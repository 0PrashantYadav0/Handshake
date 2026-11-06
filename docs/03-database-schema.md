# Database schema

This document fixes every table, column, constraint, enum and migration of Handshake's Postgres database, the complete `prisma/schema.prisma`, the seed, the evidence-pack query plan and the photo storage budget. As of 2026-10-09.

Names come from [decisions.md](decisions.md) section I and are spelled here exactly as they must appear in code. Platform facts come from [research/stack.md](research/stack.md) (section 3 "Prisma 7.10" and section 4 "Postgres bytea"). The original brief is [brief/03-database-schema.md](brief/03-database-schema.md); the section "Changes from the brief" lists every departure and its reason. The state machine these tables serve is decisions C1 to C6; the module that owns every write is `lib/deal/` (decisions B2).

## Conventions

This document specifies the ten launch tables. Later migrations added five more (`used_login_tokens`, `signing_keys`, `contract_signatures`, `agent_keys`, `job_runs`), so `prisma/schema.prisma` has 15 models. Snake_case names, one spelling shared by the database, the Prisma client and the API JSON.

| Rule | Detail |
| --- | --- |
| Keys | `id uuid` primary key on every table except `deal_events` (`bigint` autoincrement, which gives a strict order) and `webhook_events` (PayPal's event id is the key). Prisma generates UUIDs client-side with `@default(uuid())`. |
| Money | Integer minor units: `amount_minor` 8000 is 80.00 USD. `currency` is text and always `USD` (decisions A6), enforced by a CHECK. |
| Time | Every timestamp is `timestamptz(6)`, stored and compared in UTC. `deadline_at` is computed as `authorized_at + deadline_days * interval '1 day'`. |
| Audit columns | Every table has `created_at` (default `now()`). Tables updated in place also have `updated_at` (`users`, `deals`, `payments`, `payouts`), maintained by Prisma `@updatedAt`. `conditions`, `files`, `evidence`, `verdicts` and `deal_events` are write-once. `webhook_events` is updated only in `processed_at` and `last_error`. |
| Naming | Prisma models are PascalCase (`Deal`) and `@@map` to the table (`deals`). Prisma field names are the column names verbatim, snake_case, with no `@map`. So `deal.amount_minor` is the same string in SQL, TypeScript and `GET /api/deals/{code}`. Client accessors are `prisma.user`, `prisma.deal`, `prisma.condition`, `prisma.file`, `prisma.evidence`, `prisma.verdict`, `prisma.payment`, `prisma.payout`, `prisma.dealEvent`, `prisma.webhookEvent`. |
| Enums | Native Postgres enum types created by Prisma, `@@map`ped to snake_case type names; values are lower-case strings identical to decisions.md. |
| Foreign keys | `ON DELETE RESTRICT` on every relation. Nothing is deleted in production; a deal with events cannot be deleted at all (the append-only trigger raises on the cascade). Tests reset with `TRUNCATE`, which bypasses row triggers (stack.md section 3). |
| Where constraints live | Primary keys, uniques, indexes and foreign keys are declared in `schema.prisma` and generated into migration `init`. CHECK constraints and the trigger live in one hand-written migration, `constraints`, because Prisma does not model them (stack.md section 3, "customizing migrations"). |
| Blobs | Photo bytes are in `files.bytes` (`bytea`). A global Prisma `omit` keeps `bytes` out of every query; only `GET /api/files/{id}` and the verdict job select it explicitly. |
| Counts the database does not enforce | At most 4 reference photos per deal, at most 6 evidence photos per submission (decisions H3). The module checks these and throws `too_many_files`. |

## Enums

Eight enum types. The Prisma name is used in TypeScript; the Postgres type name is what `\dT` shows.

| Prisma enum | Postgres type | Values (in order) | Used by |
| --- | --- | --- | --- |
| `DealStatus` | `deal_status` | `draft`, `terms_agreed`, `held`, `proof_submitted`, `in_review`, `captured`, `paid`, `voided` | `deals.status`, `deal_events.from_status`, `deal_events.to_status` |
| `EvidenceType` | `evidence_type` | `photo`, `tracking` | `conditions.evidence_type` |
| `FilePurpose` | `file_purpose` | `reference`, `evidence` | `files.purpose` |
| `EvidenceKind` | `evidence_kind` | `photo`, `tracking`, `note` | `evidence.kind` |
| `VerdictResult` | `verdict_result` | `pass`, `fail`, `unclear` | `verdicts.result` |
| `PaymentStatus` | `payment_status` | `created`, `approved`, `authorized`, `capture_pending`, `captured`, `declined`, `voided` | `payments.status` |
| `PayoutStatus` | `payout_status` | `pending`, `success`, `failed` | `payouts.status` |
| `EventActor` | `event_actor` | `buyer`, `seller`, `system`, `paypal`, `ai` | `deal_events.actor` |

`deal_events.cause` is text, not an enum, so that a new cause never needs a migration. Its vocabulary is fixed in the `deal_events` section and typed as a TypeScript union inside `lib/deal/`.

## users

One row per email address; both demo personas are rows here.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key |
| email | text | no | | Unique. Stored lower-cased and trimmed by the app; CHECK `email = lower(email)` |
| display_name | text | yes | null | Shown to the other party; UI falls back to the part of `email` before `@` |
| paypal_email | text | yes | null | Payout receiver. Required before a seller's `accept` can reach `terms_agreed` (`paypal_email_required`) |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | Prisma `@updatedAt` |

Constraints: PK `id`; unique `email`; CHECK `users_email_lower`.

## deals

One row per deal; `status` is changed only by `lib/deal/`.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key |
| public_code | text | no | | `HS-` + 4 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (decisions I4); unique; the app regenerates on collision. Used in URLs, `custom_id` and the handwritten photo code |
| buyer_id | uuid | no | | FK `users.id` |
| seller_id | uuid | yes | null | FK `users.id`; null until `join` |
| source_text | text | no | | The buyer's sentence, 1 to 500 characters (decisions H3) |
| item_title | text | no | | Extracted by the AI, editable, 1 to 80 characters |
| amount_minor | integer | yes | null | USD cents, 1 to 1,000,000 (H3). Null only while `draft`, when extraction returned null and the UI has not asked yet (decisions D6) |
| currency | text | no | `'USD'` | Always `USD` |
| deadline_days | integer | yes | null | 1 to 21. Null only while `draft`, as above |
| deadline_at | timestamptz | yes | null | Null until `held`; then `authorized_at + deadline_days` days (decisions C2) |
| status | deal_status | no | `'draft'` | Decisions C1 |
| terms_version | integer | no | 1 | +1 on every `edit_terms` |
| buyer_accepted_version | integer | yes | null | Cleared on `edit_terms`; `accept` sets it to `terms_version` |
| seller_accepted_version | integer | yes | null | Same |
| fix_attempts_used | integer | no | 0 | 0 or 1; set to 1 by decision `request_fix` |
| seeded | boolean | no | false | True for the historical demo deals written by the seed (decisions F6). `tick` and every PayPal code path skip rows with `seeded = true` |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | Prisma `@updatedAt`. `tick` uses it to find deals stuck in `proof_submitted` for more than 2 minutes (decisions B7) |

Indexes: unique `public_code`; `(buyer_id, status)` and `(seller_id, status)` for the ledger; `(status, deadline_at)` for `tick`'s deadline query and `(status, updated_at)` for its stuck-verdict query (decisions B7).

Foreign keys: `buyer_id`, `seller_id` to `users.id`, RESTRICT.

CHECK constraints (full SQL in the `constraints` migration):

| Name | Rule |
| --- | --- |
| deals_public_code_format | `public_code ~ '^HS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'` |
| deals_currency_usd | `currency = 'USD'` |
| deals_amount_range | `amount_minor IS NULL OR amount_minor BETWEEN 1 AND 1000000` |
| deals_deadline_days_range | `deadline_days IS NULL OR deadline_days BETWEEN 1 AND 21` |
| deals_terms_version_min | `terms_version >= 1` |
| deals_buyer_accepted_range | `buyer_accepted_version IS NULL OR buyer_accepted_version BETWEEN 1 AND terms_version` |
| deals_seller_accepted_range | same for `seller_accepted_version` |
| deals_fix_attempts_range | `fix_attempts_used IN (0, 1)` |
| deals_source_text_len | `char_length(source_text) BETWEEN 1 AND 500` (replaced by `deals_source_text_sealed`, see migration `sealed_columns`) |
| deals_item_title_len | `char_length(item_title) BETWEEN 1 AND 80` (replaced by `deals_item_title_sealed`) |
| deals_parties_differ | `seller_id IS NULL OR seller_id <> buyer_id` |
| deals_complete_after_draft | `status IN ('draft', 'voided') OR (seller_id IS NOT NULL AND amount_minor IS NOT NULL AND deadline_days IS NOT NULL)` |
| deals_deadline_at_after_held | `status IN ('draft', 'terms_agreed', 'voided') OR deadline_at IS NOT NULL` |

Derived values the module relies on: the current submission number is `fix_attempts_used + 1`; the AI condition id `c{n}` is `conditions.position = n`.

## conditions

The checkable terms of a deal, at most 5, rewritten as a set on every `edit_terms`.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key |
| deal_id | uuid | no | | FK `deals.id` |
| position | integer | no | | 1 to 5, display order; `c{position}` in the AI prompt and verdict ids |
| text | text | no | | For example "Item matches the listing photos". The server-appended code condition is "Photo shows the deal code {public_code} written by hand" and is always last (decisions D6) |
| evidence_type | evidence_type | no | | `photo` or `tracking` |
| created_at | timestamptz | no | `now()` | |

Constraints: PK `id`; unique `(deal_id, position)`; FK `deal_id` RESTRICT; CHECK `conditions_position_range` (`position BETWEEN 1 AND 5`), `conditions_text_len` (`char_length(text) BETWEEN 1 AND 200`; the same 200 cap as `ExtractZ` and the `PATCH /api/deals/{code}/terms` body, 05 section 6.2).

`edit_terms` deletes the deal's condition rows and inserts the new set in the same transaction. This is safe because `edit_terms` is allowed only in `draft` and `terms_agreed`, where no verdict references a condition.

## files

Every uploaded photo, reference or evidence, bytes included.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key; the id in `GET /api/files/{id}?exp=&sig=` |
| deal_id | uuid | no | | FK `deals.id` |
| uploaded_by | uuid | no | | FK `users.id` |
| purpose | file_purpose | no | | `reference` (buyer, at creation) or `evidence` (seller, before submit) |
| mime | text | no | | `image/jpeg`, `image/png` or `image/webp` (decisions B6), sniffed from the bytes by the server, never trusted from the client |
| size_bytes | integer | no | | 1 to 2,097,152 (2 MB), must equal `octet_length(bytes)` |
| sha256 | text | no | | 64 lower-case hex characters, computed by the server. Drives the D8 guardrail and the evidence pack's tamper evidence |
| bytes | bytea | no | | The image, as uploaded after the browser downscale (1600 px long edge, JPEG 0.85). Returned by Prisma as `Uint8Array` (stack.md section 3) |
| created_at | timestamptz | no | `now()` | |

Indexes: `(deal_id, purpose)`. Foreign keys: `deal_id`, `uploaded_by`, RESTRICT.

CHECK constraints: `files_mime_allowed`, `files_size_range`, `files_size_matches_bytes`, `files_sha256_format`.

No unique on `(deal_id, sha256)`: an evidence photo identical to a reference photo must be accepted at upload so the verdict can fail it and consume the fix attempt (decisions D8).

Reference photos are ordered `(created_at, id)`; that order is the `r1..r4` labelling in the verdict prompt, and the `verdict` event payload records the mapping (see `deal_events`).

## evidence

What the seller submitted, one row per photo, tracking number or note, per submission.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key |
| deal_id | uuid | no | | FK `deals.id` |
| submission_no | integer | no | | 1 for the first submission, 2 for the fix |
| kind | evidence_kind | no | | `photo`, `tracking` or `note` |
| position | integer | no | | Photos: 1 to 6 in the order the seller listed them, which is `e{position}` in the prompt. `tracking` and `note`: 0 |
| file_id | uuid | yes | null | FK `files.id`; set only when `kind = 'photo'` |
| value | text | yes | null | Tracking number or note text (1 to 1,000 characters, decisions H3); set only when `kind <> 'photo'` |
| uploaded_by | uuid | no | | FK `users.id`; the seller |
| created_at | timestamptz | no | `now()` | |

Constraints: PK `id`; unique `(deal_id, submission_no, kind, position)`, which also limits each submission to one `tracking` and one `note` row (both have position 0); index `(deal_id, submission_no)`; FKs RESTRICT.

CHECK constraints: `evidence_submission_no_range` (`submission_no IN (1, 2)`), `evidence_kind_shape` (photo rows have `file_id` and no `value` and position 1..6; tracking and note rows have `value` and no `file_id` and position 0), `evidence_value_len`.

All rows of one submission are inserted in the same transaction as the `held -> proof_submitted` transition (decisions C2).

## verdicts

One row per condition per submission, written in their own transaction (Tx V in [02-system-design.md](02-system-design.md) section 5.8) before `decide()` runs and before any PayPal call; the decision transition is a later transaction.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key |
| deal_id | uuid | no | | FK `deals.id` |
| condition_id | uuid | no | | FK `conditions.id` |
| submission_no | integer | no | | 1 or 2; which evidence set was judged |
| result | verdict_result | no | | `pass`, `fail` or `unclear`, lower-cased before insert (decisions D2) |
| confidence | double precision | no | | 0 to 1. `decide()` compares `>= PASS_THRESHOLD`; 0.85 round-trips exactly |
| reason | text | no | | One sentence shown to both parties |
| evidence_used | text[] | no | `'{}'` | The post-processed labels the verdict rests on (`e1`..`e6`, `r1`..`r4`, `tracking`, `note`), after [05-ai-spec.md](05-ai-spec.md) section 4.7 removed ids that were not sent. Empty for `unclear` rows and seeded rows. The UI renders these as chips (08 section 7.5) |
| model | text | no | | For example `claude-sonnet-5-5`; `none` when no model was called |
| prompt_version | text | no | | `judge-v1`, bumped on any prompt change (decisions D10); `guardrail-v1` for D8 rows |
| raw_response | jsonb | no | | The `RawResponse` object from 05 section 2.2 (`request_id`, `model`, `stop_reason`, `stop_category`, `usage`, `latency_ms`, `text`, `output`, `error`; on a timeout, refusal, schema mismatch or missing verdict its `error` field names the failure, D4), or the `HashSkip` object for D8 rows. The same object is stored on every row of the same call |
| created_at | timestamptz | no | `now()` | |

Constraints: PK `id`; unique `(condition_id, submission_no)`; index `(deal_id, submission_no)`; FKs RESTRICT. CHECK: `verdicts_submission_no_range`, `verdicts_confidence_range` (`confidence BETWEEN 0 AND 1`), `verdicts_reason_nonempty`.

Verdict rows for the current `submission_no` may exist while the deal is still `proof_submitted`: Tx V commits before the capture call, so a crash during the call leaves the rows behind. `runVerdict()` checks for rows with the current `submission_no` before calling the model and reuses them; it never re-judges (02 section 5.8, decisions B7). The unique `(condition_id, submission_no)` is therefore safe with `tick`'s re-run, and a double insert fails loudly instead of silently re-judging.

## payments

One row per deal, created by `start_payment`; it carries the PayPal ids the deal never changes.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key |
| deal_id | uuid | no | | FK `deals.id`; unique (one payment per deal) |
| paypal_order_id | text | no | | Unique. From `POST /v2/checkout/orders` with `PayPal-Request-Id` `order-{code}-{n}`; overwritten when `start_payment` creates order `n + 1` (decisions C2, E4) |
| order_attempts | integer | no | 0 | Number of orders created for the deal; `n` in `order-{code}-{n}` is the value after the increment, so the first order is `order-{code}-1` (decisions E4, I3) |
| authorization_id | text | yes | null | Unique. The original authorization id; the only id ever used for capture and void (decisions E3). Set by the `authorization_created` fact |
| authorized_at | timestamptz | yes | null | Set with `authorization_id` |
| auth_expires_at | timestamptz | yes | null | PayPal's `expiration_time` on the authorization (research/paypal.md section 2); the end of the 29-day window |
| capture_id | text | yes | null | Unique. The latest capture resource id; overwritten by a second capture after a decline |
| capture_attempts | integer | no | 0 | Number of `capture_declined` facts applied to this payment; incremented only inside the transaction that applies `fact:capture_declined`, never by a capture call. `n` in `PayPal-Request-Id` `capture-{code}-{n}` equals its current value: the first capture is `capture-{code}-0`, a retry after a timeout, 5xx or crash reuses the same `n` so PayPal returns the existing capture, and only a decline advances it to `capture-{code}-1` (decisions E4, I3) |
| status | payment_status | no | `'created'` | Decisions I3. `captured` and `capture_pending` are the detail behind `deals.status = captured` (decisions C4) |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | Prisma `@updatedAt` |

Constraints: PK `id`; unique `deal_id`, `paypal_order_id`, `authorization_id`, `capture_id`; FK RESTRICT. CHECK: `payments_order_attempts_min` (`>= 0`), `payments_capture_attempts_min` (`>= 0`), `payments_auth_pair` (`authorization_id` and `authorized_at` are null together), `payments_auth_before_status` (`authorization_id IS NOT NULL OR status IN ('created', 'approved')`), `payments_capture_id_with_status` (`capture_id IS NOT NULL OR status NOT IN ('capture_pending', 'captured', 'declined')`).

This row is what makes PayPal facts idempotent (decisions C3): a fact whose target is already recorded (`authorization_id` set, `status` already `captured`, already `voided`) is a no-op.

## payouts

One row per payout attempt; attempt `n + 1` is created by `retry_payout`.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | no | `uuid()` | Primary key |
| deal_id | uuid | no | | FK `deals.id` |
| attempt | integer | no | | 1, 2, ... per deal |
| sender_batch_id | text | no | | Unique. `payout-{code}-{attempt}`; PayPal deduplicates it for 30 days (decisions E4). Also sent as `sender_item_id` so item webhooks map back |
| recipient_email | text | no | | The seller's `paypal_email` at the time of the attempt |
| amount_minor | integer | no | | The captured amount; no platform fee (decisions E7) |
| currency | text | no | `'USD'` | |
| paypal_batch_id | text | yes | null | Unique. `batch_header.payout_batch_id` from the create response; null if the call never returned |
| paypal_item_id | text | yes | null | Unique. `payout_item_id` from `PAYMENT.PAYOUTS-ITEM.*` or `GET /v1/payments/payouts/{batch}` |
| status | payout_status | no | `'pending'` | `success` on `PAYOUTS-ITEM.SUCCEEDED`; `failed` on `FAILED`, `BLOCKED`, `RETURNED`, `UNCLAIMED` (decisions E5) |
| failure_reason | text | yes | null | PayPal's error name, for example `RECEIVER_UNREGISTERED`; required when `status = 'failed'` |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | Prisma `@updatedAt` |

Constraints: PK `id`; unique `(deal_id, attempt)`, `sender_batch_id`, `paypal_batch_id`, `paypal_item_id`; FK RESTRICT. CHECK: `payouts_attempt_min` (`>= 1`), `payouts_amount_positive`, `payouts_currency_usd`, `payouts_failure_reason` (`status <> 'failed' OR failure_reason IS NOT NULL`).

The row is inserted with `status = 'pending'` before the Payouts call, so the attempt number and `sender_batch_id` exist even if the call fails; the response then fills `paypal_batch_id`.

## deal_events

The append-only audit log; one row per transition in decisions C2, including the ones that stay in the same status.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | bigint | no | autoincrement | Primary key (`bigserial`), strict order within and across deals. Serialised as a string in API JSON (stack.md section 3: `JSON.stringify` throws on `bigint`) |
| deal_id | uuid | no | | FK `deals.id` |
| from_status | deal_status | yes | null | Null only for `create` |
| to_status | deal_status | no | | Equal to `from_status` when the step did not change status |
| actor | event_actor | no | | `buyer`, `seller`, `system`, `paypal` or `ai` |
| cause | text | no | | One of the values in the table below |
| payload | jsonb | no | | An object with the ids needed to explain the step (decisions C6) |
| created_at | timestamptz | no | `now()` | |

Constraints: PK `id`; index `(deal_id, id)`; FK RESTRICT; CHECK `deal_events_cause_nonempty`, `deal_events_payload_object` (`jsonb_typeof(payload) = 'object'`). Trigger `deal_events_no_update_delete` raises on any UPDATE or DELETE (SQL in the `constraints` migration).

Every row is written in the same transaction as the change it records. Every accepted command and every applied fact writes exactly one row, including those that leave `status` unchanged. File uploads write no event. A no-op second arrival of a PayPal fact (decisions C3) writes no row. A rejected transition (`invalid_state`) writes no row. The `verdict` row is written in Tx V; the `decision:*` row is written in the later decision transaction (02 section 5.8).

Cause vocabulary, copied verbatim from decisions C6. `cause` is exactly one of these strings and nothing else. `payload` always contains at least the keys listed. Every `fact:*` payload also carries `source` (`"api"` or `"webhook"`) and either `paypal_request_id` (source `api`) or `paypal_event_id` (source `webhook`), which is how the evidence pack joins `webhook_events`; tests detect which source won a race by `payload.source`, never by `cause`. The dashboard reads the decision from the `decision:` prefix and the buyer's choice from the `review:` prefix.

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

The `verdict` payload additionally carries `labels`, an object mapping `r1..r4` and `e1..e6` to `files.id` exactly as sent to the model, so a verdict's `evidence_used` can be resolved to files later. The `from_status` and `to_status` of each cause follow the decisions C2 table.

## webhook_events

Every PayPal delivery, keyed by PayPal's event id, which makes processing idempotent (decisions E6).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| paypal_event_id | text | no | | Primary key; `id` of the event body (`WH-...`) |
| event_type | text | no | | As sent, for example `PAYMENT.CAPTURE.COMPLETED` |
| verified | boolean | no | | Signature check result. `false` rows are stored, never processed, and answered `400` |
| processed_at | timestamptz | yes | null | Null until the handler's transaction commits. A row that exists with null `processed_at` is processed again on redelivery |
| body | jsonb | no | | The full event as received |
| last_error | text | yes | null | Message of the last processing failure (the receiver answered `500` so PayPal retries) |
| created_at | timestamptz | no | `now()` | Time of first receipt |

Constraints: PK `paypal_event_id`; CHECK `webhook_events_processed_only_if_verified` (`processed_at IS NULL OR verified`). No foreign key to `deals`: the deal is resolved from `resource.custom_id` or `resource.payout_item.sender_item_id` at processing time, and the link is recorded in the `deal_events.payload.paypal_event_id`.

## Migration `constraints`: CHECK constraints and the append-only trigger

This is the second migration, hand-written with `npx prisma migrate dev --create-only --name constraints` and applied with `npx prisma migrate dev`. Prisma does not model CHECK constraints, functions or triggers, so later generated migrations never touch them (stack.md section 3).

```sql
-- prisma/migrations/<timestamp>_constraints/migration.sql

-- users
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lower" CHECK ("email" = lower(btrim("email")) AND position('@' in "email") > 1);

-- deals
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_public_code_format"
    CHECK ("public_code" ~ '^HS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  ADD CONSTRAINT "deals_currency_usd" CHECK ("currency" = 'USD'),
  ADD CONSTRAINT "deals_amount_range"
    CHECK ("amount_minor" IS NULL OR "amount_minor" BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "deals_deadline_days_range"
    CHECK ("deadline_days" IS NULL OR "deadline_days" BETWEEN 1 AND 21),
  ADD CONSTRAINT "deals_terms_version_min" CHECK ("terms_version" >= 1),
  ADD CONSTRAINT "deals_buyer_accepted_range"
    CHECK ("buyer_accepted_version" IS NULL OR "buyer_accepted_version" BETWEEN 1 AND "terms_version"),
  ADD CONSTRAINT "deals_seller_accepted_range"
    CHECK ("seller_accepted_version" IS NULL OR "seller_accepted_version" BETWEEN 1 AND "terms_version"),
  ADD CONSTRAINT "deals_fix_attempts_range" CHECK ("fix_attempts_used" IN (0, 1)),
  ADD CONSTRAINT "deals_source_text_len" CHECK (char_length("source_text") BETWEEN 1 AND 500),
  ADD CONSTRAINT "deals_item_title_len" CHECK (char_length("item_title") BETWEEN 1 AND 80),
  ADD CONSTRAINT "deals_parties_differ" CHECK ("seller_id" IS NULL OR "seller_id" <> "buyer_id"),
  ADD CONSTRAINT "deals_complete_after_draft" CHECK (
    "status" IN ('draft', 'voided')
    OR ("seller_id" IS NOT NULL AND "amount_minor" IS NOT NULL AND "deadline_days" IS NOT NULL)),
  ADD CONSTRAINT "deals_deadline_at_after_held" CHECK (
    "status" IN ('draft', 'terms_agreed', 'voided') OR "deadline_at" IS NOT NULL);

-- conditions
ALTER TABLE "conditions"
  ADD CONSTRAINT "conditions_position_range" CHECK ("position" BETWEEN 1 AND 5),
  ADD CONSTRAINT "conditions_text_len" CHECK (char_length("text") BETWEEN 1 AND 200);

-- files
ALTER TABLE "files"
  ADD CONSTRAINT "files_mime_allowed" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "files_size_range" CHECK ("size_bytes" BETWEEN 1 AND 2097152),
  ADD CONSTRAINT "files_size_matches_bytes" CHECK ("size_bytes" = octet_length("bytes")),
  ADD CONSTRAINT "files_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- evidence
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_submission_no_range" CHECK ("submission_no" IN (1, 2)),
  ADD CONSTRAINT "evidence_kind_shape" CHECK (
    ("kind" = 'photo' AND "file_id" IS NOT NULL AND "value" IS NULL AND "position" BETWEEN 1 AND 6)
    OR ("kind" IN ('tracking', 'note') AND "file_id" IS NULL AND "value" IS NOT NULL AND "position" = 0)),
  ADD CONSTRAINT "evidence_value_len" CHECK ("value" IS NULL OR char_length("value") BETWEEN 1 AND 1000);

-- verdicts
ALTER TABLE "verdicts"
  ADD CONSTRAINT "verdicts_submission_no_range" CHECK ("submission_no" IN (1, 2)),
  ADD CONSTRAINT "verdicts_confidence_range" CHECK ("confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "verdicts_reason_nonempty" CHECK (char_length("reason") >= 1);

-- payments
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_order_attempts_min" CHECK ("order_attempts" >= 0),
  ADD CONSTRAINT "payments_capture_attempts_min" CHECK ("capture_attempts" >= 0),
  ADD CONSTRAINT "payments_auth_pair" CHECK (("authorization_id" IS NULL) = ("authorized_at" IS NULL)),
  ADD CONSTRAINT "payments_auth_before_status"
    CHECK ("authorization_id" IS NOT NULL OR "status" IN ('created', 'approved')),
  ADD CONSTRAINT "payments_capture_id_with_status"
    CHECK ("capture_id" IS NOT NULL OR "status" NOT IN ('capture_pending', 'captured', 'declined'));

-- payouts
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_attempt_min" CHECK ("attempt" >= 1),
  ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "payouts_currency_usd" CHECK ("currency" = 'USD'),
  ADD CONSTRAINT "payouts_failure_reason" CHECK ("status" <> 'failed' OR "failure_reason" IS NOT NULL);

-- deal_events: shape checks and the append-only rule
ALTER TABLE "deal_events"
  ADD CONSTRAINT "deal_events_cause_nonempty" CHECK (char_length("cause") >= 1),
  ADD CONSTRAINT "deal_events_payload_object" CHECK (jsonb_typeof("payload") = 'object');

CREATE FUNCTION deal_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'deal_events is append-only (% rejected)', TG_OP;
END
$$;

CREATE TRIGGER deal_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "deal_events"
  FOR EACH ROW EXECUTE FUNCTION deal_events_append_only();

-- webhook_events
ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_processed_only_if_verified" CHECK ("processed_at" IS NULL OR "verified");
```

The trigger is row-level, so `TRUNCATE` still works for test resets (stack.md section 3 cites the Postgres TRUNCATE docs). `REVOKE` would not help because the Render app user owns the tables.

## Migration `sealed_columns`: contract data sealed at rest (trust spec §5)

`deals.source_text`, `deals.item_title`, `conditions.text`, `evidence.value`, `files.bytes`, `verdicts.reason` and `verdicts.raw_response` hold sealed values (`lib/deal/sealed.ts`), as do the `source_text`, `note`, `tracking_number` and `item_title` keys of `deal_events.payload`. The migration drops `deals_source_text_len`, `deals_item_title_len`, `conditions_text_len`, `evidence_value_len` and `files_size_matches_bytes` (a ciphertext is longer than its plaintext; the app enforces the same limits before sealing, and `size_bytes` stays the plaintext size) and adds `NOT VALID` checks that every new value is sealed: `enc1.` strings, bytes starting `E1`, `{ "sealed": "enc1…" }` JSON. `npm run reseal` (`scripts/reseal.ts`) re-seals the mutable columns with the active key; `deal_events` is append-only, so event payloads keep the key they were written with and that kid must stay in `DATA_KEYS` while such events exist.

## prisma/schema.prisma

Complete file. Prisma 7.10.0 syntax from stack.md section 3: the `prisma-client` generator with a required `output`, no `url` in the datasource (it lives in `prisma.config.ts`), and the `@prisma/adapter-pg` driver adapter passed at `new PrismaClient({ adapter })`.

```prisma
// prisma/schema.prisma
// Prisma 7.10.0. The database URL is set in prisma.config.ts, not here.
// Field names are the Postgres column names verbatim (snake_case); models and enums
// are PascalCase and @@map to snake_case tables and types.

generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// ---------- enums (values spelled as in docs/decisions.md) ----------

enum DealStatus {
  draft
  terms_agreed
  held
  proof_submitted
  in_review
  captured
  paid
  voided

  @@map("deal_status")
}

enum EvidenceType {
  photo
  tracking

  @@map("evidence_type")
}

enum FilePurpose {
  reference
  evidence

  @@map("file_purpose")
}

enum EvidenceKind {
  photo
  tracking
  note

  @@map("evidence_kind")
}

enum VerdictResult {
  pass
  fail
  unclear

  @@map("verdict_result")
}

enum PaymentStatus {
  created
  approved
  authorized
  capture_pending
  captured
  declined
  voided

  @@map("payment_status")
}

enum PayoutStatus {
  pending
  success
  failed

  @@map("payout_status")
}

enum EventActor {
  buyer
  seller
  system
  paypal
  ai

  @@map("event_actor")
}

// ---------- models ----------

model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique
  display_name String?
  paypal_email String?
  created_at   DateTime @default(now()) @db.Timestamptz(6)
  updated_at   DateTime @updatedAt @db.Timestamptz(6)

  deals_as_buyer  Deal[]     @relation("DealBuyer")
  deals_as_seller Deal[]     @relation("DealSeller")
  files           File[]
  evidence        Evidence[]

  @@map("users")
}

model Deal {
  id                      String     @id @default(uuid()) @db.Uuid
  public_code             String     @unique
  buyer_id                String     @db.Uuid
  seller_id               String?    @db.Uuid
  source_text             String
  item_title              String
  amount_minor            Int?
  currency                String     @default("USD")
  deadline_days           Int?
  deadline_at             DateTime?  @db.Timestamptz(6)
  status                  DealStatus @default(draft)
  terms_version           Int        @default(1)
  buyer_accepted_version  Int?
  seller_accepted_version Int?
  fix_attempts_used       Int        @default(0)
  seeded                  Boolean    @default(false)
  created_at              DateTime   @default(now()) @db.Timestamptz(6)
  updated_at              DateTime   @updatedAt @db.Timestamptz(6)

  buyer      User        @relation("DealBuyer", fields: [buyer_id], references: [id], onDelete: Restrict)
  seller     User?       @relation("DealSeller", fields: [seller_id], references: [id], onDelete: Restrict)
  conditions Condition[]
  files      File[]
  evidence   Evidence[]
  verdicts   Verdict[]
  payment    Payment?
  payouts    Payout[]
  events     DealEvent[]

  @@index([buyer_id, status])
  @@index([seller_id, status])
  @@index([status, deadline_at])
  @@index([status, updated_at])
  @@map("deals")
}

model Condition {
  id            String       @id @default(uuid()) @db.Uuid
  deal_id       String       @db.Uuid
  position      Int
  text          String
  evidence_type EvidenceType
  created_at    DateTime     @default(now()) @db.Timestamptz(6)

  deal     Deal      @relation(fields: [deal_id], references: [id], onDelete: Restrict)
  verdicts Verdict[]

  @@unique([deal_id, position])
  @@map("conditions")
}

model File {
  id          String      @id @default(uuid()) @db.Uuid
  deal_id     String      @db.Uuid
  uploaded_by String      @db.Uuid
  purpose     FilePurpose
  mime        String
  size_bytes  Int
  sha256      String
  bytes       Bytes
  created_at  DateTime    @default(now()) @db.Timestamptz(6)

  deal     Deal       @relation(fields: [deal_id], references: [id], onDelete: Restrict)
  uploader User       @relation(fields: [uploaded_by], references: [id], onDelete: Restrict)
  evidence Evidence[]

  @@index([deal_id, purpose])
  @@map("files")
}

model Evidence {
  id            String       @id @default(uuid()) @db.Uuid
  deal_id       String       @db.Uuid
  submission_no Int
  kind          EvidenceKind
  position      Int
  file_id       String?      @db.Uuid
  value         String?
  uploaded_by   String       @db.Uuid
  created_at    DateTime     @default(now()) @db.Timestamptz(6)

  deal     Deal  @relation(fields: [deal_id], references: [id], onDelete: Restrict)
  file     File? @relation(fields: [file_id], references: [id], onDelete: Restrict)
  uploader User  @relation(fields: [uploaded_by], references: [id], onDelete: Restrict)

  @@unique([deal_id, submission_no, kind, position])
  @@index([deal_id, submission_no])
  @@map("evidence")
}

model Verdict {
  id             String        @id @default(uuid()) @db.Uuid
  deal_id        String        @db.Uuid
  condition_id   String        @db.Uuid
  submission_no  Int
  result         VerdictResult
  confidence     Float
  reason         String
  evidence_used  String[]      @default([])
  model          String
  prompt_version String
  raw_response   Json
  created_at     DateTime      @default(now()) @db.Timestamptz(6)

  deal      Deal      @relation(fields: [deal_id], references: [id], onDelete: Restrict)
  condition Condition @relation(fields: [condition_id], references: [id], onDelete: Restrict)

  @@unique([condition_id, submission_no])
  @@index([deal_id, submission_no])
  @@map("verdicts")
}

model Payment {
  id               String        @id @default(uuid()) @db.Uuid
  deal_id          String        @unique @db.Uuid
  paypal_order_id  String        @unique
  order_attempts   Int           @default(0)
  authorization_id String?       @unique
  authorized_at    DateTime?     @db.Timestamptz(6)
  auth_expires_at  DateTime?     @db.Timestamptz(6)
  capture_id       String?       @unique
  capture_attempts Int           @default(0)
  status           PaymentStatus @default(created)
  created_at       DateTime      @default(now()) @db.Timestamptz(6)
  updated_at       DateTime      @updatedAt @db.Timestamptz(6)

  deal Deal @relation(fields: [deal_id], references: [id], onDelete: Restrict)

  @@map("payments")
}

model Payout {
  id              String       @id @default(uuid()) @db.Uuid
  deal_id         String       @db.Uuid
  attempt         Int
  sender_batch_id String       @unique
  recipient_email String
  amount_minor    Int
  currency        String       @default("USD")
  paypal_batch_id String?      @unique
  paypal_item_id  String?      @unique
  status          PayoutStatus @default(pending)
  failure_reason  String?
  created_at      DateTime     @default(now()) @db.Timestamptz(6)
  updated_at      DateTime     @updatedAt @db.Timestamptz(6)

  deal Deal @relation(fields: [deal_id], references: [id], onDelete: Restrict)

  @@unique([deal_id, attempt])
  @@map("payouts")
}

model DealEvent {
  id          BigInt      @id @default(autoincrement())
  deal_id     String      @db.Uuid
  from_status DealStatus?
  to_status   DealStatus
  actor       EventActor
  cause       String
  payload     Json
  created_at  DateTime    @default(now()) @db.Timestamptz(6)

  deal Deal @relation(fields: [deal_id], references: [id], onDelete: Restrict)

  @@index([deal_id, id])
  @@map("deal_events")
}

model WebhookEvent {
  paypal_event_id String    @id
  event_type      String
  verified        Boolean
  processed_at    DateTime? @db.Timestamptz(6)
  body            Json
  last_error      String?
  created_at      DateTime  @default(now()) @db.Timestamptz(6)

  @@map("webhook_events")
}
```

Type mapping (stack.md section 3, "schema ref"): `Bytes` is `bytea` and returns `Uint8Array`; `Json` is `jsonb`; `BigInt @default(autoincrement())` is `bigserial` and returns a JS `bigint`; `Float` is `double precision`; `String[]` is `text[]`.

Config and client, from stack.md section 3 with the global `omit` added. The config file is the one in [dependencies.md](dependencies.md): no `dotenv` is installed; Node 24's `process.loadEnvFile()` reads `.env` when it exists and is skipped on Render and in CI, where env vars are injected (UNVERIFIED: see dependencies.md "Not installed, on purpose" for the day-1 check and the `dotenv` fallback).

```ts
// prisma.config.ts  (Prisma 7: https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
import { defineConfig } from "prisma/config";
try { process.loadEnvFile(); } catch {}            // .env is optional; Render and CI inject env vars. UNVERIFIED: dependencies.md "Not installed, on purpose"
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL },    // not env(): env() throws when unset and breaks `prisma generate`
});
```

```ts
// lib/db.ts
import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  g.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, connectionTimeoutMillis: 5000 }),
    omit: { file: { bytes: true } }, // photo bytes are never selected by default
  });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma; // one client across hot reloads
```

The two places that need bytes select them explicitly: `GET /api/files/{id}` with `prisma.file.findUnique({ where: { id }, select: { mime: true, bytes: true } })`, and the verdict job, which loads the deal's reference files and the submission's evidence photos the same way.

`generated/` at the repo root is git-ignored and ESLint-ignored; `@/generated/prisma/client` resolves through `paths: { "@/*": ["./*"] }` in `tsconfig.json` (dependencies.md, 02 section 4). `prisma generate` does not run on install or on `migrate dev` in v7, so `package.json` has `"postinstall": "prisma generate"` and `"build": "prisma generate && next build"`.

## Migration workflow

Two migrations exist at launch: `init` (generated from the schema) and `constraints` (hand-written, above). Every later change is a new migration created locally and applied on Render by `prisma migrate deploy`.

| Step | Command | Where |
| --- | --- | --- |
| Start Postgres 18 | `docker compose up -d db` (compose file in [07-setup-deployment.md](07-setup-deployment.md)) | local |
| Create the first migration | `npx prisma migrate dev --name init` | local; writes `prisma/migrations/<ts>_init/migration.sql` and applies it |
| Add constraints and trigger | `npx prisma migrate dev --create-only --name constraints`, paste the SQL above into the generated file, then `npx prisma migrate dev` | local |
| Regenerate the client | `npx prisma generate` after any schema change (not automatic in v7) | local and CI |
| Later schema changes | edit `schema.prisma`, `npx prisma migrate dev --name <change>`; hand-edit with `--create-only` when a CHECK or trigger changes | local |
| Reset a dev database | `npx prisma migrate reset`, then `npm run seed` | local only |
| Apply in CI | `npx prisma migrate deploy` against the `postgres:18-alpine` service, before unit, integration and Playwright tests (stack.md section 10) | CI |
| Apply on Render | `preDeployCommand: npx prisma migrate deploy && npm run seed` (decisions J2), on the paid web service; runs on a separate instance after build and before start, and a failure aborts the deploy while the old build keeps serving (stack.md section 5g) | Render |
| Seed on Render | Before each deploy, as the second half of `preDeployCommand` (`render.yaml`; 07 section 3.4 step 6). It is idempotent: personas upserted, the historical deals written once. A change to `DEMO_SELLER_PAYPAL_EMAIL` reaches the seller persona at the next deploy or the next persona sign-in | Render |

Rules that follow from zero-downtime deploys (stack.md section 5g): migrations must stay backward compatible with the previous running build (add columns as nullable or with defaults, never rename in one step), and no migration is deployed during judging, 2026-12-01 to 2026-12-15.

Test databases: `handshake_test` on the same local container (created once with `docker compose exec db createdb -U postgres handshake_test`). Vitest `globalSetup` runs `prisma migrate deploy` against `TEST_DATABASE_URL`; `beforeEach` runs

```sql
TRUNCATE TABLE "webhook_events", "deal_events", "payouts", "payments", "verdicts",
  "evidence", "files", "conditions", "deals", "users" RESTART IDENTITY CASCADE;
```

via `$executeRawUnsafe`, and integration files run serially (`--no-file-parallelism`). `_prisma_migrations` is Prisma's own table and is never truncated.

## Seed

`npm run seed` (`tsx prisma/seed.ts`) writes the two demo users and about 25 historical deals, and is safe to run any number of times.

Rules:

- The two users are always upserted by `email`: `demo-buyer@handshake.demo` (display name "Demo Buyer") and `demo-seller@handshake.demo` (display name "Demo Seller", `paypal_email` from `DEMO_SELLER_PAYPAL_EMAIL`, null when the variable is unset). Upserting on every run means a changed env var reaches the seller's payout address at the next deploy, because `preDeployCommand` runs the seed (decisions J2), or at the next seller persona sign-in (`signInDemoPersona`).
- The historical deals are written only when no `deals.seeded = true` row exists. Re-seeding is therefore `prisma migrate reset` locally; on Render the first pre-deploy seed writes the deals (07 section 3.4 step 6) and later seeds leave them alone.
- Every historical deal has `seeded = true`, `buyer_id` = demo buyer, `seller_id` = demo seller (null on two drafts), a `public_code` from `generatePublicCode()` in `lib/deal/code.ts` (regenerated on collision), 2 to 4 `conditions` rows (the code condition last whenever a photo condition exists), and a `deal_events` row for every step of its path with `created_at` values spread over the 60 days before the seed runs. `updated_at` equals the last event's time. Every `cause` is one of the decisions C6 strings.
- Deals that reached a verdict also get `verdicts` rows (one per condition per judged submission) with `model = "seed"`, `prompt_version = "judge-v1"`, `evidence_used = []`, `raw_response = { "seeded": true }`, confidences that match the decision (all `>= 0.85` for `capture`, one `unclear` or one `< 0.85` for `buyer_review`, one `fail` for `request_fix` and `void`).
- No `files`, `evidence`, `payments`, `payouts` or `webhook_events` rows: there are no PayPal objects and no photos (decisions F6). Event payloads for `fact:*` causes carry `{ "seeded": true }` and no PayPal ids, no `source` and no `paypal_request_id` or `paypal_event_id`. The deal page must render a deal with no payment row and no evidence rows.
- No seeded deal is ever in `proof_submitted`, and `tick` ignores `seeded = true` rows, so the historical set does not drift during judging.
- Amounts range from 1,500 to 45,000 minor units so that some deals exceed `AUTO_CAPTURE_MAX_MINOR` (20,000) and show the buyer-review path; `deadline_days` ranges from 3 to 14; item titles are household items (jacket, lamp, headphones, bicycle, camera lens, board game, and so on).

Distribution of the 25 deals:

| Status | Count | Event path (causes, in order) |
| --- | --- | --- |
| draft | 3 | `create`; one of them also `join`; one of those also `accept` (buyer only). Two have `seller_id` null |
| terms_agreed | 2 | `create`, `join`, `accept`, `accept` |
| held | 4 | ... `start_payment`, `fact:authorization_created`; `deadline_at` set |
| in_review | 2 | ... `submit_evidence`, `verdict`, `decision:buyer_review`: one because `amount_minor > 20000`, one because of an `unclear` verdict |
| captured | 2 | ... `decision:capture`, `fact:capture_completed` (payload `payout` present), `fact:payout_failed` (`RECEIVER_UNREGISTERED`) |
| paid | 8 | 6 via `decision:capture`; 2 via `decision:buyer_review` then `review:approve`. Two of the 8 include a fix round: `decision:request_fix`, second `submit_evidence`, `verdict`, `decision:capture`. All end `fact:capture_completed` (payload `payout` present), `fact:payout_succeeded` |
| voided | 4 | one `cancel` from terms_agreed; one `tick:deadline` from held; one `decision:void` after a used fix; one `review:reject` |

Skeleton:

```ts
// prisma/seed.ts  (run: npm run seed)
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { generatePublicCode } from '../lib/deal/code';
import { HISTORICAL_DEALS } from './seed-data'; // the 25 fixed specs described above

try { process.loadEnvFile(); } catch {} // .env is optional; Render and CI inject env vars. UNVERIFIED: dependencies.md "Not installed, on purpose"
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const buyer = await prisma.user.upsert({
    where: { email: 'demo-buyer@handshake.demo' },
    update: { display_name: 'Demo Buyer' },
    create: { email: 'demo-buyer@handshake.demo', display_name: 'Demo Buyer' },
  });
  const paypal_email = process.env.DEMO_SELLER_PAYPAL_EMAIL ?? null;
  const seller = await prisma.user.upsert({
    where: { email: 'demo-seller@handshake.demo' },
    update: { display_name: 'Demo Seller', paypal_email },
    create: { email: 'demo-seller@handshake.demo', display_name: 'Demo Seller', paypal_email },
  });

  if (await prisma.deal.count({ where: { seeded: true } })) {
    console.log('seed: historical deals already present, skipping');
    return;
  }

  for (const spec of HISTORICAL_DEALS) {
    await prisma.$transaction(async (tx) => {
      let public_code = generatePublicCode();
      while (await tx.deal.findUnique({ where: { public_code } })) public_code = generatePublicCode();
      const deal = await tx.deal.create({
        data: {
          public_code, seeded: true,
          buyer_id: buyer.id, seller_id: spec.joined ? seller.id : null,
          status: spec.status, source_text: spec.source_text, item_title: spec.item_title,
          amount_minor: spec.amount_minor, deadline_days: spec.deadline_days, deadline_at: spec.deadline_at,
          terms_version: spec.terms_version, buyer_accepted_version: spec.buyer_accepted_version,
          seller_accepted_version: spec.seller_accepted_version, fix_attempts_used: spec.fix_attempts_used,
          created_at: spec.created_at, updated_at: spec.events.at(-1)!.created_at,
          conditions: { create: spec.conditions }, // [{ position, text, evidence_type }]
        },
        include: { conditions: true },
      });
      await tx.dealEvent.createMany({
        data: spec.events.map((e) => ({ deal_id: deal.id, ...e, payload: { seeded: true, ...e.payload } })),
      });
      if (spec.verdicts) {
        await tx.verdict.createMany({
          data: spec.verdicts.map((v) => ({
            deal_id: deal.id, condition_id: deal.conditions.find((c) => c.position === v.position)!.id,
            submission_no: v.submission_no, result: v.result, confidence: v.confidence, reason: v.reason,
            evidence_used: [], model: 'seed', prompt_version: 'judge-v1', raw_response: { seeded: true }, created_at: v.created_at,
          })),
        });
      }
    });
  }
  console.log(`seed: wrote ${HISTORICAL_DEALS.length} historical deals`);
}

main().finally(() => prisma.$disconnect());
```

Idempotency check for the seed itself: run `npm run seed` twice; the second run prints the skip line and `SELECT count(*) FROM deals WHERE seeded` is unchanged.

## Evidence pack assembly

`getEvidencePack(code, actor, deps)` builds the JSON pack from eight reads; nothing in it is computed from anything outside these tables (NFR-9).

1. `deals` by `public_code`, including `buyer` and `seller` (`id`, `email`, `display_name`). Unknown code throws `deal_not_found`; an actor who is neither buyer nor seller throws `not_a_party`.
2. `conditions` for the deal, ordered by `position`.
3. `files` for the deal with `bytes` omitted, ordered by `(created_at, id)`: `id`, `purpose`, `mime`, `size_bytes`, `sha256`, `uploaded_by`, `created_at`, plus a signed URL from `GET /api/files/{id}?exp=&sig=` valid for 10 minutes (decisions B6). The `sha256` values are the tamper evidence: anyone holding the photo can recompute them.
4. `evidence` for the deal, ordered by `(submission_no, position)`; photo rows point at step 3 by `file_id`.
5. `verdicts` for the deal, ordered by `submission_no` then the condition's `position`, with `result`, `confidence`, `reason`, `evidence_used`, `model`, `prompt_version` and `raw_response`.
6. `payments` by `deal_id` (null for deals that never reached `start_payment`) and `payouts` ordered by `attempt`. Ids and statuses only; no secrets exist in these rows.
7. `deal_events` for the deal ordered by `id`, every column, `id` as a string.
8. `webhook_events` whose `paypal_event_id` appears in any event payload from step 7: `paypal_event_id`, `event_type`, `verified`, `processed_at`, `created_at`. The `body` is left out; it is reachable in the database if a dispute ever needs it.

The JSON shape and the download filename are fixed in [04-api-spec.md](04-api-spec.md) section 10.2 (`GET /api/deals/{code}/evidence-pack`), not here; that shape must contain only columns named in this document, and the rows from step 8 are its `webhook_events` section (`paypal_event_id`, `event_type`, `verified`, `processed_at`, `created_at`). No transaction is needed: every row read here is either write-once or carries its own `updated_at`. The same reads, minus steps 3 and 8, back `GET /api/deals/{code}`.

## Storage sizing for photos in bytea

At demo scale the 5 GB Render disk holds roughly 800 fully-loaded deals; photos are the only thing that grows.

Facts from stack.md section 4 ("Postgres bytea for ~1 MB photos"): a single `bytea` value may be up to 1 GB; a row over about 2 kB is TOASTed, meaning the value is compressed, then stored out-of-line in about 2,000-byte chunks, and read only when the column is selected. JPEG does not compress, so the pglz attempt is wasted CPU; `ALTER TABLE "files" ALTER COLUMN "bytes" SET STORAGE EXTERNAL` would skip it and is not applied because at our volume it makes no measurable difference. node-postgres moves `bytea` as hex text, about 2x on the wire; stack.md marks this UNVERIFIED for the adapter-pg path and irrelevant at our scale.

| Quantity | Value | Basis |
| --- | --- | --- |
| One photo after the browser downscale | about 600 KB planning figure; 2,097,152 bytes hard cap | 1600 px long edge, JPEG 0.85 (decisions B6); stack.md uses ~600 KB |
| Files per deal | typical 5 (2 reference + 3 evidence); maximum 16 (4 reference + 6 + 6 across two submissions) | decisions H3 |
| Bytes per deal | typical about 3 MB; planning 6 MB (10 photos); worst case 32 MB | stack.md: "10 photos per deal at ~600 KB is about 6 MB" |
| Live deals through 2026-12-15 | about 150 (development, three outside testers, judges creating deals on demand) | decisions A2, A5 |
| Database size at that scale | about 0.5 GB typical, about 1 GB at the planning figure, plus WAL and indexes | computed |
| Disk | `diskSizeGB: 5`, $1.50/mo, cannot shrink | decisions J2; stack.md section 4 |
| Capacity at 6 MB per deal | about 800 deals | 5 GB / 6 MB |
| Outbound bandwidth | 5 GB/month included, then $0.15/GB; a deal page view fetches at most 10 photos (about 6 MB), so about 800 page views per month fit | stack.md section 4; `Cache-Control: private, max-age=600` on `GET /api/files/{id}` keeps repeat views off the wire |

Seeded deals store no photos, so the seed costs nothing here. The global `omit` on `files.bytes` is what keeps list and deal-page queries at a few kilobytes: with TOAST, out-of-line values are only read when selected.

## Changes from the brief

Every departure from [brief/03-database-schema.md](brief/03-database-schema.md), with the decision that caused it.

| Brief | Now | Why |
| --- | --- | --- |
| `disputes` table | dropped | Disputes cut (decisions A5); `CUSTOMER.DISPUTE.CREATED` is not subscribed |
| `deals.status` value `disputed` | dropped | Same |
| `conditions.reference_file_ids uuid[]` | dropped | Every reference photo is compared against every photo condition (decisions I2); `files.purpose = 'reference'` identifies them |
| `conditions.evidence_type` values `file`, `link` | dropped | FR-17 cut; only `photo` and `tracking` (decisions D6) |
| `evidence.storage_key` | replaced by `evidence.file_id` -> `files` | Photos live in Postgres (`files.bytes`), not object storage (decisions B6, I2) |
| `evidence.sha256` | moved to `files.sha256` | The hash belongs to the file; the D8 guardrail compares files |
| `evidence.kind` value `link` | dropped | FR-17 cut |
| `evidence` without an ordering column | `evidence.position` added | Gives `e{n}` a stable meaning and lets one unique constraint cap tracking and note at one row each |
| `payments.honor_expires_at` | dropped | No reauthorize job (decisions B7, I3) |
| `payments.authorization_id` "replaced on every reauthorization" | the original id, never replaced | Decisions E3 |
| `payments.status` values `failed` | replaced by `capture_pending` and `declined` | Decisions I3; `PAYMENT.CAPTURE.DECLINED` is the v2 failure event (E5) |
| `payments` without attempt counters | `payments.order_attempts` and `payments.capture_attempts` added | `order-{code}-{n}` and `capture-{code}-{n}` need `n` (decisions E4, I3) |
| `payouts` columns | `sender_batch_id`, `attempt`, `failure_reason`, `paypal_item_id` added | Decisions I3, E5, E7 |
| `verdicts` without the cited evidence | `verdicts.evidence_used text[]` added | The UI renders "Evidence used" chips from it (08 section 7.5) and the API's `Verdict` type carries it; rebuilding it from `raw_response` is impossible for D8 and seeded rows |
| `deal_events.cause` flat names | the prefixed vocabulary of decisions C6 | The dashboard and timeline tell a decision, a buyer review and a PayPal fact apart by prefix alone |
| `verdicts.confidence numeric(3,2)` | `double precision` | Prisma `Decimal` returns a decimal.js object that needs conversion everywhere; a double round-trips 0.85 exactly for the `decide()` comparison |
| `deals` without `deadline_days`, `seeded`, `updated_at` | added | Decisions I3, F6 |
| `deals.amount_minor`, `deadline_days` not null | nullable while `draft` | Extraction may return null and the UI asks afterwards (decisions D6); a CHECK forces both before `terms_agreed` |
| `webhook_events` without receipt time or error | `created_at`, `last_error` added | Debugging PayPal's up-to-25 retries without them is guesswork |
| Append-only "never update or delete" as a rule | enforced by a Postgres trigger | stack.md section 3 |
| No `files` table | `files` added | Decisions I2 |

## Assumptions

Choices not fixed by decisions.md, taken here because the schema needs them.

1. There is no `src/` directory; `app/`, `lib/` and `generated/` sit at the repo root and `@/*` maps to the repo root (dependencies.md, 02 section 4, 07 section 1). The generated client is `generated/prisma` (git-ignored), the client singleton is `lib/db.ts`, and `generatePublicCode()` lives in `lib/deal/code.ts` and is imported by the seed as `../lib/deal/code`.
2. Prisma field names are the snake_case column names with no `@map`; models are PascalCase mapped to snake_case tables; enums are `@@map`ped to snake_case Postgres type names.
3. `deals.amount_minor` and `deals.deadline_days` are nullable only while `draft`. The module rejects `accept` with `invalid_input` while either is null, so the CHECK `deals_complete_after_draft` can never fail at `terms_agreed`.
4. `edit_terms` replaces the deal's `conditions` rows wholesale and re-appends the server-generated code condition last.
5. `evidence.position` is 1 to 6 for photos in the seller's submitted order and 0 for the single `tracking` and single `note` row.
6. `verdicts` rows written without a model call use `model = "none"`, `prompt_version = "guardrail-v1"` and the `HashSkip` object as `raw_response` (D8); failure rows keep the configured model with `prompt_version = "judge-v1"` and the `RawResponse` object whose `error` field names the failure (D4, 05 section 2.2). `verdicts.evidence_used` holds the post-processed labels from 05 section 4.7; D8 rows list the matching evidence and reference labels, `unclear` failure rows and seeded rows hold `[]`.
7. `payments.capture_attempts` counts applied `capture_declined` facts and is incremented only in the transaction that applies `fact:capture_declined`; `n` in `capture-{code}-{n}` is its value at call time, so the first capture is `capture-{code}-0`, a retry after a timeout, 5xx or crash reuses it, and the capture after one decline is `capture-{code}-1`. `payments.order_attempts` counts orders created and is incremented in the transaction that records the new `paypal_order_id`, so the first order is `order-{code}-1`.
8. `payouts.sender_batch_id` is also sent as the Payouts item's `sender_item_id`, so an item webhook maps to the row by either `payout_batch_id` or `sender_item_id`. The row is inserted as `pending` before the Payouts call.
9. `deal_events.cause` is text with the decisions C6 vocabulary copied verbatim in this document; `actor` is `ai` for `verdict` and `system` for `decision:*`, so the audit log shows that code, not the model, moved money. The `verdict` payload carries the extra key `labels` on top of the C6 minimum.
10. `tick` ignores `seeded = true` rows, selects deadline work with `status IN ('held', 'in_review') AND deadline_at < now()` and stuck verdicts with `status = 'proof_submitted' AND updated_at < now() - interval '2 minutes'`.
11. `webhook_events.last_error` stores the processing failure message; there is no foreign key from `webhook_events` to `deals`.
12. `users.email` is lower-cased and trimmed by the app before insert; the CHECK makes a forgotten lower-case an error, not a duplicate account.
13. `confidence` is `double precision`, not `numeric(3,2)`.
14. The seed is the second half of `preDeployCommand`, `npx prisma migrate deploy && npm run seed` (decisions J2), so it runs before each deploy (07 section 3.4 step 6); it is idempotent and reads `DATABASE_URL` and `DEMO_SELLER_PAYPAL_EMAIL` from the service environment, falling back to `.env` through `process.loadEnvFile()` locally.
15. If `tsx prisma/seed.ts` cannot resolve `../generated/prisma/client`, the generator gets `importFileExtension = "ts"`; stack.md section 3 says this "may be needed" and marks nothing stronger, so it is applied only on that failure.
16. The evidence pack's JSON shape, wrapper keys and filename belong to 04 section 10.2; this document only fixes the eight reads and the column set each may expose. Step 8's rows are exposed there as a `webhook_events` section.
