> Original brief, exported 2026-10-09 from https://claude.ai/artifact/WUfZLJt14WMczryiEVHmt3 — superseded by the matching docs/0N-*.md where they differ.

# API specification

Handshake exposes 16 JSON endpoints under `/api`, plus one webhook receiver for PayPal.

**Conventions.** Requests and responses are JSON. The session is an HTTP-only cookie set by the magic link. Every state-changing request accepts an `Idempotency-Key` header. Amounts are integer minor units.

## Endpoints

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | /api/auth/magic-link | Anyone | Emails a sign-in link |
| GET | /api/auth/callback | Anyone | Exchanges the link token for a session |
| POST | /api/deals | Buyer | Creates a deal from one sentence; returns extracted terms |
| GET | /api/deals | Signed in | Lists the user's deals for the ledger |
| GET | /api/deals/{code} | Buyer or seller | Returns the deal, conditions, verdicts and status |
| PATCH | /api/deals/{code}/terms | Buyer | Edits terms; bumps terms_version and clears acceptances |
| POST | /api/deals/{code}/join | Seller | Attaches the signed-in user as seller |
| POST | /api/deals/{code}/accept | Buyer or seller | Accepts a specific terms_version |
| POST | /api/deals/{code}/payment | Buyer | Creates the PayPal order (intent AUTHORIZE); returns the order id |
| POST | /api/deals/{code}/payment/authorize | Buyer | Called after PayPal approval; authorizes the order |
| POST | /api/deals/{code}/evidence/upload-url | Seller | Returns a signed upload URL for one file |
| POST | /api/deals/{code}/evidence | Seller | Submits the evidence set and starts verification |
| POST | /api/deals/{code}/review | Buyer | Approves or rejects after an unclear verdict |
| POST | /api/deals/{code}/cancel | Buyer or seller | Cancels before proof is submitted; voids any hold |
| GET | /api/deals/{code}/events | Buyer or seller | Returns the audit trail |
| GET | /api/deals/{code}/evidence-pack | Buyer or seller | Returns the evidence pack as JSON or PDF |
| POST | /api/webhooks/paypal | PayPal | Receives PayPal events; no session |

## Key requests

Create a deal:

```json
POST /api/deals
{ "text": "I'll pay $80 for the hand-painted denim jacket once it arrives and matches the photos",
  "reference_file_ids": ["f1", "f2"] }

201
{ "code": "HS-7K2Q", "status": "draft", "terms_version": 1,
  "item_title": "Hand-painted denim jacket",
  "amount_minor": 8000, "currency": "USD", "deadline_at": "2026-10-29T00:00:00Z",
  "conditions": [
    { "id": "c1", "text": "Item matches the listing photos", "evidence_type": "photo" },
    { "id": "c2", "text": "Photo shows the deal code HS-7K2Q written by hand", "evidence_type": "photo" },
    { "id": "c3", "text": "Tracking shows delivered", "evidence_type": "tracking" } ] }
```

Submit evidence:

```json
POST /api/deals/HS-7K2Q/evidence
{ "files": ["e1", "e2"], "tracking_number": "1Z999AA10123456784", "note": "Shipped Monday" }

202
{ "status": "proof_submitted", "submission_no": 1 }
```

Read the result:

```json
GET /api/deals/HS-7K2Q
{ "status": "paid",
  "verdicts": [
    { "condition_id": "c1", "result": "pass", "confidence": 0.93, "reason": "Same painted pattern and collar as the listing photos." },
    { "condition_id": "c2", "result": "pass", "confidence": 0.97, "reason": "Handwritten code HS-7K2Q is visible beside the jacket." },
    { "condition_id": "c3", "result": "pass", "confidence": 0.99, "reason": "Carrier status is delivered." } ],
  "decision": "capture" }
```

## Errors

Every error uses one shape:

```json
{ "error": { "code": "terms_not_accepted", "message": "Both parties must accept version 3 before payment." } }
```

| HTTP | code | When |
| --- | --- | --- |
| 400 | invalid_input | Body fails validation |
| 401 | not_signed_in | No session |
| 403 | not_a_party | The user is neither buyer nor seller |
| 404 | deal_not_found | Unknown code |
| 409 | invalid_state | The action is not allowed in the current status |
| 409 | terms_not_accepted | Acceptances do not match terms_version |
| 422 | condition_not_checkable | A condition cannot be verified from evidence |
| 502 | paypal_error | PayPal rejected or failed the call; includes PayPal's debug id |

## PayPal webhooks handled

| Event | Effect on the deal |
| --- | --- |
| CHECKOUT.ORDER.APPROVED | Marks the payment approved; a safety net if the browser never calls authorize |
| PAYMENT.AUTHORIZATION.CREATED | Status becomes held; stores the authorization id and expiry times |
| PAYMENT.AUTHORIZATION.VOIDED | Status becomes voided |
| PAYMENT.CAPTURE.COMPLETED | Stores the capture id; triggers the payout |
| PAYMENT.CAPTURE.DENIED | Returns the deal to in review and alerts both parties |
| PAYMENT.PAYOUTS-ITEM.SUCCEEDED | Status becomes paid |
| PAYMENT.PAYOUTS-ITEM.FAILED | Keeps status captured and flags the payout for retry |
| CUSTOMER.DISPUTE.CREATED | Creates a disputes row; status becomes disputed |

The receiver verifies the signature, stores the event by its PayPal id, answers 200, and only then processes it. A repeated event id is ignored.
