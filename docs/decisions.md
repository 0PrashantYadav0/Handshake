# Handshake: decision log

As of 2026-10-09. This file is the authoritative list of decisions taken after the original brief (`docs/brief/`) was written and the research (`docs/research/`) was done. Where a working document in `docs/` differs from the brief, the reason is here. **Every named thing (state, command, endpoint, table, column, env var) is spelled here the way it must be spelled everywhere else.**

## A. Hackathon constraints (details: `docs/hackathon.md`)

- **A1.** Submission deadline 2026-11-12 12:00 PST. Internal: feature freeze 2026-11-08, submit 2026-11-11.
- **A2.** Judges test the hosted app 2026-12-01 to 2026-12-15, a month after submission. The demo must stay up until then, and demo deals must be created on demand because PayPal holds expire after 29 days. No pre-made live deals.
- **A3.** Deliverables: public repo with `LICENSE` (MIT) at the root, README with run instructions, hosted URL, sandbox test logins and tools used, YouTube video under 3 minutes.
- **A4.** Prize targets: a grand prize or Best Use of PayPal + AI, plus the AG Grid sponsor prize (judged on AG Studio). Agentic Commerce is not a target.
- **A5.** Scope cut from the brief: PDF evidence pack (JSON only), disputes (FR-15, FR-16, SB-12, the `disputed` state and `disputes` table), FR-17 (GitHub PR proof), FR-18 (split payouts), Playwright reduced to one happy-path test, outside testers reduced to three. These stay listed as "later" in the requirements.
- **A6.** Currency is USD only. Extraction returns `currency` as `"USD"` or `null`; anything else is rejected with `unsupported_currency`.

## B. Architecture ("approach A")

- **B1.** One Next.js app (App Router, TypeScript, Node runtime) + one Postgres + one cron job (every 10 minutes since J2), all on Render. No queue, no worker, no second service.
- **B2.** One deep module, `lib/deal/`, owns every deal. Its public interface:
  - Commands: `handle(code, actor, command, deps)`, `applyPaypalEvent(event, deps)`, `tick(now, deps)`.
  - Queries: `getDeal(code, actor, deps)`, `listDeals(actor, deps)`, `getEvents(code, actor, deps)`, `getEvidencePack(code, actor, deps)`.
  - It is the **only** code that changes `deals.status`, writes `deal_events`, or calls PayPal authorize, capture, void or Payouts. The transition table, `decide()`, event writing, idempotency keys and the buyer-or-seller access check are private to it.
  - Errors are thrown as `DealError(code)` using the API error codes in section H.
- **B3.** `deps` are injected: `{ db, paypal, ai, email, clock }`. Each has a real adapter and a fake: PayPal (sandbox SDK + raw fetch / in-memory fake that records calls and can be told to fail), AI (Claude / canned verdicts), email (Resend / console), clock (`Date` / fixed). The carrier lookup is a plain pure function (D7), not a dep. File storage is Postgres (B6), not a dep.
- **B4.** Route handlers are thin: read the session, validate the body with Zod, call the module, map `DealError` to HTTP. No business rule lives in a route.
- **B5.** The verdict runs **inside** `POST /api/deals/{code}/evidence`, and the response is `200` with the final state. The AI call is capped at 17 s (19 s overall abort signal, D4); the PayPal capture and payout add up to 20 s more, so the request can take about 40 s worst case, typically 6 to 12 s. The UI waits 45 s before showing a connection error. The brief's `202` is gone: work left running after a response is lost on a Render restart. Whether Render's proxy allows a 40 s response is UNVERIFIED and is spike 4 in `02-system-design.md` section 12.
- **B6.** Photos are stored in Postgres (`files.bytes`, `bytea`). The browser downscales to 1600 px on the long edge, JPEG quality 0.85, before upload; the server accepts JPEG, PNG and WebP up to 2 MB. Files are served by `GET /api/files/{id}` with an HMAC-signed URL that expires after 10 minutes. No S3, no extra provider.
- **B7.** `tick(now)` does four things: void `held` and `in_review` deals whose `deadline_at` has passed; re-run the verdict for deals stuck in `proof_submitted` for more than 2 minutes (the server died mid-call); reconcile with PayPal (E12, added 2026-10-11); nothing else. **There is no reauthorize job**: PayPal blocks reauthorization for the first 3 days of a hold and allows effectively one per hold, so a daily job is impossible (research/paypal.md). Deals are capped at 21 days after authorization, inside PayPal's 29-day validity.
- **B8.** Request-level `Idempotency-Key` headers on our own API are dropped. Double submits are rejected by the state machine (`invalid_state`); PayPal-side idempotency is guaranteed by `PayPal-Request-Id` (E4).
- **B9.** The repo's `docs/` folder is the source of truth from now on. The Claude Doc is the original brief and is not kept in sync.

## C. Deal state machine

- **C1.** `deals.status` is one of exactly: `draft`, `terms_agreed`, `held`, `proof_submitted`, `in_review`, `captured`, `paid`, `voided`.
- **C2.** Transitions (anything else throws `invalid_state` and writes no event):

| From | Trigger | To | Side effect |
| --- | --- | --- | --- |
| draft | `edit_terms` (buyer) | draft | `terms_version` + 1, both accepted versions cleared |
| draft | `join` (signed-in non-party, `seller_id` null) | draft | sets `seller_id` |
| draft | `accept` by one party | draft | records that party's accepted version |
| draft | `accept` when both accepted versions equal `terms_version` | terms_agreed | seller must have a verified `paypal_email` (K5; else `paypal_email_required`, or `payout_email_unverified` when set but unverified) |
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
| captured | `retry_payout` (seller) | captured | re-sends attempt `n` when the latest payout is `pending` with `paypal_batch_id` null, or creates attempt `n + 1` when it is `failed` (E7) |

A fact that matches no row (for example `authorization_voided` on a `voided` deal, or `capture_completed` on a `paid` deal) writes a `from_status = to_status` event if it carries new PayPal detail and is otherwise a no-op; it never throws `invalid_state`. No fact is "deferred" or discarded.

- **C3.** A PayPal **fact** (`authorization_created`, `capture_completed`, `capture_pending`, `capture_declined`, `authorization_voided`, `payout_succeeded`, `payout_failed`) may arrive from an API response or a webhook. It is applied **once, from whichever source is first**; the second arrival with the same PayPal id is a no-op, not `invalid_state`. This is what makes SB-6 and SB-7 pass.
- **C4.** `captured` means "capture requested". `payments.status` carries the detail (`capture_pending` or `captured`). The payout is triggered on the first sight of capture status `COMPLETED`, whether from the capture API response or from `PAYMENT.CAPTURE.COMPLETED`. If a void is refused because the authorization is already captured (PayPal: "You cannot void an authorized payment that has been fully captured", research/paypal.md "3. Payments"), `lib/deal` re-sends `capture-{code}-{n}` with the same key, which returns the existing capture, and applies `capture_completed` or `capture_pending` by the C2 rows above. `PREVIOUSLY_VOIDED` on a void counts as success.
- **C5.** `in_review` past `deadline_at` is voided (FR-10: no passing proof by the deadline). The 8-day gap between the 21-day cap and PayPal's 29-day validity is the safety margin.
- **C6.** `deal_events` is append-only and written in the same transaction as every status change, with `from_status`, `to_status`, `actor` (`buyer`, `seller`, `system`, `paypal`, `ai`), `cause` and a `payload` with the ids needed to explain the step. Every accepted command and every applied fact writes exactly one row, including those that leave `status` unchanged. File uploads write no event. `cause` is exactly one of the strings below and nothing else; `02-system-design.md` section 5.4, the `deal_events` table and seed in `03-database-schema.md`, `04-api-spec.md` section 16, `06-test-plan.md`, `08-ui-spec.md` section 7.11 and `09-ag-studio.md` copy this list verbatim. The dashboard reads the decision from the `decision:` prefix and the buyer's choice from the `review:` prefix.

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
| `retry_payout` | seller | payout attempt `n + 1` created, or attempt `n` re-sent | `attempt`, `sender_batch_id`, `paypal_batch_id`, `status`, `failure_reason`, `cancelled_item_id` |
| `tick:deadline` | system | `tick` voids past `deadline_at` | `deadline_at`, `authorization_id` |
| `tick:reverify` | system | `tick` re-runs a stuck verdict (proof_submitted to proof_submitted) | `submission_no` |
| `fact:authorization_created` | paypal | hold recorded | `authorization_id`, `auth_expires_at` |
| `fact:late_authorization_voided` | paypal | authorization arrived after cancel and was voided (status unchanged) | `authorization_id` |
| `fact:capture_completed`, `fact:capture_pending`, `fact:capture_declined` | paypal | capture result recorded | `capture_id`, `reason` for pending or declined, `payout` when created in the same transaction |
| `fact:authorization_voided` | paypal | PayPal reports the void | `authorization_id` |
| `fact:payout_succeeded`, `fact:payout_failed` | paypal | payout item result recorded | `payout_item_id`, `payout_batch_id`, `sender_item_id`, `attempt`, `failure_reason` for failed |
| `contract:verification_failed` | system | the contract gate (K6) refused a payment step; status unchanged | `step`, `problem` |

Every `fact:*` payload also carries `source` (`"api"`, `"webhook"` or `"reconcile"`) and either `paypal_request_id` (source `api`) or `paypal_event_id` (source `webhook`); source `reconcile` carries no id (E12). Tests detect which source won a race by `payload.source`, never by `cause`.

## D. AI (details: `docs/research/claude-api.md`)

- **D1.** Model: `claude-sonnet-5-5` for both jobs, via `@anthropic-ai/sdk`. `AI_MODEL` env var overrides it; the eval compares Opus 5.5 and Haiku 5.5 as challengers.
- **D2.** Structured outputs via `output_config: { format: { type: "json_schema", schema } }` with **hand-written JSON schemas** (the SDK's Zod helper silently drops `enum` enforcement). Range and length checks that the API rejects (`minimum`, `maximum`, `minLength`, `maxLength`, `maxItems`) are enforced by Zod on our side. Enum values are lower-cased before validation.
- **D3.** No `temperature` (the 5.5 models reject non-default values). Latency is controlled with `output_config.effort: "low"`; the eval may raise it for the verdict job. No `thinking` parameter is sent on either job: the request uses adaptive thinking at `effort: "low"`, which Sonnet 5.5 mostly skips (research/claude-api.md "5. Temperature, sampling and thinking"). `thinking: { type: "between_tools" }` is Sonnet-only and is used only by the Studio agent (G3); sending it on job 1 or 2 breaks the Opus and Haiku challengers.
- **D4.** Timeouts: extraction 7 s per attempt, two attempts, inside a 15 s abort signal; verdict 17 s per attempt with no retry, inside a 19 s abort signal. If the eval shows p95 under 8 s, the verdict call becomes 9 s per attempt with one retry inside the same 19 s signal. A verdict failure, timeout, refusal, schema mismatch or missing verdict for a condition yields `unclear` for the affected conditions, which the decision function turns into `buyer_review`. An extraction failure after its retry is `ai_unavailable` 503 (H2). Server-side refusal fallback to another model is **off**.
- **D5.** Images are sent as base64 blocks, each preceded by a text label (`Reference r1:`, `Evidence e1:`). At 1600 px a photo costs about 2,500 tokens; a verdict with 10 photos costs about $0.07 on Sonnet, a 30-case eval about $2.40.
- **D6.** Extraction input is the sentence and today's date only. The model returns up to 4 conditions of `evidence_type` `photo` or `tracking` (the brief's `file` and `link` types are cut with FR-17). When any photo condition exists, **the server, not the model**, appends the condition "Photo shows the deal code {code} written by hand", so at most 5 conditions exist. Subjective parts go to `rejected[]` with a suggested rewording. A sentence with zero checkable conditions is rejected with `condition_not_checkable`. `amount_minor` and `deadline_days` may be `null`; the UI then asks.
- **D7.** Carrier status is a mock: a tracking number whose last character is an even digit is `delivered`, an odd digit is `in_transit`, anything else is `unknown`. The demo kit uses `TRK-DEMO-0000`. The README discloses this.
- **D8.** Guardrail before the model: an evidence photo whose `sha256` equals any reference photo's fails every photo condition without a model call.
- **D9.** Decision function, pure, unit-tested row by row. It differs from the brief in one place: on the second submission a `fail` voids only when the model is confident; a low-confidence `fail` goes to the buyer, because void is the one irreversible automated action against the seller and verdicts vary between runs (research/claude-api.md "Open risks" 12). D8 rows carry `confidence` 1 and always void on attempt 2.

```
decide(verdicts, deal):
  if any verdict is fail:
      if deal.fix_attempts_used == 0: return request_fix
      hardFail = any verdict is fail with confidence >= PASS_THRESHOLD
      if hardFail: return void
      return buyer_review
  if any verdict is unclear or any confidence < PASS_THRESHOLD:   # 0.85; exactly 0.85 passes
      return buyer_review
  if deal.amount_minor > AUTO_CAPTURE_MAX_MINOR:                 # 20000
      return buyer_review
  return capture
```

- **D10.** Every verdict row stores `model`, `prompt_version` (`extract-v1`, `judge-v1`, bumped on any prompt change) and `raw_response`.
- **D11.** Untrusted content (notes, text inside images) is delimited in the prompt and described as evidence, never followed as instructions. Two eval cases test injection.
- **D12.** Eval: 30 cases in `eval/cases/<name>/` with `deal.json`, `reference/`, `evidence/`, `tracking.txt`, `expected.json`. `npm run eval` prints the decision-match rate and the wrong-capture rate; the second must be zero. The photos are our own (a user task: photograph 6 to 8 household items in matching, wrong-item and blurry variants, plus handwritten code notes).

## E. PayPal (details: `docs/research/paypal.md`)

- **E1.** `@paypal/paypal-server-sdk` 2.5.0 for create order (intent `AUTHORIZE`), authorize order, capture authorization, void authorization. Raw `fetch` for Payouts (create batch, cancel unclaimed item: `POST /v1/payments/payouts-item/{id}/cancel`) and for webhook signature verification; the SDK covers neither. The PayPal port therefore has seven methods: create order, authorize order, capture authorization, void authorization, create payout, cancel payout item, verify webhook (plus the three reads of E12). One small OAuth token cache of our own for the raw calls.
- **E2.** The deal's `public_code` goes in the purchase unit's `custom_id`. Order amount is the deal amount in USD.
- **E3.** The **original** `authorization_id` is stored permanently and is the only id ever used for capture and void (a reauthorization cannot be voided). No reauthorize call anywhere.
- **E4.** `PayPal-Request-Id` on every write, at most 38 characters:
  - `order-{code}-{n}`: `n` is `payments.order_attempts`, the number of orders created for the deal, starting at 1 (`order-HS-XXXX-1`, 15 characters). `start_payment` reuses the stored order id without a PayPal call when the stored order is under 6 h old and still unapproved, and otherwise creates order `n + 1`. One key per order is needed because PayPal keeps Orders keys for 6 h (extendable to 72 h by an account manager) while the approval window is 6 h to redirect plus 6 h to approve; both retention figures come from SDK docstrings and are UNVERIFIED (research/paypal.md "4. Idempotency" and "Open risks" 10).
  - `auth-{code}`: once per deal.
  - `void-{code}`: spent at most once per deal, on the stored `authorization_id`: by the command or tick that voids the deal, or by a late authorization that arrives on a deal with no stored authorization (`02-system-design.md` section 5.3; `payments` stores the id and is marked `voided`).
  - `void-{authorization_id}`: used once per stray authorization that arrives on a deal which already stores a different `authorization_id` (`02-system-design.md` section 5.3); `payments` is untouched and the event is `fact:late_authorization_voided` either way. Never used for the stored authorization. `void-0VF52814937998046` is 22 characters.
  - `capture-{code}-{n}`: `n` is `payments.capture_attempts`, the number of `fact:capture_declined` events recorded for the deal, starting at 0. A retry after a timeout, 5xx or crash reuses the same `n`, so PayPal returns the first capture instead of making a second one; only a decline advances it.
  - Payouts `sender_batch_id`: `payout-{code}-{n}` with `n = payouts.attempt` (PayPal deduplicates it for 30 days).
- **E5.** Webhook events subscribed: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.BLOCKED`, `PAYMENT.PAYOUTS-ITEM.RETURNED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`. `BLOCKED` and `RETURNED` are stored as `failed`. `UNCLAIMED` is stored as `failed` with `failure_reason` `UNCLAIMED` and `paypal_item_id` kept, because the item stays claimable for 30 days and must be cancelled before any retry (E7; research/paypal.md "5. Payouts"). `PAYMENT.CAPTURE.DENIED` is not a v2 event and is not used. `CUSTOMER.DISPUTE.CREATED` is not subscribed (A5).
- **E6.** Webhook receiver: verify the signature **in our own code** (PayPal's verify endpoint rejects its own simulator's events): fetch and cache the cert from `PAYPAL-CERT-URL` (host must end in `.paypal.com`), message = `{transmission_id}|{transmission_time}|{webhook_id}|{crc32(raw body)}` using Node's `zlib.crc32`, verify RSA-SHA256. Outside production, also accept webhook id `WEBHOOK_ID` so the simulator works. Then insert `webhook_events` keyed by PayPal event id (already processed → `200` and stop; exists but unprocessed → process again), process inside a transaction, set `processed_at`, answer `200`. A processing failure leaves `processed_at` null and answers `500` so PayPal retries. A bad signature is stored with `verified = false`, not processed, and answered `400`.
- **E7.** Payout: on the first sight of capture `COMPLETED`, create a Payouts batch to the seller's `paypal_email` for the captured amount (no platform fee in this build). `payouts.status` `pending` → `success` on `PAYOUTS-ITEM.SUCCEEDED` (deal → `paid`) or `failed` with the reason (deal stays `captured`). `retry_payout` (seller, after fixing `paypal_email`) creates attempt `n + 1` only when the latest attempt is `failed` with reason `FAILED`, `BLOCKED` or `RETURNED`, or with reason `UNCLAIMED` after `POST /v1/payments/payouts-item/{paypal_item_id}/cancel` succeeds in the same request; if that cancel fails, `retry_payout` answers `paypal_error` and the row stays `failed`. This stops a mistyped address from being paid twice. A `payout_succeeded` for an attempt that is not the latest, on a `paid` deal, updates that `payouts` row only and writes a `paid` → `paid` event (C2).
- **E8.** `CHECKOUT.ORDER.APPROVED` is the safety net for SB-6: if `payments.status` is still `created`, the handler authorizes the order server-side and applies the `authorization_created` fact.
- **E9.** Browser: `@paypal/react-paypal-js` 10.x using the legacy `PayPalScriptProvider` with `intent: "authorize"` and `PayPalButtons`; `createOrder` calls `POST .../payment`, `onApprove` calls `POST .../payment/authorize`. The buyer logs into the PayPal popup with the sandbox personal account listed in the README.
- **E10.** Platform as merchant: the Handshake sandbox business account receives the capture and pays the seller through Payouts. Production would use multiparty onboarding; the README says so.
- **E11.** Week-1 sandbox spike must confirm two UNVERIFIED items: capturing the original hold on days 4 to 21 without reauthorizing works; and whether Payouts needs a feature enabled on the sandbox app.
- **E12.** Reconciliation for late or lost webhooks (2026-10-11; trust-and-accounts spec section 9, issue #62). The port gains three reads with no request id: `getCapture` (SDK `GET /v2/payments/captures/{id}`), `getAuthorization` (SDK `GET /v2/payments/authorizations/{id}`), `getPayoutBatch` (raw `GET /v1/payments/payouts/{id}`). `tick` runs `reconcile(now)` after its other steps, on non-seeded deals only: payments `capture_pending` with `updated_at` over 10 minutes old read the capture (COMPLETED, PENDING, DECLINED or FAILED map as the capture answer does); payments `approved` with an `authorization_id` on a `terms_agreed` deal over 10 minutes old read the authorization (`CREATED` → `authorization_created`; `VOIDED` → `authorization_voided`; `DENIED` → `authorization_voided` too, because a denied hold never holds money, has no webhook, and would otherwise block `start_payment` and make `cancel` fail on the void; `PENDING` → nothing); payouts `pending` with a `paypal_batch_id` over 30 minutes old read the batch and map the item whose `sender_item_id` is the row's `sender_batch_id` exactly as `PAYMENT.PAYOUTS-ITEM.*` (`SUCCESS` as `SUCCEEDED`, then `FAILED`, `BLOCKED`, `RETURNED`, `UNCLAIMED`; anything else → nothing). Each fact goes through `applyFactTx` under the row lock with `{ source: "reconcile" }`, so the apply-once rule (C3) makes a webhook after a reconcile, or a reconcile after a webhook, a no-op. A PayPal error on one deal lands in `TickReport.errors` and the run goes on; applied codes are listed in `TickReport.reconciled`. Thresholds run against `updated_at`, so a deal still pending at PayPal is asked again on each tick (every 10 minutes, J2).

## F. Sign-in, access, demo

- **F1.** Sessions: a `jose` HS256 JWT in cookie `hs_session` (HttpOnly, Secure, SameSite=Lax), signed with `SESSION_SECRET`. No auth framework (Auth.js v5 is beta and needs a DB adapter). Amended 2026-10-11 (K2): the token carries `mfa` (false = partial, 15 minutes; true = full, 30 days) and `sv`, the user's `session_version`.
- **F2.** Magic link: `POST /api/auth/magic-link { email }` emails a 15-minute JWT link via Resend; in development the link is printed to the console. The link opens `/signin/link`, whose Continue button POSTs the token to `/api/auth/callback`, which spends it once, sets a partial session and sends the user to the second factor (K1, K10). Resend's test sender only delivers to the account owner's address until a domain is verified, so magic links are optional for judges (F3) and verified-domain sending is a "could".
- **F3.** Demo personas: when `DEMO_LOGIN=true`, `POST /api/auth/demo { persona: "buyer" | "seller" }` signs in as the seeded `demo-buyer@handshake.demo` or `demo-seller@handshake.demo`, and the header shows a persona switcher. The demo seller's `paypal_email` comes from `DEMO_SELLER_PAYPAL_EMAIL`. `POST /api/auth/demo` upserts the persona on every sign-in: `display_name` ("Demo Buyer" / "Demo Seller") and, for the seller, `paypal_email = DEMO_SELLER_PAYPAL_EMAIL`, so a judge's `PATCH /api/me` cannot redirect later payouts. This is how a judge plays both sides in one browser. Amended 2026-10-11 (K7): the personas pass the second factor with a published secret, and their payout address, keys and recovery codes are locked.
- **F4.** Access: a user may read a deal only as buyer or seller (`not_a_party`), with one exception: a signed-in non-party may read a **preview** (`code`, `item_title`, `amount_minor`, `currency`, `deadline_days`, `conditions`, buyer `display_name`) of a `draft` deal with no seller, so they can join.
- **F5.** Demo kit under `public/demo/`: preset sentences, reference photos, and evidence sets (`good`, `wrong-item`, `blurry`). "Use sample" buttons upload them. The handwritten-code photo is composed in the browser on a canvas (sample photo + the deal code in a handwriting font) because codes are generated per deal. The README discloses this.
- **F6.** Seed data: the two demo users plus about 25 historical deals in mixed statuses, flagged `deals.seeded = true`, with events but no PayPal objects, so the ledger and dashboard have something to show.
- **F7.** User profile: `GET /api/me`, `PATCH /api/me { display_name, paypal_email, totp }`. A new `paypal_email` needs step-up and is unverified until its emailed code comes back (K5).

## G. UI (details: `docs/08-ui-spec.md`)

- **G1.** Pages: `/` (landing + sign-in), `/new` (sentence → terms review → reference photos → share link), `/deal/[code]` (role-aware deal page), `/ledger` (AG Grid), `/dashboard` (AG Studio), `/me`. Seller flow is mobile-first.
- **G2.** Tailwind CSS v4 for styling; no component library. Visual direction is decided at build time with the frontend-design skill; the UI spec fixes layout, states and copy.
- **G3.** AG Grid Community for the ledger (must). AG Studio dashboard with a custom theme and one custom widget (should). A custom Claude-backed Studio agent through `POST /api/studio/agent` with thinking off (could). `AG_GRID_LICENSE_KEY` env var; the Studio trial is requested on or after 2026-11-01 so it lasts through judging, and a longer key is requested on the PayPal Discord now.

## H. API

- **H1.** Endpoints (all JSON unless noted; `{code}` is the deal's `public_code`):
  `POST /api/auth/magic-link`, `GET /api/auth/callback`, `POST /api/auth/demo`, `POST /api/auth/sign-out`,
  `GET /api/me`, `PATCH /api/me`,
  `POST /api/deals`, `GET /api/deals`, `GET /api/deals/{code}`, `PATCH /api/deals/{code}/terms`, `POST /api/deals/{code}/join`, `POST /api/deals/{code}/accept`,
  `POST /api/deals/{code}/payment`, `POST /api/deals/{code}/payment/authorize`,
  `POST /api/deals/{code}/files` (multipart; `purpose` = `reference` | `evidence`), `GET /api/files/{id}?exp=&sig=`,
  `POST /api/deals/{code}/evidence`, `POST /api/deals/{code}/review`, `POST /api/deals/{code}/cancel`, `POST /api/deals/{code}/payout/retry`,
  `GET /api/deals/{code}/events`, `GET /api/deals/{code}/evidence-pack`,
  `POST /api/webhooks/paypal`, `POST /api/jobs/tick` (bearer `CRON_SECRET`), `GET /api/health`,
  `GET /api/dashboard/data`, `POST /api/studio/agent` (could).
- **H2.** Error shape `{ "error": { "code", "message" } }`. Codes: `invalid_input` 400, `not_signed_in` 401, `not_a_party` 403, `deal_not_found` 404, `file_too_large` 413, `invalid_state` 409, `terms_not_accepted` 409, `terms_version_mismatch` 409, `paypal_email_required` 409, `condition_not_checkable` 422 (only for a sentence the model read and found zero checkable conditions in), `unsupported_currency` 422, `too_many_files` 422, `rate_limited` 429 (`POST /api/studio/agent`, `POST /api/deals` and `GET /api/deals/{code}` per-user limits; `POST /api/auth/magic-link` stays `200` when limited so addresses cannot be probed), `internal_error` 500 (any unhandled exception; webhook processing failure), `paypal_error` 502 (includes PayPal's debug id), `ai_unavailable` 503 (extraction failed after its retry: timeout, 429/5xx, refusal or bad output; message "the model did not answer; try again"); added 2026-10-11 (K): `mfa_required` 401 (partial session on a full-session route), `totp_invalid` 400 (wrong, reused or missing code), `signature_invalid` 400 (hash mismatch, bad signature, unknown or revoked key), `contract_invalid` 409 (the contract gate refused a money step), `payout_email_unverified` 409. This list is exact; no document adds a code.
- **H3.** Limits: reference photos ≤ 4 per deal, evidence photos ≤ 6 per submission, 2 MB per file, note ≤ 1,000 characters, sentence ≤ 500 characters, amount ≤ 1,000,000 minor units.

## I. Data

- **I1.** Tables: `users`, `deals`, `conditions`, `files`, `evidence`, `verdicts`, `payments`, `payouts`, `deal_events`, `webhook_events`. No `disputes`, no sessions. *Amended (K10):* `used_login_tokens` records each sign-in link's id once; trust spec §6 added `signing_keys` and `contract_signatures`.
- **I2.** `files`: `id`, `deal_id`, `uploaded_by`, `purpose` (`reference` | `evidence`), `mime`, `size_bytes`, `sha256`, `bytes`, `created_at`. `evidence` rows reference `file_id` for photos; `kind` is `photo` | `tracking` | `note`; `value` holds the tracking number or note text; `submission_no` is 1 or 2. Reference photos are compared against every photo condition, so `conditions.reference_file_ids` is dropped.
- **I3.** `deals` adds `deadline_days` (1 to 21), `seeded` (boolean), `updated_at`; `deadline_at` is null until `held`. `payments` keeps `authorization_id` (original), `authorized_at`, `auth_expires_at`, `capture_id`, `status` (`created` | `approved` | `authorized` | `capture_pending` | `captured` | `declined` | `voided`), and adds `order_attempts` (integer, default 0; E4) and `capture_attempts` (integer, default 0; incremented only when a `fact:capture_declined` event is applied; E4); no `honor_expires_at`. `payouts` adds `sender_batch_id`, `attempt`, `failure_reason`, `paypal_item_id`.
- **I4.** `public_code` = `HS-` + 4 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`; regenerate on collision.
- **I5.** Prisma 7.10.0 with `@prisma/adapter-pg` (pinned exactly; a plain install pulls a v8 release candidate). Enums as Prisma enums. `deal_events.id` is `BigInt @default(autoincrement())`.

## J. Stack, hosting, process (details: `docs/research/stack.md`, `docs/dependencies.md`)

- **J1.** Node 24.21.0 (`.node-version`), TypeScript 5.9.x, Next.js and React at the versions pinned in `docs/dependencies.md`, Vitest, Playwright, Zod, jose, Resend.
- **J2.** Render Blueprint `render.yaml`: web service plan `0.5c-512mb` ($7/mo) with `preDeployCommand: npx prisma migrate deploy`, Postgres `0.1c-256mb` with `diskSizeGB: 5` ($6/mo), cron calling `POST /api/jobs/tick`, every 10 minutes since 2026-10-11 so deadline voids and PayPal reconciliation are prompt (was `0 6 * * *`). About $35 from 2026-10-09 to 2026-12-15, inside the $50 credit. Free tiers are not used: they sleep or expire before judging.
- **J3.** Env vars: `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `FILE_URL_SECRET`, `DATA_KEYS`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`, `PAYPAL_WEBHOOK_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `RESEND_API_KEY`, `EMAIL_FROM`, `PASS_THRESHOLD`, `AUTO_CAPTURE_MAX_MINOR`, `CRON_SECRET`, `DEMO_LOGIN`, `DEMO_SELLER_PAYPAL_EMAIL`, `AG_GRID_LICENSE_KEY`. `.env.example` lists every name with no values.
- **J4.** Local: Postgres via Docker Compose; `cloudflared` quick tunnel for webhooks. CI: GitHub Actions with a Postgres service runs lint, typecheck, unit and integration tests, and build on every push. Playwright runs locally before each deploy.
- **J5.** Work is tracked as GitHub issues in milestones W1 to W5; each issue carries acceptance criteria and the test command that proves it. Code starts only after the docs in `docs/` and the plan are reviewed.

## K. Trust and accounts (2026-10-11; details: `docs/superpowers/specs/2026-10-11-trust-and-accounts-design.md`)

- **K1.** Two-factor sign-in for every account: email link, then TOTP (RFC 6238, SHA-1, 6 digits, 30 s, one step of drift). Enrollment is mandatory; ten recovery codes stored as SHA-256. A used step is recorded so a code works once. Five wrong codes per 10 minutes lock the account, counted atomically in Postgres before each check.
- **K2.** Partial sessions reach only `/api/auth/2fa/*` and the 2FA pages. Every request checks the session against `users.session_version`; "Sign out everywhere" bumps it.
- **K3.** Step-up (a fresh code in the same request) for signing a contract, changing the payout email, revoking a signing key and new recovery codes.
- **K4.** Accepting is signing: each browser's ECDSA P-256 key (non-extractable, IndexedDB) signs `"Handshake contract v2\n" + SHA-256(canonical JSON)`. Contract format 2 covers code, version, item, amount, currency, deadline, conditions, both parties, listing photo hashes and the decision rule (snapshotted per deal at creation and used by `decide()`). Both parties sign after the seller joins; editing the terms or adding listing photos needs new signatures. Signatures are append-only.
- **K5.** Payouts only to a verified address: an emailed 6-digit code (hashed with user and address, single use, 15 minutes, five attempts). An unverified address at capture records the payout `failed` with `PAYOUT_EMAIL_UNVERIFIED`; the seller verifies and retries.
- **K6.** Contract gate: before an order, any authorization (API, webhook, reconcile), any capture and any payout, the contract is rebuilt from the rows and both signatures verified; payouts must also match the contract amount and the verified address. A failure records `contract:verification_failed`, answers `contract_invalid`, and moves no money. Voids are never gated.
- **K7.** Demo personas (only with `DEMO_LOGIN=true`, which refuses to boot unless PayPal is the sandbox) share published TOTP secrets, are exempt from lockout, and cannot change payout address, keys or recovery codes.
- **K8.** Field encryption at rest (AES-256-GCM, `DATA_KEYS` keyring, AAD = column and deal id) for deal text, conditions, evidence values, photos, verdict reasons and raw responses, the contract keys of event payloads, and TOTP secrets. Not zero-knowledge: the server must read terms for Claude to judge them.
- **K9.** Reconciliation: the tick job reads captures pending over 10 minutes, holds approved over 10 minutes and payouts pending over 30 minutes from PayPal and applies the same facts webhooks would (E12).
- **K10.** A sign-in link works once: the callback inserts the token's `jti` into `used_login_tokens` (primary key, so a second insert claims nothing), across restarts and instances. Rows past the 15-minute expiry are deleted on the next sign-in, by the database clock. The emailed link opens `/signin/link`; only its "Continue" POST (same origin) spends the token, so mail scanners that open links do not.
- **K11.** Content-Security-Policy per page request from `proxy.ts` (`lib/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'` (the PayPal SDK loads through `strict-dynamic`; `'unsafe-eval'` only in development), `style-src 'self' 'unsafe-inline'` (React style attributes, AG Grid and the PayPal SDK; nonces do not cover attributes), PayPal hosts for connect, frame and img, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` only when `APP_URL` is https. API routes, `_next/` and `public/demo/` are skipped. Every page is dynamic already (the root layout reads the session), so each response carries its own nonce.

## Assumptions

Choices made while fixing review findings, each the simplest option consistent with the rest of this file.

1. The `cause` vocabulary (C6) uses the prefixed scheme from `04-api-spec.md` section 16 (`decision:*`, `review:*`, `tick:*`, `fact:*`) rather than flat names, because the dashboard and the timeline need to tell a decision, a buyer review and a PayPal fact apart by prefix alone.
2. `order_attempts` and `capture_attempts` live on `payments` (I3), not `deals`, because they describe PayPal calls and `payments` is one row per deal.
3. `payouts.paypal_item_id` is the PayPal payout item id, stored so an `UNCLAIMED` item can be cancelled before a retry (E7).
4. A late `fact:authorization_voided` in `proof_submitted` or `in_review` with `capture_id` null voids the deal in place (C2); it is not deferred to `tick`, because a void that PayPal reports has already happened and no capture can follow it.

## L. Agents (2026-11-05, docs/agents.md)

- **L1.** Agents are first-class but can't move money. No tool approves a hold or decides a buyer review. Money moves only on a person's PayPal approval and on `decide()`.
- **L2.** An agent key is a hashed bearer token, a per-deal ceiling and a sealed P-256 signing key, bound to one user. Making one needs a full session and step-up. Its signatures pass `verifyContract` like a device key's.
- **L3.** The negotiation model proposes; `lib/agents/desk.ts` enforces each agent's private limit in code. An accept outside a limit is refused, an offer past it is cut to the limit.
- **L4.** The MCP endpoint is stateless Streamable HTTP with JSON responses (`/api/mcp`): `initialize`, `ping`, `tools/list`, `tools/call`.
- **L5.** Demo and eval photos are path-traced renders from `scripts/demo/photo-studio/` instead of photographs (amends D12, T-23). Disclosed in the README.
- **L6.** The seed runs in the pre-deploy step; it is idempotent. `job_runs` records the tick for `GET /api/status`.
