> Original brief, exported 2026-10-09 from https://claude.ai/artifact/WUfZLJt14WMczryiEVHmt3 — superseded by the matching docs/0N-*.md where they differ.

# Database schema

Ten Postgres tables hold everything; `deal_events` is the audit log and the source of the evidence pack.

**Conventions.** Primary keys are UUIDs. Money is stored as integer minor units (`amount_minor`, so 80.00 USD is 8000) with a 3-letter `currency`. All timestamps are `timestamptz` in UTC. Every table has `created_at`.

## users

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| email | text | Unique; used for the magic link |
| display_name | text | Optional |
| paypal_email | text | Where a seller is paid; required before a seller can accept |

## deals

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| public_code | text | Unique short code used in the share link and the handwritten photo code |
| buyer_id, seller_id | uuid | Foreign keys to users; seller_id is null until the seller joins |
| source_text | text | The buyer's original sentence |
| item_title | text | Extracted by the AI, editable |
| amount_minor, currency | integer, text | The agreed price |
| deadline_at | timestamptz | At most 21 days after authorization |
| status | text | One of the states in the system design tab |
| terms_version | integer | Incremented on every edit; both parties accept a specific version |
| buyer_accepted_version, seller_accepted_version | integer | Payment is allowed only when both equal terms_version |
| fix_attempts_used | integer | 0 or 1 |

Indexes: `public_code` unique; `(buyer_id, status)`; `(seller_id, status)`; `(status, deadline_at)` for the expiry job.

## conditions

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| deal_id | uuid | Foreign key |
| position | integer | Display order |
| text | text | For example "Item matches the listing photos" |
| evidence_type | text | photo, tracking, file or link |
| reference_file_ids | uuid[] | Listing photos the evidence is compared with |

## evidence

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| deal_id | uuid | Foreign key |
| submission_no | integer | 1 for the first upload, 2 for the fix |
| kind | text | photo, tracking, note or link |
| storage_key | text | Object storage key for files; null otherwise |
| value | text | Tracking number, note text or URL |
| sha256 | text | Hash of the file, for tamper evidence and duplicate detection |
| uploaded_by | uuid | Foreign key to users |

## verdicts

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| deal_id, condition_id | uuid | Foreign keys |
| submission_no | integer | Which evidence set was judged |
| result | text | pass, fail or unclear |
| confidence | numeric(3,2) | 0.00 to 1.00 |
| reason | text | One sentence shown to both parties |
| model, prompt_version | text | For reproducibility |
| raw_response | jsonb | The model's full output |

## payments

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| deal_id | uuid | Unique foreign key; one payment per deal |
| paypal_order_id | text | Unique |
| authorization_id | text | Replaced on every reauthorization |
| authorized_at, honor_expires_at, auth_expires_at | timestamptz | Drive the reauthorize job |
| capture_id | text | Set on capture |
| status | text | created, approved, authorized, captured, voided or failed |

## payouts

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| deal_id | uuid | Foreign key |
| recipient_email | text | The seller's PayPal email |
| amount_minor, currency | integer, text | Captured amount minus any fee you model |
| paypal_batch_id, paypal_item_id | text | Returned by Payouts |
| status | text | pending, success or failed |

## deal_events

| Column | Type | Notes |
| --- | --- | --- |
| id | bigserial | Primary key; gives a strict order |
| deal_id | uuid | Foreign key |
| from_status, to_status | text | The transition |
| actor | text | buyer, seller, system, paypal or ai |
| cause | text | For example "webhook PAYMENT.CAPTURE.COMPLETED" |
| payload | jsonb | Ids and values needed to explain the step |

This table is append-only. Never update or delete a row.

## webhook_events

| Column | Type | Notes |
| --- | --- | --- |
| paypal_event_id | text | Primary key; makes processing idempotent |
| event_type | text | As sent by PayPal |
| verified | boolean | Signature check result |
| processed_at | timestamptz | Null until handled |
| body | jsonb | The full event |

## disputes

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| deal_id | uuid | Foreign key |
| paypal_dispute_id | text | Unique |
| reason, status | text | As reported by PayPal |
| evidence_submitted_at | timestamptz | Null until the pack is sent (stretch) |
