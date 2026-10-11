# Handshake system design

This document decides how one Next.js app, its `lib/deal` module, Postgres, PayPal, Anthropic, Resend and the Render cron fit together, what each part may do, and how a deal moves money safely when any of them fails.

As of 2026-10-09. Names (states, commands, endpoints, tables, columns, env vars) are spelled as in [decisions.md](decisions.md). The original brief is [brief/02-system-design.md](brief/02-system-design.md); where they differ, decisions.md wins. External facts come from [research/paypal.md](research/paypal.md), [research/stack.md](research/stack.md) and [research/claude-api.md](research/claude-api.md). Related working documents: [01-requirements.md](01-requirements.md), [03-database-schema.md](03-database-schema.md), [04-api-spec.md](04-api-spec.md), [05-ai-spec.md](05-ai-spec.md), [06-test-plan.md](06-test-plan.md), [07-setup-deployment.md](07-setup-deployment.md), [08-ui-spec.md](08-ui-spec.md), [09-ag-studio.md](09-ag-studio.md). Response shapes are defined once, in 04-api-spec.md; this document points at them and does not repeat them.

## 1. Overview

Handshake is one Next.js 16 app (App Router, TypeScript, Node runtime) with one Postgres database and one daily cron job, all on Render (decisions B1). The browser talks only to `/api/*` and to PayPal's approval popup. Every deal is owned by one deep module, `lib/deal/`, which is the only code that changes `deals.status`, writes `deal_events`, or calls PayPal authorize, capture, void or Payouts (B2). Route handlers are thin (B4). The AI (Claude) returns JSON verdicts; a fixed function in code, `decide()`, turns verdicts into one of four actions (D9); the model never calls PayPal and has no tools. PayPal facts (an authorization was created, a capture completed, a payout succeeded) can arrive from an API response or a webhook, and each is applied exactly once, from whichever arrives first (C3). The verdict runs inside the evidence request: the AI call is capped at 17 s inside a 19 s abort signal, the request typically takes 6 to 12 s and about 40 s in the worst case, and the UI waits 45 s (B5). Photos live in Postgres as `bytea` and are served through HMAC-signed URLs (B6).

```
+------------------------------------------------------------------------------------+
| Browser  (buyer on desktop, seller on a phone)                                      |
|   pages:  /   /new   /deal/[code]   /ledger   /dashboard   /me                      |
|   client code: photo downscale (1600 px, JPEG 0.85), demo-kit canvas,              |
|   PayPal buttons (@paypal/react-paypal-js, intent "authorize"), AG Grid, AG Studio |
+--------------------+----------------------------------------------+----------------+
                     | fetch /api/*  (JSON or multipart;             | PayPal popup
                     | cookie hs_session)                            | (approval only)
                     v                                               v
+---------------------------------------------------------+   +---------------------+
| Next.js app   (Render web service, Node runtime)         |   | PayPal sandbox      |
|                                                         |   |   Orders v2         |
|  app/api/*  route handlers                              |   |   Payments v2       |
|    session -> Zod -> lib/* -> DealError -> HTTP          |   |   Payouts v1        |
|        |                                                |   |   Webhooks          |
|        v                                                |   +----+-----------^----+
|  lib/deal   commands, facts, tick, queries              |        |           |
|    owns deals.status, deal_events and every money call  |        | webhooks  | REST
|     |          |          |          |         |         |        | (signed)  | (SDK + fetch)
|     v          v          v          v         v         |        |           |
|  lib/paypal  lib/ai    lib/email   lib/files  lib/auth  |<-------+           |
|  lib/db (Prisma)                                        |--------------------+
+------+-----------+-----------+-----------------+--------+
       |           |           |                 |
       v           v           v                 v
   Postgres    Anthropic     Resend      (photo bytes are in Postgres: files.bytes)
   (Render)    Messages API  email

   Render cron  (0 6 * * *)  --- POST /api/jobs/tick  (Authorization: Bearer CRON_SECRET) --->  Next.js app
```

## 2. Components

Each component has one job and a short list of things it must never do.

| Component | Responsibility | May | May not |
| --- | --- | --- | --- |
| Browser (pages in `app/`, client components in `components/`) | Role-aware pages; downscale photos before upload; compose the handwritten-code demo photo on a canvas (F5); host the PayPal buttons; AG Grid ledger and AG Studio dashboard | Call `/api/*`; open the PayPal popup via the JS SDK with the public `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Call PayPal REST or Anthropic; hold any secret; decide anything about a deal |
| Route handlers (`app/api/**/route.ts`) | HTTP edge | Read the session; validate the body with Zod; call `lib/deal`, `lib/auth`, `lib/files`; map `DealError` to HTTP (H2); read the raw webhook body | Contain a business rule; touch `deals.status`; call PayPal or Anthropic directly |
| `lib/deal` | Everything about a deal: commands, PayPal facts, `tick()`, queries, access check, transition table, `decide()`, idempotency keys, event writing, evidence pack | Read and write every table; call the `paypal`, `ai`, `email`, `clock` deps | Import Next.js request APIs (`cookies()`, `headers()`); know about HTTP; let model output reach a PayPal argument |
| `lib/paypal` | Adapter with seven methods (E1): create order, authorize order, capture authorization, void authorization over `@paypal/paypal-server-sdk` 2.5.0; create payout, cancel payout item and webhook signature verification over raw `fetch`; plus three reads for reconciliation (E12): get capture and get authorization over the SDK, get payout batch over raw `fetch`; OAuth token cache for the raw calls (E1, E6) | Send `PayPal-Request-Id` on every write; throw `PayPalError` carrying PayPal's `debug_id` read as in 3.4 | Retry a POST on its own (the SDK's `maxNumberOfRetries` stays 0); decide which call to make; be called from anywhere except `lib/deal` (money calls) and the webhook route (verification) |
| `lib/ai` | Adapter over `@anthropic-ai/sdk` as specified in [05-ai-spec.md](05-ai-spec.md): prompts `extract-v1` and `judge-v1`, hand-written JSON schemas, Zod validation, timeouts (D1 to D5, D10, D11). The D8 hash check is not here: `lib/deal/verdict.ts` runs `hashCheck()` before `judge()` | `extract()` throws `DealError` (`ai_unavailable`, `unsupported_currency`, `condition_not_checkable`); `judge()` returns a verdict for every condition on every input, including timeout, refusal, API error and invalid JSON | Throw from `judge()`; see a PayPal id or key; call PayPal; recommend an action |
| `lib/auth` | `hs_session` JWT cookie, magic-link token, demo personas (F1 to F3) | Sign and verify `jose` HS256 tokens; set and clear the cookie; upsert `users` by email | Know anything about deals |
| `lib/files` | Upload validation (mime by magic bytes, size, sha256) and HMAC-signed file URLs (B6) | Sign and verify `exp` and `sig` with `FILE_URL_SECRET` | Decide who may upload (that is `lib/deal`'s access check) |
| `lib/email` | Resend adapter and console adapter for the magic link and the two deal notices (5.6) | Send one message | Block or fail a transaction: `lib/deal` sends after commit and logs failures |
| Postgres (Render `0.1c-256mb`, 5 GB) | All state, photo bytes, the append-only `deal_events` audit log, `webhook_events` | | |
| PayPal sandbox | Holds, captures, voids, Payouts, webhooks | | |
| Anthropic | `claude-sonnet-5-5` for extraction and judging | | Hold tools or credentials |
| Resend | Magic links and the two notices in 5.6 (test sender delivers only to the account owner until a domain is verified, F2) | | |
| Render cron (`0 6 * * *`) | `curl -X POST /api/jobs/tick` with `CRON_SECRET` once a day (J2) | | Run app code itself |

## 3. The `lib/deal` interface

`lib/deal` exposes three command entry points, four queries and two helpers for creation and upload; everything else in it is private. All code below is TypeScript as it will appear in `lib/deal/types.ts` and `lib/deal/index.ts`.

### 3.1 Actor, commands, public functions

```ts
// lib/deal/types.ts

export type DealStatus =
  | "draft" | "terms_agreed" | "held" | "proof_submitted"
  | "in_review" | "captured" | "paid" | "voided";
export type PaymentStatus =
  | "created" | "approved" | "authorized" | "capture_pending"
  | "captured" | "declined" | "voided";
export type PayoutStatus = "pending" | "success" | "failed";
export type EvidenceType = "photo" | "tracking";
export type EvidenceKind = "photo" | "tracking" | "note";
export type VerdictResult = "pass" | "fail" | "unclear";
export type Decision = "capture" | "request_fix" | "buyer_review" | "void";
export type CarrierStatus = "delivered" | "in_transit" | "unknown";
export type Role = "buyer" | "seller";
export type EventActor = "buyer" | "seller" | "system" | "paypal" | "ai";

/** The signed-in user. lib/deal derives the role from deals.buyer_id and deals.seller_id. */
export type Actor = { user_id: string };

export type ConditionInput = { text: string; evidence_type: EvidenceType };

/** One variant per command in decisions.md C2. The route name that carries each is in section 4. */
export type Command =
  | { type: "edit_terms"; item_title: string; amount_minor: number | null;
      deadline_days: number | null; conditions: ConditionInput[] }
  | { type: "join" }
  | { type: "accept"; terms_version: number }
  | { type: "start_payment" }
  | { type: "confirm_approval"; order_id: string }      // the body of POST .../payment/authorize (04 section 7.2)
  | { type: "submit_evidence"; file_ids: string[]; tracking_number: string | null; note: string | null }
  | { type: "review"; decision: "approve" | "reject"; note: string | null }   // the route maps a missing note to null (04 section 9.2; C6)
  | { type: "cancel" }
  | { type: "retry_payout" };

export type CreateDealInput = { text: string };                               // the sentence, <= 500 chars
export type AddFileInput = { purpose: "reference" | "evidence"; mime: "image/jpeg" | "image/png" | "image/webp";
                             bytes: Uint8Array };

/** A verified, parsed PayPal webhook event, as built by app/api/webhooks/paypal/route.ts. */
export type PaypalWebhookEvent = {
  id: string;                         // PayPal event id; primary key of webhook_events
  event_type: string;                 // one of the names in decisions.md E5
  create_time: string;
  resource_type: string;
  resource: Record<string, unknown>;  // the v2 resource (order, authorization, capture or payout item)
  verified: boolean;                  // result of lib/paypal/verify.ts
  body: unknown;                      // the parsed raw body, stored in webhook_events.body
};

export type TickReport = {
  voided: string[];                   // deal codes voided for a passed deadline
  verdicts_rerun: string[];           // deal codes whose verdict step was finished
  reconciled: string[];               // deal codes where reconcile() applied a PayPal fact (E12; 5.7)
  errors: { code: string; message: string }[];
};
```

```ts
// lib/deal/index.ts  (the whole public surface)

// Response types (DealView, DealPreview, LedgerRow, DealEvent, EvidencePack, FileRef) are
// 04-api-spec.md sections 3, 6.2 and 10.2 verbatim; lib/deal/types.ts holds them and the routes return them unchanged.
export function createDeal(actor: Actor, input: CreateDealInput, deps: Deps): Promise<DealView & { rejected: { text: string; suggestion: string }[] }>;
export function addFile(code: string, actor: Actor, input: AddFileInput, deps: Deps): Promise<FileRef>;

export function handle(code: string, actor: Actor, command: Command, deps: Deps): Promise<DealView>;
export function applyPaypalEvent(event: PaypalWebhookEvent, deps: Deps):
  Promise<{ outcome: "unverified" | "already_processed" | "applied" | "noop" | "unknown_deal" }>;
export function tick(now: Date, deps: Deps): Promise<TickReport>;

export function getDeal(code: string, actor: Actor, deps: Deps): Promise<DealView | DealPreview>;
export function listDeals(actor: Actor, deps: Deps): Promise<LedgerRow[]>;
export function getEvents(code: string, actor: Actor, deps: Deps): Promise<DealEvent[]>;
export function getEvidencePack(code: string, actor: Actor, deps: Deps): Promise<EvidencePack>;
```

Rules that hold for every function:

- `handle()` returns the full `DealView` after the command, so every command endpoint answers `200` with the same shape `GET /api/deals/{code}` returns, with one exception: `POST /api/deals/{code}/payment` calls `handle(code, actor, { type: "start_payment" })` and answers `200 { order_id: view.payment.paypal_order_id }`, which is what the PayPal button's `createOrder` callback must return (04 section 7.1, E9). `createDeal()` answers `201` with a `DealView` plus the extraction's `rejected[]` list.
- `addFile()` writes no `deal_events` row and changes no deal column (C6: file uploads write no event). A `reference` upload is allowed only while the deal is `draft` and `seller_accepted_version` is null (else `invalid_state`, "Edit the terms before adding photos."); an `evidence` upload only while `held` and before `deadline_at` (04 section 8.1).
- A command that is not allowed in the current status throws `DealError("invalid_state")` and writes nothing (C2).
- Commands on a seeded deal (`deals.seeded = true`, F6) throw `invalid_state`: seeded deals are history, not live.
- `applyPaypalEvent()` and `tick()` take no actor; they write events with `actor` `paypal` and `system`.
- `getDeal()` returns `DealPreview` for a signed-in non-party on a `draft` deal with no seller (F4), `DealView` for a party, and throws `not_a_party` otherwise.

### 3.2 Views

The response types are [04-api-spec.md](04-api-spec.md) verbatim and are not repeated here: `DealView`, `DealPreview`, `FileRef`, `Condition`, `Submission`, `Verdict`, `Payment`, `Payout`, `DealEvent` and `Party` (04 section 3), `LedgerRow` (04 section 6.2) and `EvidencePack` (04 section 10.2). `lib/deal/types.ts` declares them once and `lib/deal/views.ts` and `lib/deal/pack.ts` build them. There is no `actions[]` field: the UI derives what the caller may do from `status` and `role` ([08-ui-spec.md](08-ui-spec.md) section 7.3). `GET /api/dashboard/data` is composed in its route from `listDeals`, `getDeal` and `getEvents` with `lib/dashboard-rows.ts` (04 section 14, 09 section 5.2); no dashboard query is added to `lib/deal`.

How the view is role-aware:

- `role` is computed from the deal row (`buyer_id`, `seller_id`); `DealPreview.role` is `"preview"` (04 section 3; F4).
- `seller.has_paypal_email` is a boolean for both parties; the seller's `paypal_email` itself appears only in the evidence pack's `parties.seller` and only when the caller is the seller; `EvidencePack.payouts[].recipient_email` likewise appears only for the seller.
- `FileRef.url` is minted inside `buildDealView` and `getEvidencePack`, after the access check, and expires 10 minutes after the response (B6).
- `payment` is null until `start_payment` and always null on seeded deals; `payouts` is ascending by `attempt`.

### 3.3 Errors

The code list is decisions H2, exactly; no document adds a code.

```ts
// lib/deal/errors.ts
export type DealErrorCode =
  | "invalid_input" | "not_signed_in" | "not_a_party" | "deal_not_found" | "file_too_large"
  | "invalid_state" | "terms_not_accepted" | "terms_version_mismatch" | "paypal_email_required"
  | "condition_not_checkable" | "unsupported_currency" | "too_many_files" | "rate_limited"
  | "internal_error" | "paypal_error" | "ai_unavailable";

export class DealError extends Error {
  constructor(public code: DealErrorCode, message?: string, public debug_id?: string) { super(message ?? code); }
}

export const HTTP_STATUS: Record<DealErrorCode, number> = {
  invalid_input: 400, not_signed_in: 401, not_a_party: 403, deal_not_found: 404, file_too_large: 413,
  invalid_state: 409, terms_not_accepted: 409, terms_version_mismatch: 409, paypal_email_required: 409,
  condition_not_checkable: 422, unsupported_currency: 422, too_many_files: 422, rate_limited: 429,
  internal_error: 500, paypal_error: 502, ai_unavailable: 503,
};
```

| Code | Thrown by | When |
| --- | --- | --- |
| `invalid_input` | routes (Zod) and `lib/deal` | Body fails validation; `accept` while `amount_minor` or `deadline_days` is null; `submit_evidence` without a photo when a photo condition exists, or without a tracking number when a tracking condition exists; `confirm_approval` with an `order_id` that is not the stored one; `POST /api/auth/demo` while `DEMO_LOGIN` is not `true` ("Demo login is disabled.") |
| `not_signed_in` | routes (`lib/http.ts`) | No valid `hs_session` cookie |
| `not_a_party` | `lib/deal/access.ts` | Caller is neither buyer nor seller and the preview exception (F4) does not apply |
| `deal_not_found` | `lib/deal/access.ts` | Unknown `public_code` |
| `file_too_large` | `lib/files/validate.ts` | File over 2 MB (H3) |
| `invalid_state` | `lib/deal/transitions.ts`, `lib/deal/commands.ts` | The command has no row in the transition table for the current status; the deal is seeded; `submit_evidence` or an evidence upload at or after `deadline_at` ("The deadline has passed"); a reference upload after the seller accepted; `start_payment` while a `PENDING` authorization is stored (7); `retry_payout` when the latest payout is `success`, or `pending` with a `paypal_batch_id` (5.1) |
| `terms_not_accepted` | `lib/deal/commands.ts` | `start_payment` or `confirm_approval` while the deal is `draft` |
| `terms_version_mismatch` | `lib/deal/commands.ts` | `accept { terms_version }` does not equal `deals.terms_version` |
| `paypal_email_required` | `lib/deal/commands.ts` | The seller accepts, or retries a payout, without a `paypal_email` |
| `condition_not_checkable` | `lib/ai/extract.ts`, surfaced by `createDeal` | The model read the sentence and found zero checkable conditions; the message carries the suggested rewording when there is one. Nothing else maps to this code |
| `unsupported_currency` | `lib/ai/extract.ts`, surfaced by `createDeal` | Extraction returned a currency other than `"USD"` or `null` (A6) |
| `too_many_files` | `addFile`, `submit_evidence` | More than 4 reference photos per deal or 6 evidence photos per submission (H3) |
| `rate_limited` | `app/api/studio/agent/route.ts` only | The Studio agent proxy's per-session limit (G3) |
| `internal_error` | `lib/http.ts` (`toResponse`) and the webhook route | Any unhandled exception; a webhook processing failure (`500` so PayPal retries, E6) |
| `paypal_error` | `lib/deal` wrapping `PayPalError` | PayPal returned 4xx (other than the cases mapped to facts in 5.3) or 5xx, or timed out; the message includes PayPal's `debug_id` |
| `ai_unavailable` | `lib/ai/extract.ts`, surfaced by `createDeal` | Extraction failed after its one retry: timeout, 429/5xx, refusal or bad output (D4); message "the model did not answer; try again" |

Uncaught exceptions answer `500 { "error": { "code": "internal_error", "message": "Something went wrong. Try again." } }` with no state change.

### 3.4 Deps

```ts
// lib/deal/types.ts (continued)
import type { PrismaClient } from "@/generated/prisma/client";
import type { AiDep } from "@/lib/ai";

export type Deps = { db: PrismaClient; paypal: PayPal; ai: AiDep; email: Email; clock: Clock };

export interface Clock { now(): Date }

export interface Email {
  /** Resolves on success and on failure; failures are logged by the adapter. Never throws. */
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

/** Seven methods (E1) plus three reads (E12). Every write sends the given idempotency key as PayPal-Request-Id and throws PayPalError on any non-2xx
 *  except the cases named on the method. */
export interface PayPal {
  createAuthorizeOrder(
    input: { code: string; amount_minor: number; description: string },   // custom_id = code (E2); one purchase unit
    requestId: string,                                                      // order-{code}-{n}
  ): Promise<{ paypal_order_id: string }>;

  authorizeOrder(
    paypal_order_id: string,
    requestId: string,                                                      // auth-{code}
  ): Promise<{ authorization_id: string; status: "CREATED" | "PENDING" | "DENIED" | "CAPTURED" | "PARTIALLY_CAPTURED" | "VOIDED";
              expiration_time: string; reason: string | null }>;   // purchase_units[0].payments.authorizations[0]; reason = status_details.reason when PENDING

  captureAuthorization(
    authorization_id: string,                 // always the original (E3)
    amount_minor: number,                     // sent explicitly, with final_capture: true
    requestId: string,                        // capture-{code}-{n}
  ): Promise<{ capture_id: string; status: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED";
              reason: string | null }>;      // status_details.reason when PENDING or DECLINED

  /** PREVIOUSLY_VOIDED resolves as success (C4). A refusal because the authorization is captured
   *  ("You cannot void an authorized payment that has been fully captured", research/paypal.md "3. Payments"; the issue
   *  name is not in the research) throws PayPalError with status 422; lib/deal answers any other 422 on a void by
   *  re-sending capture-{code}-{n} (C4, 5.3). */
  voidAuthorization(authorization_id: string, requestId: string): Promise<void>;   // void-{code} or void-{authorization_id}

  /** Raw fetch POST /v1/payments/payouts. A rejection for a sender_batch_id used in the last 30 days
   *  (research/paypal.md "5. Payouts", "Duplicate handling") is NOT an error: the adapter follows the HATEOAS link in the
   *  error body to the original payout, reads its payout_batch_id and batch_status, and resolves as if the create had
   *  answered 201. The create response carries no item id (same section). */
  createPayout(
    input: { sender_batch_id: string; sender_item_id: string; receiver: string; amount_minor: number; note: string },
    requestId: string,                        // payout-{code}-{n}, equal to sender_batch_id
  ): Promise<{ payout_batch_id: string; batch_status: "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED" }>;

  /** Raw fetch POST /v1/payments/payouts-item/{id}/cancel (E1, E7). An item that is already cancelled or returned resolves
   *  as success; anything else non-2xx throws PayPalError. */
  cancelPayoutItem(payout_item_id: string): Promise<void>;

  /** Reads for reconcile() (E12, 5.7). No request id; any non-2xx throws PayPalError. SDK GET /v2/payments/captures/{id}
   *  and GET /v2/payments/authorizations/{id}; raw fetch GET /v1/payments/payouts/{batch_id}. */
  getCapture(capture_id: string): Promise<{ capture_id: string; status: CaptureStatus; reason: string | null }>;   // status unions as in lib/paypal/types.ts
  getAuthorization(authorization_id: string):
    Promise<{ authorization_id: string; status: AuthorizationStatus; expiration_time: string; reason: string | null }>;
  getPayoutBatch(payout_batch_id: string): Promise<{ payout_batch_id: string; batch_status: PayoutBatchStatus;
    items: { payout_item_id: string; sender_item_id: string | null; transaction_status: PayoutItemStatus; error_name: string | null }[] }>;

  /** E6 self-verification (9.4). Never throws; a cert that cannot be fetched is reported as fetch_failed so the route answers 500. */
  verifyWebhook(rawBody: string, headers: Record<string, string | null>):
    Promise<{ result: "verified" | "unverified" | "fetch_failed"; webhook_id: string | null }>;
}

export class PayPalError extends Error {
  constructor(public status: number, public name_: string | null, public debug_id: string | null, public body: unknown) { super(name_ ?? `paypal_${status}`); }
}
```

Where `PayPalError`'s fields come from:

- SDK calls throw `ApiError` (research/paypal.md "7. `@paypal/paypal-server-sdk`"): `status = e.statusCode`; `body = e.body` is the raw response text, "JSON with name/details[].issue", so the adapter does `JSON.parse` inside a try; `name_ = body.details?.[0]?.issue ?? body.name ?? null` (on the real wire `name` is the generic `UNPROCESSABLE_ENTITY` and the useful code, `PREVIOUSLY_VOIDED` or `AUTHORIZATION_VOIDED`, sits in `details[0].issue`, so the issue wins; `errorName` in `lib/paypal/index.ts`); `debug_id = body.debug_id ?? null`. The research documents `.result` and `.headers` on `ApiResponse`, not on `ApiError`; whether `ApiError` carries them too is UNVERIFIED, so the adapter reads the body and falls back to `null`.
- Raw `fetch` calls (Payouts, cancel) read `name_` the same way and `debug_id` from the JSON body, falling back to the `paypal-debug-id` response header.
- A timeout (SDK `timeout: 10_000`, `AbortSignal.timeout(10_000)` on fetch) becomes `PayPalError(0, "timeout", null, null)`.

The AI dependency is defined by [05-ai-spec.md](05-ai-spec.md) and is reproduced here verbatim from its sections 1, 2.2, 3.1, 3.6, 4.1, 4.7 and 6.1 so that `lib/deal/verdict.ts` and `lib/deal/commands.ts` compile against `lib/ai` as written there:

```ts
// lib/ai/index.ts (05 section 1)
export interface AiDep {
  extract(input: ExtractInput): Promise<ExtractOutput>; // throws DealError (05 section 3.6)
  judge(input: JudgeInput): Promise<JudgeOutput>;       // never throws (05 section 5)
}

// lib/ai/call-json.ts (05 section 2.2)
export type AiFailure =
  | { kind: "timeout" }
  | { kind: "api_error"; status: number | null; type: string | null; message: string }
  | { kind: "refusal"; category: string | null }
  | { kind: "stop"; stop_reason: string }        // "max_tokens" or any other non-end_turn stop
  | { kind: "no_text" }
  | { kind: "bad_json" }
  | { kind: "schema_mismatch"; issues: string };

/** Stored verbatim in verdicts.raw_response (05 section 8). */
export interface RawResponse {
  request_id: string | null;
  model: string;                 // the model id we asked for
  stop_reason: string | null;
  stop_category: string | null;  // msg.stop_details?.category on refusal
  usage: { input_tokens: number; output_tokens: number } | null;
  latency_ms: number;
  text: string | null;           // the raw text block, before JSON.parse
  output: unknown;               // JSON.parse(text) when it parsed, else null
  error: AiFailure | null;
}

// lib/ai/extract.ts (05 sections 3.1 and 3.6)
export interface ExtractInput {
  sentence: string;  // 1 to 500 characters, validated by the route before this call (H3)
  today: Date;       // deps.clock.now()
}
export interface ExtractOutput {
  item_title: string;
  amount_minor: number | null;
  currency: "USD" | null;
  deadline_days: number | null;
  conditions: { text: string; evidence_type: "photo" | "tracking" }[]; // 1 to 4 model conditions; lib/deal/terms.ts appendCodeCondition() adds the code condition (D6)
  rejected: { text: string; suggestion: string }[];
  model: string;
  prompt_version: typeof EXTRACT_PROMPT_VERSION;
  raw_response: RawResponse;
}

// lib/ai/judge.ts (05 sections 4.1 and 4.7)
export type ImgMime = "image/jpeg" | "image/png" | "image/webp";   // B6: what the server accepts

export interface JudgePhoto { id: string; mime: ImgMime; sha256: string; bytes: Uint8Array }   // id is files.id

export interface JudgeInput {
  code: string;                                   // deals.public_code
  conditions: { id: string; text: string; evidence_type: "photo" | "tracking" }[]; // conditions rows ordered by position, 1 to 5
  reference_photos: JudgePhoto[];                 // files with purpose reference, ordered by created_at, 0 to 4
  evidence_photos: JudgePhoto[];                  // evidence photos of this submission, in upload order, 0 to 6
  tracking_number: string | null;                 // evidence row kind tracking, or null
  carrier_status: "delivered" | "in_transit" | "unknown" | null; // carrierStatus(tracking_number); null when no number
  note: string | null;                            // evidence row kind note, at most 1,000 characters (H3)
  submission_no: 1 | 2;
}
export type Result = "pass" | "fail" | "unclear";
export interface Verdict {
  condition_id: string;          // database id
  result: Result;
  confidence: number;            // 0 to 1, clamped, not rounded (verdicts.confidence is double precision)
  reason: string;
  evidence_used: string[];       // labels (e1, r2, tracking, note), kept inside raw_response too
}
export interface JudgeOutput {
  verdicts: Verdict[];           // exactly one per input condition, in input order
  model: string;                 // model(); "none" only on rows written by the D8 guardrail (6.1)
  prompt_version: typeof JUDGE_PROMPT_VERSION | "guardrail-v1";   // judge() always returns JUDGE_PROMPT_VERSION; "guardrail-v1" comes from hashCheck() (6.1)
  raw_response: RawResponse | HashSkip;
}
export interface HashSkip { skipped: "hash_match"; matches: { evidence: string; reference: string; sha256: string }[]; latency_ms: number }

// lib/deal/verdict.ts (05 section 6.1)
export const GUARDRAIL_VERSION = "guardrail-v1" as const;   // bumped when this function's rules change
export function hashCheck(input: JudgeInput): JudgeOutput | null;   // every photo condition fails at confidence 1 when an evidence sha256 equals a reference sha256; null otherwise
```

`lib/deal/verdict.ts` runs `hashCheck()` (05 section 6.1) before `deps.ai.judge`; `judge()` never sees a hash match. `judge()` answers `unclear` for every condition on any failure (05 section 5), so `lib/deal` never branches on an AI failure: it stores whatever `hashCheck()` or `judge()` returns and calls `decide()`. `extract()` throws `DealError` with `ai_unavailable`, `unsupported_currency` or `condition_not_checkable`, which `createDeal` lets through unchanged; `createDeal` then calls `appendCodeCondition(code, out.conditions)` (`lib/deal/terms.ts`, D6).

The real adapters live in `lib/paypal/index.ts`, `lib/ai/index.ts`, `lib/email/index.ts`; `lib/deps.ts` builds the `Deps` from env. Fakes are in section 10.

## 4. Module layout

One line per file. Generated code and tests are listed at the end for orientation.

```
lib/
  deal/
    index.ts          Public surface from 3.1: createDeal, addFile, handle, applyPaypalEvent, tick, the queries; re-exports types
    types.ts          Every type in section 3
    errors.ts         DealError, DealErrorCode, HTTP_STATUS
    access.ts         loadDeal(code, actor): row + role, or preview, or not_a_party / deal_not_found
    transitions.ts    The C2 table as data; transition(tx, deal, to, actor, cause, payload) with the guarded UPDATE + event insert
    commands.ts       One function per Command variant plus createDeal and addFile
    facts.ts          applyFact(): the once-only rule (5.3), side effects, the payout trigger
    verdict.ts        runVerdict(): builds JudgeInput (carrier D7), hashCheck() (D8), ai.judge, verdict rows, decide(), the resulting action
    decide.ts         decide(verdicts, deal, limits) and limitsFromEnv() (D9, 05 section 7); lib/env.ts exports LIMITS = limitsFromEnv()
    terms.ts          appendCodeCondition(code, conditions) (D6): the deal-code condition, always last, only when a photo condition exists
    keys.ts           order-{code}-{n}, auth-{code}, void-{code}, void-{authorization_id}, capture-{code}-{n}, payout-{code}-{n} (E4, 8.1)
    webhooks.ts       PayPal event -> (deal lookup, fact) mapping (5.5); E8 handling for CHECKOUT.ORDER.APPROVED
    tick.ts           tick(now): deadline voids and stuck-verdict reruns (B7)
    views.ts          buildDealView, buildDealPreview, buildLedgerRow (shapes: 04 sections 3, 6.2)
    pack.ts           getEvidencePack JSON builder (shape: 04 section 10.2)
    notify.ts         The two notices (5.6) sent after commit through deps.email
    code.ts           newPublicCode(): HS- + 4 chars from 23456789ABCDEFGHJKMNPQRSTUVWXYZ, retried on collision (I4)
  carrier.ts          carrierStatus(trackingNumber): D7 mock, pure (05 section 4.1; imported by the browser too, 08)
  dashboard-rows.ts   toDashboardDeal, toDashboardVerdicts, toDecisions and the DashboardData type (04 section 14, 09 section 5.2); pure, unit-tested
  paypal/
    types.ts          PayPal interface and PayPalError (re-exported from lib/deal/types)
    index.ts          Real adapter: SDK OrdersController/PaymentsController for order, authorize, capture, void; fetch for create payout, cancel payout item
    token.ts          getToken(): client-credentials token cached until expires_in minus 60 s, for the raw calls
    verify.ts         verifyWebhook(rawBody, headers): E6 steps, cert cache; wired as the PayPal port's seventh method
    fake.ts           FakePayPal (section 10)
  ai/                 Laid out by 05 section 1; listed here for orientation
    client.ts         claude() lazy client, model()
    call-json.ts      callJson(), AiError, RawResponse
    schemas.ts        EXTRACT_SCHEMA, ExtractZ, VERDICT_SCHEMA, VerdictsZ, CONDITION_IDS, EVIDENCE_IDS
    prompts.ts        EXTRACT_SYSTEM, JUDGE_SYSTEM, EXTRACT_PROMPT_VERSION, JUDGE_PROMPT_VERSION, message builders
    extract.ts        extract(input, client): model call, finalizeTerms()
    judge.ts          judge(input, client): model call, post-processing; never throws
    index.ts          AiDep interface and the real adapter
    fake.ts           fake AiDep returning canned results (section 10)
  email/
    types.ts          Email interface
    index.ts          Resend adapter (from EMAIL_FROM, key RESEND_API_KEY); logs and swallows errors
    console.ts        Console adapter used in development and tests
  auth/
    session.ts        signSession, readSession (jose HS256, cookie hs_session, 30 days), clearSession
    magic-link.ts     createMagicToken (15 min), verifyMagicToken, link builder using APP_URL
    demo.ts           signInDemoPersona("buyer" | "seller") when DEMO_LOGIN=true
  files/
    validate.ts       sniffMime (magic bytes), size <= 2 MB, sha256 -> throws file_too_large / invalid_input
    urls.ts           signFileUrl(id, ttlSec = 600), verifyFileUrl(id, exp, sig) with FILE_URL_SECRET
  db.ts               Prisma singleton with @prisma/adapter-pg (connectionTimeoutMillis 5000)
  env.ts              Zod-validated process.env for every name in decisions.md J3; fails fast at boot; exports LIMITS = limitsFromEnv() (05 section 7)
  deps.ts             getDeps(): real Deps from env (console email when RESEND_API_KEY is unset)
  http.ts             requireSession(req), parseBody(schema, req), toResponse(error), json(data, status)
  clock.ts            SystemClock and FixedClock

app/
  layout.tsx                              Root layout, header with persona switcher when DEMO_LOGIN=true
  page.tsx                                Landing and sign-in (magic link form, demo persona buttons)
  new/page.tsx                            Sentence -> terms review -> reference photos -> share link
  deal/[code]/page.tsx                    Role-aware deal page (buyer, seller, preview)
  ledger/page.tsx                         AG Grid ledger over listDeals
  dashboard/page.tsx                      AG Studio dashboard over GET /api/dashboard/data
  me/page.tsx                             Profile: display_name, paypal_email
  api/health/route.ts                     GET -> { ok: true }; no DB, no AI
  api/auth/magic-link/route.ts            POST { email } -> sends the link (console in development)
  api/auth/callback/route.ts              GET ?token= -> sets hs_session, redirects to /ledger
  api/auth/demo/route.ts                  POST { persona } -> sets hs_session; 400 invalid_input unless DEMO_LOGIN=true
  api/auth/sign-out/route.ts              POST -> clears hs_session
  api/me/route.ts                         GET profile; PATCH { display_name, paypal_email }
  api/deals/route.ts                      POST createDeal (201); GET listDeals
  api/deals/[code]/route.ts               GET getDeal
  api/deals/[code]/terms/route.ts         PATCH -> handle edit_terms
  api/deals/[code]/join/route.ts          POST -> handle join
  api/deals/[code]/accept/route.ts        POST { terms_version } -> handle accept
  api/deals/[code]/payment/route.ts       POST -> handle start_payment; answers { order_id } (the only command endpoint that does not return DealView)
  api/deals/[code]/payment/authorize/route.ts   POST { order_id } -> handle confirm_approval
  api/deals/[code]/files/route.ts         POST multipart (file, purpose) -> addFile (201 FileRef)
  api/deals/[code]/evidence/route.ts      POST { file_ids, tracking_number, note } -> handle submit_evidence (200, final state)
  api/deals/[code]/review/route.ts        POST { decision } -> handle review
  api/deals/[code]/cancel/route.ts        POST -> handle cancel
  api/deals/[code]/payout/retry/route.ts  POST -> handle retry_payout
  api/deals/[code]/events/route.ts        GET getEvents
  api/deals/[code]/evidence-pack/route.ts GET getEvidencePack as an attachment handshake-{code}-evidence-pack.json (04 section 10.2)
  api/files/[id]/route.ts                 GET ?exp=&sig= -> bytes with Content-Type and Cache-Control: private, max-age=600
  api/webhooks/paypal/route.ts            POST raw body -> verify -> applyPaypalEvent -> 200 / 400 (bad signature) / 500 (cert fetch failed or processing threw)
  api/jobs/tick/route.ts                  POST bearer CRON_SECRET -> tick(now) -> 200 TickReport
  api/dashboard/data/route.ts             GET: listDeals + getDeal + getEvents -> lib/dashboard-rows.ts -> DashboardData (04 section 14)
  api/studio/agent/route.ts               POST Studio agent proxy to Claude, thinking off (could, G3)

components/                               Client components: PayButton, PhotoUploader, ConditionList, VerdictList, DealTimeline, Ledger, Studio
generated/prisma/                         Prisma client output (gitignored; alias @/generated/prisma/client)
prisma/schema.prisma, prisma/migrations/, prisma/seed.ts
eval/cases/<name>/, eval/run.ts           The 30-case eval (D12)
tests/unit/, tests/int/, tests/e2e/       Vitest unit, Vitest integration (real Postgres, fakes), Playwright happy path
scripts/sandbox/                          SB-1 to SB-11 scripts against the PayPal sandbox
public/demo/                              Demo kit (F5)
```

## 5. State machine

`deals.status` is one of exactly eight values (C1), and only the transitions below exist (C2).

### 5.1 Transitions

The table is decisions C2 verbatim.

| From | Trigger | To | Side effect |
| --- | --- | --- | --- |
| draft | `edit_terms` (buyer) | draft | `terms_version` + 1, both accepted versions cleared |
| draft | `join` (signed-in non-party, `seller_id` null) | draft | sets `seller_id` |
| draft | `accept` by one party | draft | records that party's accepted version |
| draft | `accept` when both accepted versions equal `terms_version` | terms_agreed | seller must have `paypal_email` (else `paypal_email_required`) |
| terms_agreed | `edit_terms` (buyer) | draft | as above |
| terms_agreed | `start_payment` (buyer) | terms_agreed | returns the stored `paypal_order_id` without a PayPal call when the stored order is under 6 h old and still `created`; otherwise creates order `n + 1` with key `order-{code}-{n+1}` (E4); `payments.status = created` |
| terms_agreed | fact `authorization_created` (from `confirm_approval` or a webhook, whichever first) | held | stores `authorization_id`, `authorized_at`, `auth_expires_at`; sets `deadline_at = authorized_at + deadline_days` |
| held | `submit_evidence` (seller) | proof_submitted | stores evidence rows, then runs the verdict in the same request |
| proof_submitted | decision `capture` | captured | calls capture with the **original** authorization id; on `COMPLETED` triggers the payout (E7) |
| proof_submitted | decision `request_fix` | held | `fix_attempts_used = 1` |
| proof_submitted | decision `buyer_review` (includes AI failure, timeout, invalid output, refusal) | in_review | notifies the buyer |
| proof_submitted | decision `void` | voided | calls void |
| in_review | `review { approve }` (buyer) | captured | calls capture |
| in_review | `review { reject }` (buyer) | voided | calls void |
| proof_submitted, in_review | fact `capture_completed` or `capture_pending` (a capture resource exists only because `lib/deal` requested it and died before recording it) | captured | stores `capture_id`; on `COMPLETED` triggers the payout (E7) |
| captured | fact `capture_declined` (webhook `PAYMENT.CAPTURE.DECLINED`) | in_review | notifies both parties |
| captured | fact `payout_succeeded` for the latest payout attempt | paid | none |
| paid | fact `payout_succeeded` for an earlier attempt | paid | updates that `payouts` row only (E7) |
| draft, terms_agreed, held | `cancel` (buyer or seller) | voided | calls void if an authorization exists |
| held, in_review | `tick` past `deadline_at` | voided | calls void |
| draft, terms_agreed, held, proof_submitted, in_review (`payments.capture_id` null) | fact `authorization_voided` | voided | no PayPal call |
| captured, paid (`payments.capture_id` set) | fact `authorization_voided` | unchanged | `payments.status` only; event with `from_status = to_status` |

A fact that matches no row writes a `from_status = to_status` event if it carries new PayPal detail and is otherwise a no-op; it never throws `invalid_state` and nothing is deferred (C2). The rows above carry these extra rules:

- `edit_terms` from `terms_agreed` is allowed only while no `payments` row exists. Once the buyer has clicked Pay, the terms are frozen and `cancel` is the way out. Otherwise a stale PayPal popup could create a hold for an amount the parties no longer agree on.
- Reference photos (`addFile` with `purpose = reference`) are allowed while the deal is `draft` and `seller_accepted_version` is null (04 section 8.1). The upload writes no event, does not change `terms_version` and does not clear anyone's acceptance; the precondition is what stops the seller from accepting terms whose photos then change. There is no delete for reference photos.
- `start_payment` with a stored order: `payments.status = created` and `clock.now() - payments.updated_at < 6 h` returns the stored `paypal_order_id` with no PayPal call and writes a `start_payment` event with the stored id and the current `order_attempt` (C6: created or reused); otherwise it calls `createAuthorizeOrder` with `order-{code}-{order_attempts + 1}`, then in one transaction upserts `payments` (`paypal_order_id`, `status = created`, `order_attempts + 1`) and writes `start_payment` with `{ paypal_order_id, order_attempt }`. While a `PENDING` authorization is stored (`payments.authorization_id` set with `status = approved`, see 7) `start_payment` is `invalid_state`: a second order would make a second hold.
- `submit_evidence` and an evidence upload require `clock.now() < deadline_at`, else `invalid_state` ("The deadline has passed"). `tick` runs once a day, so without this check a seller could submit up to 24 h after the deadline both parties accepted (FR-10, FR-11).
- `cancel` calls void whenever `payments.authorization_id` is set, including a `PENDING` authorization stored with `payments.status = approved`. Without an authorization there is no PayPal call and `payments.status` stays `created` or `approved` (03's CHECK `payments_auth_before_status` forbids `voided` there); the unapproved order expires on its own, and a hold that arrives afterwards is voided by 5.3.
- `retry_payout` (seller) is allowed in `captured` with `payments.status = captured` when the latest `payouts` row is `pending` with `paypal_batch_id` null, or `failed` (04 section 9.4). Two cases, decided by that row's `status`:
  - `pending` with `paypal_batch_id` null (the create call never got an answer: timeout, 5xx, or the process died after the row was committed, 7): re-send attempt `n` with the same `sender_batch_id` and key `payout-{code}-{n}` through `sendPayout(row)` (5.3). PayPal either processes it, returns the stored response for the key, or rejects the duplicate `sender_batch_id` with a link to the original, which the adapter resolves as success (3.4). The row gets its `paypal_batch_id`; on another timeout or 5xx it stays `pending` with `paypal_batch_id` null and the command still answers `200`. No new attempt. The `retry_payout` event carries `attempt: n` and `cancelled_item_id: null`.
  - `failed` (an item result `FAILED`, `BLOCKED`, `RETURNED` or `UNCLAIMED`, or a 4xx with PayPal's error name on the create call): create attempt `n + 1` with `payout-{code}-{n+1}` (E7). For `UNCLAIMED`, first `cancelPayoutItem(paypal_item_id)` in the same request; if that cancel fails the command answers `paypal_error` and the row stays `failed`, so whoever claims the first address is never paid as well as the seller. Then one transaction inserts the row `n + 1` (`pending`, `paypal_batch_id` null, `recipient_email` = the seller's current `paypal_email`) and writes the `retry_payout` event with `cancelled_item_id`; `sendPayout(row)` runs after commit.
  Either way the seller must have a `paypal_email` (`paypal_email_required`). A latest row that is `success`, or `pending` with a `paypal_batch_id` (PayPal has the batch; a webhook will come), is `invalid_state`.

```
 create
   |
   v
 [draft] <------ edit_terms (from terms_agreed; only while no payments row exists)
   |  ^
   |  +--------- edit_terms / join / accept (one party)   (stay in draft; reference uploads write nothing)
   |
   | accept (both at terms_version; seller has paypal_email)
   v
 [terms_agreed] <--+ start_payment (stays; creates or reuses the order)
   |
   | fact authorization_created   (confirm_approval or webhook, whichever first)
   v
 [held] <---------------------------+
   |                                | decision request_fix (fix_attempts_used = 1)
   | submit_evidence (seller)       |
   v                                |
 [proof_submitted] -----------------+
   |         |          |
   |         |          +--- decision void ---------------------------------> [voided]
   |         |
   |         +--- decision buyer_review --> [in_review] --- review reject ---> [voided]
   |                                          |    ^
   | decision capture          review approve |    | fact capture_declined
   v                                          v    |
 [captured] <---------------------------------+----+
   |   ^
   |   +-- fact capture_completed / capture_pending from proof_submitted or in_review (crash recovery)
   | fact payout_succeeded (latest attempt)
   v
 [paid] <--+ fact payout_succeeded (earlier attempt; payouts row only)

 Also into [voided]:   cancel (buyer or seller) from draft, terms_agreed, held
                       tick past deadline_at from held, in_review
                       fact authorization_voided from draft, terms_agreed, held, proof_submitted, in_review (capture_id null)
```

### 5.2 How a transition is written

Every status change goes through one function, inside the caller's transaction, after the deal row has been locked:

```
transition(tx, deal, to, actor, cause, payload):
  if (deal.status, cause) -> to is not a row of the table:  throw DealError("invalid_state")
  n = UPDATE deals SET status = to, updated_at = now() WHERE id = deal.id AND status = deal.status
  if n != 1:  throw DealError("invalid_state")          # belt and braces under the row lock
  INSERT deal_events (deal_id, from_status, to_status, actor, cause, payload, created_at)
  deal.status = to
```

Prisma has no row-lock API, so the lock is one raw statement at the top of every interactive transaction:

```ts
await db.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT 1 FROM "deals" WHERE "id" = ${dealId}::uuid FOR UPDATE`;
  // re-read the deal and payments rows through tx, validate, write status + event, commit
}, { timeout: 15_000 });   // Prisma's interactive-transaction timeout; set explicitly rather than relying on its default
```

Every transaction in this document starts this way; the `timeout` matters for the transactions that follow a PayPal call (8.2), which may wait on a lock held by a racing request.

Status change and `deal_events` row are always in the same transaction (C6). Every accepted command and every applied fact writes exactly one row, including those that leave `status` unchanged (`join`, `accept` by one party, `start_payment` (created or reused), `retry_payout`, `verdict`, `tick:reverify`, `fact:capture_completed` on a `captured` deal); they write the event with `from_status = to_status`. File uploads write no event.

### 5.3 The fact-applied-once rule (C3, C4)

A PayPal fact is one of `authorization_created`, `capture_completed`, `capture_pending`, `capture_declined`, `authorization_voided`, `payout_succeeded`, `payout_failed`. It may come from an API response (`source: "api"`, with `paypal_request_id`) or a webhook (`source: "webhook"`, with `paypal_event_id`), or from `reconcile()` reading the resource back from PayPal (`source: "reconcile"`, no id; 5.7, E12). The first arrival is applied; a later arrival with the same PayPal id is a no-op, never `invalid_state`. A fact that fits no C2 row writes a detail-only event or nothing; nothing is deferred or discarded.

```ts
export type FactSource = { source: "api"; paypal_request_id: string } | { source: "webhook"; paypal_event_id: string } | { source: "reconcile" };

export type PaypalFact =
  | { type: "authorization_created"; authorization_id: string; auth_expires_at: string }   // authorized_at is clock.now() at apply time (04 section 7.2)
  | { type: "capture_completed"; capture_id: string }
  | { type: "capture_pending";   capture_id: string; reason: string | null }
  | { type: "capture_declined";  capture_id: string; reason: string | null }
  | { type: "authorization_voided"; authorization_id: string }
  | { type: "payout_succeeded"; sender_item_id: string; payout_batch_id: string; payout_item_id: string }
  | { type: "payout_failed";    sender_item_id: string; payout_batch_id: string | null; payout_item_id: string | null;
      failure_reason: "FAILED" | "BLOCKED" | "RETURNED" | "UNCLAIMED" | string };
```

```
applyFact(tx, deal, payment, fact, src):                  # deal row locked by the caller; payload = {...fact, ...src}
  # returns "noop" or "applied"; when capture_completed inserted a payouts row, the caller runs sendPayout(row) AFTER commit (8.2)
  if seen(payment, fact):  return "noop"

  switch fact.type:
    authorization_created:
      if deal.status == "terms_agreed" and payment.authorization_id in (null, fact.authorization_id):
        # the normal row, or a PENDING authorization (stored with status approved, 7) that PayPal has now cleared
        payment.{authorization_id, auth_expires_at} = fact; payment.authorized_at = clock.now(); payment.status = "authorized"
        deal.deadline_at = payment.authorized_at + deal.deadline_days days
        transition(deal -> "held", actor "paypal", cause "fact:authorization_created", payload)
      elif payment.authorization_id is null:
        # the deal was cancelled before PayPal answered (a stale popup); the one use of void-{code} on this deal
        payment.{authorization_id, auth_expires_at} = fact; payment.authorized_at = clock.now()   # CHECK payments_auth_pair
        paypal.voidAuthorization(fact.authorization_id, "void-" + deal.code)
        payment.status = "voided"
        event(deal.status -> deal.status, actor "paypal", cause "fact:late_authorization_voided", payload)
      else:
        # a stray second authorization (for example a PENDING one that cleared after the buyer paid again, 7):
        # the stored id is never replaced (E3) and void-{code} is not spent on it
        paypal.voidAuthorization(fact.authorization_id, "void-" + fact.authorization_id)
        event(deal.status -> deal.status, actor "paypal", cause "fact:late_authorization_voided", payload)

    capture_completed:
      payment.capture_id = fact.capture_id; payment.status = "captured"
      to = "captured" if deal.status in ("proof_submitted", "in_review", "captured") else deal.status   # paid, voided: detail only
      if to == "captured" and no payouts row for the deal:
        INSERT payouts (attempt 1, sender_batch_id "payout-{code}-1", recipient_email = seller.paypal_email, amount_minor, currency "USD",
                        status "pending", paypal_batch_id null)   # the intent row; the call comes after commit (sendPayout, 8.2)
        payload.payout = that row
      if deal.status in ("proof_submitted", "in_review"):     # lib/deal requested it and died before recording it (C2)
        transition(deal -> "captured", actor "paypal", cause "fact:capture_completed", payload)
      else:
        event(deal.status -> deal.status, actor "paypal", cause "fact:capture_completed", payload)

    capture_pending:
      payment.capture_id = fact.capture_id; payment.status = "capture_pending"
      if deal.status in ("proof_submitted", "in_review"):
        transition(deal -> "captured", actor "paypal", cause "fact:capture_pending", payload)
      else:
        event(deal.status -> deal.status, actor "paypal", cause "fact:capture_pending", payload)

    capture_declined:
      payment.capture_id = fact.capture_id; payment.status = "declined"; payment.capture_attempts += 1   # E4: only a decline advances n
      if deal.status == "captured":
        transition(deal -> "in_review", actor "paypal", cause "fact:capture_declined", payload)
        notify both "PayPal declined the capture"
      else:
        event(deal.status -> deal.status, actor "paypal", cause "fact:capture_declined", payload)

    authorization_voided:
      payment.status = "voided"
      if deal.status in ("draft", "terms_agreed", "held", "proof_submitted", "in_review") and payment.capture_id is null:
        transition(deal -> "voided", actor "paypal", cause "fact:authorization_voided", payload)
      else:                                                   # captured or paid with capture_id set (C2), or already voided
        event(deal.status -> deal.status, actor "paypal", cause "fact:authorization_voided", payload)

    payout_succeeded:
      row = payouts[fact.sender_item_id]                      # sender_item_id == sender_batch_id == payout-{code}-{n}
      row.{status "success", paypal_batch_id, paypal_item_id} = fact
      if deal.status == "captured" and row.attempt == max(payouts.attempt):
        transition(deal -> "paid", actor "paypal", cause "fact:payout_succeeded", payload)
      else:                                                   # paid already, or an earlier attempt: row only (E7)
        event(deal.status -> deal.status, actor "paypal", cause "fact:payout_succeeded", payload)

    payout_failed:
      row = payouts[fact.sender_item_id]
      row.{status "failed", failure_reason, paypal_batch_id, paypal_item_id} = fact   # UNCLAIMED keeps paypal_item_id for the cancel (E5)
      event(deal.status -> deal.status, actor "paypal", cause "fact:payout_failed", payload)   # never a transition
  return "applied"

seen(payment, fact):                                      # "the same PayPal id was already recorded"
  authorization_created:  payment.authorization_id == fact.authorization_id and payment.status != "approved"
                          # a PENDING authorization is stored with status approved and is NOT seen: its CREATED webhook must still move the deal to held
  capture_completed:      payment.capture_id == fact.capture_id and payment.status == "captured"
  capture_pending:        payment.capture_id == fact.capture_id and payment.status in ("capture_pending", "captured", "declined")
  capture_declined:       payment.capture_id == fact.capture_id and payment.status == "declined"
  authorization_voided:   payment.status == "voided"
  payout_succeeded:       payouts[fact.sender_item_id].status == "success"
  payout_failed:          payouts[fact.sender_item_id].status != "pending"     # success or failed already: no-op

sendPayout(row):                                          # after commit; row is pending with paypal_batch_id null (04 section 9.1 step 10)
  try:
    r = paypal.createPayout({ sender_batch_id: row.sender_batch_id, sender_item_id: row.sender_batch_id, receiver: row.recipient_email,
                              amount_minor: row.amount_minor, note: "Handshake deal {code}" }, row.sender_batch_id)
    UPDATE payouts SET paypal_batch_id = r.payout_batch_id WHERE id = row.id AND status = "pending"
  catch PayPalError e:
    if e.status in 400..499 and e.name_:  UPDATE payouts SET status = "failed", failure_reason = e.name_ WHERE id = row.id AND status = "pending"
    else: nothing                                         # timeout or 5xx: the row stays pending with paypal_batch_id null; retry_payout re-sends it (5.1)
```

Two rules around the void call keep the money safe:

- **Void refused because the money is captured (C4).** When `voidAuthorization` (from `cancel`, `review { reject }`, decision `void` or `tick`) throws a 422 that is not `PREVIOUSLY_VOIDED`, `lib/deal` re-sends `capture-{code}-{n}` with the current `payments.capture_attempts` as `n`. PayPal returns the existing capture for that key (research/paypal.md "4. Idempotency"), and `applyFact(capture_completed | capture_pending, source api)` moves the deal by the C2 rows. The command that wanted the void then answers `invalid_state` ("The payment was already captured"); `tick` records it under `errors` and the deal is no longer eligible. If the re-sent capture also fails, the original void error is thrown as `paypal_error`.
- **Keys.** `void-{code}` is spent at most once per deal: by the command or tick that voids it, or by the late-authorization branch above when no authorization was ever stored. A stray authorization on a deal that already has one is voided with its own key `void-{authorization_id}` (8.1), so the real void of the stored authorization is never answered with the stray one's result.

`captured` means "capture requested" (C4); `payments.status` carries `capture_pending`, `captured` or `declined`. The payout is triggered on the first sight of `COMPLETED`, whether from the capture API response or from `PAYMENT.CAPTURE.COMPLETED`, and only once: the `payouts` row for attempt 1 is the guard. That row is inserted `pending` with `paypal_batch_id` null in the transaction that records the capture; `sendPayout(row)` runs after commit and its answer fills `paypal_batch_id` (8.2). `sendPayout` never throws into the request: the capture is already recorded, so the request answers `200` whatever the Payouts call did, and the seller's "Retry payout" covers a row left `pending` without a batch id.

### 5.4 Event vocabulary

`deal_events.cause` is exactly one of the strings below (decisions C6, copied verbatim; the same list is in 03, 04 section 16, 06, 08 section 7.11 and 09). The dashboard reads the decision from the `decision:` prefix and the buyer's choice from the `review:` prefix.

| `cause` | `actor` | Written when | `payload` must include |
| --- | --- | --- | --- |
| `create` | buyer | deal created | `source_text`, `model`, `prompt_version`, `rejected` |
| `edit_terms` | buyer | terms edited | `terms_version`, `changed` |
| `join` | seller | seller joins | `seller_id` |
| `accept` | buyer or seller | a party accepts | `terms_version` |
| `start_payment` | buyer | order created or reused | `paypal_order_id`, `order_attempt` |
| `submit_evidence` | seller | evidence stored | `submission_no`, `file_ids`, `tracking_number`, `carrier_status` |
| `verdict` | ai | verdict rows stored (proof_submitted to proof_submitted) | `submission_no`, `model`, `prompt_version`, `verdicts[]` (`condition_id`, `result`, `confidence`) |
| `decision:capture`, `decision:request_fix`, `decision:buyer_review`, `decision:void` | system | `decide()` applied | `submission_no`; `capture_id`, `capture_status`, `paypal_request_id` for capture; `reason` for buyer_review; `authorization_id` for void |
| `review:approve`, `review:reject` | buyer | buyer decides in `in_review` | `note`; `capture_id`, `capture_status` for approve; `authorization_id` for reject |
| `cancel` | buyer or seller | deal cancelled | `authorization_id`, `voided` |
| `retry_payout` | seller | payout attempt `n + 1` created | `attempt`, `sender_batch_id`, `paypal_batch_id`, `status`, `failure_reason`, `cancelled_item_id` |
| `tick:deadline` | system | `tick` voids past `deadline_at` | `deadline_at`, `authorization_id` |
| `tick:reverify` | system | `tick` re-runs a stuck verdict (proof_submitted to proof_submitted) | `submission_no` |
| `fact:authorization_created` | paypal | hold recorded | `authorization_id`, `auth_expires_at` |
| `fact:late_authorization_voided` | paypal | authorization arrived after cancel and was voided (status unchanged) | `authorization_id` |
| `fact:capture_completed`, `fact:capture_pending`, `fact:capture_declined` | paypal | capture result recorded | `capture_id`, `reason` for pending or declined, `payout` when created in the same transaction |
| `fact:authorization_voided` | paypal | PayPal reports the void | `authorization_id` |
| `fact:payout_succeeded`, `fact:payout_failed` | paypal | payout item result recorded | `payout_item_id`, `payout_batch_id`, `sender_item_id`, `attempt`, `failure_reason` for failed |

Every `fact:*` payload also carries `source` (`"api"`, `"webhook"` or `"reconcile"`) and either `paypal_request_id` (source `api`) or `paypal_event_id` (source `webhook`); source `reconcile` carries no id (E12). Tests detect which source won a race by `payload.source`, never by `cause`. `retry_payout` is also written when attempt `n` is re-sent (5.1), with the same `attempt` and `cancelled_item_id` null.

### 5.5 Webhook event to fact

`lib/deal/webhooks.ts` maps the events subscribed in E5. The deal is found by `resource.custom_id` for authorizations and captures (research/paypal.md, "Summary" item 13: `custom_id` "comes back on the authorization and capture resources, so it is in webhook payloads"), by `resource.purchase_units[0].custom_id` for orders, and by `resource.payout_item.sender_item_id` for payout items (research/paypal.md, "Implications for Handshake" item 4). The authorization resource carries `custom_id`, `status` and `expiration_time` but no order id (research/paypal.md "2. Orders v2", authorize response), so no fact built from a webhook carries one; `applyFact` matches on the deal's status and stored ids instead (5.3).

| `event_type` | Deal lookup | What `applyPaypalEvent` does |
| --- | --- | --- |
| `CHECKOUT.ORDER.APPROVED` | `purchase_units[0].custom_id` | E8: if `deal.status == "terms_agreed"`, `payments.paypal_order_id == resource.id` and `payments.status` is `created` or `approved`: set `approved`, commit, call `authorizeOrder(id, "auth-{code}")`, apply `authorization_created`. `ORDER_ALREADY_AUTHORIZED` or `ORDER_COMPLETED_OR_VOIDED` from PayPal: `noop` (the authorization event carries the fact). Any other PayPal error: throw, so PayPal retries. Otherwise (`voided` after a cancel, already `held`, another order id) `noop`: a stale popup must not create a hold on a cancelled deal |
| `PAYMENT.AUTHORIZATION.CREATED` | `resource.custom_id` | `authorization_created` with `authorization_id = resource.id`, `auth_expires_at = resource.expiration_time`; only when `resource.status == "CREATED"`, else `noop`. `authorized_at` is the server clock when the fact is applied |
| `PAYMENT.AUTHORIZATION.VOIDED` | `resource.custom_id` | `authorization_voided` |
| `PAYMENT.CAPTURE.COMPLETED` | `resource.custom_id` | `capture_completed` with `capture_id = resource.id` |
| `PAYMENT.CAPTURE.PENDING` | `resource.custom_id` | `capture_pending` with `reason = resource.status_details.reason` |
| `PAYMENT.CAPTURE.DECLINED` | `resource.custom_id` | `capture_declined` with `reason = resource.status_details.reason` |
| `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` | `resource.payout_item.sender_item_id` = `payout-{code}-{n}` | `payout_succeeded` with `payout_batch_id`, `payout_item_id` |
| `PAYMENT.PAYOUTS-ITEM.FAILED`, `.BLOCKED`, `.RETURNED` | same | `payout_failed` with `failure_reason = resource.errors.name` when present, else `FAILED`, `BLOCKED` or `RETURNED` (E5: stored as `failed`) |
| `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` | same | `payout_failed` with `failure_reason = "UNCLAIMED"` and `payout_item_id = resource.payout_item_id` kept on the row, because the item stays claimable for 30 days and must be cancelled before any retry (E5, E7) |
| anything else | | `noop` (stored, processed) |

An event whose `custom_id` or `sender_item_id` matches no deal, or matches a seeded deal, returns `unknown_deal`, is marked processed and answers `200`.

### 5.6 Notifications

Exactly two deal notices exist (C2, FR-32; 04 section 16: "No other endpoint sends email"). They are sent through `deps.email` after the transaction commits; a failure is logged and changes nothing. Resend's test sender cannot deliver to the demo personas anyway (F2), so the deal page is the source of truth.

| Moment | To | Subject |
| --- | --- | --- |
| decision `buyer_review` (`proof_submitted -> in_review`) | buyer | "Your decision is needed on {code}" |
| fact `capture_declined` (`captured -> in_review`) | both | "PayPal declined the capture" |

### 5.7 What `tick()` does (B7, E12)

```
tick(now):
  report = { voided: [], verdicts_rerun: [], reconciled: [], errors: [] }

  for deal in SELECT ... FROM deals WHERE status IN ('held', 'in_review') AND deadline_at < now AND seeded = false:
    try:
      if payments.authorization_id:  paypal.voidAuthorization(authorization_id, "void-{code}")   # PREVIOUSLY_VOIDED counts as success; a 422 "already captured" takes the C4 path in 5.3
      tx: lock deal; re-check status and deadline; payment.status = "voided";
          transition(deal -> "voided", actor "system", cause "tick:deadline", payload {deadline_at, authorization_id})
      report.voided.push(code)
    catch e:  report.errors.push({ code, message })       # next day's run tries again

  for deal in SELECT ... FROM deals WHERE status = 'proof_submitted' AND updated_at < now - interval '2 minutes' AND seeded = false:
    try:
      tx: lock deal; re-check status; event("proof_submitted" -> "proof_submitted", actor "system", cause "tick:reverify", payload {submission_no})
      runVerdict(code); report.verdicts_rerun.push(code)
    catch e:  report.errors.push({ code, message })

  reconcile(now):                                        # lib/deal/reconcile.ts (E12): late or lost webhooks; seeded = false throughout
    payments capture_pending, updated_at < now - 10 min:   fact = captureFact(paypal.getCapture(capture_id))      # COMPLETED / PENDING / DECLINED as the webhook
    payments approved with authorization_id, deal terms_agreed, updated_at < now - 10 min:
                                                           paypal.getAuthorization(id): CREATED -> authorization_created; VOIDED or DENIED -> authorization_voided; PENDING -> nothing
    payouts pending with paypal_batch_id, updated_at < now - 30 min:
                                                           paypal.getPayoutBatch(id), item with sender_item_id = sender_batch_id: SUCCESS / FAILED / BLOCKED / RETURNED / UNCLAIMED
                                                           -> the PAYMENT.PAYOUTS-ITEM.* fact (5.5); anything else -> nothing
    for each fact:
      try:  tx: lock deal; applyFactTx(fact, { source: "reconcile" }); after commit: sendPayout / declined notice (5.3)
            report.reconciled.push(code) when applied        # a fact already applied by a webhook is a no-op, and the webhook after a reconcile is too
      catch e:  report.errors.push({ code, message })

  return report
```

`runVerdict()` is idempotent: when verdict rows already exist for the current `submission_no` it skips the model call and goes straight to `decide()` (5.8), so a rerun after a crash never re-judges and never changes its mind. There is no reauthorize job (B7): reauthorization is blocked for the first 3 days and allowed effectively once per hold (research/paypal.md, "3. Payments v2 authorizations: capture, void, reauthorize"), so deals are capped at 21 days inside the 29-day validity, and `in_review` past `deadline_at` is voided (C5). `tick()` is safe to run twice: the second run finds nothing to do. No email is sent on a deadline void (5.6). A deal still waiting at PayPal (capture or authorization `PENDING`, payout item `PENDING`) keeps its `updated_at` and is asked again on every run.

### 5.8 The verdict step

```
runVerdict(code):
  deal, submission = load proof_submitted deal and its latest submission
  if no verdict rows for submission.submission_no:
    input = JudgeInput { code, conditions (by position), reference_photos (purpose reference, by created_at), evidence_photos (this submission, upload order),
                         tracking_number, carrier_status = carrierStatus(tracking_number) (lib/carrier.ts, D7), note, submission_no }
    const output = hashCheck(input) ?? (await ai.judge(input))   # D8 in lib/deal/verdict.ts (05 section 6.1): no model call on a hash match;
                                                                 # judge() never throws; any failure is unclear with confidence 0 for every condition
    Tx V: INSERT verdicts (one per condition: result, confidence, reason, evidence_used, model = output.model, prompt_version = output.prompt_version,
                           raw_response = output.raw_response; D10);
          event("proof_submitted" -> "proof_submitted", actor "ai", cause "verdict",
                payload {submission_no, model, prompt_version, verdicts: [{condition_id, result, confidence}]})
  const { decision, reason } = decide(verdicts, deal, LIMITS)   # D9, pure (05 section 7); LIMITS from lib/env; attempt 2 voids only on a fail
                                                                # with confidence >= passThreshold, else buyer_review
  act(decision, reason)                     # 8.2: capture / request_fix / buyer_review / void; reason goes into the decision:* payload (C6)
```

`hashCheck()` lives in `lib/deal/verdict.ts`, not in `lib/ai`, so it runs identically with the real adapter and the fake, and the integration tests can assert that `judge` was not called on a hash match. That is why `JudgePhoto` carries `sha256`.

## 6. Sequences

Transaction names used below: **Tx A** (evidence stored, `held -> proof_submitted`), **Tx V** (verdict rows), **Tx B** (the decision transition plus any capture fact and the `pending` payouts row). Every transaction starts by locking the deal row (5.2).

### 6.1 Happy path (SB-1)

1. Buyer, signed in, `POST /api/deals { text }`. `createDeal()` generates the `public_code`, calls `ai.extract({ sentence, today: clock.now() })` (15 s, one retry inside; `ai_unavailable` 503 after that), which rejects a non-USD currency (`unsupported_currency`) or zero checkable conditions (`condition_not_checkable`); then `appendCodeCondition(code, out.conditions)` (`lib/deal/terms.ts`, D6) adds the deal-code condition, last, when a photo condition exists. One transaction inserts `deals` (`draft`, `terms_version 1`), `conditions`, and the event `create` (`null -> draft`, actor buyer, payload `{ source_text, model, prompt_version, rejected }`). Answer `201` with the `DealView` and `rejected[]`.
2. Buyer fixes anything the model got wrong (`PATCH /api/deals/{code}/terms` -> `edit_terms`), uploads up to 4 reference photos (`POST /api/deals/{code}/files`, `purpose = reference` -> `addFile`; no event, no version change), and shares `/deal/{code}`.
3. Seller signs in (demo persona or magic link) and opens the link. `getDeal` returns a `DealPreview` (F4). `POST /api/deals/{code}/join` -> `join` sets `seller_id`, event `join`. If `users.paypal_email` is empty the page sends the seller to `PATCH /api/me`.
4. Both call `POST /api/deals/{code}/accept { terms_version }`. The second accept moves the deal to `terms_agreed` (seller must have `paypal_email`), event `accept`.
5. Buyer clicks the PayPal button. `createOrder` calls `POST /api/deals/{code}/payment` -> `start_payment`. No `payments` row exists, so: `paypal.createAuthorizeOrder({ code, amount_minor, description }, "order-{code}-1")` first (no transaction before the call: `payments.paypal_order_id` is `NOT NULL UNIQUE`, 03); then one transaction locks the deal, upserts `payments` (`paypal_order_id`, `status = created`, `order_attempts = 1`) and writes the event `start_payment` (`terms_agreed -> terms_agreed`, payload `{ paypal_order_id, order_attempt: 1 }`). The route answers `200 { order_id }` and the browser returns it to the SDK (04 section 7.1). A second click within 6 h returns the stored id with no call (5.1).
6. Buyer approves in the popup. `onApprove` calls `POST /api/deals/{code}/payment/authorize { order_id }` -> `confirm_approval`: Tx 1 checks `order_id == payments.paypal_order_id` (`invalid_input` otherwise) and sets `payments.status = approved`; `paypal.authorizeOrder(id, "auth-{code}")` returns `status CREATED`; Tx 2 applies the fact `authorization_created` (`authorization_id`, `authorized_at = clock.now()`, `auth_expires_at`, payment `authorized`, `deadline_at`; `terms_agreed -> held`; event `fact:authorization_created`, actor paypal, payload with `source: "api"` and `paypal_request_id: "auth-{code}"`). Answer `200` `DealView`. No email.
7. Webhooks `CHECKOUT.ORDER.APPROVED` and `PAYMENT.AUTHORIZATION.CREATED` arrive later: each is stored in `webhook_events`, found to be `noop` (already authorized), marked processed, answered `200`.
8. Seller uploads up to 6 evidence photos (`addFile`, `purpose = evidence`, allowed while `held` and before `deadline_at`) and calls `POST /api/deals/{code}/evidence { file_ids, tracking_number, note }` -> `submit_evidence`:
   1. Tx A: validate (status `held`, `clock.now() < deadline_at`, caller is the seller, files belong to this deal with `purpose = evidence` and are not yet in a submission, note <= 1,000 chars); insert `evidence` rows with `submission_no = fix_attempts_used + 1`; `held -> proof_submitted`; event `submit_evidence`.
   2. `runVerdict()`: builds `JudgeInput` (carrier status from `lib/carrier.ts`), `hashCheck()` (D8, no match here), `ai.judge` (17 s inside a 19 s signal); Tx V inserts the verdict rows and the `verdict` event.
   3. `decide()` returns `{ decision: "capture", reason: "all_pass" }`. `paypal.captureAuthorization(authorization_id, amount_minor, "capture-{code}-0")` returns `COMPLETED`.
   4. Tx B: `proof_submitted -> captured` (event `decision:capture`, actor system, payload `{ submission_no, reason: "all_pass", capture_id, capture_status: "COMPLETED", paypal_request_id: "capture-{code}-0" }`); `applyFact(capture_completed, source api)` sets `capture_id`, `payments.status = captured`, inserts the `payouts` row (`attempt 1`, `pending`, `sender_batch_id payout-{code}-1`, `paypal_batch_id` null, `recipient_email`) and writes the event `fact:capture_completed` with `payload.payout = { attempt: 1, sender_batch_id, paypal_batch_id: null, status: "pending" }`. Commit.
   5. `sendPayout(row)` (5.3), after commit: `paypal.createPayout({ sender_batch_id: "payout-{code}-1", sender_item_id: "payout-{code}-1", receiver: seller.paypal_email, amount_minor, note }, "payout-{code}-1")` returns `payout_batch_id`, stored on the row. On a timeout or 5xx the row stays `pending` with `paypal_batch_id` null and the seller's page offers "Retry payout" (7); only a 4xx with a PayPal error name sets it `failed` with that name as `failure_reason`.
   6. Answer `200` with the `DealView`: `status captured`, verdicts, `decision capture`, `payouts[0].status pending` with its `paypal_batch_id`. Typical total 6 to 12 s; the AI part is capped at 17 s and the whole request at about 40 s (B5).
9. `PAYMENT.CAPTURE.COMPLETED` arrives: `noop`. `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` arrives: `applyFact(payout_succeeded)` sets the payout `success`, `captured -> paid`, event `fact:payout_succeeded`. No email.
10. Both parties see `paid`; the ledger, `GET /api/deals/{code}/events` and the evidence pack show every step.

### 6.2 Request-fix, then success (SB-3)

1. Steps 1 to 8.2 of 6.1 with a wrong-item photo. The model returns `fail` for "Item matches the listing photos".
2. `decide()`: a `fail` with `fix_attempts_used = 0` -> `{ request_fix, reason: "fail" }`. Tx B: `proof_submitted -> held`, `fix_attempts_used = 1`, event `decision:request_fix` with payload `{ submission_no, reason: "fail" }`. Answer `200` (`status held`, submission 1 shows its verdicts and decision). No email: the seller is looking at the response.
3. Seller uploads correct photos and submits again. Tx A inserts `submission_no = 2`. `runVerdict()` judges submission 2; `decide()` -> `capture`; the rest is 6.1 steps 8.3 to 10. The idempotency key is still `capture-{code}-0`: `capture_attempts` is still 0.
4. Had submission 2 also failed with confidence >= `PASS_THRESHOLD`, `decide()` would return `void` (D9): `paypal.voidAuthorization(authorization_id, "void-{code}")`, Tx B `proof_submitted -> voided` (event `decision:void`, payload `{ submission_no, authorization_id }`), payment `voided`, then `applyFact(authorization_voided, source api)` so the later `PAYMENT.AUTHORIZATION.VOIDED` is a no-op (SB-2 without waiting for the deadline). A second-attempt `fail` below the threshold goes to `buyer_review` instead.

### 6.3 Unclear, then the buyer approves (SB-4)

1. Steps 1 to 8.2 of 6.1 with a blurry photo. The model returns `unclear` for one condition.
2. `decide()` -> `buyer_review`. Tx B: `proof_submitted -> in_review`, event `decision:buyer_review` with `reason: "unclear"`. After commit, email the buyer "Your decision is needed on {code}" (5.6). Answer `200` (`status in_review`).
3. Buyer opens the deal page: every verdict with reason, every photo, the tracking status. `POST /api/deals/{code}/review { decision: "approve" }` -> `review`: `paypal.captureAuthorization(authorization_id, amount_minor, "capture-{code}-0")` -> `COMPLETED`; Tx: `in_review -> captured` (event `review:approve`, actor buyer, payload `{ note, capture_id, capture_status }`), `applyFact(capture_completed)` inserts the `pending` payouts row; after commit `sendPayout(row)` as in 6.1 step 8.5. Answer `200`.
4. `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` -> `paid`.

### 6.4 The buyer rejects (SB-5)

1. As 6.3 steps 1 and 2.
2. `POST /api/deals/{code}/review { decision: "reject" }` -> `review`: `paypal.voidAuthorization(authorization_id, "void-{code}")` (204; `PREVIOUSLY_VOIDED` counts as success); Tx: `payments.status = voided`, `in_review -> voided`, event `review:reject` with payload `{ note, authorization_id }`, then `applyFact(authorization_voided, source api)`. Answer `200`. No email. As built, that `applyFact` runs after the transition inside the same Tx, so the log holds two rows: `in_review -> voided` cause `review:reject`, then `voided -> voided` cause `fact:authorization_voided` with `{ source: "api", paypal_request_id: "void-{code}" }`.
3. `PAYMENT.AUTHORIZATION.VOIDED` arrives: `noop` (`payments.status` is already `voided`).

### 6.5 Cancel with a hold (SB-11)

1. Deal is `held`. Buyer (or seller) calls `POST /api/deals/{code}/cancel` -> `cancel`.
2. `paypal.voidAuthorization(authorization_id, "void-{code}")`. A 422 that is not `PREVIOUSLY_VOIDED` means the money is captured: the C4 path in 5.3 re-sends `capture-{code}-{n}`, applies the capture fact and answers `invalid_state`. From `held` that fact is detail-only (`held -> held`, `payments.status = captured`): the C2 row for `capture_completed` moves only `proof_submitted` and `in_review`, so the deal stays `held` with its money captured.
3. Tx: `payments.status = voided`, `held -> voided`, event `cancel` (actor buyer or seller, payload `{ authorization_id, voided: true }`), then `applyFact(authorization_voided, source api)`. Answer `200`. No email. As built this is two rows: `held -> voided` cause `cancel`, then `voided -> voided` cause `fact:authorization_voided` with `{ source: "api", paypal_request_id: "void-{code}" }`; the later `PAYMENT.AUTHORIZATION.VOIDED` webhook is a `noop`.
4. From `draft` or `terms_agreed` with no stored authorization, step 2 is skipped: `status = voided`, event `cancel` with `{ authorization_id: null, voided: false }`, and `payments.status` is left as it is (`created` or `approved`; the unapproved order expires on its own). From `terms_agreed` with a `PENDING` authorization stored (7), step 2 runs: `cancel` voids whenever `authorization_id` is set. If an `authorization_created` fact arrives after a cancel without a hold (the buyer approved in a popup they had left open), 5.3 stores the ids and voids it at once with `void-{code}`, which has not been used yet; `CHECKOUT.ORDER.APPROVED` for the cancelled deal is a `noop` (5.5), so Handshake itself never authorizes a cancelled deal.

### 6.6 Deadline void (SB-2, second half)

1. Render cron runs `curl -fsS --max-time 120 -X POST -H "Authorization: Bearer $CRON_SECRET" https://{host}/api/jobs/tick` at 06:00 UTC.
2. The route compares the bearer with `CRON_SECRET` using `timingSafeEqual` and calls `tick(clock.now())`.
3. For each `held` or `in_review` deal with `deadline_at < now` and `seeded = false`: void with `void-{code}`, then Tx `-> voided` with cause `tick:deadline`. No email.
4. For each `proof_submitted` deal older than 2 minutes: event `tick:reverify`, then `runVerdict()` (6.9).
5. Answer `200` with the `TickReport`. A deal that failed today is retried tomorrow; nothing in the report blocks the rest.

### 6.7 SB-6: the buyer closes the tab after approving

1. 6.1 steps 1 to 5. The buyer approves in the PayPal popup and closes the tab before `onApprove` reaches the server. No `confirm_approval` arrives. `payments.status` is `created`.
2. PayPal sends `CHECKOUT.ORDER.APPROVED`. The webhook route verifies the signature (9.4) and calls `applyPaypalEvent`.
3. `webhook_events` row inserted. The deal is found by `purchase_units[0].custom_id`; it is `terms_agreed`, `resource.id` equals `payments.paypal_order_id` and `payments.status` is `created`, so E8 applies: Tx 1 sets `approved`; `paypal.authorizeOrder(id, "auth-{code}")`; Tx 2 applies `authorization_created` (`terms_agreed -> held`, `source: "webhook"`, `paypal_event_id`) and sets `processed_at`. Answer `200`.
4. `PAYMENT.AUTHORIZATION.CREATED` arrives: `seen()` is true -> `noop`, `200`.
5. If the browser's `confirm_approval` and the webhook race, both use `auth-{code}`. PayPal "processes the first request and might fail the second" (research/paypal.md, "4. Idempotency"). The winner applies the fact; the loser's Tx 2 re-reads the row under the lock, finds `payments.status = authorized`, and returns the current view (`confirm_approval` is idempotent once the hold exists). A loser that got a PayPal error answers `502` (browser) or `500` (webhook, so PayPal redelivers and then finds `noop`). The same holds when `PAYMENT.AUTHORIZATION.CREATED` itself lands before the API path's Tx 2: the webhook applies the fact (the deal is `terms_agreed` with no stored authorization), and the API path finds it `seen`. The legitimate hold is never voided: the late-void branches in 5.3 run only when the deal has left `terms_agreed` or already holds a different authorization.

### 6.8 Webhook arrival and idempotent processing (SB-7)

1. `POST /api/webhooks/paypal`: `raw = await request.text()` (research/stack.md, "2. Next.js App Router details", webhook raw body); read `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`.
2. `paypal.verifyWebhook(raw, headers)` per 9.4. `fetch_failed` (the cert could not be fetched): answer `500` and store nothing, so PayPal's retry is a real retry. Parse `raw` with `JSON.parse` only after verification.
3. `applyPaypalEvent({ id, event_type, create_time, resource_type, resource, verified, body })`:
   1. `INSERT INTO webhook_events (paypal_event_id, event_type, verified, body) ... ON CONFLICT (paypal_event_id) DO UPDATE SET verified = EXCLUDED.verified WHERE webhook_events.processed_at IS NULL`, then read the row. A row left `verified = false` by an earlier bad delivery is therefore corrected when a later delivery verifies; a processed row is never touched.
   2. The incoming `verified` is `false`: do nothing else; the route answers `400`. (The decision uses this delivery's result, not the stored flag.)
   3. `processed_at` already set: return `already_processed`; the route answers `200`. This is the second delivery in SB-7: one `webhook_events` row, no second `deal_events` row.
   4. Otherwise process in one transaction: find the deal, map to a fact (5.5), lock the deal row, `applyFact` (no-op if seen), set `processed_at`, commit. Return the outcome; the route answers `200`.
   5. Any throw leaves `processed_at` null and the route answers `500 internal_error`; PayPal retries up to 25 times over 3 days (research/paypal.md, "6. Webhooks", "Delivery and retries"). The next delivery finds the row unprocessed and processes it again.
4. `CHECKOUT.ORDER.APPROVED` is the one event with a PayPal call in the middle (E8); it uses the two-transaction pattern of 8.2 and sets `processed_at` in the second transaction. `PAYMENT.CAPTURE.COMPLETED` on a deal with no `payouts` row also makes a call, but after its transaction: the handler applies the fact, inserts the `payouts` row `pending` with `paypal_batch_id` null and sets `processed_at` in the one transaction, then runs `sendPayout(row)` with `payout-{code}-1` (8.2). A crash between the two leaves the row `pending` without a batch id; the seller's `retry_payout` re-sends the same key (5.1) and PayPal returns the same batch.

### 6.9 The server dies during the verdict, and `tick()` retries

1. 6.1 step 8.1 committed Tx A: the deal is `proof_submitted`, evidence rows exist. The process is killed during `ai.judge` (a Render deploy or a crash). The seller's request fails at the network level; a reload shows `proof_submitted` with "Verdict in progress".
2. Nothing else happens until `tick()` runs (daily cron, or `POST /api/jobs/tick` run by hand). `tick()` selects `proof_submitted` deals with `updated_at` older than 2 minutes, writes `tick:reverify` and calls `runVerdict()`.
3. Case A, died before Tx V: no verdict rows exist; `hashCheck()` and, without a match, the model run again; Tx V, the capture, Tx B and the payout follow as in 6.1.
4. Case B, died after Tx V but before or during the capture call: verdict rows exist, so the model is not called; `decide()` gives the same answer from the same rows; the capture is sent with the same key `capture-{code}-0`. If the dead attempt's capture reached PayPal, PayPal returns the existing capture ("The server does not capture the payment again", research/paypal.md, "4. Idempotency"), and Tx B applies `capture_completed` once. If `PAYMENT.CAPTURE.COMPLETED` arrived in between, 5.3 already moved the deal `proof_submitted -> captured` with `fact:capture_completed`, inserted the `payouts` row and sent the payout (6.8); the deal is then no longer `proof_submitted`, `tick` does not select it, and no `decision:capture` event is written for it. The `verdict` event and the `fact:capture_completed` event together explain the step in the evidence pack.
5. Case C, died after the capture call but before Tx B: as case B; the re-sent capture returns the existing capture, Tx B writes everything once, including the `pending` payouts row, and `sendPayout` follows.
6. Case D, died after Tx B but before or during `sendPayout`: the deal is `captured`, so `tick` does not select it. The `payouts` row is `pending` with `paypal_batch_id` null, the seller's page shows "Retry payout", and `retry_payout` re-sends `payout-{code}-1` (5.1): PayPal answers with the stored response for the key or rejects the duplicate `sender_batch_id` with a link to the original, which the adapter resolves to the original batch (3.4). If PayPal had accepted the first send, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` for `payout-{code}-1` completes the deal regardless. No second payout can be created: attempt `n + 1` exists only through `retry_payout` from a `failed` row (5.1).

## 7. Failure modes

Money never moves on a failure: every failure leaves the deal in a state from which a retry with the same idempotency key, a webhook, or a human decision completes it.

| What fails | What the user sees | Resulting state | What retries it |
| --- | --- | --- | --- |
| PayPal 5xx or timeout on `createAuthorizeOrder` | `502 paypal_error`; the PayPal button shows "Could not start payment. Try again" | `terms_agreed`; `payments` row unchanged (absent, or the previous order) | Buyer clicks Pay again: `start_payment` creates order `n + 1` with a new key (the dead call's order, if PayPal made one, is never approved and expires) |
| PayPal 5xx or timeout on `authorizeOrder` | `502`; page shows "Approval not confirmed. Click Pay again" | `terms_agreed`; `payments.status = approved` | Buyer clicks again (`auth-{code}`); `CHECKOUT.ORDER.APPROVED` (E8) and `PAYMENT.AUTHORIZATION.CREATED` webhooks also complete it |
| Authorization comes back `PENDING` (`PENDING_REVIEW`, research/paypal.md "2. Orders v2") | `502 paypal_error` "PayPal did not place the hold (PENDING)"; the page shows "PayPal is reviewing the payment" | `terms_agreed`; `payments.status = approved` with `authorization_id`, `authorized_at`, `auth_expires_at` stored (03's CHECK `payments_auth_before_status` allows an id with status `approved`); `start_payment` is `invalid_state` while this is so | `PAYMENT.AUTHORIZATION.CREATED` with `status CREATED` for that id moves the deal to `held` (5.3: not `seen` while `approved`); either party may `cancel`, which voids the pending authorization. There is no second order, so there can be no second hold |
| Authorization comes back `DENIED` | `502 paypal_error` "PayPal did not place the hold (DENIED)" | `terms_agreed`, `approved`; no fact applied, nothing stored | Either party cancels; the buyer may pay again after 6 h with order `n + 1` |
| PayPal 5xx on capture inside the evidence request | `502 paypal_error`; page shows the verdicts and "Payment capture is delayed; we retry automatically" | `proof_submitted` with verdict rows | `tick()` (next run) re-sends `capture-{code}-{n}` without re-judging |
| PayPal 5xx on capture from `review { approve }` | `502`; "Could not capture. Try again" | `in_review` | Buyer clicks Approve again, same key |
| Capture `DECLINED` in the API response | Both notified; buyer sees "PayPal declined the capture" with Approve (retry) and Reject | Tx B: `proof_submitted -> captured -> in_review` (two events); `payments.status = declined`; `capture_attempts + 1` | Buyer approves again with `capture-{code}-{n+1}` or rejects (void) |
| Capture `DECLINED` by webhook after `PENDING` | Same | `captured -> in_review` | Same |
| Capture `PENDING` | "Payment is processing at PayPal" | `captured`; `payments.status = capture_pending`; no payout yet | `PAYMENT.CAPTURE.COMPLETED` (then payout) or `PAYMENT.CAPTURE.DECLINED`; if neither arrives, `tick` reads the capture once per run after 10 minutes (5.7, E12); no tighter polling (research/paypal.md, "11. Rate limits and sandbox gotchas") |
| Capture returns `AUTHORIZATION_EXPIRED` or `AUTHORIZATION_VOIDED` (422) | "The hold is no longer available" | Fact `authorization_voided` -> `voided` | Nothing; the deal is over |
| Void refused because the money is already captured (422, C4) | "The payment was already captured" (`409 invalid_state`) | `capture-{code}-{n}` re-sent; fact `capture_completed` or `capture_pending` -> `captured` | Nothing; the capture path continues |
| PayPal 5xx on void (cancel, reject, tick) | `502` "Could not release the hold. Try again" | Unchanged | The user clicks again; `tick()` the next day for deadline voids; `PAYMENT.AUTHORIZATION.VOIDED` if PayPal did void |
| `createPayout` times out or returns 5xx (or the process dies after Tx B) | `200` with the captured view; seller sees "We didn't hear back from PayPal. Retry to send the payout again." with "Retry payout" | `captured`; `payouts` row stays `pending` with `paypal_batch_id` null | Seller `retry_payout` re-sends attempt `n` with the same `sender_batch_id` (5.1); a duplicate rejection resolves to the original batch (3.4); `PAYOUTS-ITEM.SUCCEEDED` if PayPal had accepted it completes the deal regardless |
| `createPayout` returns a 4xx with a PayPal error `name` | `200` with the captured view; seller sees "PayPal couldn't pay {paypal_email}: {failure_reason}" with "Retry payout" | `captured`; `payouts` row `failed`, `failure_reason` = that name, `paypal_batch_id` null | Seller fixes `paypal_email` and calls `retry_payout` -> attempt `n + 1` (5.1) |
| Payout item `FAILED`, `BLOCKED`, `RETURNED` | Same copy with the item's reason | `captured`; payout `failed` with `failure_reason` | Seller fixes `paypal_email` (`PATCH /api/me`) and calls `retry_payout` -> attempt `n + 1` |
| Payout item `UNCLAIMED` (no PayPal account at that address; claimable for 30 days, research/paypal.md "5. Payouts") | Same copy, reason `UNCLAIMED` | `captured`; payout `failed`, `failure_reason UNCLAIMED`, `paypal_item_id` kept | Seller fixes `paypal_email` and calls `retry_payout`: `cancelPayoutItem(paypal_item_id)` first, then attempt `n + 1`; if the cancel fails, `502 paypal_error` and no new attempt (E7). If the item is claimed before the cancel, `PAYOUTS-ITEM.SUCCEEDED` for attempt `n` arrives: the row becomes `success` and the deal `paid` (it is the latest attempt) |
| AI timeout on the verdict (17 s per attempt, 19 s signal) | Seller: "The AI could not judge in time; the buyer will decide". Buyer emailed | Verdicts `unclear` (confidence 0, "The AI did not answer in time."); `in_review` | The buyer decides; there is no automatic re-judge |
| AI refusal (`stop_reason: "refusal"`, HTTP 200) | Same | Same ("The AI declined to judge this submission.") | Same |
| Invalid AI JSON (schema or Zod mismatch, unknown or missing `condition_id`) | Same | Missing or invalid conditions `unclear` ("The AI answer could not be read."); `in_review` | Same |
| AI 429 or 5xx (including 529 overloaded) | Same | Same ("The AI service returned an error.") | Same |
| AI timeout, refusal, invalid JSON or 429/5xx on extraction (after the one retry) | `503 ai_unavailable` "the model did not answer; try again" | No deal created | Buyer submits again |
| Duplicate webhook delivery | Nothing | Unchanged; one `webhook_events` row | n/a |
| Unverified webhook (bad signature, wrong host in `PAYPAL-CERT-URL`) | Nothing | Stored with `verified = false`, not processed; `400` | PayPal retries; a later delivery that verifies updates the row to `verified = true` and is processed (6.8) |
| Webhook cert cannot be fetched (network, 10 s timeout) | Nothing | Nothing stored; `500` | PayPal retries with the same event |
| Webhook for a deal we do not know | Nothing | Stored, `processed_at` set, `unknown_deal` | n/a |
| DB error mid-transaction | `500 internal_error` "Something went wrong. Try again" (or `500` to PayPal) | The previous committed state; nothing partial | The user, PayPal's redelivery, or `tick()` |
| Process dies during the AI call | Request fails; reload shows "Verdict in progress" | `proof_submitted` | `tick()` after 2 minutes (6.9) |
| Resend failure or undeliverable address (demo personas) | Nothing; the page shows the state | Unchanged | Nothing; the UI is the source of truth |

## 8. Idempotency keys and transactions

Every PayPal write carries a key derived from committed database state, so a retry always repeats the exact same request, and PayPal answers with the result of the first one.

### 8.1 Keys (E4)

| Call | `PayPal-Request-Id` | `n` | Retained by PayPal | Example (`code = HS-7K2Q`) |
| --- | --- | --- | --- | --- |
| Create order | `order-{code}-{n}` | `payments.order_attempts`, the number of orders created for the deal, starting at 1 | 6 h, UNVERIFIED (research/paypal.md "Open risks" 10: from SDK docstrings) | `order-HS-7K2Q-1` (15 chars) |
| Authorize order | `auth-{code}` | | 6 h, UNVERIFIED (same) | `auth-HS-7K2Q` |
| Void authorization (the stored one) | `void-{code}` | | 45 days, UNVERIFIED (same) | `void-HS-7K2Q` |
| Void a stray authorization (5.3) | `void-{authorization_id}` | | 45 days, UNVERIFIED (same) | `void-0VF52814937998046` (22 chars; PayPal ids are 17 characters in the research samples) |
| Capture authorization | `capture-{code}-{n}` | `payments.capture_attempts`, the count of `fact:capture_declined` events for the deal, starting at 0 | 45 days, UNVERIFIED (same) | `capture-HS-7K2Q-0` |
| Create payout | `payout-{code}-{n}`, also sent as `sender_batch_id` and `sender_item_id` | `payouts.attempt`, starting at 1 | 30 days ("The server stores keys for 30 days.", Payouts schema); `sender_batch_id` deduplicated 30 days | `payout-HS-7K2Q-1` |

All keys are under 38 characters (research/paypal.md, "4. Idempotency"). A second capture after a decline is legitimate and gets a new `n`; a retry after a timeout, 5xx or crash reuses the same `n`. `void-{code}` is used at most once per deal, which the rules in 5.1 and 5.3 guarantee. `order-{code}-{n}`: while the stored order is `created` and under 6 h old, `start_payment` returns the stored id without a call; after that it creates order `n + 1` with a fresh key, because the 6 h retention and the 6 h approval window are the same length and a reused key could otherwise return an order that can no longer be approved. `void-{authorization_id}` is used once per stray authorization and never for the stored one (E4).

### 8.2 Transactions and the ordering around PayPal calls

The rule for every PayPal write is **write intent, call PayPal, write result**, where "intent" is whatever committed state makes the key and the arguments deterministic on a retry:

1. **Tx-before** (intent): lock the deal row (5.2), validate the command against the transition table, write the rows that make a retry deterministic, commit. Some calls need no Tx-before because the committed state already is the intent.
2. **Call** PayPal with the key from 8.1. No lock is held during the call.
3. **Tx-after** (result): lock the row again, re-read, re-validate the transition, apply the fact (5.3), write the status change and its `deal_events` row, commit.

| Call | Tx-before writes | Tx-after writes | If the process dies between the call and Tx-after |
| --- | --- | --- | --- |
| `createAuthorizeOrder` | nothing: the key `order-{code}-{order_attempts + 1}` and the amount come from committed rows (`payments.paypal_order_id` is `NOT NULL`, so no placeholder row can be written) | upsert `payments` (`paypal_order_id`, `status = created`, `order_attempts + 1`); event `start_payment` | The order PayPal may have created is never approved; the next click creates order `n + 1` with a new key |
| `authorizeOrder` | `payments.status = approved` | fact `authorization_created` -> `held` | Buyer clicks again (same key), or E8 / `PAYMENT.AUTHORIZATION.CREATED` applies the fact |
| `captureAuthorization` from the verdict | Tx A (`proof_submitted`, evidence) and Tx V (verdicts) | Tx B: `decision:capture` transition, fact `capture_completed` / `capture_pending` / `capture_declined`, and on `COMPLETED` the `payouts` row `pending` with `paypal_batch_id` null | `tick()` reruns `runVerdict()`: same verdicts, same decision, same key; PayPal returns the existing capture |
| `captureAuthorization` from `review { approve }` | nothing new: `in_review` plus the stored verdicts are the intent | `in_review -> captured`, fact, and on `COMPLETED` the `pending` payouts row | Buyer clicks Approve again, same key |
| `createPayout` (`sendPayout`, 5.3) after Tx B, after the approve transaction, after the `PAYMENT.CAPTURE.COMPLETED` transaction, or from `retry_payout` | the `payouts` row `pending` with `paypal_batch_id` null and `sender_batch_id` = the key, committed by the transaction before (attempt 1 by `applyFact`; attempt `n + 1` by `retry_payout` after `cancelPayoutItem` for `UNCLAIMED`) | `payouts.paypal_batch_id` on 2xx (or the duplicate rejection resolved in 3.4); `failed` with PayPal's error name on a 4xx; nothing on a timeout or 5xx | The row stays `pending` with `paypal_batch_id` null; the seller's `retry_payout` re-sends the same `sender_batch_id` and PayPal returns the first batch (5.1) |
| `voidAuthorization` | nothing: the call comes first so a failed void never leaves a `voided` deal with live money | `payments.status = voided`, `-> voided`, fact `authorization_voided` | User clicks again, `tick()` next day, or `PAYMENT.AUTHORIZATION.VOIDED` applies the fact |

The payout is the one call whose intent is its own row: a `payouts` row `pending` with `paypal_batch_id` null means "sent or about to be sent", and PayPal deduplicates `sender_batch_id` for 30 days (research/paypal.md "5. Payouts"), so re-sending it is always safe. A row is `pending` with a batch id (PayPal has it; a webhook will come), `pending` without one (re-send), `success`, or `failed` with a reason (attempt `n + 1`). That is what lets the UI show "Retry payout" exactly when the latest row is `failed` or `pending` with `paypal_batch_id` null (08 section 7.4).

Why the lock is not held across the call: a PayPal call can take seconds, and the `pg` pool has 10 connections (research/stack.md, "3. Prisma 7.10", pooling). Two actors can therefore both pass Tx-before and send the same key; PayPal processes one and may fail the other; the loser's Tx-after re-reads under the lock, sees the state already moved, and returns the current view or `invalid_state`. The fact is applied once either way.

Transactions that make no PayPal call (`edit_terms`, `join`, `accept`, `submit_evidence` Tx A, Tx V, `cancel` without a hold, most webhook facts, `tick` deadline voids after the call) are single transactions: lock, validate, write status and event, commit. A throw anywhere rolls the whole transaction back, so there is never a status change without its event or an event without its status change.

The verdict request's time budget: Tx A under 0.1 s, carrier and `hashCheck()` 0 s, `ai.judge` at most 17 s per attempt inside a 19 s signal (D4; 9 s with one retry if the eval's p95 is under 8 s), Tx V under 0.1 s, capture at most 10 s (SDK `timeout: 10_000`), Tx B under 0.1 s, payout at most 10 s (`AbortSignal.timeout(10_000)`). Typical total is 6 to 12 s; the worst case is about 40 s, and the UI waits 45 s (B5). Render documents no request timeout (research/stack.md, "5. Render", "(d) Request timeout", UNVERIFIED); spike 4 in section 12 measures it.

## 9. Security

The session is a signed cookie, a deal is readable only by its two parties, files are reachable only through expiring signed links, webhooks are verified in our own code, secrets live only in env vars, and nothing the model says is ever an argument to PayPal.

### 9.1 Sessions (F1 to F3)

- `hs_session` is a `jose` HS256 JWT `{ sub: user_id }` signed with `SESSION_SECRET`, 30 days, cookie flags `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`. The pattern is the Next.js auth guide's stateless session (research/stack.md, "6. Sessions and magic links").
- Magic link: `POST /api/auth/magic-link { email }` signs `{ sub: email, purpose: "login" }` for 15 minutes (04 section 4.1) and emails `{APP_URL}/api/auth/callback?token=...` through Resend; in development the link is printed to the console. The callback verifies the token, upserts `users` by email, sets `hs_session` and redirects. The token is replayable until it expires; there is no magic-link table (I1), and the 15-minute window is the limit.
- Demo personas: when `DEMO_LOGIN=true`, `POST /api/auth/demo { persona }` upserts the persona on every sign-in (`display_name` "Demo Buyer" or "Demo Seller"; for the seller `paypal_email = DEMO_SELLER_PAYPAL_EMAIL`, so a judge's `PATCH /api/me` cannot redirect later payouts, F3) and sets `hs_session` for `demo-buyer@handshake.demo` or `demo-seller@handshake.demo`. The route answers `400 invalid_input` with the message "Demo login is disabled." when `DEMO_LOGIN` is not `true` (04 section 4.3).
- Every route except `/api/health`, `/api/auth/*`, `/api/webhooks/paypal`, `/api/jobs/tick` and `/api/files/{id}` calls `requireSession()` and answers `401 not_signed_in` without a valid cookie. No `proxy.ts` is used: it would buffer uploads and silently truncate them past 10 MB (research/stack.md, "2. Next.js App Router details").

### 9.2 Access rule and the preview exception (F4)

`lib/deal/access.ts` loads the deal by `public_code` (`deal_not_found`), then: `user_id == buyer_id` -> role `buyer`; `user_id == seller_id` -> role `seller`; otherwise, if `status = draft` and `seller_id` is null -> `preview` (read-only `DealPreview`; the only command allowed is `join`); otherwise `not_a_party`. Commands then check the role the transition table requires (buyer-only: `edit_terms`, `start_payment`, `confirm_approval`, `review`; seller-only: `submit_evidence`, `retry_payout`, `addFile` with `purpose = evidence`; either: `accept`, `cancel`). `listDeals` (and through it the ledger and the dashboard route, 3.2) selects `WHERE buyer_id = $1 OR seller_id = $1`. A third signed-in user gets `403` on every deal endpoint except the preview read.

### 9.3 Signed file URLs (B6)

- Upload: `POST /api/deals/{code}/files` reads `request.formData()`, rejects `content-length` over 2.5 MB (2,621,440 bytes) with `413 file_too_large` before parsing (04 section 8.1), then `lib/files/validate.ts` checks the magic bytes (`FF D8 FF` JPEG, `89 50 4E 47` PNG, `RIFF....WEBP` WebP), size <= 2,097,152 bytes (`file_too_large`), computes `sha256`, and `addFile` checks the role, status and per-deal counts (`too_many_files`) before inserting `files` with `bytes`.
- Serve: `GET /api/files/{id}?exp=&sig=` where `sig = base64url(HMAC-SHA256(FILE_URL_SECRET, "{id}.{exp}"))` and `exp` is a Unix time 600 s after minting. The route rejects a missing or non-numeric `exp`, an expired `exp`, and a `sig` that differs in length or fails `timingSafeEqual` (research/stack.md, "8. HMAC-signed expiring photo URLs"). It answers with `Content-Type: files.mime`, `Cache-Control: private, max-age=600`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`. No session is needed: the signature is the capability, and signed URLs are minted only inside `buildDealView` and `getEvidencePack`, which run after the access check.
- Blobs are fetched only by this route; every other query uses Prisma `select` without `bytes`, so list and deal pages never pull megabytes (research/stack.md, "3. Prisma 7.10", Bytes).

### 9.4 Webhook signature verification (E6)

`lib/paypal/verify.ts` implements `paypal.verifyWebhook(rawBody, headers)` (3.4), called by the webhook route before anything is parsed or stored as verified:

1. `raw = await request.text()`.
2. Read `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`. Any missing header -> unverified.
3. `PAYPAL-CERT-URL` must parse as `https:` with a hostname ending in `.paypal.com`; otherwise unverified and the cert is never fetched.
4. Fetch the PEM from that URL (10 s timeout) and cache it in memory by URL for the process lifetime. A fetch that fails or times out is `fetch_failed`, not `unverified`: the route stores nothing and answers `500`, so PayPal's retry is a real retry.
5. Build the signed message, with the CRC as an unsigned decimal (Node's built-in `zlib.crc32`, no dependency; research/paypal.md, "6. Webhooks", "Self-verification"):

   ```ts
   const message = `${transmissionId}|${transmissionTime}|${webhookId}|${zlib.crc32(Buffer.from(raw))}`;
   ```
6. `crypto.createVerify("SHA256").update(message).verify(pem, transmissionSig, "base64")`.
7. Try `webhookId = PAYPAL_WEBHOOK_ID` first. When `NODE_ENV !== "production"`, also try the literal `WEBHOOK_ID`, which is the id PayPal's simulator signs with (research/paypal.md, "6. Webhooks", "Simulator"). PayPal's postback endpoint is not used: it rejects its own simulator's events.
8. `verified` -> `applyPaypalEvent(..., verified: true)` (6.8). `unverified` -> `applyPaypalEvent(..., verified: false)` stores or updates the row with `verified = false`, nothing is processed, the route answers `400`. `fetch_failed` -> `500`, nothing stored.

### 9.5 Secrets

- Every secret is an env var named in decisions J3; `lib/env.ts` validates them with Zod at boot and the app refuses to start without one. `SESSION_SECRET`, `FILE_URL_SECRET` and `CRON_SECRET` are `z.string().min(32)`, so an empty bearer can never match `CRON_SECRET` and sessions and file URLs cannot be forged with an empty key; `PAYPAL_WEBHOOK_ID` is `.min(1)` when `NODE_ENV` is `production`. `.env.example` lists names only.
- The only value that reaches the browser is `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (the PayPal client id is public by design). `AG_GRID_LICENSE_KEY` is validated in the browser and is not a server secret (research/ag-grid.md).
- `lib/db.ts` and `lib/auth/session.ts` import `server-only`, so a client bundle cannot pull in the database or a session. As built `lib/paypal` and `lib/ai` do not, because `scripts/sandbox/spike.ts` and `eval/run.ts` run them under `tsx`, where `server-only` throws; the import-graph test (`tests/unit/boundaries.test.ts`) is what keeps them out of the wrong places.
- `POST /api/jobs/tick` compares the bearer token with `CRON_SECRET` via `timingSafeEqual` after a length check.
- Logs record PayPal debug ids, event ids and deal codes, never request bodies, tokens or photo bytes. `verdicts.raw_response` is stored in the database, not logged.

### 9.6 No model output ever reaches a PayPal call

The data flow is one-directional by construction:

- `ai.judge` returns `JudgeOutput.verdicts` (`condition_id`, `result`, `confidence`, `reason`, `evidence_used`). The only consumer is `decide()`, whose output is the four-value `Decision` enum.
- The arguments of every PayPal call come from database rows: `payments.authorization_id`, `deals.amount_minor`, `deals.public_code`, `users.paypal_email`. The `reason` strings are stored and rendered (React escapes them) and are never passed to `lib/paypal`.
- `ai.extract` output is validated by Zod, shown to the buyer for editing, and stored; the amount reaches `createAuthorizeOrder` only after both parties have accepted that `terms_version`, which makes it human-approved input.
- `lib/ai` imports nothing from `lib/paypal` and vice versa; an ESLint `no-restricted-imports` rule enforces it. The `AiDep` interface has no PayPal types in its signature.
- Untrusted text (notes, text inside images) is delimited and described as evidence in the prompt (D11); even if the model were steered, it can only change a verdict, and a changed verdict can only reach `buyer_review`, `request_fix` or `void` paths, or `capture` through the same threshold and ceiling checks as any honest verdict.
- The model has no tools (hackathon.md: "Handshake deliberately gives the model no tools").

## 10. Testability

Every dependency with a network behind it has a fake that records calls and can be told how to answer, so the whole state machine runs in Vitest against a real Postgres with no network.

| Fake | File | What it records | What it can simulate |
| --- | --- | --- | --- |
| `FakePayPal` | `lib/paypal/fake.ts` | Every call of the ten methods with its arguments and `requestId`, in order; a map `requestId -> first result`, so a repeated key returns the first result without a new "call"; a repeated `sender_batch_id` on `createPayout` returns the original batch (the duplicate rule in 3.4) | `failNext(method, PayPalError)` (5xx, 422 `AUTHORIZATION_VOIDED`, `PREVIOUSLY_VOIDED`, a void refused after capture, a failed `cancelPayoutItem`); `authorizeStatus = "CREATED" or "PENDING" or "DENIED"`; `captureStatus = "COMPLETED" or "PENDING" or "DECLINED"`; a hang until a given `Promise` (to test the dies-between cases); `event(type, resource)` to build a `PaypalWebhookEvent` for any resource it has issued; `verifyWebhook` answers `verified` unless told otherwise; the `get*` reads answer from its `captures`, `authorizations` and `payouts` maps, whose `status` / `itemStatus` a test sets to play PayPal moving on without a webhook |
| fake `AiDep` | `lib/ai/fake.ts` | Every `ExtractInput` and `JudgeInput` (so tests assert labels, delimiting and that no PayPal id is present) | `extractWith(result or "timeout" or "refusal" or "invalid")`, `judgeWith(verdicts or "timeout" or "refusal" or "invalid" or "missing_c2")`, named as in 06; defaults: a fixed extraction, every condition `pass` at 0.95 |
| `RecordingEmail` | `lib/email/console.ts` | Every message | Nothing fails; tests assert who was told what |
| `FixedClock` | `lib/clock.ts` | | `set(date)`, `advance(ms)`: deadline voids, the 2-minute stuck rule, URL expiry |
| Webhook cert fetcher | injected into `verifyWebhookSignature` | | A test RSA key pair signs synthetic events; a wrong key, a wrong host and a changed body each produce `verified = false` |

Internal seams and what each test level covers:

| Level | Runs | Covers |
| --- | --- | --- |
| Unit (Vitest, `tests/unit`) | every push | `decide()` row by row including a missing verdict and confidence exactly 0.85; `transitions.ts` (every allowed row succeeds, every other pair throws and writes nothing); `keys.ts`; `lib/carrier.ts`; `code.ts`; `files/urls.ts`; `files/validate.ts`; `paypal/verify.ts` with a local key pair; `ai/schemas.ts` Zod rules; `views.ts` role-aware fields (seller email only for the seller) |
| Integration (Vitest, `tests/int`, `handshake_test` database, fakes) | every push, serial | `handle()` for every command through the route handlers called in-process with a `Request`; `applyPaypalEvent` idempotency (SB-7); the fact-once rule from both sources (SB-6); dies-between cases via the hanging fake; `tick()`; access rules (third user gets 403; preview); signed URL expiry; `getEvidencePack` rebuilt from the database alone |
| AI eval (`npm run eval`) | on every prompt or model change | The 30 cases in `eval/cases/` against the real API; decision-match rate and a wrong-capture rate that must be zero (D12) |
| Sandbox scripts (`scripts/sandbox/`) | before each deploy | SB-1 to SB-8, SB-10, SB-11 against the real PayPal sandbox and the deployed URL (SB-9 and SB-12 are cut, A5) |
| End to end (Playwright, `tests/e2e/`) | locally before each deploy | One happy path: both personas in one browser via the persona switcher, the real PayPal sandbox popup driven with the sandbox buyer login, through to `captured` |

`lib/deps.ts` builds the real `Deps`; tests build `Deps` by hand and never read env. Route handlers are plain exported functions, so the integration tests call `POST(new Request(...))` directly, which is how the thin-route rule (B4) is checked: a route that did real work would need more than a fake `Deps` to test.

## 11. Design decisions

| Decision | Rationale |
| --- | --- |
| One Next.js app, one Postgres, one daily cron (B1) | One developer plus an agent and five weeks. Every extra service is a second deploy, a second set of env vars and a second thing to be awake during judging. The $50 Render credit covers exactly this shape (J2). |
| One deep module, `lib/deal` (B2) | Every money rule lives in one folder with one interface, so it can be tested against fakes end to end and reviewed in one sitting. Routes cannot drift from the rules because they contain none. |
| The verdict runs inside the request (B5) | Work left running after a response is lost on a Render restart, and there is no queue to put it in. Answering `200` with the final state after at most 17 s of AI time (about 40 s worst case with the PayPal calls) is simpler for the UI and honest about what happened. `tick()` covers the crash case. |
| Facts applied once from whichever source is first (C3) | The brief made webhooks the source of truth, which forces the UI to wait and a webhook outage to stall every deal. Treating the API response and the webhook as two carriers of one fact makes SB-6 and SB-7 pass with the same code and lets the demo move at the speed of the API response. |
| `captured` means capture requested; `payments.status` carries the detail (C4) | Keeps the deal state machine to eight states while `PENDING` and `DECLINED` remain representable and retryable. |
| No reauthorize job (B7) | PayPal blocks reauthorization for 3 days and allows effectively one per hold (research/paypal.md, "3. Payments v2 authorizations"). A daily job cannot be correct. A 21-day cap inside the 29-day validity, plus the day-4-to-21 capture spike (E11), is the plan. |
| Write intent, call PayPal, write result, no lock across the call (8.2) | Makes every PayPal write recoverable by key reuse after a crash, with no long-held connections. The cost is that two actors can race the same key; PayPal and the re-read under the lock make that safe. |
| Void is called before the status changes; the payout row is written before its call | A `voided` deal with live money is the one state nobody retries, so the void call comes first and a failure leaves the deal where a user, `tick()` or a redelivered webhook tries again with the same key. The payout is the opposite case: its key is the `sender_batch_id`, which PayPal deduplicates for 30 days, so a `pending` row with no batch id is safe to re-send and is exactly what `retry_payout` re-sends (5.1). Writing the row first means a crash after the call can never lose a batch PayPal accepted, and the attempt number exists before any money moves (03). |
| Verdict rows committed before any capture | A rerun after a crash must reach the same decision, so it must read stored verdicts, not call the model again. |
| Photos in Postgres (B6) | No bucket, no third credential set, one backup. At demo scale (hundreds of 600 KB photos) `bytea` is fine (research/stack.md, "4. Postgres bytea"). |
| Self-verified webhooks (E6) | PayPal's postback endpoint rejects simulator events; the CRC32 plus RSA method works for both real and simulated events with one code path and no dependency. |
| `jose` sessions, no auth framework (F1) | Auth.js v5 is beta and needs a DB adapter for email sign-in; a signed JWT cookie is the pattern in the Next.js auth guide and is a few dozen lines. |
| Request-level `Idempotency-Key` headers dropped (B8) | The state machine already rejects a double submit with `invalid_state`, and `PayPal-Request-Id` covers the money side. The header would have needed a table. |
| Seeded deals are read-only | They exist so the ledger and dashboard have history; letting commands run on them would call PayPal with no PayPal objects. |

### Rejected: a separate API service plus a worker service with a queue

The verdict, capture and payout would be jobs on a queue drained by a worker, and the web app would poll. Rejected because: it needs a queue (Redis or a Postgres job table with a poller), a second Render service (another $7/mo and another thing to keep alive), and cross-service idempotency; a Render deploy restarts both anyway, so the durability argument only holds with a durable queue, which is more code than `tick()`; the verdict request (typically 6 to 12 s, about 40 s worst case) fits in one request; and the UI gets a worse experience (polling) for a hackathon demo that must feel immediate. The shape in 8.2 gives the same crash safety with one process.

### Rejected: event-sourced deals

`deal_events` would be the write model and `deals.status` a projection rebuilt by replay. Rejected because: the audit trail is already append-only and complete with a plain status column (C6), which satisfies NFR-9 (the evidence pack is rebuilt from the database alone); replay needs versioned event schemas, snapshots and a projector, none of which the product needs; AG Grid and AG Studio want current-state rows, not streams; Prisma enums and a `(status, deadline_at)` index make `tick()` a one-line query; and the fact-once rule is easier to express as a guard on `payments` columns than as a deduplicating event fold. The one thing event sourcing would give, time travel, is covered by `GET /api/deals/{code}/events`.

## 12. Risks and the week-1 spike list

Two PayPal behaviours are unverified (E11) and three platform limits are undocumented; the first week confirms them before the state machine is finished.

| # | Spike | How | Decides |
| --- | --- | --- | --- |
| 1 | Capturing the original hold on days 4 to 21 without reauthorizing (UNVERIFIED, research/paypal.md "Open risks" 1) | Day 1 of the sandbox: create and authorize a $1 order and leave it. Day 5: capture it with the original authorization id. Repeat on day 10 with a second hold | If capture fails after day 3: cap `deadline_days` at 3 for the demo and add exactly one `reauthorize` immediately before capture (research/paypal.md "Implications" 2), with a new `reauth-{code}` key and a `current_authorization_id` column; void still targets the original (E3) |
| 2 | Whether Payouts needs a feature enabled on the sandbox app (UNVERIFIED, "Open risks" 3) | Day 1: check the app's Features list; send a $1 payout to the second sandbox personal account; look for `REQUIRED_SCOPE_MISSING` or `AUTHORIZATION_ERROR` | Setup steps in [07-setup-deployment.md](07-setup-deployment.md) |
| 3 | Real webhook delivery, self-verification and order-key reuse | Register the `cloudflared` tunnel URL; run an authorize; confirm `PAYMENT.AUTHORIZATION.CREATED` arrives with `resource.custom_id`, and `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` with `resource.payout_item.sender_item_id`; confirm the signature verifies with `PAYPAL_WEBHOOK_ID`. Also click Pay twice 10 minutes apart on one deal and confirm the same order id comes back (the 6 h retention in 8.1 is UNVERIFIED) | The lookup column in 5.5; a fallback by `paypal_order_id` or `authorization_id` if `custom_id` is absent; whether the 6 h reuse window in 5.1 can stay |
| 4 | Render request timeout for a 40 s route (UNVERIFIED, research/stack.md "Open risks" 1; B5) | Deploy a route that sleeps 40 s; call it from outside | If it is cut: lower the AI timeout to 12 s and the PayPal timeouts to 5 s; the design does not change |
| 5 | Verdict latency with 10 images at `effort: "low"` on `claude-sonnet-5-5` | Run 5 eval cases 3 times each; record p50 and p95 | Whether `effort: "medium"` is affordable inside 17 s; `AI_MODEL` default |
| 6 | Negative testing for capture `DECLINED` and `PENDING` | Enable Negative Testing on the sandbox business account; send `PayPal-Mock-Response` on capture (research/paypal.md, "9. Sandbox setup" 6) | Whether SB-level scripts can exercise the `in_review` and `capture_pending` rows, or only the integration tests with fakes |
| 7 | `PREVIOUSLY_VOIDED` on a second void, and void returning 204 | Void the same authorization twice | The `voidAuthorization` adapter's success mapping |
| 8 | iPhone HEIC uploads through `createImageBitmap` (UNVERIFIED, research/stack.md "Open risks" 5) | Upload from a real iPhone in Safari and in Chrome | The client-side error copy in the UI spec |
| 9 | Memory of `next start` with a 2 MB multipart upload on `0.5c-512mb` | Upload 6 photos while watching Render metrics | Whether the upload limit must drop |
| 10 | Whether a cross-service `fromService: { envVarKey: RENDER_EXTERNAL_HOSTNAME }` fills the cron's `APP_HOST` (UNVERIFIED, 07 section 3.4 step 4) | After the first Blueprint deploy, open handshake-tick > Environment and read `APP_HOST` | If empty: `APP_HOST` becomes `sync: false` in `render.yaml` and the host is pasted by hand; without it the daily `tick` never runs |

Remaining risks after the spikes:

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A judge submits evidence while Render restarts a deploy | One deal stuck in `proof_submitted` until the next cron run | Freeze deploys during judging (2026-12-01 to 12-15); `POST /api/jobs/tick` can be run by hand |
| Anthropic 529 or a safety-classifier refusal during a judge's demo | The deal goes to `in_review`; the demo still works, the buyer decides | The in-review page is a first-class screen, not an error |
| Resend cannot deliver to demo persona addresses | No notification emails in the hosted demo | The deal page is the source of truth; persona switching replaces email |
| A stale PayPal popup approves after a cancel | `CHECKOUT.ORDER.APPROVED` on a cancelled deal is a `noop` (5.5), so no hold is created; only an `authorizeOrder` call already in flight when the cancel commits can produce a late authorization | Voided immediately by 5.3 with the unused `void-{code}` |
| PayPal fails the second of two concurrent same-key requests | One `502` for the loser | The loser re-reads and finds the fact applied; the user sees the current state on reload |

## Assumptions

Choices not made in decisions.md, taken here as the simplest option consistent with it:

1. `createDeal(actor, input, deps)` and `addFile(code, actor, input, deps)` are added to `lib/deal`'s public interface; B2 lists no creation or upload entry point. No dashboard query is added: `GET /api/dashboard/data` is composed in its route from `listDeals`, `getDeal` and `getEvents` with `lib/dashboard-rows.ts` (04 section 14, 09 Assumption 2).
2. Every command endpoint answers `200` with the full `DealView`, except `POST /api/deals/{code}/payment`, which answers `200 { order_id }` (04 section 7.1); `POST /api/deals` answers `201` with `DealView & { rejected }`; `POST /api/deals/{code}/files` answers `201` with a `FileRef`; `POST /api/jobs/tick` answers `200` with a `TickReport`.
3. Response types are not defined in this document: `lib/deal/types.ts` declares the shapes of 04 sections 3, 6.2 and 10.2 verbatim; `DashboardData` (04 section 14) lives in `lib/dashboard-rows.ts`. There is no `actions[]` field and no `ActionName` type; the UI derives actions from `status` and `role`.
4. Uncaught exceptions answer `500 internal_error`; a webhook cert that cannot be fetched also answers `500` with nothing stored.
5. `edit_terms` from `terms_agreed` is allowed only while no `payments` row exists. Reference photos can be added while the deal is `draft` and `seller_accepted_version` is null; the upload writes no event and does not change `terms_version`; there is no delete for reference photos.
6. `sender_item_id` equals `sender_batch_id` (`payout-{code}-{n}`); payout attempts start at 1; capture `n` is `payments.capture_attempts`, incremented only when a `fact:capture_declined` is applied.
7. E8 applies when `deal.status = terms_agreed` and `payments.status` is `created` or `approved` (not yet authorized), a superset of E8's "still `created`"; on a cancelled deal the approval is a `noop`.
8. An authorization returned as `PENDING` is stored (`authorization_id`, `authorized_at`, `auth_expires_at`) with `payments.status = approved` and the deal still `terms_agreed`; the API path answers `502 paypal_error`; the later `PAYMENT.AUTHORIZATION.CREATED` with `status CREATED` moves the deal to `held`; `cancel` voids it; `start_payment` is `invalid_state` meanwhile. `DENIED` stores nothing and answers `502`.
9. `authorized_at` is the server clock when the fact is applied, in both the API and the webhook path (04 assumption 12), so one hold always yields one `deadline_at`. A webhook-built `authorization_created` fact carries no order id; it is matched on `deal.status` and the stored `authorization_id`.
10. A stray authorization on a deal that already holds a different one is voided with its own key `void-{authorization_id}` (E4) and recorded as `fact:late_authorization_voided` without touching `payments`. A late authorization on a deal with no stored authorization is stored (id, `authorized_at`, `auth_expires_at`, so 03's `payments_auth_pair` holds), voided with `void-{code}` and marked `voided`.
11. Capture errors `AUTHORIZATION_EXPIRED` and `AUTHORIZATION_VOIDED` are applied as the fact `authorization_voided`; a capture status `FAILED` is treated as `DECLINED`. A void refused with any other 422 is treated as "already captured" (C4): `capture-{code}-{n}` is re-sent and the command answers `invalid_state`.
12. `confirm_approval` is idempotent: when the hold already exists it returns the view without a PayPal call.
13. The `payouts` row is inserted `pending` with `paypal_batch_id` null inside the transaction that records the capture (evidence request Tx B, `review { approve }`, the `PAYMENT.CAPTURE.COMPLETED` handler) or the `retry_payout` transaction for attempt `n + 1`; `sendPayout(row)` calls Payouts after commit (5.3, 8.2; 04 section 9.1 step 10). A 2xx fills `paypal_batch_id`; a timeout or 5xx leaves the row `pending` with `paypal_batch_id` null; only a 4xx with a PayPal error `name` or an item webhook sets `failed`. `retry_payout` re-sends attempt `n` with the same `sender_batch_id` when the latest row is `pending` with `paypal_batch_id` null, and creates `n + 1` (after `cancelPayoutItem` for `UNCLAIMED`) when it is `failed` (E7; 04 section 9.4). The Payouts adapter resolves a duplicate-`sender_batch_id` rejection to the original batch (research/paypal.md "5. Payouts", "Duplicate handling").
14. `runVerdict()` skips the model call when verdict rows exist for the current submission; the `verdict` event (actor `ai`, `proof_submitted -> proof_submitted`) is written with the verdict rows; `tick` writes `tick:reverify` before re-running it; `hashCheck()` runs in `lib/deal/verdict.ts` before `judge()` (05 section 6.1), so `JudgeOutput.prompt_version` is `judge-v1` or `guardrail-v1`; `decide(verdicts, deal, LIMITS)` returns `{ decision, reason }` and the `reason` word goes into every `decision:*` payload (05 section 7).
15. `submit_evidence` requires at least one photo when a photo condition exists and a tracking number when a tracking condition exists, and `clock.now() < deadline_at`; evidence uploads have the same deadline check.
16. The two notices in 5.6 are the complete list; sending happens after commit and failures are logged only. No email on `held`, `request_fix`, `voided`, `paid` or `payout_failed`.
17. Seeded deals (`seeded = true`) are read-only: commands throw `invalid_state`, `tick()` skips them, webhooks for them are `unknown_deal`.
18. PayPal client timeouts are 10 s per call; the webhook cert fetch is 10 s; `deal_events.id` is serialised as a decimal string in the API; interactive transactions run with `timeout: 15_000`.
19. The Prisma client is generated into `generated/prisma/` at the repo root (gitignored), imported as `@/generated/prisma/client`.
20. The Playwright happy path drives the real PayPal sandbox popup with the sandbox buyer login read from the developer's local shell (`E2E_PAYPAL_BUYER_EMAIL`, `E2E_PAYPAL_BUYER_PASSWORD`; 06 "End to end"); these are test-only and not app configuration, so they are not in J3.
21. The evidence pack is 04 section 10.2: both parties' emails and, for the seller only, the seller's `paypal_email` and payout recipient emails; photo bytes are referenced by `sha256` and a 10-minute signed URL, not embedded; the attachment is `handshake-{code}-evidence-pack.json`.
22. `GET /api/files/{id}` needs no session: the HMAC signature is the capability and is minted only inside access-checked views.
23. `webhook_events` is written with `ON CONFLICT (paypal_event_id) DO UPDATE SET verified = EXCLUDED.verified WHERE processed_at IS NULL`, and processing is decided by the incoming verification result, so a transient bad delivery never pins a row to `verified = false`.
24. `SESSION_SECRET`, `FILE_URL_SECRET` and `CRON_SECRET` must be at least 32 characters; `PAYPAL_WEBHOOK_ID` must be non-empty in production.
25. `PayPalError.debug_id` and `name_` are read from the parsed error body (`e.body` on the SDK's `ApiError`, the JSON body on raw fetch, with the `paypal-debug-id` header as the fetch fallback); whether `ApiError` also exposes parsed `result` and `headers` is UNVERIFIED (research/paypal.md section 7 documents them on `ApiResponse`).
