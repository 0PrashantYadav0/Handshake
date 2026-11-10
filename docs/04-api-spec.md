# Handshake API specification

This document fixes the request, response, errors and side effects of every HTTP endpoint in `docs/decisions.md` H1, so routes, pages and tests can be built from it without further design. As of 2026-10-09.

Related documents: [decisions.md](decisions.md) (authoritative names), [research/paypal.md](research/paypal.md), [research/stack.md](research/stack.md), [research/ag-grid.md](research/ag-grid.md), [research/claude-api.md](research/claude-api.md). Where this differs from the original brief, this document wins.

## 1. Conventions

Every endpoint lives under `/api`, speaks JSON, and is served by a thin Next.js Route Handler on the Node runtime (decisions B1, B4).

### 1.1 Requests and responses

| Topic | Rule |
| --- | --- |
| Body format | `Content-Type: application/json`, except `POST /api/deals/{code}/files` (`multipart/form-data`) and `POST /api/webhooks/paypal` (raw JSON read with `await request.text()`). |
| Response format | JSON with `Content-Type: application/json`, except `GET /api/files/{id}` (image bytes) and `/api/auth/callback` (302/303 redirects). `POST /api/studio/agent` answers plain JSON (section 15). |
| Session | Cookie `hs_session`: a `jose` HS256 JWT with claim `sub` = user id, signed with `SESSION_SECRET`, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days). `Secure` is dropped when `NODE_ENV !== "production"` so local http works (decisions F1, stack.md section 6). |
| Who needs a session | Every `/api/me*`, `/api/deals*`, `/api/dashboard/data` and `/api/studio/agent` call. Not needed: `/api/auth/*`, `/api/files/{id}` (the signature is the credential), `/api/webhooks/paypal` (PayPal signature), `/api/jobs/tick` (bearer `CRON_SECRET`), `/api/health`. |
| Deal identity | `{code}` is `deals.public_code`, format `HS-` + 4 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (decisions I4). Internal UUIDs never appear in URLs. |
| Other ids | Users, conditions, files, payments, payouts: UUID strings. `deal_events.id` is a BigInt in Postgres and is serialised as a decimal string (decisions I5, stack.md section 3). |
| Money | Integer minor units in `amount_minor`; `currency` is always `"USD"` (decisions A6). PayPal receives `value = (amount_minor / 100).toFixed(2)`. |
| Time | ISO 8601 UTC strings with a `Z` suffix, e.g. `"2026-10-20T15:16:09Z"`. |
| Validation | Zod schemas in the route. Unknown body fields are ignored. Strings are trimmed before validation. |
| Check order | 1. session (`401`), 2. body shape (`400`), 3. deal exists (`404`), 4. caller is a party (`403`), 4a. `deals.seeded = true` on any command endpoint (`terms`, `join`, `accept`, `payment`, `payment/authorize`, `files`, `evidence`, `review`, `cancel`, `payout/retry`): `409 invalid_state` with message `"This is a historical demo deal."` (02 section 3.1; the `DealView` of a seeded deal carries no actions), 5. role and status (`409`), 6. business rules (`409`/`422`). |
| Idempotency | No request-level `Idempotency-Key` header (decisions B8). A double submit hits the state machine and gets `409 invalid_state`; every PayPal write carries `PayPal-Request-Id` (decisions E4). |
| Concurrency | `lib/deal/handle()` serialises commands per deal with a row lock, so two concurrent requests on one deal run one after the other; the second sees the first one's state. |
| Proxy | No `proxy.ts` matches `/api/*`. The 10 MB proxy body buffer and its silent truncation therefore never apply (stack.md section 2). |

### 1.2 Error shape

Every error, from every endpoint, has one shape:

```json
{ "error": { "code": "terms_version_mismatch", "message": "You accepted version 1 but the terms are now version 2." } }
```

`message` is a plain sentence meant for the screen. Clients branch on `code`, never on `message`.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `invalid_input` | Body, query or multipart fields fail validation; a file is not JPEG, PNG or WebP; a webhook signature fails; demo login is disabled. |
| 401 | `not_signed_in` | No valid `hs_session` cookie, or a wrong `CRON_SECRET` bearer on `/api/jobs/tick`. |
| 403 | `not_a_party` | The signed-in user is neither buyer nor seller of the deal; or is a party but in the wrong role for this action (message names the role); or a signed file link is invalid or expired. |
| 404 | `deal_not_found` | Unknown deal code; unknown file id. |
| 409 | `invalid_state` | The action is not allowed in the deal's current status (decisions C2); `edit_terms` from `terms_agreed` once a `payments` row exists (`"Payment has started; cancel the deal to change the terms."`); any command on a seeded deal (`"This is a historical demo deal."`). |
| 409 | `terms_not_accepted` | `start_payment` or `confirm_approval` while both accepted versions do not equal `terms_version` (status `draft`). |
| 409 | `terms_version_mismatch` | `accept` with a `terms_version` that is not the current one. |
| 409 | `paypal_email_required` | The seller has no `paypal_email` when accepting, when the deal would become `terms_agreed`, or when retrying a payout. |
| 413 | `file_too_large` | One uploaded file exceeds 2 MB, or the request body exceeds 2.5 MB. |
| 422 | `condition_not_checkable` | Extraction found no checkable condition in the sentence. The message carries the model's suggested rewordings. |
| 422 | `unsupported_currency` | Extraction returned a currency other than `"USD"` or `null`. |
| 422 | `too_many_files` | More than 4 reference photos on a deal, more than 6 evidence photos in one submission, or more than 6 unsubmitted evidence files on a deal. |
| 429 | `rate_limited` | Per user, per 10 minutes, in memory (`lib/rate-limit.ts`): 20 `POST /api/deals` extractions, 120 `GET /api/deals/{code}` reads, 30 `POST /api/studio/agent` turns (section 15). `POST /api/auth/magic-link` is limited too (3 per email, 10 per IP) but stays `200` so addresses cannot be probed (decisions H2). |
| 500 | `internal_error` | Any unhandled exception, or a webhook processing failure. Never carries internals. |
| 502 | `paypal_error` | PayPal rejected or failed a call. The message ends with PayPal's `debug_id`, e.g. `"PayPal declined the capture (debug id 7a1b2c3d4e5f6)."`. |
| 503 | `ai_unavailable` | Extraction failed after its one retry (timeout, 429/5xx, refusal or output that failed the schema). Message `"The model did not answer; try again."`. |

The list is decisions H2 verbatim and exact; no endpoint adds a code. `invalid_input` also covers `accept` while `amount_minor` or `deadline_days` is null (`"Set the amount and the deadline before accepting."`).

### 1.3 Limits

All limits come from decisions H3 and B6.

| Limit | Value | Error when exceeded |
| --- | --- | --- |
| Sentence (`text`) | 500 characters | `invalid_input` |
| Note | 1,000 characters | `invalid_input` |
| Amount | 1 to 1,000,000 minor units | `invalid_input` |
| Deadline | 1 to 21 days | `invalid_input` |
| Item title | 1 to 80 characters | `invalid_input` |
| Condition text | 1 to 200 characters; 1 to 4 buyer conditions (the server adds the code condition, so at most 5 exist) | `invalid_input` |
| Tracking number | 1 to 64 characters | `invalid_input` |
| Display name | 1 to 60 characters | `invalid_input` |
| File size | 2 MB per file; request body 2.5 MB | `file_too_large` |
| File type | `image/jpeg`, `image/png`, `image/webp`, checked by magic bytes, not by the client's `Content-Type` | `invalid_input` |
| Reference photos | 4 per deal | `too_many_files` |
| Evidence photos | 6 per submission; at most 6 uploaded-but-unsubmitted evidence files per deal | `too_many_files` |
| Verdict budget | Inside `POST /api/deals/{code}/evidence`: model 17 s per attempt within a 19 s abort signal, then capture up to 10 s (SDK `timeout: 10_000`), then payout up to 10 s; about 40 s worst case, typically 6 to 12 s; the UI waits 45 s (decisions B5, D4). Whether Render's proxy allows a 40 s response is UNVERIFIED (02 section 12, spike 4). | n/a |
| Signed file URL | 10 minutes | `not_a_party` |
| Rate limits | Per 10 minutes: 20 extractions per user, 120 deal reads per user, 30 Studio turns per user, 3 magic links per email and 10 per IP | `rate_limited`; the magic link answers `200` |

## 2. Endpoints

Twenty-seven endpoints, exactly the list in decisions H1.

| Method | Path | Who | State precondition | What it does |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/magic-link` | Anyone | none | Emails a 15-minute sign-in link (console in development) |
| GET | `/api/auth/callback` | Anyone with a link | none | Forwards to `/signin/link` (spends nothing) |
| POST | `/api/auth/callback` | Anyone with a link, same origin | none | Uses the link token once, upserts the user, sets a partial `hs_session`, redirects to the second factor |
| POST | `/api/auth/demo` | Anyone, when `DEMO_LOGIN=true` | none | Signs in as the demo buyer or demo seller |
| POST | `/api/auth/sign-out` | Anyone | none | Clears `hs_session` |
| GET | `/api/me` | Signed in | none | Returns the caller's profile |
| PATCH | `/api/me` | Signed in | none | Updates `display_name` and `paypal_email` |
| POST | `/api/deals` | Signed in (becomes buyer) | none | Extracts terms from one sentence and creates a `draft` deal |
| GET | `/api/deals` | Signed in | none | Lists the caller's deals for the ledger as `LedgerRow[]` |
| GET | `/api/deals/{code}` | Buyer or seller; any signed-in user for a preview | any; preview only when `draft` with no seller | Returns the `DealView`, or a `DealPreview` for a non-party |
| PATCH | `/api/deals/{code}/terms` | Buyer | `draft`, or `terms_agreed` with no `payments` row | Edits terms, bumps `terms_version`, clears both acceptances; deal becomes `draft` |
| POST | `/api/deals/{code}/join` | Signed-in non-party | `draft`, `seller_id` null | Attaches the caller as seller |
| POST | `/api/deals/{code}/accept` | Buyer or seller | `draft` | Records acceptance of a terms version; becomes `terms_agreed` when both match |
| POST | `/api/deals/{code}/payment` | Buyer | `terms_agreed` | Creates (or re-returns) the PayPal order with intent `AUTHORIZE` |
| POST | `/api/deals/{code}/payment/authorize` | Buyer | `terms_agreed` | Authorizes the approved order; deal becomes `held` |
| POST | `/api/deals/{code}/files` | Buyer (`reference`) or seller (`evidence`) | `draft` for reference; `held` for evidence | Stores one photo in Postgres and returns its id |
| GET | `/api/files/{id}?exp=&sig=` | Anyone with a valid signed link | none | Serves the photo bytes |
| POST | `/api/deals/{code}/evidence` | Seller | `held` | Submits the evidence set, runs the verdict and the decision, returns the final state |
| POST | `/api/deals/{code}/review` | Buyer | `in_review` | Approves (capture) or rejects (void) |
| POST | `/api/deals/{code}/cancel` | Buyer or seller | `draft`, `terms_agreed`, `held` | Cancels; voids the hold if one exists |
| POST | `/api/deals/{code}/payout/retry` | Seller | `captured`, latest payout `failed`, or `pending` with no `paypal_batch_id` | Re-sends attempt `n` or creates attempt `n + 1` |
| GET | `/api/deals/{code}/events` | Buyer or seller | any | Returns the audit trail |
| GET | `/api/deals/{code}/evidence-pack` | Buyer or seller | any | Returns the evidence pack as a downloadable JSON file |
| POST | `/api/webhooks/paypal` | PayPal | none | Verifies, stores and processes one PayPal event |
| POST | `/api/jobs/tick` | Render cron with bearer `CRON_SECRET` | none | Voids overdue deals and re-runs stuck verdicts |
| GET | `/api/health` | Anyone | none | Returns `{ "ok": true }` |
| GET | `/api/dashboard/data` | Signed in | none | Returns the `DashboardData` of [09-ag-studio.md](09-ag-studio.md) section 5.2 for the caller's deals |
| POST | `/api/studio/agent` | Signed in | none | Runs one AG Studio agent turn on Claude and answers JSON (could) |

## 3. Shared types

`DealView` is defined once here and returned by every deal endpoint that changes or reads a deal.

```ts
type Status = "draft" | "terms_agreed" | "held" | "proof_submitted" | "in_review" | "captured" | "paid" | "voided";
type Role = "buyer" | "seller";
type Actor = "buyer" | "seller" | "system" | "paypal" | "ai";
type EvidenceType = "photo" | "tracking";
type VerdictResult = "pass" | "fail" | "unclear";
type Decision = "capture" | "request_fix" | "buyer_review" | "void";
type DecisionReason = "all_pass" | "fail" | "unclear" | "low_confidence" | "amount_over_limit";   // 05 section 7; an AI failure is "unclear"
type CarrierStatus = "delivered" | "in_transit" | "unknown";
type PaymentStatus = "created" | "approved" | "authorized" | "capture_pending" | "captured" | "declined" | "voided";
type PayoutStatus = "pending" | "success" | "failed";
type Mime = "image/jpeg" | "image/png" | "image/webp";

type Party = { display_name: string | null; email: string };

type Condition = {
  id: string;
  position: number;            // 1-based display order; the code condition is always last
  text: string;
  evidence_type: EvidenceType;
  system: boolean;             // true for the server-added "Photo shows the deal code {code} written by hand"
};

type FileRef = {
  id: string;
  purpose: "reference" | "evidence";
  mime: Mime;
  size_bytes: number;
  sha256: string;              // lowercase hex, 64 chars
  url: string;                 // signed, relative, valid 10 minutes from the response
  created_at: string;
};

type Verdict = {
  condition_id: string;
  result: VerdictResult;
  confidence: number;          // 0.00 to 1.00
  reason: string;              // one sentence
  evidence_used: string[];     // labels r1..r4, e1..e6, "tracking", "note" (05 section 4.2), the verdicts.evidence_used column (05 section 4.7 post-processed labels; D8 guardrail rows list the matching evidence and reference labels); [] for AI-failure and seeded rows
  model: string;               // e.g. "claude-sonnet-5-5"
  prompt_version: string;      // e.g. "judge-v1"
};

type Submission = {
  submission_no: 1 | 2;
  submitted_at: string;
  files: FileRef[];            // evidence photos, in upload order
  tracking_number: string | null;
  carrier_status: CarrierStatus | null;
  note: string | null;
  verdicts: Verdict[];         // empty until transaction V of 9.1 commits; may be present while status is proof_submitted (PayPal call pending)
  decision: Decision | null;   // null while status is proof_submitted
  decision_reason: DecisionReason | null;   // set by decide() with the decision; null while decision is null
  decided_at: string | null;
};

type Payment = {
  status: PaymentStatus;
  paypal_order_id: string;
  authorization_id: string | null;   // the ORIGINAL authorization id (decisions E3)
  authorized_at: string | null;
  auth_expires_at: string | null;
  capture_id: string | null;
};

type Payout = {
  attempt: number;             // 1 for the first attempt
  status: PayoutStatus;
  amount_minor: number;
  sender_batch_id: string;     // "payout-{code}-{attempt}"
  paypal_batch_id: string | null;   // null until the Payouts call has answered
  paypal_item_id: string | null;    // from the first PAYOUTS-ITEM.* webhook; needed to cancel an UNCLAIMED item (decisions E5)
  failure_reason: string | null;
  created_at: string;
};

type DealView = {
  code: string;
  role: Role;                  // the caller's role
  status: Status;
  item_title: string;
  source_text: string;
  amount_minor: number | null; // null until the buyer fills it in
  currency: "USD";
  deadline_days: number | null;
  deadline_at: string | null;  // null until held
  terms_version: number;
  buyer_accepted_version: number | null;
  seller_accepted_version: number | null;
  fix_attempts_used: 0 | 1;
  buyer: Party;
  seller: (Party & { has_paypal_email: boolean; paypal_email: string | null }) | null;   // paypal_email is filled only when role = "seller"; null for the buyer
  conditions: Condition[];
  reference_files: FileRef[];
  submissions: Submission[];
  payment: Payment | null;     // null until start_payment; always null on seeded deals
  payouts: Payout[];           // ascending by attempt
  seeded: boolean;
  created_at: string;
  updated_at: string;
};

type DealPreview = {           // what a signed-in non-party sees (decisions F4)
  role: "preview";
  code: string;
  item_title: string;
  amount_minor: number | null;
  currency: "USD";
  deadline_days: number | null;
  conditions: Condition[];
  buyer: { display_name: string | null };
};

type DealEvent = {
  id: string;                  // BigInt as decimal string; strictly increasing per deal
  from_status: Status | null;  // null only on "create"
  to_status: Status;
  actor: Actor;
  cause: string;               // see section 16
  payload: Record<string, unknown>;
  created_at: string;
};

type Me = { id: string; email: string; display_name: string | null; paypal_email: string | null; created_at: string };
```

A `FileRef.url` is minted at response time, so two reads of the same deal return different `url` values for the same file. The `sha256` is the stable identity.

`DealView` is the single deal contract: [02-system-design.md](02-system-design.md) section 3.2, [08-ui-spec.md](08-ui-spec.md) section 7.1 and [09-ag-studio.md](09-ag-studio.md) read it from here. The UI uses `payouts.at(-1)` for the latest payout and `submissions.flatMap(s => s.verdicts.map(v => ({ ...v, submission_no: s.submission_no })))` for a flat verdict list.

## 4. Auth

### 4.1 `POST /api/auth/magic-link`

Who: anyone. Preconditions: none.

Request:

```ts
{ email: string; next?: string }   // email: valid address, lowercased; next: must match /^\/(?![\/\\])/ and be at most 200 chars, otherwise "/ledger" is used
```

`next` is validated with `^/(?![/\\])` so `//evil.example` and `/\evil.example`, which browsers resolve as absolute URLs, fall back to `/ledger`.

Response: `200 { "ok": true }`. The same response is returned whether or not the address is known, so addresses cannot be probed.

Errors: `invalid_input`, `internal_error` (Resend rejected the send; in production only).

Side effects: signs a login JWT `{ sub: email, purpose: "login", next }` with `SESSION_SECRET`, expiry 15 minutes, and sends `{APP_URL}/signin/link?token={jwt}&next=` through the `email` dep (Resend from `EMAIL_FROM`). When `NODE_ENV !== "production"` the link is printed to the server console instead and Resend is not called (decisions F2). No deal event.

Resend's test sender delivers only to the account owner's address until a domain is verified (stack.md section 7), so judges use demo personas (4.3).

### 4.2 `/api/auth/callback` (K10)

Who: anyone holding a link. Preconditions: none.

`GET ?token=&next=` answers `302 Location: /signin/link?token=&next=` and spends nothing. Mail scanners that open links therefore cannot use up the token. `/signin/link` shows "Continue signing in", a form that POSTs `token` and `next`.

`POST` (form fields `token`, `next`): a request whose `Origin` is not `APP_URL`'s origin is refused (login CSRF). The token's `jti` is inserted into `used_login_tokens`, and only the first insert counts. The response is `303` to `/signin/2fa?next=` (2FA on) or `/security/setup?next=` (not enrolled), with a partial `hs_session` (`Max-Age=900`). An invalid, expired, wrong-purpose or used token, or a foreign origin, answers `303 Location: /signin?error=invalid_link` with no cookie.

Side effects: upserts `users` by `email` (creates the user on first sign-in with `display_name` null). No deal event.

### 4.3 `POST /api/auth/demo`

Who: anyone, only while `DEMO_LOGIN=true`. Preconditions: none.

Request:

```ts
{ persona: "buyer" | "seller" }
```

Response: `200 { "user": Me }` plus the `hs_session` cookie for `demo-buyer@handshake.demo` or `demo-seller@handshake.demo` (decisions F3). Calling it while already signed in replaces the session; this is the persona switcher.

Errors: `invalid_input` (bad persona, or `DEMO_LOGIN` is not `true`; message `"Demo login is disabled."`).

Side effects: upserts the persona on every sign-in (decisions F3): `display_name` (`"Demo Buyer"` for the buyer, `"Demo Seller"` for the seller, the same values as 03's seed) and, for the seller, `paypal_email = DEMO_SELLER_PAYPAL_EMAIL`. A judge who changed either through `PATCH /api/me` is reset at the next demo sign-in, so one tester cannot redirect every later capture's payout for the rest of judging. No deal event.

### 4.4 `POST /api/auth/sign-out`

Who: anyone. Request: empty body. Response: `200 { "ok": true }` with `hs_session` cleared (`Max-Age=0`). No errors, no side effects.

## 5. Profile

### 5.1 `GET /api/me`

Who: signed in. Response: `200 { "user": Me }`. Errors: `not_signed_in`.

### 5.2 `PATCH /api/me`

Who: signed in.

Request:

```ts
{ display_name?: string; paypal_email?: string }   // display_name 1..60 chars; paypal_email a valid address; at least one field
```

Response: `200 { "user": Me }`. Errors: `not_signed_in`, `invalid_input`.

Side effects: updates `users`. No deal event. This is how a seller fixes `paypal_email` before `POST /api/deals/{code}/payout/retry` (decisions E7).

## 6. Deals

### 6.1 `POST /api/deals`

Who: any signed-in user; the caller becomes the buyer. Preconditions: none.

Request:

```ts
{ text: string }   // 1..500 characters
```

Response: `201` with `DealView & { rejected: { text: string; suggestion: string }[] }`. `rejected` lists the subjective parts the model could not turn into checkable conditions, each with a suggested rewording (decisions D6). It is returned only here; it is also stored in the `create` event payload so the evidence pack can show it.

Errors: `not_signed_in`, `invalid_input`, `condition_not_checkable` (the model read the sentence and found zero checkable conditions; the message lists the suggestions), `unsupported_currency` (currency not `"USD"` or `null`), `ai_unavailable` 503 (Claude timed out after one retry, answered 429/5xx, refused, or returned output that failed the schema; message `"The model did not answer; try again."`; decisions D4, H2).

Side effects:

- Calls the `ai` dep for extraction (model `AI_MODEL`, default `claude-sonnet-5-5`, 15 s timeout, one retry; decisions D1, D4). Input is the sentence and today's date only.
- Generates `public_code` (decisions I4), regenerating on collision.
- Inserts `deals` (`status = draft`, `terms_version = 1`, `buyer_id` = caller, `seller_id` null, `amount_minor` and `deadline_days` as extracted or null, `currency = "USD"`) and `conditions` in the model's order. If any condition has `evidence_type = "photo"`, the server appends the condition `Photo shows the deal code {code} written by hand` as the last position (decisions D6).
- Writes event `create` (actor `buyer`, `from_status` null, `to_status` `draft`, payload `{ source_text, model, prompt_version, rejected }`).
- No PayPal call, no email.

Example (a sentence with one rejected part):

```json
POST /api/deals
{ "text": "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos, and it has to be good quality" }

201
{
  "code": "HS-7K2Q",
  "role": "buyer",
  "status": "draft",
  "item_title": "Hand-painted denim jacket",
  "source_text": "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos, and it has to be good quality",
  "amount_minor": 8000,
  "currency": "USD",
  "deadline_days": 7,
  "deadline_at": null,
  "terms_version": 1,
  "buyer_accepted_version": null,
  "seller_accepted_version": null,
  "fix_attempts_used": 0,
  "buyer": { "display_name": "Demo Buyer", "email": "demo-buyer@handshake.demo" },
  "seller": null,
  "conditions": [
    { "id": "c1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0a71", "position": 1, "text": "Item matches the reference photos", "evidence_type": "photo", "system": false },
    { "id": "c2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b82", "position": 2, "text": "Tracking shows delivered", "evidence_type": "tracking", "system": false },
    { "id": "c3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c93", "position": 3, "text": "Photo shows the deal code HS-7K2Q written by hand", "evidence_type": "photo", "system": true }
  ],
  "reference_files": [],
  "submissions": [],
  "payment": null,
  "payouts": [],
  "seeded": false,
  "created_at": "2026-10-20T14:03:11Z",
  "updated_at": "2026-10-20T14:03:11Z",
  "rejected": [
    { "text": "it has to be good quality", "suggestion": "Photo shows no tears, stains or missing buttons" }
  ]
}
```

### 6.2 `GET /api/deals`

Who: signed in. Preconditions: none.

Response: `200 LedgerRow[]` (a bare array), every deal where the caller is buyer or seller, sorted by `last_event_at` descending, no pagination. `listDeals(actor, deps)` returns the same array; the shape is [09-ag-studio.md](09-ag-studio.md) section 4.1 plus `seeded` and `updated_at`, and `amount_minor` is nullable because a `draft` deal may have none.

```ts
type LedgerRow = {
  code: string;                       // deals.public_code, e.g. "HS-7K2Q"
  item_title: string;
  role: Role;                         // the signed-in user's side
  counterparty: string | null;        // other party's display_name, else their email, null while seller_id is null
  amount_minor: number | null;        // integer minor units; null until the buyer fills it in
  currency: "USD";
  status: Status;
  deadline_at: string | null;         // null until held
  last_event_cause: string | null;    // deal_events.cause of the newest event
  last_event_at: string | null;       // deal_events.created_at of the newest event
  lowest_confidence: number | null;   // min(verdicts.confidence) over the highest submission_no; null if no verdicts
  seeded: boolean;                    // the ledger's "Sample" badge
  updated_at: string;
};
```

Errors: `not_signed_in`. Side effects: none.

### 6.3 `GET /api/deals/{code}`

Who: buyer or seller for the full view; any signed-in user for a preview of a joinable deal. Preconditions: none for a party.

Response for a party: `200 DealView`.

Response for a signed-in non-party when the deal is `draft` with `seller_id` null: `200 DealPreview` (decisions F4). The preview has no `source_text`, no files, no payment and no seller. The client tells the two apart by `role` (`"preview"`).

Errors: `not_signed_in`, `deal_not_found`, `not_a_party` (non-party and the deal is not previewable).

Side effects: none. Each call mints fresh signed URLs for every `FileRef`.

Example, as the buyer while the money is held:

```json
GET /api/deals/HS-7K2Q

200
{
  "code": "HS-7K2Q",
  "role": "buyer",
  "status": "held",
  "item_title": "Hand-painted denim jacket",
  "source_text": "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos, and it has to be good quality",
  "amount_minor": 8000,
  "currency": "USD",
  "deadline_days": 7,
  "deadline_at": "2026-10-27T15:16:09Z",
  "terms_version": 1,
  "buyer_accepted_version": 1,
  "seller_accepted_version": 1,
  "fix_attempts_used": 0,
  "buyer": { "display_name": "Demo Buyer", "email": "demo-buyer@handshake.demo" },
  "seller": { "display_name": "Demo Seller", "email": "demo-seller@handshake.demo", "has_paypal_email": true, "paypal_email": null },
  "conditions": [
    { "id": "c1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0a71", "position": 1, "text": "Item matches the reference photos", "evidence_type": "photo", "system": false },
    { "id": "c2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b82", "position": 2, "text": "Tracking shows delivered", "evidence_type": "tracking", "system": false },
    { "id": "c3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c93", "position": 3, "text": "Photo shows the deal code HS-7K2Q written by hand", "evidence_type": "photo", "system": true }
  ],
  "reference_files": [
    { "id": "f1d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a01", "purpose": "reference", "mime": "image/jpeg", "size_bytes": 412885, "sha256": "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce", "url": "/api/files/f1d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a01?exp=1792577400&sig=q3Zt8m2VhXk9Jc0bR1PpW4sYd7LfUeN2oGaH6iKxT5A", "created_at": "2026-10-20T14:05:02Z" },
    { "id": "f2e1b0c9-2d3e-4f40-9b5c-6d7e8f9a0b12", "purpose": "reference", "mime": "image/jpeg", "size_bytes": 398120, "sha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d", "url": "/api/files/f2e1b0c9-2d3e-4f40-9b5c-6d7e8f9a0b12?exp=1792577400&sig=Hx1vN8kQ2rT6yUeW3zAbC9dFgJ4mLpS7oVbX0nYiK5E", "created_at": "2026-10-20T14:05:09Z" }
  ],
  "submissions": [],
  "payment": {
    "status": "authorized",
    "paypal_order_id": "5O190127TN364715T",
    "authorization_id": "0VF52814937998046",
    "authorized_at": "2026-10-20T15:16:09Z",
    "auth_expires_at": "2026-11-18T15:16:09Z",
    "capture_id": null
  },
  "payouts": [],
  "seeded": false,
  "created_at": "2026-10-20T14:03:11Z",
  "updated_at": "2026-10-20T15:16:09Z"
}
```

### 6.4 `PATCH /api/deals/{code}/terms`

Who: buyer. Preconditions: status `draft`, or `terms_agreed` with no `payments` row (02 section 5.1). Module call: `handle(code, actor, { type: "edit_terms", ... })`.

Request (every field optional, at least one present; `conditions` is a full replacement):

```ts
{
  item_title?: string;                 // 1..80
  amount_minor?: number;               // integer 1..1000000
  deadline_days?: number;              // integer 1..21
  conditions?: { text: string; evidence_type: EvidenceType }[];   // 1..4 items, text 1..200
}
```

Response: `200 DealView` with `status = "draft"`, `terms_version + 1`, both accepted versions null.

Errors: `not_signed_in`, `invalid_input`, `deal_not_found`, `not_a_party` (non-party, or the seller), `invalid_state` (status is not `draft` or `terms_agreed`; or `terms_agreed` with a `payments` row: `"Payment has started; cancel the deal to change the terms."`). Once `start_payment` has run, cancel is the only way out: a PayPal order carries the amount it was created with, and `order-{code}-{n}` would hand the old order back (paypal.md section 4).

Side effects (decisions C2 rows 1 and 5):

- Updates the deal fields given. When `conditions` is given, all `conditions` rows are replaced with new ids; any submitted condition whose text equals the server's code condition is dropped, and the server re-appends its own code condition if any photo condition remains.
- Sets `terms_version = terms_version + 1`, `buyer_accepted_version = null`, `seller_accepted_version = null`, `status = draft`.
- Writes event `edit_terms` (actor `buyer`, payload `{ terms_version, changed: string[] }` listing the field names changed).
- No PayPal call, no email. No PayPal order can exist at this point (the precondition above).

### 6.5 `POST /api/deals/{code}/join`

Who: a signed-in user who is not the buyer. Preconditions: status `draft`, `seller_id` null. Module call: `join`.

Request: empty body. Response: `200 DealView` with `role = "seller"`.

Errors: `not_signed_in`, `deal_not_found`, `not_a_party` (the caller is the buyer: `"You are the buyer of this deal."`; or a non-party when the deal already has a seller or is not `draft`, 02 section 9.2). A caller who is already the seller gets `200 DealView` with no change.

Side effects: sets `seller_id`; writes event `join` (actor `seller`, `draft` to `draft`, payload `{ seller_id }`). No PayPal call, no email.

### 6.6 `POST /api/deals/{code}/accept`

Who: buyer or seller. Preconditions: status `draft`. Module call: `accept`.

Request:

```ts
{ terms_version: number }   // must equal the deal's current terms_version
```

Response: `200 DealView`. `status` is `draft` while only one side has accepted, `terms_agreed` once `buyer_accepted_version` and `seller_accepted_version` both equal `terms_version` (decisions C2 rows 3 and 4).

Errors: `not_signed_in`, `invalid_input` (shape; or `amount_minor` or `deadline_days` is null: `"Set the amount and the deadline before accepting."`), `deal_not_found`, `not_a_party`, `invalid_state` (status is not `draft`), `terms_version_mismatch`, `paypal_email_required` (the seller accepts without a `paypal_email`; also raised to whichever party's acceptance would complete the agreement while the seller has no `paypal_email`).

The buyer may accept before any seller exists: `/new` ends with the buyer's accept, the deal stays `draft` with `buyer_accepted_version` set, and the agreement completes when the seller joins and accepts the same version (decisions C2 rows 3 and 4).

Side effects: sets the caller's accepted version; when both match, sets `status = terms_agreed`. Writes event `accept` (actor `buyer` or `seller`, payload `{ terms_version }`, `to_status` `draft` or `terms_agreed`). Accepting the same version twice is a no-op that still answers `200`. No PayPal call, no email.

## 7. Payment

The browser uses `@paypal/react-paypal-js` 10.x with the legacy `PayPalScriptProvider` (`intent: "authorize"`, `currency: "USD"`, `clientId: NEXT_PUBLIC_PAYPAL_CLIENT_ID`) and `PayPalButtons`. `createOrder` calls 7.1 and returns `order_id`; `onApprove` calls 7.2 with `data.orderID` (decisions E9, paypal.md section 8).

### 7.1 `POST /api/deals/{code}/payment`

Who: buyer. Preconditions: status `terms_agreed`. Module call: `start_payment`.

Request: empty body.

Response:

```json
200 { "order_id": "5O190127TN364715T" }
```

Errors: `not_signed_in`, `deal_not_found`, `not_a_party`, `invalid_state`, `terms_not_accepted` (defensive: both accepted versions must equal `terms_version`), `paypal_error`.

Side effects (decisions C2 row 6, E1, E2, E4; 02 section 8.1):

- Reuse: when `payments.paypal_order_id` is set, `payments.status = created` and the row's `updated_at` is under 6 hours old, the stored id is returned with no PayPal call.
- Otherwise, no transaction before the call: `payments.paypal_order_id` is `NOT NULL UNIQUE` (03), so no placeholder row can be written; the key and the amount come from committed rows (02 section 8.2). Call `OrdersController.createOrder` with `paypalRequestId = "order-{code}-{order_attempts + 1}"` (`n = payments.order_attempts`, 0 when no row exists; `order-HS-XXXX-1` is 15 characters), `Prefer: return=representation`, body `{ intent: "AUTHORIZE", purchase_units: [{ custom_id: "{code}", description: item_title (truncated to 127), amount: { currency_code: "USD", value } }], payment_source: { paypal: { experience_context: { brand_name: "Handshake", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" } } } }` (paypal.md section 2). Then one transaction: lock the deal, re-check `status = terms_agreed`, upsert `payments` (`paypal_order_id` = the id returned, `status = created`, `order_attempts = n + 1`), write the `start_payment` event, commit. A superseded order is never re-returned because every order has its own key. If the process dies between the call and the transaction, the next click creates order `n + 1` with a new key; the dead call's order is never approved.
- PayPal retains an Orders key for 6 h (SDK docstring; UNVERIFIED, paypal.md "4. Idempotency" and "Open risks" 10), while an order stays approvable for up to 6 h to redirect plus 6 h to approve (paypal.md "2. Orders", `order.links`). An authorization that arrives for a superseded order is voided by the late-authorization rule in 11.4.
- Writes event `start_payment` (actor `buyer`, `terms_agreed` to `terms_agreed`, payload `{ paypal_order_id, order_attempt }`) on every call, reuse included (decisions C6).
- No email.

### 7.2 `POST /api/deals/{code}/payment/authorize`

Who: buyer. Preconditions: status `terms_agreed`, `payments.status` in `created` or `approved`. Module call: `confirm_approval`.

Request:

```ts
{ order_id: string }   // must equal payments.paypal_order_id
```

Response: `200 DealView` with `status = "held"`, `payment.status = "authorized"`, `deadline_at` set.

If the `PAYMENT.AUTHORIZATION.CREATED` webhook (or `CHECKOUT.ORDER.APPROVED`, decisions E8) already moved the deal to `held`, the response is the same `200 DealView` and nothing is written (decisions C3).

Errors: `not_signed_in`, `invalid_input` (`order_id` does not match), `deal_not_found`, `not_a_party`, `terms_not_accepted` (status `draft`: both accepted versions do not equal `terms_version`; 02 section 3.3), `invalid_state` (any other status than `terms_agreed`; in `held` this wins over the `order_id` check, so only the stored order id takes the no-op path above), `paypal_error` (PayPal error, or the authorization came back in any status other than `CREATED`; the message carries that status and the debug id).

Side effects (decisions C2 row 7, E3; 02 section 8.2):

- Transaction before the call: lock the deal, re-check the preconditions, set `payments.status = approved`, commit. This is what lets the `CHECKOUT.ORDER.APPROVED` webhook (E8) finish the authorization if this call fails or the process dies.
- Calls `OrdersController.authorizeOrder({ id: order_id, paypalRequestId: "auth-{code}", prefer: "return=representation" })`. Reads `purchase_units[0].payments.authorizations[0].{id, status, expiration_time}` (paypal.md section 2).
- Transaction after the call, when the deal is still `terms_agreed` and `payments.paypal_order_id = order_id`: applies fact `authorization_created`: `payments.authorization_id` = that id (stored permanently; the only id ever captured or voided), `payments.status = authorized`, `authorized_at = now`, `auth_expires_at = expiration_time`; `deals.deadline_at = authorized_at + deadline_days` days; `status = held`. Writes event `fact:authorization_created` (actor `paypal`, `terms_agreed` to `held`, payload `{ authorization_id, auth_expires_at, source: "api", paypal_request_id: "auth-{code}" }`). No email (02 section 5.6).
- Transaction after the call, when the deal is no longer `terms_agreed` or the order was superseded (a cancel or a second `start_payment` won the race): the late-authorization branches of 11.4 run instead, with `source: "api"`; the response is the current `DealView`.

## 8. Files

### 8.1 `POST /api/deals/{code}/files`

Who: buyer for `purpose = reference`; seller for `purpose = evidence`. Preconditions: `reference` needs status `draft` and `seller_accepted_version` null; `evidence` needs status `held`. Module call: `addFile`.

Request: `multipart/form-data` with exactly two fields:

| Field | Type | Rule |
| --- | --- | --- |
| `purpose` | text | `reference` or `evidence` |
| `file` | file | one file, JPEG, PNG or WebP by magic bytes, at most 2 MB |

The browser downscales to 1600 px on the long edge, JPEG quality 0.85, before upload (decisions B6, stack.md section 9). The server reads `await request.formData()`, rejects `Content-Length` over 2.5 MB with `413` before reading the body, and rejects a `file` over 2 MB after reading it.

Response: `201 FileRef`.

Errors: `not_signed_in`, `invalid_input` (missing field, bad purpose, unsupported image type), `file_too_large`, `deal_not_found`, `not_a_party` (wrong role for the purpose), `invalid_state` (wrong status; a reference upload after the seller accepted: `"Edit the terms before adding photos."`), `too_many_files` (5th reference photo; 7th unsubmitted evidence file).

Side effects: inserts `files` (`deal_id`, `uploaded_by`, `purpose`, `mime` as sniffed, `size_bytes`, `sha256` of the bytes, `bytes`). No deal event, no PayPal call, no email. There is no delete endpoint; the per-deal caps bound storage.

### 8.2 `GET /api/files/{id}?exp=&sig=`

Who: anyone holding a valid signed link. No session. Preconditions: none.

Signed URL format, minted by the server whenever it returns a `FileRef`:

```
/api/files/{id}?exp={unix seconds, now + 600}&sig={base64url( HMAC-SHA256( key = FILE_URL_SECRET, message = "{id}.{exp}" ) )}
```

Verification: `exp` must be all digits and not in the past; `sig` must match with `crypto.timingSafeEqual` after a length check (stack.md section 8, using `FILE_URL_SECRET` from decisions J3).

Response: `200` with the stored bytes, headers `Content-Type: {mime}`, `Content-Length`, `Cache-Control: private, max-age=600`, `Content-Disposition: inline`.

Errors: `invalid_input` (missing or malformed `exp`/`sig`), `not_a_party` (expired or wrong signature; message `"This link has expired."`), `deal_not_found` (unknown file id, including an id that is not a UUID; message `"File not found."`). The signature is checked before the lookup, so an unknown id with a bad signature is `not_a_party`.

Side effects: none.

## 9. Evidence, review, cancel, payout retry

### 9.1 `POST /api/deals/{code}/evidence`

Who: seller. Preconditions: status `held`. Module call: `submit_evidence`.

Request:

```ts
{
  file_ids: string[];          // 0..6 ids of this deal's evidence files not yet used by a submission
  tracking_number?: string;    // 1..64; required when any condition has evidence_type "tracking"
  note?: string;               // 1..1000
}
```

`file_ids` must be non-empty when any condition has `evidence_type = "photo"`. Each submission is complete on its own: a fix submission re-sends the tracking number and every photo the seller wants judged (the UI prefills the tracking number from submission 1).

Response: `200 DealView` after the verdict and the decision have run (decisions B5). `status` is one of `captured`, `held` (fix requested, `fix_attempts_used = 1`), `in_review` or `voided`, and `submissions[last].decision` says which.

Errors: `not_signed_in`, `invalid_input` (shape; missing tracking number or photos the conditions require; a file id that is not an unsubmitted evidence file of this deal), `deal_not_found`, `not_a_party`, `invalid_state` (status is not `held`, including a second submit while the first is still running), `too_many_files` (more than 6 ids), `paypal_error` (the decision's capture or void call failed; the verdict rows are already stored and the deal stays `proof_submitted`; see step 8).

Side effects, in order (02 sections 5.8 and 8.2: write intent, call PayPal, write result):

1. Transaction A: inserts `evidence` rows (`submission_no` = 1, or 2 when `fix_attempts_used = 1`; one `photo` row per file with `file_id`; one `tracking` row with `value`; one `note` row with `value`), sets `status = proof_submitted`, writes event `submit_evidence` (actor `seller`, `held` to `proof_submitted`, payload `{ submission_no, file_ids, tracking_number, carrier_status }`). Commits.
2. Carrier lookup, pure function (decisions D7): last character even digit `delivered`, odd digit `in_transit`, anything else `unknown`.
3. Guardrail (decisions D8): an evidence photo whose `sha256` equals any reference photo's `sha256` fails every photo condition (confidence 1) without a model call; tracking conditions become `unclear`.
4. Verdict through the `ai` dep (decisions D1 to D5): one call, 17 s timeout, no retry, inside `AbortSignal.timeout(19_000)` (claude-api.md section 8); reference photos and evidence photos as base64 blocks; the carrier status as text; `output_config` with a hand-written JSON schema; `effort: "low"`. Any timeout, refusal, schema mismatch or missing verdict yields `unclear` (confidence 0, reason from 05 section 5) for the affected conditions.
5. Transaction V: inserts `verdicts` (one row per condition with `model`, `prompt_version`, `raw_response`; decisions D10); writes event `verdict` (actor `ai`, `proof_submitted` to `proof_submitted`, payload `{ submission_no, model, prompt_version, verdicts: [{ condition_id, result, confidence }] }`). Commits. The deal stays `proof_submitted`. From here on the model is never called again for this submission: a rerun reads these rows.
6. `decide(verdicts, deal)` (decisions D9) with `PASS_THRESHOLD` (0.85 passes) and `AUTO_CAPTURE_MAX_MINOR` (20000). It receives only `{ condition_id, result, confidence }` per verdict row (05 section 7) and returns `{ decision, reason }` with `reason: DecisionReason`: `fail` (any verdict is `fail`), `unclear` (any verdict is `unclear`, which is also what an AI failure, timeout, refusal or schema mismatch yields), `low_confidence` (a confidence under `PASS_THRESHOLD`), `amount_over_limit`, `all_pass`, checked in that order.
7. PayPal call for the decision:
   - `capture`: `PaymentsController.captureAuthorizedPayment({ authorizationId: payment.authorization_id, paypalRequestId: "capture-{code}-{n}", prefer: "return=representation", body: { finalCapture: true, amount: { currencyCode: "USD", value } } })`, SDK `timeout: 10_000`, where `n = payments.capture_attempts` (the number of `fact:capture_declined` events recorded for the deal, 0 the first time; decisions E4). A retry after a timeout, 5xx or crash reuses the same key, so PayPal returns the first capture instead of making a second one (paypal.md section 4).
   - `void`: `PaymentsController.voidPayment({ authorizationId, paypalRequestId: "void-{code}" })`; `PREVIOUSLY_VOIDED` counts as success (paypal.md section 3). A void refused because the authorization is already captured re-sends `capture-{code}-{n}` with the same key to recover the capture and applies the capture fact instead (decisions C4).
   - `request_fix`, `buyer_review`: no call.
8. If the call fails (timeout, 5xx, or a 4xx other than those named above), the request answers `502 paypal_error`; the verdict rows and the `verdict` event stay; the deal stays `proof_submitted`. `POST /api/jobs/tick` (section 12) runs `decide()` on the stored rows and re-sends the same key; it never re-judges.
9. Transaction B: lock the deal, re-check `status = proof_submitted`, then:
   - `capture`, response status `COMPLETED` or `PENDING`: `status = captured`; event `decision:capture` (actor `system`, payload `{ submission_no, reason: "all_pass", capture_id, capture_status, paypal_request_id }`). Then fact `capture_completed` or `capture_pending` with `source: "api"` (section 11.4). On `COMPLETED` the `payouts` row is inserted in the same transaction, before any Payouts call: `attempt = 1`, `status = pending`, `sender_batch_id = "payout-{code}-1"`, `recipient_email = seller.paypal_email`, `amount_minor`, `paypal_batch_id` null. Commits.
   - `capture`, response status `DECLINED` or `FAILED` (paypal.md section 3; `FAILED` is treated as `DECLINED`): `status = captured`; event `decision:capture` as above with `capture_status: "DECLINED"`; then fact `capture_declined` with `source: "api"`: `payments.status = declined`, `capture_id` stored, `capture_attempts + 1`, `captured` to `in_review`; email both parties (`"PayPal declined the capture"`). No payout. The buyer's next approve (9.2) uses `capture-{code}-{n+1}`.
   - `request_fix`: `status = held`, `fix_attempts_used = 1`; event `decision:request_fix` (actor `system`, payload `{ submission_no, reason: "fail" }`). No email.
   - `buyer_review`: `status = in_review`; event `decision:buyer_review` (actor `system`, payload `{ submission_no, reason }` with `reason` one of `unclear`, `low_confidence`, `amount_over_limit`, or `fail` on attempt 2 with low confidence); email to the buyer (`"Your decision is needed on {code}"`, 02 section 5.6).
   - `void`: `status = voided`; event `decision:void` (actor `system`, payload `{ submission_no, reason: "fail", authorization_id }`); then fact `authorization_voided` with `source: "api"` so the later `PAYMENT.AUTHORIZATION.VOIDED` webhook is a no-op. No email.
   - `Submission.decision` and `decision_reason` in the `DealView` are read from the newest `decision:*` event of that submission.
10. Transaction P, after `COMPLETED` only: raw `POST /v1/payments/payouts` with `PayPal-Request-Id` and `sender_batch_id` both `"payout-{code}-1"`, `items[0] = { recipient_type: "EMAIL", receiver: seller.paypal_email, amount: { value, currency: "USD" }, sender_item_id: "payout-{code}-1", note: "Handshake deal {code}" }`, `AbortSignal.timeout(10_000)` (paypal.md section 5). On `201`, `payouts.paypal_batch_id` = `batch_header.payout_batch_id`. On a timeout or 5xx the row stays `pending` with `paypal_batch_id` null and the request still answers `200`: PayPal may have accepted the batch, and "you can safely retry the request with the same `sender_batch_id`" (paypal.md section 5), which `retry_payout` does (9.4). Only a 4xx with a PayPal error `name` sets `status = failed` and `failure_reason` = that name. The deal stays `captured` either way; `paid` comes from the webhook.
11. Budget: model 17 s inside a 19 s signal, capture up to 10 s, payout up to 10 s; about 40 s worst case, typically 6 to 12 s (decisions B5). Render's proxy answered a 40 s route with 200 when measured (02 section 12, spike 4).

Example, first submission, capture decision:

```json
POST /api/deals/HS-7K2Q/evidence
{
  "file_ids": ["e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a55", "e2b3c4d5-e6f7-4a81-9b0c-1d2e3f4a5b66"],
  "tracking_number": "TRK-DEMO-0000",
  "note": "Shipped Monday, delivered Wednesday"
}

200
{
  "code": "HS-7K2Q",
  "role": "seller",
  "status": "captured",
  "item_title": "Hand-painted denim jacket",
  "source_text": "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos, and it has to be good quality",
  "amount_minor": 8000,
  "currency": "USD",
  "deadline_days": 7,
  "deadline_at": "2026-10-27T15:16:09Z",
  "terms_version": 1,
  "buyer_accepted_version": 1,
  "seller_accepted_version": 1,
  "fix_attempts_used": 0,
  "buyer": { "display_name": "Demo Buyer", "email": "demo-buyer@handshake.demo" },
  "seller": { "display_name": "Demo Seller", "email": "demo-seller@handshake.demo", "has_paypal_email": true, "paypal_email": "sb-seller@personal.example.com" },
  "conditions": [
    { "id": "c1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0a71", "position": 1, "text": "Item matches the reference photos", "evidence_type": "photo", "system": false },
    { "id": "c2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b82", "position": 2, "text": "Tracking shows delivered", "evidence_type": "tracking", "system": false },
    { "id": "c3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c93", "position": 3, "text": "Photo shows the deal code HS-7K2Q written by hand", "evidence_type": "photo", "system": true }
  ],
  "reference_files": [
    { "id": "f1d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a01", "purpose": "reference", "mime": "image/jpeg", "size_bytes": 412885, "sha256": "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce", "url": "/api/files/f1d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a01?exp=1792749091&sig=Zp4uV2cL9xM1nQ7rS3tB8wE6yH0jK5aD2fG9hI4kL7M", "created_at": "2026-10-20T14:05:02Z" },
    { "id": "f2e1b0c9-2d3e-4f40-9b5c-6d7e8f9a0b12", "purpose": "reference", "mime": "image/jpeg", "size_bytes": 398120, "sha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d", "url": "/api/files/f2e1b0c9-2d3e-4f40-9b5c-6d7e8f9a0b12?exp=1792749091&sig=Ab8cD1eF4gH7iJ0kL3mN6oP9qR2sT5uV8wX1yZ4aB7C", "created_at": "2026-10-20T14:05:09Z" }
  ],
  "submissions": [
    {
      "submission_no": 1,
      "submitted_at": "2026-10-23T09:41:20Z",
      "files": [
        { "id": "e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a55", "purpose": "evidence", "mime": "image/jpeg", "size_bytes": 455210, "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae", "url": "/api/files/e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a55?exp=1792749091&sig=Nq6rS9tU2vW5xY8zA1bC4dE7fG0hI3jK6lM9nO2pQ5R", "created_at": "2026-10-23T09:40:02Z" },
        { "id": "e2b3c4d5-e6f7-4a81-9b0c-1d2e3f4a5b66", "purpose": "evidence", "mime": "image/jpeg", "size_bytes": 431077, "sha256": "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9", "url": "/api/files/e2b3c4d5-e6f7-4a81-9b0c-1d2e3f4a5b66?exp=1792749091&sig=Ty3uV6wX9yZ2aB5cD8eF1gH4iJ7kL0mN3oP6qR9sT2U", "created_at": "2026-10-23T09:40:15Z" }
      ],
      "tracking_number": "TRK-DEMO-0000",
      "carrier_status": "delivered",
      "note": "Shipped Monday, delivered Wednesday",
      "verdicts": [
        { "condition_id": "c1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0a71", "result": "pass", "confidence": 0.93, "reason": "The painted pattern, collar and buttons match both reference photos.", "evidence_used": ["r1", "r2", "e1", "e2"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1" },
        { "condition_id": "c2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b82", "result": "pass", "confidence": 0.99, "reason": "Carrier status is delivered.", "evidence_used": ["tracking"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1" },
        { "condition_id": "c3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c93", "result": "pass", "confidence": 0.97, "reason": "A handwritten note reading HS-7K2Q lies on the jacket in the second photo.", "evidence_used": ["e2"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1" }
      ],
      "decision": "capture",
      "decision_reason": "all_pass",
      "decided_at": "2026-10-23T09:41:31Z"
    }
  ],
  "payment": {
    "status": "captured",
    "paypal_order_id": "5O190127TN364715T",
    "authorization_id": "0VF52814937998046",
    "authorized_at": "2026-10-20T15:16:09Z",
    "auth_expires_at": "2026-11-18T15:16:09Z",
    "capture_id": "3C679366HH908993F"
  },
  "payouts": [
    { "attempt": 1, "status": "pending", "amount_minor": 8000, "sender_batch_id": "payout-HS-7K2Q-1", "paypal_batch_id": "DN2EZ9K7N2WUJ", "paypal_item_id": null, "failure_reason": null, "created_at": "2026-10-23T09:41:32Z" }
  ],
  "seeded": false,
  "created_at": "2026-10-20T14:03:11Z",
  "updated_at": "2026-10-23T09:41:32Z"
}
```

The deal becomes `paid` only when `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` arrives (section 11.4).

### 9.2 `POST /api/deals/{code}/review`

Who: buyer. Preconditions: status `in_review`. Module call: `review`.

Request:

```ts
{ decision: "approve" | "reject"; note?: string }   // note 1..1000, stored in the event payload
```

Response: `200 DealView` with `status = "captured"` (approve) or `"voided"` (reject).

Errors: `not_signed_in`, `invalid_input`, `deal_not_found`, `not_a_party` (the seller), `invalid_state`, `paypal_error` (the capture or void failed; the deal stays `in_review` and the buyer can try again).

Side effects (decisions C2 rows 13 and 14):

- `approve`: capture call exactly as in 9.1 step 7 (key `capture-{code}-{n}` with `n = payments.capture_attempts`; after one `capture_declined`, `n` is 1). Then, in one transaction, `status = captured`, event `review:approve` (actor `buyer`, `in_review` to `captured`, payload `{ note, capture_id, capture_status }`), then the `capture_completed` or `capture_pending` fact and, on `COMPLETED`, the `payouts` row as in 9.1 step 9; the Payouts call follows as in step 10. A `DECLINED` or `FAILED` capture response is handled as in 9.1 step 9: event `review:approve` with `capture_status: "DECLINED"`, then fact `capture_declined` with `source: "api"` (`payments.status = declined`, `capture_id` stored, `capture_attempts + 1`, back to `in_review`), email both parties; the next approve uses `capture-{code}-{n+1}`.
- `reject`: void call; `status = voided`; event `review:reject` (actor `buyer`, payload `{ note, authorization_id }`); then fact `authorization_voided` with `source: "api"`. No email.

Example, a deal above the auto-capture ceiling:

```json
POST /api/deals/HS-M4P9/review
{ "decision": "approve", "note": "Photos match, releasing." }

200
{
  "code": "HS-M4P9",
  "role": "buyer",
  "status": "captured",
  "item_title": "Fujifilm X100V camera",
  "source_text": "I'll pay $250 for the Fujifilm X100V once it arrives and matches the listing photos",
  "amount_minor": 25000,
  "currency": "USD",
  "deadline_days": 10,
  "deadline_at": "2026-10-31T11:02:40Z",
  "terms_version": 2,
  "buyer_accepted_version": 2,
  "seller_accepted_version": 2,
  "fix_attempts_used": 0,
  "buyer": { "display_name": "Demo Buyer", "email": "demo-buyer@handshake.demo" },
  "seller": { "display_name": "Demo Seller", "email": "demo-seller@handshake.demo", "has_paypal_email": true, "paypal_email": null },
  "conditions": [
    { "id": "d1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0b01", "position": 1, "text": "Item matches the reference photos", "evidence_type": "photo", "system": false },
    { "id": "d2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b02", "position": 2, "text": "Tracking shows delivered", "evidence_type": "tracking", "system": false },
    { "id": "d3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c03", "position": 3, "text": "Photo shows the deal code HS-M4P9 written by hand", "evidence_type": "photo", "system": true }
  ],
  "reference_files": [
    { "id": "f9d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a09", "purpose": "reference", "mime": "image/jpeg", "size_bytes": 388402, "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b", "url": "/api/files/f9d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a09?exp=1792866720&sig=Kd2eF5gH8iJ1kL4mN7oP0qR3sT6uV9wX2yZ5aB8cD1E", "created_at": "2026-10-21T10:58:12Z" }
  ],
  "submissions": [
    {
      "submission_no": 1,
      "submitted_at": "2026-10-24T17:55:03Z",
      "files": [
        { "id": "e9a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a99", "purpose": "evidence", "mime": "image/jpeg", "size_bytes": 467119, "sha256": "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35", "url": "/api/files/e9a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a99?exp=1792866720&sig=Rs5tU8vW1xY4zA7bC0dE3fG6hI9jK2lM5nO8pQ1rS4T", "created_at": "2026-10-24T17:53:40Z" }
      ],
      "tracking_number": "TRK-DEMO-0002",
      "carrier_status": "delivered",
      "note": null,
      "verdicts": [
        { "condition_id": "d1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0b01", "result": "pass", "confidence": 0.91, "reason": "Same silver body, lens cap and strap lugs as the reference photo.", "evidence_used": ["r1", "e1"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1" },
        { "condition_id": "d2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b02", "result": "pass", "confidence": 0.99, "reason": "Carrier status is delivered.", "evidence_used": ["tracking"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1" },
        { "condition_id": "d3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c03", "result": "pass", "confidence": 0.95, "reason": "A handwritten HS-M4P9 card leans against the camera.", "evidence_used": ["e1"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1" }
      ],
      "decision": "buyer_review",
      "decision_reason": "amount_over_limit",
      "decided_at": "2026-10-24T17:55:14Z"
    }
  ],
  "payment": {
    "status": "captured",
    "paypal_order_id": "8XK41923MD701128L",
    "authorization_id": "7GJ03572RL442191C",
    "authorized_at": "2026-10-21T11:02:40Z",
    "auth_expires_at": "2026-11-19T11:02:40Z",
    "capture_id": "9AB12345CD678901E"
  },
  "payouts": [
    { "attempt": 1, "status": "pending", "amount_minor": 25000, "sender_batch_id": "payout-HS-M4P9-1", "paypal_batch_id": "QX7RT2M9K4LPA", "paypal_item_id": null, "failure_reason": null, "created_at": "2026-10-24T18:02:01Z" }
  ],
  "seeded": false,
  "created_at": "2026-10-21T10:55:30Z",
  "updated_at": "2026-10-24T18:02:01Z"
}
```

### 9.3 `POST /api/deals/{code}/cancel`

Who: buyer or seller. Preconditions: status `draft`, `terms_agreed` or `held`. Module call: `cancel`.

Request: empty body. Response: `200 DealView` with `status = "voided"`.

Errors: `not_signed_in`, `deal_not_found`, `not_a_party`, `invalid_state`, `paypal_error` (the void failed; the deal is unchanged).

Side effects (decisions C2 row 17): when `payments.authorization_id` is set, void call with key `void-{code}` (`PREVIOUSLY_VOIDED` is success), then `status = voided`, `payments.status = voided`, event `cancel` (actor `buyer` or `seller`, payload `{ authorization_id, voided: true }`), then fact `authorization_voided` with `source: "api"`. Without an authorization: no PayPal call, `status = voided`, event `cancel` with `{ authorization_id: null, voided: false }`. An unapproved order stays approvable for up to 12 hours (7.1); if the buyer approves it in a still-open popup, `PAYMENT.AUTHORIZATION.CREATED` (or a late 7.2 response) hits the late-authorization branches of 11.4, which void it at once (`void-{code}` when the cancelled deal stored no authorization, `void-{authorization_id}` when it already stores a different one) and write `fact:late_authorization_voided`, so no hold outlives a cancelled deal. No email.

### 9.4 `POST /api/deals/{code}/payout/retry`

Who: seller. Preconditions: status `captured`, `payments.status = captured`, and the latest `payouts` row is either `failed`, or `pending` with `paypal_batch_id` null (the Payouts call never got an answer: timeout, 5xx, or the process died after transaction B). Module call: `retry_payout`.

Request: empty body. Response: `200 DealView`; the latest `payouts` entry is attempt `n` with `paypal_batch_id` filled (re-send) or a new attempt `n + 1` with `status = pending`.

Errors: `not_signed_in`, `deal_not_found`, `not_a_party` (the buyer), `invalid_state` (latest payout `pending` with a `paypal_batch_id`, meaning PayPal has the batch and a webhook will come; latest payout `success`; or capture still `capture_pending`), `paypal_email_required` (the seller has no `paypal_email`), `paypal_error` (the OAuth token could not be obtained, or the cancel of an `UNCLAIMED` item failed; the row is unchanged).

Side effects (decisions E7; 02 section 6.9 case C), two cases:

- Latest row `pending`, `paypal_batch_id` null: re-send attempt `n` with the same `PayPal-Request-Id` and `sender_batch_id` `"payout-{code}-{n}"` and the same body as 9.1 step 10. PayPal deduplicates the batch id for 30 days (paypal.md section 5), so a batch it already accepted is not paid twice; a duplicate rejection carries the original batch in its HATEOAS link and is treated as the original. On an answer, `payouts.paypal_batch_id` is stored; on another timeout or 5xx the row stays `pending` with `paypal_batch_id` null and the response is still `200`. Event `retry_payout` (actor `seller`, `captured` to `captured`, payload `{ attempt: n, sender_batch_id, paypal_batch_id, status, failure_reason: null, cancelled_item_id: null }`).
- Latest row `failed`: when `failure_reason = UNCLAIMED`, first `POST /v1/payments/payouts-item/{paypal_item_id}/cancel` (E1); a failed cancel answers `paypal_error` and the row stays `failed`. Then insert `payouts` attempt `n + 1` (`status = pending`, `sender_batch_id = "payout-{code}-{n+1}"`, `recipient_email` = the seller's current `paypal_email`, `paypal_batch_id` null), commit, and call Payouts with `PayPal-Request-Id` and `sender_batch_id` both `"payout-{code}-{n+1}"`, `sender_item_id` the same string, as in 9.1 step 10 (same timeout, same `pending` / `failed` outcome rules). Event `retry_payout` (payload `{ attempt: n + 1, sender_batch_id, paypal_batch_id, status, failure_reason, cancelled_item_id }`, the last one the cancelled item id or null).

`payouts.status = failed` is set only by the `PAYOUTS-ITEM.FAILED`, `BLOCKED`, `RETURNED` and `UNCLAIMED` webhooks (11.4) and by a 4xx with a PayPal error `name` on the create call itself (9.1 step 10). No email.

## 10. Audit trail and evidence pack

### 10.1 `GET /api/deals/{code}/events`

Who: buyer or seller. Preconditions: none. Module call: `getEvents`.

Response: `200 DealEvent[]` (a bare array) ascending by `id`. Errors: `not_signed_in`, `deal_not_found`, `not_a_party`. Side effects: none.

### 10.2 `GET /api/deals/{code}/evidence-pack`

Who: buyer or seller. Preconditions: none. Module call: `getEvidencePack`.

Response: `200` JSON with `Content-Disposition: attachment; filename="handshake-{code}-evidence-pack.json"`. JSON only; the brief's PDF is cut (decisions A5). The pack is rebuilt from the database on every call; nothing is cached. File URLs inside it expire 10 minutes after `generated_at`; the `sha256` values identify the files permanently.

```ts
type EvidencePack = {
  format: "handshake-evidence-pack/1";
  generated_at: string;
  generated_for: Role;
  deal: Omit<DealView, "role" | "buyer" | "seller" | "conditions" | "reference_files" | "submissions" | "payment" | "payouts">;
  parties: { buyer: Party; seller: (Party & { paypal_email: string | null }) | null };
  conditions: Condition[];
  reference_files: FileRef[];
  submissions: (Omit<Submission, "verdicts"> & { verdicts: (Verdict & { raw_response: RawResponse | HashSkip | { seeded: true } })[] })[];
  payment: Payment | null;
  payouts: (Payout & { recipient_email: string })[];
  events: DealEvent[];
  webhook_events: { paypal_event_id: string; event_type: string; verified: boolean; processed_at: string | null; created_at: string }[];   // every row whose paypal_event_id appears in an event payload; body omitted (03 "Evidence pack assembly" step 8)
  extraction: { model: string; prompt_version: string; rejected: { text: string; suggestion: string }[] } | null;   // from the create event; null on seeded deals
};
```

`raw_response` is the `RawResponse` of [05-ai-spec.md](05-ai-spec.md) section 2.2 (`request_id`, `model`, `stop_reason`, `stop_category`, `usage`, `latency_ms`, `text`, `output`, `error`), stored once per call and repeated on every row of that call; `output.verdicts[].condition_id` holds the prompt labels `c1`..`c5`, not database ids (05 section 4.2). A D8 guardrail row carries the `HashSkip` object instead; a seeded row carries `{ "seeded": true }` (03).

Errors: `not_signed_in`, `deal_not_found`, `not_a_party`. Side effects: none.

Example (HS-7K2Q after the payout succeeded):

```json
GET /api/deals/HS-7K2Q/evidence-pack

200
{
  "format": "handshake-evidence-pack/1",
  "generated_at": "2026-10-23T09:51:31Z",
  "generated_for": "seller",
  "deal": {
    "code": "HS-7K2Q",
    "status": "paid",
    "item_title": "Hand-painted denim jacket",
    "source_text": "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos, and it has to be good quality",
    "amount_minor": 8000,
    "currency": "USD",
    "deadline_days": 7,
    "deadline_at": "2026-10-27T15:16:09Z",
    "terms_version": 1,
    "buyer_accepted_version": 1,
    "seller_accepted_version": 1,
    "fix_attempts_used": 0,
    "seeded": false,
    "created_at": "2026-10-20T14:03:11Z",
    "updated_at": "2026-10-23T09:43:08Z"
  },
  "parties": {
    "buyer": { "display_name": "Demo Buyer", "email": "demo-buyer@handshake.demo" },
    "seller": { "display_name": "Demo Seller", "email": "demo-seller@handshake.demo", "paypal_email": "sb-seller@personal.example.com" }
  },
  "conditions": [
    { "id": "c1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0a71", "position": 1, "text": "Item matches the reference photos", "evidence_type": "photo", "system": false },
    { "id": "c2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b82", "position": 2, "text": "Tracking shows delivered", "evidence_type": "tracking", "system": false },
    { "id": "c3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c93", "position": 3, "text": "Photo shows the deal code HS-7K2Q written by hand", "evidence_type": "photo", "system": true }
  ],
  "reference_files": [
    { "id": "f1d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a01", "purpose": "reference", "mime": "image/jpeg", "size_bytes": 412885, "sha256": "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce", "url": "/api/files/f1d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a01?exp=1792749691&sig=Mw7xY0zA3bC6dE9fG2hI5jK8lM1nO4pQ7rS0tU3vW6X", "created_at": "2026-10-20T14:05:02Z" },
    { "id": "f2e1b0c9-2d3e-4f40-9b5c-6d7e8f9a0b12", "purpose": "reference", "mime": "image/jpeg", "size_bytes": 398120, "sha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d", "url": "/api/files/f2e1b0c9-2d3e-4f40-9b5c-6d7e8f9a0b12?exp=1792749691&sig=Yz9aB2cD5eF8gH1iJ4kL7mN0oP3qR6sT9uV2wX5yZ8A", "created_at": "2026-10-20T14:05:09Z" }
  ],
  "submissions": [
    {
      "submission_no": 1,
      "submitted_at": "2026-10-23T09:41:20Z",
      "files": [
        { "id": "e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a55", "purpose": "evidence", "mime": "image/jpeg", "size_bytes": 455210, "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae", "url": "/api/files/e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a55?exp=1792749691&sig=Bc1dE4fG7hI0jK3lM6nO9pQ2rS5tU8vW1xY4zA7bC0D", "created_at": "2026-10-23T09:40:02Z" },
        { "id": "e2b3c4d5-e6f7-4a81-9b0c-1d2e3f4a5b66", "purpose": "evidence", "mime": "image/jpeg", "size_bytes": 431077, "sha256": "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9", "url": "/api/files/e2b3c4d5-e6f7-4a81-9b0c-1d2e3f4a5b66?exp=1792749691&sig=Ef3gH6iJ9kL2mN5oP8qR1sT4uV7wX0yZ3aB6cD9eF2G", "created_at": "2026-10-23T09:40:15Z" }
      ],
      "tracking_number": "TRK-DEMO-0000",
      "carrier_status": "delivered",
      "note": "Shipped Monday, delivered Wednesday",
      "verdicts": [
        { "condition_id": "c1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0a71", "result": "pass", "confidence": 0.93, "reason": "The painted pattern, collar and buttons match both reference photos.", "evidence_used": ["r1", "r2", "e1", "e2"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1",
          "raw_response": { "request_id": "req_011CSx4Yk2mN8pQ7rT3vW6zB", "model": "claude-sonnet-5-5", "stop_reason": "end_turn", "stop_category": null, "usage": { "input_tokens": 11240, "output_tokens": 212 }, "latency_ms": 6830, "text": "{\"verdicts\":[{\"condition_id\":\"c1\",\"result\":\"pass\",\"confidence\":0.93,\"reason\":\"The painted pattern, collar and buttons match both reference photos.\",\"evidence_used\":[\"r1\",\"r2\",\"e1\",\"e2\"]},{\"condition_id\":\"c2\",\"result\":\"pass\",\"confidence\":0.99,\"reason\":\"Carrier status is delivered.\",\"evidence_used\":[\"tracking\"]},{\"condition_id\":\"c3\",\"result\":\"pass\",\"confidence\":0.97,\"reason\":\"A handwritten note reading HS-7K2Q lies on the jacket in the second photo.\",\"evidence_used\":[\"e2\"]}]}", "output": { "verdicts": [ { "condition_id": "c1", "result": "pass", "confidence": 0.93, "reason": "The painted pattern, collar and buttons match both reference photos.", "evidence_used": ["r1", "r2", "e1", "e2"] }, { "condition_id": "c2", "result": "pass", "confidence": 0.99, "reason": "Carrier status is delivered.", "evidence_used": ["tracking"] }, { "condition_id": "c3", "result": "pass", "confidence": 0.97, "reason": "A handwritten note reading HS-7K2Q lies on the jacket in the second photo.", "evidence_used": ["e2"] } ] }, "error": null } },
        { "condition_id": "c2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b82", "result": "pass", "confidence": 0.99, "reason": "Carrier status is delivered.", "evidence_used": ["tracking"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1",
          "raw_response": { "request_id": "req_011CSx4Yk2mN8pQ7rT3vW6zB", "model": "claude-sonnet-5-5", "stop_reason": "end_turn", "stop_category": null, "usage": { "input_tokens": 11240, "output_tokens": 212 }, "latency_ms": 6830, "text": "{\"verdicts\":[{\"condition_id\":\"c1\",\"result\":\"pass\",\"confidence\":0.93,\"reason\":\"The painted pattern, collar and buttons match both reference photos.\",\"evidence_used\":[\"r1\",\"r2\",\"e1\",\"e2\"]},{\"condition_id\":\"c2\",\"result\":\"pass\",\"confidence\":0.99,\"reason\":\"Carrier status is delivered.\",\"evidence_used\":[\"tracking\"]},{\"condition_id\":\"c3\",\"result\":\"pass\",\"confidence\":0.97,\"reason\":\"A handwritten note reading HS-7K2Q lies on the jacket in the second photo.\",\"evidence_used\":[\"e2\"]}]}", "output": { "verdicts": [ { "condition_id": "c1", "result": "pass", "confidence": 0.93, "reason": "The painted pattern, collar and buttons match both reference photos.", "evidence_used": ["r1", "r2", "e1", "e2"] }, { "condition_id": "c2", "result": "pass", "confidence": 0.99, "reason": "Carrier status is delivered.", "evidence_used": ["tracking"] }, { "condition_id": "c3", "result": "pass", "confidence": 0.97, "reason": "A handwritten note reading HS-7K2Q lies on the jacket in the second photo.", "evidence_used": ["e2"] } ] }, "error": null } },
        { "condition_id": "c3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c93", "result": "pass", "confidence": 0.97, "reason": "A handwritten note reading HS-7K2Q lies on the jacket in the second photo.", "evidence_used": ["e2"], "model": "claude-sonnet-5-5", "prompt_version": "judge-v1",
          "raw_response": { "request_id": "req_011CSx4Yk2mN8pQ7rT3vW6zB", "model": "claude-sonnet-5-5", "stop_reason": "end_turn", "stop_category": null, "usage": { "input_tokens": 11240, "output_tokens": 212 }, "latency_ms": 6830, "text": "{\"verdicts\":[{\"condition_id\":\"c1\",\"result\":\"pass\",\"confidence\":0.93,\"reason\":\"The painted pattern, collar and buttons match both reference photos.\",\"evidence_used\":[\"r1\",\"r2\",\"e1\",\"e2\"]},{\"condition_id\":\"c2\",\"result\":\"pass\",\"confidence\":0.99,\"reason\":\"Carrier status is delivered.\",\"evidence_used\":[\"tracking\"]},{\"condition_id\":\"c3\",\"result\":\"pass\",\"confidence\":0.97,\"reason\":\"A handwritten note reading HS-7K2Q lies on the jacket in the second photo.\",\"evidence_used\":[\"e2\"]}]}", "output": { "verdicts": [ { "condition_id": "c1", "result": "pass", "confidence": 0.93, "reason": "The painted pattern, collar and buttons match both reference photos.", "evidence_used": ["r1", "r2", "e1", "e2"] }, { "condition_id": "c2", "result": "pass", "confidence": 0.99, "reason": "Carrier status is delivered.", "evidence_used": ["tracking"] }, { "condition_id": "c3", "result": "pass", "confidence": 0.97, "reason": "A handwritten note reading HS-7K2Q lies on the jacket in the second photo.", "evidence_used": ["e2"] } ] }, "error": null } }
      ],
      "decision": "capture",
      "decision_reason": "all_pass",
      "decided_at": "2026-10-23T09:41:31Z"
    }
  ],
  "payment": {
    "status": "captured",
    "paypal_order_id": "5O190127TN364715T",
    "authorization_id": "0VF52814937998046",
    "authorized_at": "2026-10-20T15:16:09Z",
    "auth_expires_at": "2026-11-18T15:16:09Z",
    "capture_id": "3C679366HH908993F"
  },
  "payouts": [
    { "attempt": 1, "status": "success", "amount_minor": 8000, "sender_batch_id": "payout-HS-7K2Q-1", "paypal_batch_id": "DN2EZ9K7N2WUJ", "paypal_item_id": "G2P8H4K9L1M3N", "failure_reason": null, "created_at": "2026-10-23T09:41:32Z", "recipient_email": "sb-seller@personal.example.com" }
  ],
  "events": [
    { "id": "1041", "from_status": null, "to_status": "draft", "actor": "buyer", "cause": "create", "payload": { "source_text": "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos, and it has to be good quality", "model": "claude-sonnet-5-5", "prompt_version": "extract-v1", "rejected": [ { "text": "it has to be good quality", "suggestion": "Photo shows no tears, stains or missing buttons" } ] }, "created_at": "2026-10-20T14:03:11Z" },
    { "id": "1042", "from_status": "draft", "to_status": "draft", "actor": "buyer", "cause": "accept", "payload": { "terms_version": 1 }, "created_at": "2026-10-20T14:09:30Z" },
    { "id": "1043", "from_status": "draft", "to_status": "draft", "actor": "seller", "cause": "join", "payload": { "seller_id": "u2b3c4d5-e6f7-4a81-9b0c-1d2e3f4a5b02" }, "created_at": "2026-10-20T15:10:40Z" },
    { "id": "1044", "from_status": "draft", "to_status": "terms_agreed", "actor": "seller", "cause": "accept", "payload": { "terms_version": 1 }, "created_at": "2026-10-20T15:12:02Z" },
    { "id": "1045", "from_status": "terms_agreed", "to_status": "terms_agreed", "actor": "buyer", "cause": "start_payment", "payload": { "paypal_order_id": "5O190127TN364715T", "order_attempt": 1 }, "created_at": "2026-10-20T15:15:01Z" },
    { "id": "1046", "from_status": "terms_agreed", "to_status": "held", "actor": "paypal", "cause": "fact:authorization_created", "payload": { "authorization_id": "0VF52814937998046", "auth_expires_at": "2026-11-18T15:16:09Z", "source": "api", "paypal_request_id": "auth-HS-7K2Q" }, "created_at": "2026-10-20T15:16:09Z" },
    { "id": "1047", "from_status": "held", "to_status": "proof_submitted", "actor": "seller", "cause": "submit_evidence", "payload": { "submission_no": 1, "file_ids": ["e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a55", "e2b3c4d5-e6f7-4a81-9b0c-1d2e3f4a5b66"], "tracking_number": "TRK-DEMO-0000", "carrier_status": "delivered" }, "created_at": "2026-10-23T09:41:20Z" },
    { "id": "1048", "from_status": "proof_submitted", "to_status": "proof_submitted", "actor": "ai", "cause": "verdict", "payload": { "submission_no": 1, "model": "claude-sonnet-5-5", "prompt_version": "judge-v1", "verdicts": [ { "condition_id": "c1a6e2d0-5b7f-4e11-9c3a-2f8d6b4e0a71", "result": "pass", "confidence": 0.93 }, { "condition_id": "c2b7f3e1-6c80-4f22-8d4b-3a9e7c5f1b82", "result": "pass", "confidence": 0.99 }, { "condition_id": "c3c8a4f2-7d91-4a33-9e5c-4b0f8d6a2c93", "result": "pass", "confidence": 0.97 } ] }, "created_at": "2026-10-23T09:41:27Z" },
    { "id": "1049", "from_status": "proof_submitted", "to_status": "captured", "actor": "system", "cause": "decision:capture", "payload": { "submission_no": 1, "reason": "all_pass", "capture_id": "3C679366HH908993F", "capture_status": "COMPLETED", "paypal_request_id": "capture-HS-7K2Q-0" }, "created_at": "2026-10-23T09:41:31Z" },
    { "id": "1050", "from_status": "captured", "to_status": "captured", "actor": "paypal", "cause": "fact:capture_completed", "payload": { "capture_id": "3C679366HH908993F", "source": "api", "paypal_request_id": "capture-HS-7K2Q-0", "payout": { "attempt": 1, "sender_batch_id": "payout-HS-7K2Q-1", "status": "pending" } }, "created_at": "2026-10-23T09:41:31Z" },
    { "id": "1051", "from_status": "captured", "to_status": "paid", "actor": "paypal", "cause": "fact:payout_succeeded", "payload": { "payout_item_id": "G2P8H4K9L1M3N", "payout_batch_id": "DN2EZ9K7N2WUJ", "sender_item_id": "payout-HS-7K2Q-1", "attempt": 1, "source": "webhook", "paypal_event_id": "WH-58D329510W468432D-8HN650336L201105X" }, "created_at": "2026-10-23T09:43:08Z" }
  ],
  "webhook_events": [
    { "paypal_event_id": "WH-58D329510W468432D-8HN650336L201105X", "event_type": "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "verified": true, "processed_at": "2026-10-23T09:43:08Z", "created_at": "2026-10-23T09:43:08Z" }
  ],
  "extraction": {
    "model": "claude-sonnet-5-5",
    "prompt_version": "extract-v1",
    "rejected": [ { "text": "it has to be good quality", "suggestion": "Photo shows no tears, stains or missing buttons" } ]
  }
}
```

## 11. `POST /api/webhooks/paypal`

Who: PayPal. No session, no CSRF token. The receiver verifies the signature in our own code, stores the event, processes it in the same request, and answers (decisions E6).

### 11.1 Headers read

| Header (Node lowercases them) | Use |
| --- | --- |
| `paypal-transmission-id` | first part of the signed message |
| `paypal-transmission-time` | second part, used verbatim |
| `paypal-transmission-sig` | base64 RSA-SHA256 signature |
| `paypal-cert-url` | where to fetch the signing certificate (PEM) |
| `paypal-auth-algo` | must be `SHA256withRSA` |

Source: paypal.md section 6, "Self-verification".

### 11.2 Verification

1. `raw = await request.text()`. The raw string is used for the CRC; never re-serialise a parsed object (stack.md section 2, paypal.md section 6).
2. Any header missing, or `paypal-auth-algo` not `SHA256withRSA`, or `raw` not JSON with string `id` and `event_type`: answer `400 invalid_input`. Nothing is stored (there is no trustworthy event id).
3. `paypal-cert-url` must be `https:` with a host ending in `.paypal.com`; otherwise the signature counts as bad. Fetch the PEM and cache it in memory by URL for the life of the process.
4. `message = "{transmission_id}|{transmission_time}|{webhook_id}|{zlib.crc32(Buffer.from(raw))}"` with the CRC as an unsigned decimal; `crypto.createVerify("SHA256").update(message).verify(pem, sig, "base64")`.
5. Try `webhook_id = PAYPAL_WEBHOOK_ID`. If that fails and `NODE_ENV !== "production"`, try the literal `WEBHOOK_ID` so simulator events verify (paypal.md section 6, "Simulator").

### 11.3 Storage, processing and response codes

| Situation | `webhook_events` write | Response |
| --- | --- | --- |
| Signature bad | insert `{ paypal_event_id: id, event_type, verified: false, processed_at: null, body }` if no row exists; an existing row is left as is | `400 { error: { code: "invalid_input", message: "Signature verification failed." } }` |
| Signature good, row exists with `processed_at` set | none | `200 { "ok": true, "outcome": "already_processed" }` (SB-7) |
| Signature good, no row or row with `processed_at` null | insert or update `verified: true`; process inside one transaction with `applyPaypalEvent(event, deps)`; set `processed_at` | `200 { "ok": true, "outcome": "applied" }`, `"noop"` (no fact for this event, or the resource lacks the field the lookup needs) or `"unknown_deal"` (no deal for the lookup). The values are `WebhookOutcome` in `lib/deal/webhooks.ts` |
| Processing throws | row stays with `processed_at` null, `last_error` = the message | `500 { error: { code: "internal_error", message: "Processing failed." } }` |

Retry semantics: PayPal retries any non-2xx response up to 25 times over 3 days (paypal.md section 6, "Delivery and retries"). A `500` therefore means "deliver again", and because `processed_at` is still null the next delivery is processed again; every fact is applied at most once per PayPal resource id (decisions C3), so re-processing is safe. A `400` is also retried by PayPal; each retry re-verifies, and a later delivery that verifies is processed normally. No work is deferred past the response.

### 11.4 Event to fact mapping

Deal lookup uses `resource.custom_id` (the deal's `public_code`, decisions E2) for order, authorization and capture events, and `resource.payout_item.sender_item_id` (`payout-{code}-{n}`) for payout item events (paypal.md section 5 and "Implications" item 4). An event whose deal cannot be found, whose deal is seeded (`deals.seeded = true`; seeded deals have no PayPal objects), or whose resource has no such field (simulator payloads are v1-shaped), is stored, marked processed and ignored.

| Event (decisions E5) | Fields read from `resource` | Fact and effect |
| --- | --- | --- |
| `CHECKOUT.ORDER.APPROVED` | `id` (order id), `purchase_units[0].custom_id` | If `deals.status = terms_agreed`, `payments.paypal_order_id = id` and `payments.status` is `created` or `approved`: set `approved`, call `authorizeOrder` with key `auth-{code}`, apply `authorization_created` (decisions E8, SB-6; 02 Assumption 7 covers the browser's 7.2 dying after its transaction-before). `ORDER_ALREADY_AUTHORIZED` or `ORDER_COMPLETED_OR_VOIDED` from PayPal: ignore (the authorization event carries the fact). Any other PayPal error: throw, so PayPal retries. Any other deal status, a superseded order id, or `payments.status` `authorized` or later: ignore; nothing is authorized for a deal that no longer wants the money. |
| `PAYMENT.AUTHORIZATION.CREATED` | `id`, `status`, `custom_id`, `expiration_time` | The authorization resource carries no order id (paypal.md "2. Orders v2", authorize response), so the match is on `deals.status` and stored ids only (02 section 5.3). When `status = CREATED`, `deals.status = terms_agreed` and `payments.authorization_id` is null or equals `id`: `authorization_created`, `terms_agreed` to `held` as in 7.2 with `source: "webhook"`. Same `id` already applied: no-op. Otherwise two late-authorization branches (decisions E4; 02 section 5.3), both writing event `fact:late_authorization_voided` (actor `paypal`, `from_status = to_status`, payload `{ authorization_id, source, paypal_event_id }`) and sending no email: (a) `payments.authorization_id` is null (the deal was cancelled before PayPal answered): store `authorization_id`, `authorized_at = now`, `auth_expires_at`; void call with key `void-{code}` (`PREVIOUSLY_VOIDED` is success; the one use of that key on this deal); `payments.status = voided`. (b) `payments.authorization_id` is set and differs from `id` (a stray authorization, for example from a superseded order): void call with key `void-{authorization_id}`; `payments` untouched; `void-{code}` is never spent on a stray. `status` other than `CREATED`: no-op. |
| `PAYMENT.AUTHORIZATION.VOIDED` | `id`, `custom_id` | `authorization_voided`: from `draft`, `terms_agreed`, `held`, `proof_submitted` or `in_review` with `payments.capture_id` null: to `voided`, `payments.status = voided`, no PayPal call, no email. In `captured` or `paid` (`capture_id` set): `payments.status = voided` only, event with `from_status = to_status`. Same `id` already applied (we voided it ourselves): no-op. |
| `PAYMENT.CAPTURE.COMPLETED` | `id`, `custom_id` | `capture_completed`: `payments.status = captured`, `capture_id = id`. From `proof_submitted` or `in_review` (the process died after the capture call and before transaction B; decisions C2): to `captured`. In `captured`: status unchanged. On first sight of `COMPLETED` for this capture id, insert the `payouts` row in the same transaction and send the Payouts call after commit (9.1 steps 9 and 10). |
| `PAYMENT.CAPTURE.PENDING` | `id`, `custom_id`, `status_details.reason` | `capture_pending`: `payments.status = capture_pending`, `capture_id = id`; `proof_submitted` or `in_review` to `captured`, `captured` unchanged. No payout yet. |
| `PAYMENT.CAPTURE.DECLINED` | `id`, `custom_id`, `status_details.reason` | `capture_declined`: `payments.status = declined`, `capture_id = id`, `capture_attempts + 1`; `captured` to `in_review` (decisions C2); email both parties (`"PayPal declined the capture"`). |
| `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` | `payout_item_id`, `payout_batch_id`, `transaction_status`, `payout_item.sender_item_id` | `payout_succeeded`: that `payouts` row `status = success`, `paypal_batch_id`, `paypal_item_id` stored. Latest attempt on a `captured` deal: `captured` to `paid`, no email. An earlier attempt on a `paid` deal: the row only, event `paid` to `paid` (decisions E7). |
| `PAYMENT.PAYOUTS-ITEM.FAILED` | as above plus `errors.name` | `payout_failed`: row `status = failed`, `failure_reason = errors.name` (or `transaction_status` when `errors` is absent), `paypal_item_id` stored; deal stays `captured`; no email (the deal page shows the failure and the retry button). |
| `PAYMENT.PAYOUTS-ITEM.BLOCKED` | as above | treated exactly like `FAILED` |
| `PAYMENT.PAYOUTS-ITEM.RETURNED` | as above | treated exactly like `FAILED` |
| `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` | as above | `payout_failed` with `failure_reason = UNCLAIMED` and `paypal_item_id` kept: the item stays claimable for 30 days and `retry_payout` cancels it first (decisions E5, E7). No email. |
| any other `event_type` | none | stored, marked processed, ignored |

Every applied fact writes one `deal_events` row with actor `paypal`, cause `fact:{name}`, and payload `{ ...ids, source: "webhook", paypal_event_id }`. A fact that matches no row of decisions C2 in the current status (for example `authorization_voided` on a `voided` deal, `capture_completed` on a `paid` deal, or `payout_failed` on a `paid` deal) writes a `from_status = to_status` event if it carries new PayPal detail and is otherwise a no-op; it changes no status, never throws `invalid_state`, and is never deferred or discarded. A second arrival of the same fact with the same PayPal id is a no-op (decisions C3).

`PAYMENT.CAPTURE.DENIED` is a Payments v1 event and is not subscribed (decisions E5, paypal.md section 6). `CUSTOMER.DISPUTE.CREATED` is not subscribed (decisions A5).

## 12. `POST /api/jobs/tick`

Who: the Render cron service (schedule `*/10 * * * *`, decisions J2), or an operator with the secret. Header `Authorization: Bearer {CRON_SECRET}`, compared with `crypto.timingSafeEqual` after a length check. Module call: `tick(now, deps)`.

Request: empty body.

Response:

```ts
200 TickReport
type TickReport = {                                   // 02 section 3.1, verbatim
  voided: string[];                                   // deal codes voided for a passed deadline
  verdicts_rerun: string[];                           // deal codes whose verdict step was finished
  reconciled: string[];                               // deal codes where a late or lost webhook's fact was applied (decisions E12)
  errors: { code: string; message: string }[];        // per-deal failures; the run continues past them
};
```

Errors: `not_signed_in` (missing or wrong bearer). A per-deal failure never fails the request.

Side effects (decisions B7, C2, C5), each deal in its own transaction, seeded deals skipped:

1. Every deal with status `held` or `in_review` and `deadline_at < now`: void call with key `void-{code}` (`PREVIOUSLY_VOIDED` is success), `status = voided`, `payments.status = voided`, event `tick:deadline` (actor `system`, payload `{ deadline_at, authorization_id }`), then fact `authorization_voided` with `source: "api"`. No email (02 section 5.6). Voiding in `in_review` is deliberate: no passing proof by the deadline (FR-10).
2. Every deal with status `proof_submitted` and `updated_at < now - 2 minutes`: event `tick:reverify` (actor `system`, `proof_submitted` to `proof_submitted`, payload `{ submission_no }`; decisions C6), then 9.1 from step 2 on the latest submission, with one rule: when `verdicts` rows exist for the current `submission_no`, steps 2 to 5 are skipped and `judge()` is not called; `decide()` runs on the stored rows and the PayPal call re-sends the same key (02 sections 5.7 and 6.9). The model is called only when no rows exist (the process died before transaction V). The capture key `capture-{code}-{n}` is unchanged, so a capture that did succeed before the crash is returned, not repeated; a deal that a `PAYMENT.CAPTURE.COMPLETED` webhook already moved to `captured` (11.4) is no longer `proof_submitted` and is not selected.
3. Reconciliation (decisions E12; 02 section 5.7): payments `capture_pending` or `approved` with a pending authorization for over 10 minutes, and payouts `pending` with a batch id for over 30 minutes, are read back from PayPal and the fact the missing webhook would have carried is applied once (`source: "reconcile"`); the codes go in `reconciled`.
4. Nothing else. There is no reauthorize job (decisions B7). `proof_submitted` deals are not deadline-voided; a capture that keeps failing is closed by PayPal's own `PAYMENT.AUTHORIZATION.VOIDED` when the 29-day authorization expires (decisions B7).

The endpoint is idempotent: a second call in the same minute finds nothing to do and returns empty lists.

## 13. `GET /api/health`

Who: anyone. Response: `200 { "ok": true }`. No database, no AI, no auth; Render's health check must answer within 5 s (stack.md section 5d). Never errors.

## 14. `GET /api/dashboard/data`

Who: signed in. Preconditions: none.

Response: `200 DashboardData`, the type of [09-ag-studio.md](09-ag-studio.md) section 5.2 verbatim, scoped to the deals where the caller is buyer or seller, including seeded deals (decisions F6; 09 Assumption 1). No emails, no names. The route composes it from the module's public queries `listDeals` + `getDeal` + `getEvents` (09 Assumption 2) with the pure builders in `lib/dashboard-rows.ts`; [02-system-design.md](02-system-design.md) section 3.2 points here.

```ts
// lib/dashboard-rows.ts
export type Decision = 'capture' | 'request_fix' | 'buyer_review' | 'void';

export type DashboardDeal = {
  code: string;
  item_title: string;
  role: 'buyer' | 'seller';
  status: DealStatus;
  status_label: string;          // STATUS_LABEL[status]
  amount_usd: number;            // amount_minor / 100
  held_usd: number;              // amount_usd if status in held, proof_submitted, in_review; else 0
  released_usd: number;          // amount_usd if status in captured, paid; else 0
  voided_usd: number;            // amount_usd if status is voided; else 0
  created_at: string;            // ISO 8601
  deadline_at: string | null;
  decision: Decision | null;     // newest decision, see below
  decision_label: string;        // the decision in plain words, or 'No verdict'
  lowest_confidence: number | null;
  fix_attempts_used: 0 | 1;
  seeded: boolean;
};

export type DashboardVerdict = {
  deal_code: string;
  condition_text: string;
  submission_no: 1 | 2;
  result: 'pass' | 'fail' | 'unclear';
  confidence: number;            // 0..1
  confidence_band: '0.00 - 0.69' | '0.70 - 0.84' | '0.85 - 0.94' | '0.95 - 1.00';
};

export type DashboardDecision = {
  deal_code: string;
  decision: Decision;
  decided_at: string;            // deal_events.created_at, ISO 8601
  decided_on: string;            // YYYY-MM-DD, for charts that bucket by day
  amount_usd: number;
  is_capture: 0 | 1;             // one-hot columns so a stacked column chart needs only categoryKey + valueKey
  is_request_fix: 0 | 1;
  is_buyer_review: 0 | 1;
  is_void: 0 | 1;
};

export type DashboardData = {
  generated_at: string;
  deals: DashboardDeal[];
  verdicts: DashboardVerdict[];
  decisions: DashboardDecision[];
};
```

Rules, from 09 section 5.2: a decision is any event whose `cause` starts with `decision:`; the part after the colon is the `Decision`; `DashboardDeal.decision` is the newest one (C6; 09 section 5.2). `confidence_band` edges are `< 0.70`, `0.70 - 0.84`, `0.85 - 0.94`, `0.95 - 1.00`. A `draft` deal with `amount_minor` null has `amount_usd` 0. Order: `deals` by `created_at` ascending, `verdicts` by deal, `submission_no`, then condition `position`, `decisions` by `decided_at` ascending.

Dates are ISO strings. Whether AG Studio accepts ISO strings for `dateTimeFormat` fields is UNVERIFIED (ag-grid.md section 3); the page converts them to `Date` objects before handing them to Studio if the check fails.

Errors: `not_signed_in`. Side effects: none.

## 15. `POST /api/studio/agent` (could)

Who: signed in. Preconditions: none. This is the server half of the Claude adapter for the AG Studio Agent Framework (decisions G3). The route, its request and response mapping and its code are in [09-ag-studio.md](09-ag-studio.md) section 6.3; this section only fixes the HTTP contract. Built in T-39 (Studio 3.0.0).

Request: JSON, the `AgLlmRequest` the Studio `directLlmRunner` hands to the adapter: `{ instructions?: string (≤ 60,000 chars); input: AgAiConversationItem[] (≤ 80); tools: { name; description?; parameters }[] (≤ 40) }`. `toolChoice`, `responseFormat` and `model` are accepted and ignored.

Response: `200` JSON, the `AgLlmResponse` `{ id, createdAt, status: "completed" | "incomplete" | "failed", output: AgAiOutputItem[], error?: { code, message }, incompleteDetails? }`. A model failure (timeout, 429, 529, refusal) is still `200` with `status: "failed"`, so the chat panel shows a message instead of a crashed page; `stop_reason: "max_tokens"` is `status: "incomplete"` with `incompleteDetails: { reason: "max_output_tokens" }`. The client adapter replays `output` as stream events (09 Assumption 11). The `status` enum is verified against `agLlmAdapter.d.ts` in ag-studio 3.0.0 (09 section 6.3).

Model and settings (decisions D3; claude-api.md section 5): fixed `claude-sonnet-5-5` regardless of `AI_MODEL`, because `thinking: { type: "between_tools" }`, the only way to turn thinking off, is "Sonnet 5.5 only (other models return a 400)"; `output_config: { effort: "low" }`; `max_tokens` 2000; no `temperature`; SDK `timeout: 30_000`, `maxRetries: 1`. Studio executes its own tools in the browser; the one `kind: "server"` tool, `explain_verdict`, runs inside this route (`lib/studio-tools.ts`, as the signed-in user) in a loop of at most 3 tool rounds per turn (`MAX_TOOL_ROUNDS` in `lib/studio-agent.ts`), each round one more Claude call. Rate limit: 30 turns per 10 minutes per user, in memory (09 section 6.3; every judge shares one demo persona).

Errors: `not_signed_in`, `invalid_input` (shape or size), `rate_limited` 429 (decisions H2).

Side effects: one to four Claude calls per turn; nothing is stored.

## 16. Events written by this API

`deal_events` is append-only and written in the same transaction as the change it records (decisions C6). Every accepted command and every applied fact writes exactly one row, including commands that leave `status` unchanged; file uploads write none. `payload` always holds the ids needed to explain the step.

| `cause` | `actor` | `from_status` to `to_status` | `payload` keys |
| --- | --- | --- | --- |
| `create` | buyer | null to draft | `source_text`, `model`, `prompt_version`, `rejected` |
| `edit_terms` | buyer | draft or terms_agreed to draft | `terms_version`, `changed` |
| `join` | seller | draft to draft | `seller_id` |
| `accept` | buyer or seller | draft to draft or terms_agreed | `terms_version` |
| `start_payment` | buyer | terms_agreed to terms_agreed (order created or reused) | `paypal_order_id`, `order_attempt` |
| `submit_evidence` | seller | held to proof_submitted | `submission_no`, `file_ids`, `tracking_number`, `carrier_status` |
| `verdict` | ai | proof_submitted to proof_submitted (verdict rows stored) | `submission_no`, `model`, `prompt_version`, `verdicts[]` (`condition_id`, `result`, `confidence`) |
| `decision:capture` | system | proof_submitted to captured | `submission_no`, `reason`, `capture_id`, `capture_status`, `paypal_request_id` |
| `decision:request_fix` | system | proof_submitted to held | `submission_no`, `reason` |
| `decision:buyer_review` | system | proof_submitted to in_review | `submission_no`, `reason` |
| `decision:void` | system | proof_submitted to voided | `submission_no`, `reason`, `authorization_id` |
| `review:approve` | buyer | in_review to captured | `note`, `capture_id`, `capture_status` |
| `review:reject` | buyer | in_review to voided | `note`, `authorization_id` |
| `cancel` | buyer or seller | draft, terms_agreed or held to voided | `authorization_id`, `voided` |
| `retry_payout` | seller | captured to captured | `attempt`, `sender_batch_id`, `paypal_batch_id`, `status`, `failure_reason`, `cancelled_item_id` |
| `tick:deadline` | system | held or in_review to voided | `deadline_at`, `authorization_id` |
| `tick:reverify` | system | proof_submitted to proof_submitted | `submission_no` |
| `fact:authorization_created` | paypal | terms_agreed to held | `authorization_id`, `auth_expires_at` |
| `fact:late_authorization_voided` | paypal | unchanged (`from_status = to_status`) | `authorization_id` |
| `fact:capture_completed` | paypal | proof_submitted, in_review or captured to captured | `capture_id`, `payout` (when created in the same transaction) |
| `fact:capture_pending` | paypal | proof_submitted, in_review or captured to captured | `capture_id`, `reason` |
| `fact:capture_declined` | paypal | captured to in_review | `capture_id`, `reason` |
| `fact:authorization_voided` | paypal | draft, terms_agreed, held, proof_submitted or in_review to voided; captured or paid unchanged | `authorization_id` |
| `fact:payout_succeeded` | paypal | captured to paid; paid to paid for an earlier attempt | `payout_item_id`, `payout_batch_id`, `sender_item_id`, `attempt` |
| `fact:payout_failed` | paypal | captured to captured | `payout_item_id`, `payout_batch_id`, `sender_item_id`, `attempt`, `failure_reason` |

This is the `cause` vocabulary of decisions C6, verbatim and complete; `reason` on `decision:*` is the `DecisionReason` of section 3. Every `fact:*` payload also carries `source` (`"api"` when the fact came from a PayPal API response inside one of our requests, `"webhook"` when it came from `POST /api/webhooks/paypal`, `"reconcile"` when `tick` read it back from PayPal, with no id) and either `paypal_request_id` (source `api`) or `paypal_event_id` (source `webhook`). Tests detect which source won a race by `payload.source`, never by `cause`. The identity used to apply a fact once is the pair (fact name, PayPal resource id); a second arrival with the same pair writes nothing.

Emails sent by this API, owned by [02-system-design.md](02-system-design.md) section 5.6 and `lib/deal/notify.ts`: the magic link (4.1) plus the two notices below (decisions C2, FR-32), sent through the `email` dep after the transaction commits; a send failure is logged and changes nothing. This is the complete list. No other endpoint sends email: nothing on `held`, `request_fix`, `voided` (any cause), `paid` or `payout_failed` (02 Assumption 16).

| Moment | Endpoint that triggers it | To | Subject |
| --- | --- | --- | --- |
| decision `buyer_review` (`proof_submitted` to `in_review`) | 9.1 | buyer | "Your decision is needed on {code}" |
| fact `capture_declined` (`captured` to `in_review`) | 9.1, 9.2, 11.4 | both | "PayPal declined the capture" |

## Assumptions

Choices made here because decisions.md does not decide them. Each is the simplest option consistent with it.

1. The error codes are decisions H2 exactly: `internal_error` 500 for unhandled exceptions and webhook processing failures, `ai_unavailable` 503 for an extraction that failed after its retry, `rate_limited` 429 for the Studio agent only. `accept` with a null `amount_minor` or `deadline_days` is `400 invalid_input`.
2. A party acting in the wrong role (a seller editing terms, a buyer submitting evidence) gets `403 not_a_party` with a message naming the required role; no new code is added.
3. Every command endpoint answers `409 invalid_state` on a seeded deal (`deals.seeded = true`), before any role or status check; webhooks that resolve to a seeded deal are stored, marked processed and ignored; `tick` skips seeded deals.
4. `POST /api/deals` takes `{ text }` only; reference photos are uploaded afterwards with `POST /api/deals/{code}/files` while the deal is `draft` and before the seller has accepted. There is no file delete endpoint.
5. Uploads are one file per request; the file is sniffed by magic bytes and the sniffed MIME type is stored. Evidence uploads are capped at 6 unsubmitted files per deal.
6. `rejected[]` from extraction is returned by `POST /api/deals` and stored in the `create` event payload, not in a table.
7. Terms edits replace the whole `conditions` list with new ids; the server strips and re-appends its code condition. Edits never call the model. `edit_terms` from `terms_agreed` is refused once a `payments` row exists; cancel is the way out.
8. Every submission is self-contained: the verdict for submission `n` judges only the evidence rows with `submission_no = n`.
9. The verdict request follows "write intent, call PayPal, write result": transaction V (verdict rows and the `verdict` event) commits before `decide()` and before any PayPal call; transaction B (the `decision:*` event, the status change, the capture or void fact and the `payouts` row) commits after it. A PayPal failure answers `502 paypal_error` with the verdict rows in place and the deal in `proof_submitted`; `tick` runs `decide()` on the stored rows, re-sends the same key and calls the model only when no rows exist for the current `submission_no`.
10. The capture key counter `n` in `capture-{code}-{n}` is `payments.capture_attempts`, incremented only by an applied `capture_declined` fact, so an errored capture call is retried with the same key. A `DECLINED` or `FAILED` capture response is handled as the `capture_declined` fact with `source: "api"`.
11. `sender_item_id` on a Payouts item equals `sender_batch_id` (`payout-{code}-{n}`), which is how a payout item webhook finds its `payouts` row.
12. An authorization returned in any status other than `CREATED` from `authorizeOrder` answers `502 paypal_error`; `authorized_at` is the server clock at the time the fact is applied.
13. `start_payment` reuses the stored order when it is under 6 hours old and still `created` (measured by `payments.updated_at`), and otherwise creates order `n + 1` with key `order-{code}-{n+1}` taken from the committed `payments.order_attempts`; nothing is written before the PayPal call (`payments.paypal_order_id` is `NOT NULL`, 03), and one transaction after it stores the order id, `order_attempts = n + 1` and the `start_payment` event. It writes a `start_payment` event on every call.
14. Facts never throw `invalid_state` and are never deferred. A fact that matches no C2 row in the current status writes a `from_status = to_status` event if it carries new PayPal detail and is otherwise a no-op. A late authorization (the deal is not `terms_agreed`, or it already stores a different authorization) is voided at once and recorded as `fact:late_authorization_voided`, on both the webhook and the 7.2 path: with `void-{code}` when no authorization is stored (the ids are stored and `payments` is marked `voided`), with `void-{authorization_id}` when a different one is stored (`payments` untouched); decisions E4.
15. The `payouts` row is inserted `pending` with `paypal_batch_id` null before the Payouts call. A timeout or 5xx leaves it `pending` (PayPal may have accepted the batch); only a 4xx with a PayPal error `name` on the create call, or a `PAYOUTS-ITEM.FAILED` / `BLOCKED` / `RETURNED` / `UNCLAIMED` webhook, sets `failed`. `retry_payout` re-sends attempt `n` with the same `sender_batch_id` when the latest row is `pending` without `paypal_batch_id`, and creates `n + 1` when it is `failed` (after cancelling an `UNCLAIMED` item). The request still answers `200` when the Payouts call fails.
16. Events are written for every accepted command, including ones that leave `status` unchanged (`join`, `accept`, `start_payment`, `retry_payout`); file uploads write none. The verdict is recorded as an `ai` event and the decision as a separate `system` event.
17. Emails are the magic link plus the two notices of 02 section 5.6, sent after commit; failures are logged only.
18. Magic-link requests accept an optional `next` path carried in the token, validated with `^/(?![/\\])` and at most 200 characters, otherwise `/ledger`; the callback redirects there, and to `/?error=invalid_link` on failure. Links may be reused within their 15 minutes.
19. `POST /api/auth/demo` answers `400 invalid_input` when `DEMO_LOGIN` is not `true`, and upserts the persona's `display_name` and, for the seller, `paypal_email = DEMO_SELLER_PAYPAL_EMAIL` on every sign-in, so a judge's `PATCH /api/me` cannot redirect later payouts for the rest of judging (decisions F3).
20. `GET /api/files/{id}` needs no session; bad or expired links answer `403 not_a_party`, unknown ids `404 deal_not_found`.
21. `GET /api/deals` returns `LedgerRow[]` (09 section 4.1 plus `seeded` and `updated_at`, `amount_minor` nullable) as a bare array, and `GET /api/deals/{code}/events` returns `DealEvent[]` as a bare array. `GET /api/dashboard/data` returns 09 section 5.2's `DashboardData` for all of the caller's deals with no pagination; a null `amount_minor` gives `amount_usd` 0.
22. Tracking numbers are limited to 64 characters, display names to 60, condition text to 200, item titles to 80.
23. `tick` identifies a stuck verdict by `deals.updated_at` older than 2 minutes.
24. `decide()` returns `{ decision, reason }` with `reason` a `DecisionReason` (`all_pass`, `fail`, `unclear`, `low_confidence`, `amount_over_limit`; 05 section 7). There is no separate AI-failure reason: a failed, timed-out or refused verdict call yields `unclear` rows (decisions D4) and the reason is `unclear`. The reason is stored as `reason` in every `decision:*` event payload and exposed as `Submission.decision_reason`.
25. `Verdict.evidence_used` is read from the `verdicts.evidence_used` column (03; the post-processed labels of 05 section 4.7), never derived from `raw_response`; D8 guardrail rows list the matching evidence and reference labels, and it is `[]` for AI-failure rows and seeded rows. `seller.paypal_email` in the `DealView` is filled only when the caller is the seller; the evidence pack carries it for the seller as before.
26. `DealPreview.role` is `"preview"`, matching 02 section 3.2.
27. PayPal SDK calls use `timeout: 10_000`, matching 02 section 8.2 and Assumption 17; `dependencies.md` follows this value.
