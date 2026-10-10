# PayPal research (as of 2026-10-09)

Scope: what Handshake needs from PayPal (sandbox only): OAuth, Orders v2 with `intent=AUTHORIZE`, Payments v2 (capture/void/reauthorize), Payouts v1, Webhooks, the TS Server SDK, and the React/JS SDK.

Sources: only developer.paypal.com (HTML pages, `.md` views, and the OpenAPI `schema.json` files that the API reference pages link as "authoritative"), github.com/paypal, and the npm registry. Schema files used:
- Orders v2: https://developer.paypal.com/api/orders/v2/schema.json (spec version 2.36)
- Payments v2: https://developer.paypal.com/api/payments/v2/schema.json (2.12)
- Payouts v1: https://developer.paypal.com/api/payments.payouts-batch/v1/schema.json (1.9)
- Webhooks v1: https://developer.paypal.com/api/webhooks/v1/schema.json (1.11)

"Schema" in the citations below means the matching file above.

---

## Summary: facts we'll rely on

1. Token: `POST https://api-m.sandbox.paypal.com/v1/oauth2/token`, Basic auth `client_id:secret`, body `grant_type=client_credentials`. The response includes `expires_in` in seconds (the sample shows 31668, about 8.8 h). Cache the token. https://developer.paypal.com/api/rest/authentication/ , https://developer.paypal.com/api/rest/reference/rate-limiting/
2. After a successful authorization, money is held for **29 days**. The **honor period is 3 days**. Capture is "subject to risk and money availability". https://developer.paypal.com/docs/checkout/standard/customize/authorization/
3. **Reauthorize is effectively once.** It is allowed only after the 3-day honor period (`REAUTHORIZATION_TOO_SOON`). You cannot reauthorize a reauthorization (`REAUTHORIZATION_NOT_SUPPORTED`). In the US the amount can be up to 115% of the original, capped at a +$75 increase. A reauthorization gets a new ID and a new 3-day honor period. (Schema `reauthorize_request` says "only once"; the guide says "multiple". Details in Q3.)
4. **A reauthorization cannot be voided. Void the original parent authorization** (`CANNOT_BE_VOIDED`). Payments schema.
5. Authorizations end at **30 days**. `PAYMENT.AUTHORIZATION.VOIDED` fires "due to authorization reaching its 30 day validity period" or a manual void. https://developer.paypal.com/api/rest/webhooks/event-names/
6. `PayPal-Request-Id` is supported on create order, authorize order, capture order, capture/reauthorize/void authorization, refund, and create payout. It is retained for **6 h** on Orders, **45 days** on Payments, and **30 days** on Payouts. Retrying with the same key returns the current state of the first request and does not repeat the action. https://developer.paypal.com/reference/guidelines/idempotency/ ; SDK docstrings in https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/main/src/controllers/paymentsController.ts and ordersController.ts ; Payouts schema
7. Payouts: `sender_batch_id` is deduplicated for 30 days, so reusing it is the natural idempotency key. Payouts are funded from the PayPal balance. The sandbox business account is created with a default balance. https://developer.paypal.com/docs/payouts/standard/integrate-api/ , https://developer.paypal.com/tools/sandbox/accounts/
8. For a Payments-v2 capture failure the event is **`PAYMENT.CAPTURE.DECLINED`**. `PAYMENT.CAPTURE.DENIED` exists but is listed only under Payments v1 and Marketplaces. https://developer.paypal.com/api/rest/webhooks/event-names/
9. Webhooks: the listener must return 2xx. Otherwise PayPal retries up to 25 times over 3 days. Port 443/HTTPS only. Up to 10 URLs per app. https://developer.paypal.com/api/rest/webhooks/ , https://developer.paypal.com/api/rest/webhooks/rest/
10. **Simulator events cannot be verified by postback.** Self-verify them with the CRC32 method and webhook id literal `WEBHOOK_ID`. https://developer.paypal.com/api/rest/webhooks/simulator/
11. `@paypal/paypal-server-sdk@2.5.0` has Orders, Payments, Vault, Transaction Search, and Subscriptions controllers. It has **no Payouts and no webhook verification**, so use raw fetch for those. It supports `paypalRequestId` and caches/refreshes the OAuth token itself. https://github.com/paypal/PayPal-TypeScript-Server-SDK (README), npm
12. `@paypal/react-paypal-js@10.6.0`: the default docs now cover the V6 SDK (`@paypal/react-paypal-js/sdk-v6`, `PayPalProvider`). The legacy V5 `PayPalScriptProvider`/`PayPalButtons` are still exported from the package root. For V5 you **must** pass `intent: "authorize"` so it matches the server order. https://github.com/paypal/paypal-js/tree/main/packages/react-paypal-js , https://developer.paypal.com/sdk/js/configuration/
13. Put the deal id in `purchase_units[].custom_id` (max 255, not shown to the payer). It comes back on the authorization and capture resources, so it is in webhook payloads. `invoice_id` must be unique per merchant account (`DUPLICATE_INVOICE_ID`). Orders + Payments schemas.
14. An order must be approved within the window: 6 h to redirect the payer, then 6 h for approval and authorize. Orders schema (`order.links` description).
15. Payouts rate guideline: 400 POST/min. 429 means `RATE_LIMIT_REACHED`. https://developer.paypal.com/docs/payouts/standard/integrate-api/

---

## 1. Auth (OAuth2 client credentials)

Source: https://developer.paypal.com/api/rest/authentication/

```bash
curl -X POST "https://api-m.sandbox.paypal.com/v1/oauth2/token" \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```
```json
{ "scope": "... https://uri.paypal.com/payments/payouts ... https://uri.paypal.com/services/applications/webhooks",
  "access_token": "A21AAF...", "token_type": "Bearer", "app_id": "APP-80W284485P519543T",
  "expires_in": 31668, "nonce": "..." }
```
- Lifetime: "PayPal returns an access token and the number of seconds the access token is valid... When your access token expires, call `/v1/oauth2/token` again". The doc gives no fixed number. The sample shows `expires_in: 31668` (about 8.8 h). Read `expires_in` and never hardcode it.
- Caching: "Rather than generate an OAuth 2.0 access token for each transaction, cache tokens." https://developer.paypal.com/api/rest/reference/rate-limiting/ . The Payouts guide also says to "reuse OAuth 2.0 access tokens (till their expiry time)". https://developer.paypal.com/docs/payouts/standard/integrate-api/
- The Server SDK caches the token in memory. It fetches a new one when the token is invalid or expired (`ClientCredentialsAuthManager.updateToken`, with optional `oAuthClockSkew`, `oAuthOnTokenUpdate`, and `oAuthTokenProvider` hooks). https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/main/src/clientCredentialsAuthManager.ts , https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/main/src/configuration.ts
- Check that the `scope` string includes `https://uri.paypal.com/payments/payouts`. It appears in the doc sample. If it is missing, Payouts calls will fail with a scope error (Payouts test value `ERRPYO011` simulates `REQUIRED_SCOPE_MISSING`).

## 2. Orders v2 (intent AUTHORIZE)

### Create order: `POST /v2/checkout/orders`
Schema `order_request`: required `intent` and `purchase_units`.
- `intent`: `CAPTURE` | `AUTHORIZE`. Schema text for AUTHORIZE: "Authorized payments are best captured within three days of authorization but are available to capture for up to 29 days. After the three-day honor period, the original authorized payment expires and you must re-authorize the payment... This intent is not supported when you have more than one `purchase_unit` within your order". So use exactly one purchase unit.
- `purchase_unit_request` fields we use:
  - `amount` (required): `{currency_code, value}` with value as a string.
  - `custom_id`: max 255. "Appears in transaction and settlement reports but is not visible to the payer."
  - `invoice_id`: max 127. "values are required to be unique within each merchant account by default".
  - `description`: truncated to 127 chars.
  - `reference_id`: max 256.
  - `soft_descriptor`: truncated to 22.
  - Omit `payee`, so funds go to the app's own business account (platform as merchant).
- Return/cancel URLs: `application_context.return_url`/`cancel_url` are **DEPRECATED**. Use `payment_source.paypal.experience_context`, which has: `return_url`, `cancel_url`, `user_action` (`CONTINUE`|`PAY_NOW`), `shipping_preference` (`GET_FROM_FILE`|`NO_SHIPPING`|`SET_PROVIDED_ADDRESS`), `brand_name` (max 127), `landing_page`, `locale`. Schema `paypal_wallet_experience_context`, `order_application_context`.
- When the JS SDK buttons drive approval, return/cancel URLs are not needed. They matter only for full-page redirect: "If you are not using the PayPal JavaScript SDK ... ensure that you include ... return_url". Orders schema, `order.links` description.
- Headers: `PayPal-Request-Id`, `Prefer: return=minimal|return=representation`, `PayPal-Mock-Response` (negative testing).

```json
POST /v2/checkout/orders
PayPal-Request-Id: ord-<dealId>
Prefer: return=representation
{
  "intent": "AUTHORIZE",
  "purchase_units": [{
    "custom_id": "<dealId>",
    "description": "Handshake deal: logo design",
    "amount": { "currency_code": "USD", "value": "25.00" }
  }],
  "payment_source": { "paypal": { "experience_context": {
    "brand_name": "Handshake", "user_action": "PAY_NOW", "shipping_preference": "NO_SHIPPING",
    "return_url": "https://<app>/deals/<dealId>?pp=return",
    "cancel_url": "https://<app>/deals/<dealId>?pp=cancel"
  } } }
}
```
Response: `{ id, status: "CREATED" | "PAYER_ACTION_REQUIRED", links: [{rel:"approve"|"payer-action", href}, ...] }`. The order expires if not approved in time: "The API caller has 6 hours (default...) from the time the order is created, to redirect your payer. Once redirected, the API caller has 6 hours for the payer to approve the order and either authorize or capture the order." Orders schema, `order.links`.

### Authorize order: `POST /v2/checkout/orders/{id}/authorize`
"To successfully authorize payment for an order, the buyer must first approve the order". The body is optional (`order_authorize_request` = `{payment_source?}`). Send `{}` or nothing with `Content-Type: application/json`. Headers: `PayPal-Request-Id`, `Prefer`. Errors include `ORDER_NOT_APPROVED`, `ORDER_ALREADY_AUTHORIZED`, `ORDER_COMPLETED_OR_VOIDED`. https://developer.paypal.com/api/rest/reference/orders/v2/errors/

Response (abridged, from the guide sample https://developer.paypal.com/docs/checkout/standard/customize/authorization/):
```json
{ "id": "48S239579N1696452", "intent": "AUTHORIZE", "status": "COMPLETED",
  "purchase_units": [{ "custom_id": "<dealId>", "payments": { "authorizations": [{
      "id": "66P728836U784324A",          // authorization id -> store
      "status": "CREATED",                // CREATED | CAPTURED | DENIED | PARTIALLY_CAPTURED | VOIDED | PENDING
      "status_details": { "reason": "PENDING_REVIEW" },   // only when PENDING
      "amount": { "currency_code": "USD", "value": "30.00" },
      "custom_id": "<dealId>",
      "expiration_time": "2020-01-01T15:57:51Z",          // store; end of the 29-day window
      "links": [ {"rel":"capture"}, {"rel":"void"}, {"rel":"reauthorize"} ] }] } }] }
```
Path: `purchase_units[0].payments.authorizations[0].{id,status,expiration_time}`. Authorization statuses come from the Payments schema `authorization.status`. Auth `PENDING` reasons are `PENDING_REVIEW` and `DECLINED_BY_RISK_FRAUD_FILTERS`.

### Order statuses (Orders schema `order_status`)
`CREATED`, `SAVED`, `APPROVED`, `VOIDED`, `COMPLETED`, `PAYER_ACTION_REQUIRED`.
- "COMPLETED ... A completed order can indicate a payment was authorized, an authorized payment was captured, or a payment was declined." After `/authorize` the order is `COMPLETED`. Track the authorization status from then on, not the order status.

## 3. Payments v2 authorizations: capture, void, reauthorize

All three endpoints accept `PayPal-Request-Id` and `Prefer`. Payments schema.

### Capture: `POST /v2/payments/authorizations/{authorization_id}/capture`
Body `capture_request` (all fields optional): `amount {currency_code,value}`, `invoice_id` (max 127), `final_capture` (bool), `note_to_payer` (max 255), `soft_descriptor` (max 22), `payment_instruction`. If `amount` is omitted, the full authorized amount is captured (UNVERIFIED wording; the guide's sample capture request has no body).
```json
POST /v2/payments/authorizations/66P728836U784324A/capture
PayPal-Request-Id: cap-<dealId>
{ "final_capture": true }
-> 201 { "id": "5KA38057EC136584R", "status": "COMPLETED", "links": [...] }
```
Capture statuses: `COMPLETED | DECLINED | PARTIALLY_REFUNDED | PENDING | REFUNDED | FAILED`. Pending/denied reasons: `BUYER_COMPLAINT, CHARGEBACK, ECHECK, INTERNATIONAL_WITHDRAWAL, OTHER, PENDING_REVIEW, RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION, REFUNDED, TRANSACTION_APPROVED_AWAITING_FUNDING, UNILATERAL, VERIFICATION_REQUIRED, DECLINED_BY_RISK_FRAUD_FILTERS`. The capture resource includes `custom_id`, `invoice_id`, `final_capture`, and `seller_receivable_breakdown` (gross/fee/net). Responses: 200/201, 400, 401, 403, 404, 409, 422.

Capture errors (Payments schema):
- `AUTHORIZATION_EXPIRED`: "An expired authorization cannot be captured."
- `AUTHORIZATION_VOIDED`: "A voided authorization cannot be captured or reauthorized."
- `AUTHORIZATION_DENIED`
- `AUTHORIZATION_ALREADY_CAPTURED`: "If `final_capture` is set to `true`, additional captures are not possible"
- `MAX_CAPTURE_AMOUNT_EXCEEDED`: "The default overage limit is 115%, which allows the sum of all captures to be up to 115% of the order amount."
- `MAX_CAPTURE_COUNT_EXCEEDED`
- `DUPLICATE_INVOICE_ID`
- `PAYEE_ACCOUNT_RESTRICTED`

### Void: `POST /v2/payments/authorizations/{authorization_id}/void`
No body. Returns **204 No Content** by default, or 200 with the authorization when `Prefer: return=representation`. Responses: 200, 204, 401, 403, 404, 409, 422.
- "You cannot void an authorized payment that has been fully captured."
- `CANNOT_BE_VOIDED`: "A reauthorization cannot be voided. Please void the original parent authorization."
- `PREVIOUSLY_VOIDED`: "Authorization has been previously voided and hence cannot be voided again." Treat it as success in our idempotent void path.

### Reauthorize: `POST /v2/payments/authorizations/{authorization_id}/reauthorize`
Body: `{ "amount": {currency_code, value} }`. "Supports only the `amount` request parameter." Response 201: `{ id: <NEW authorization id>, status: "CREATED", links }`.

The rules, quoted:
- Operation description (Payments schema; also the SDK docstring): "To ensure that funds are still available, reauthorize a payment after its initial three-day honor period expires. Within the 29-day authorization period, you can issue multiple re-authorizations after the honor period expires. If 30 days have transpired since the date of the original authorization, you must create an authorized payment instead of reauthorizing the original authorized payment. A reauthorized payment itself has a new honor period of three days. You can reauthorize an authorized payment from 4 to 29 days after the 3-day honor period. The allowed amount depends on context and geography, for example in US it is up to 115% of the original authorized amount, not to exceed an increase of $75 USD."
- Request schema `reauthorize_request` (same file): "**You can reauthorize a payment only once from days four to 29.** ... **You can reauthorize an authorized payment once.**"
- Guide (https://developer.paypal.com/docs/checkout/standard/customize/authorization/): "If you haven't captured the payment within 3 days of authorization, you can reauthorize the payment... You can issue multiple reauthorizations within the 29-day authorization period after the honor period expires. A reauthorization generates a new authorization ID and restarts the 3-day honor period. Use the new authorization ID on subsequent captures. If you reauthorize on the 27th day of the authorization period, you get only 2 days of the honor period."
- Errors:
  - `REAUTHORIZATION_TOO_SOON`: "Re-authorization is not allowed within the three-day honor period."
  - `REAUTHORIZATION_NOT_SUPPORTED`: "A reauthorize cannot be attempted on an authorization_id that is the result of a prior reauthorization..."
  - `AUTHORIZATION_VOIDED`
  - `AUTHORIZATION_EXPIRED`

**Resolution:** The docs conflict on "once" vs "multiple". The error codes settle the practical answer. You cannot reauthorize a reauth ID, and you can reauth only after day 3. So at most one useful reauthorization per original authorization, done between day 4 and day 29. A 29-day window still caps everything: "you get only 2 days of the honor period" if done on day 27.

**Capture after the honor period without reauth:** The docs say the hold is "valid for 29 days" and the authorization is "available to capture for up to 29 days", but capture "is subject to risk and money availability". The Orders schema also says "After the three-day honor period, the original authorized payment expires and you must re-authorize". That sentence contradicts the 29-day wording. Reading them together: capturing the original authorization on days 4-29 is permitted but funds are no longer guaranteed. **UNVERIFIED in practice.** Sandbox has no clock control, so day-4+ behaviour cannot be tested before the deadline. Tried: the guide, both schemas, the SDK docstrings, and the linked page `/docs/checkout/advanced/authorization-honor/`, which returns 404.

## 4. Idempotency (`PayPal-Request-Id`)

Sources: https://developer.paypal.com/reference/guidelines/idempotency/ , https://developer.paypal.com/api/rest/requests/#paypal-request-id , schemas, SDK docstrings.

| Endpoint | Header supported | Retention |
|---|---|---|
| POST /v2/checkout/orders | yes | 6 h ("can request ... up to 72 hours by speaking to their Account Manager"). SDK docstring, ordersController.ts |
| POST /v2/checkout/orders/{id}/authorize | yes | 6 h (same) |
| POST /v2/checkout/orders/{id}/capture | yes | 6 h |
| POST /v2/payments/authorizations/{id}/capture | yes | 45 days. SDK docstring, paymentsController.ts |
| POST /v2/payments/authorizations/{id}/reauthorize | yes | 45 days |
| POST /v2/payments/authorizations/{id}/void | yes | 45 days |
| POST /v2/payments/captures/{id}/refund | yes | 45 days (requests doc: "up to 45 days") |
| POST /v1/payments/payouts | yes | "The server stores keys for 30 days." (Payouts schema). `sender_batch_id` is also deduped for 30 days. |
| POST /v1/notifications/verify-webhook-signature | not listed | n/a (read-only; safe to retry) |

The retention numbers for Orders and Payments come from the SDK's generated docstrings. The OpenAPI `schema.json` header descriptions only say "for idempotency purposes".

Behaviour:
- "when you include a previously specified `PayPal-Request-Id` header in a request, PayPal returns the latest status of the previous request that used that same header. Conversely, when you omit the `PayPal-Request-Id` header from a request, PayPal duplicates the request."
- Example: a capture times out, then a retry with the same key returns `201` with the capture, and "The server does not capture the payment again".
- "When you send two simultaneous API requests with same `PayPal-Request-Id` header, PayPal processes the first request and might fail the second request."
- "The `PayPal-Request-Id` header value must be unique for both each request and an API call type." UUIDs are recommended "because it meets the 38 single-byte character limit". The schema allows up to 10000 chars, but keep it **≤ 38 chars**.
- "PayPal provides the status of a request at the current time and not the status of the original request."
- SDK retries are off by default: `maxNumberOfRetries: 0`, and `httpMethodsToRetry` defaults to `['GET','PUT']`. So POSTs are never auto-retried by the SDK. https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/main/doc/retry-configuration.md

## 5. Payouts API (v1)

Sources: https://developer.paypal.com/docs/payouts/standard/integrate-api/ , Payouts schema, https://developer.paypal.com/api/payouts/test-go-live , https://developer.paypal.com/payouts/use-payouts/set-up

### Create batch: `POST /v1/payments/payouts`
```json
POST https://api-m.sandbox.paypal.com/v1/payments/payouts
Authorization: Bearer <token>
PayPal-Request-Id: po-<dealId>
{
  "sender_batch_header": {
    "sender_batch_id": "deal-<dealId>",      // max 256; deduped for 30 days
    "email_subject": "You have a payout from Handshake",   // max 255
    "email_message": "Your deal was approved."            // max 1000
  },
  "items": [{
    "recipient_type": "EMAIL",               // EMAIL | PHONE | PAYPAL_ID (USER_HANDLE for Venmo)
    "receiver": "seller@personal.example.com",   // max 127
    "amount": { "value": "25.00", "currency": "USD" },   // NOTE: "currency", not "currency_code"
    "note": "Deal <dealId>",                 // max 4000
    "sender_item_id": "<dealId>"             // max 63; comes back on item + webhook
  }]
}
-> 201
{ "batch_header": { "payout_batch_id": "3TRXJ4Z8XJ8QY", "batch_status": "PENDING",
    "sender_batch_header": { "sender_batch_id": "deal-<dealId>", ... } },
  "links": [{ "rel": "self", "href": ".../v1/payments/payouts/3TRXJ4Z8XJ8QY" }] }
```
- The create response has **no item IDs**. Get them with `GET /v1/payments/payouts/{payout_batch_id}`, which returns `items[].payout_item_id`, `transaction_id`, `transaction_status`, `payout_item_fee`, `payout_item.sender_item_id`, and `errors`. Single item: `GET /v1/payments/payouts-item/{payout_item_id}`.
- Batch status (`batch_enum`): `DENIED | PENDING | PROCESSING | SUCCESS | CANCELED`.
- Item `transaction_status` (`transaction_enum`): `SUCCESS | FAILED | PENDING | UNCLAIMED | RETURNED | ONHOLD | BLOCKED | REFUNDED | REVERSED`.
- Duplicate handling: "If you specify a `sender_batch_id` that was used in the last 30 days, the API rejects the request with an error message that shows the duplicate `sender_batch_id` and includes a HATEOAS link to the original payout... If you receive an HTTP `5nn` status code, you can safely retry the request with the same `sender_batch_id`."
- `UNCLAIMED`: when the receiver email has no PayPal account (`RECEIVER_UNREGISTERED`) or is unconfirmed (`RECEIVER_UNCONFIRMED`). "if the recipient does not claim this payout within 30 days, the funds will be returned". Unclaimed items can be cancelled with `POST /v1/payments/payouts-item/{id}/cancel`.
- Item error names from the schema: `RECEIVER_UNREGISTERED`, `RECEIVER_UNCONFIRMED`, `RECEIVER_ACCOUNT_LOCKED`, `RECEIVER_ACCOUNT_LIMITATION`, `RECEIVER_COUNTRY_NOT_ALLOWED`, `RECEIVER_REFUSED`, `INSUFFICIENT_FUNDS`, `DUPLICATE_ITEM`, `USER_BUSINESS_ERROR`, `CURRENCY_NOT_SUPPORTED_FOR_RECEIVER`, and others. The guide's sample also shows `RECEIVER_ACCOUNT_INVALID` with `transaction_status: FAILED`.

### Sandbox requirements
- Prerequisites per the guide: "Complete all mandatory steps to set up your sandbox account. Ensure your PayPal business account is set up. Ensure to fund your business account."
- Sandbox setup steps: create a sandbox app with **Type: Merchant** tied to the sandbox business account, then add a webhook under **Features > Sandbox Webhooks**. https://developer.paypal.com/payouts/use-payouts/set-up#set-up-sandbox-account-for-payouts-api-integration
- Production needs "request access" to Payouts. Sandbox: "In the meantime, you can set up and test your integration in your sandbox accounts." https://developer.paypal.com/docs/payouts/standard/
- **Is a "Payouts" app-feature checkbox required in sandbox? UNVERIFIED.** The setup doc does not mention one. The OAuth sample scope includes `https://uri.paypal.com/payments/payouts`. Check the dashboard app's Features list on day 1. If a payout returns `REQUIRED_SCOPE_MISSING`/`AUTHORIZATION_ERROR`, enable Payouts there.
- Balance: sandbox accounts are created "with default values for balances" (https://developer.paypal.com/tools/sandbox/accounts/). Captures also land in the same business balance, so the capture funds the payout. Custom balances are available through "Create Custom Account". The exact default amount is UNVERIFIED.
- Fees: sandbox sample responses show fees. Batch `fees` = 0.50 USD; item `payout_item_fee` = 0.25 USD, and 0.00 on a FAILED item. "Initially, the fee is `0`. The fee is populated after the item moves to the `PENDING` state". Budget: the payout plus fee comes out of the business balance.
- Rate limit: "For Payouts API, we allow 400 POST requests per minute." A 429 means `RATE_LIMIT_REACHED`.

### Testing failures
- Real failure path: send to an email with no sandbox account. This gives `UNCLAIMED`/`RECEIVER_UNREGISTERED`, not `FAILED`.
- Simulation (sandbox; "Test values are case sensitive"). Put the value in `items[0].note`:

  | Value | Simulated error |
  |---|---|
  | `ERRPYO001` | `SENDER_RESTRICTED` |
  | `ERRPYO002` | `SENDER_EMAIL_UNCONFIRMED` |
  | `ERRPYO003` | `AUTHORIZATION_ERROR` |
  | `ERRPYO005` | `INSUFFICIENT_FUNDS` |
  | `ERRPYO006` | `INTERNAL_ERROR` |
  | `ERRPYO010` | `VALIDATION_ERROR` |
  | `ERRPYO011` | `REQUIRED_SCOPE_MISSING` |
  | `ERRPYO014` | `USER_BUSINESS_ERROR` |
  | `ERRPYO039` | `PREVIOUS_REQUEST_IN_PROGRESS` |

  Or use a path param on GET, e.g. `GET /v1/payments/payouts/ERRPYO022` for `RECEIVER_UNREGISTERED` and `ERRPYO019` for `RECEIVER_ACCOUNT_LOCKED`. https://developer.paypal.com/api/payouts/test-go-live
- These simulations return canned API responses ("without creating actual payouts"). Whether they emit webhooks is UNVERIFIED (probably not).

## 6. Webhooks

### Event names (all confirmed on https://developer.paypal.com/api/rest/webhooks/event-names/)
| Event | Status | Notes |
|---|---|---|
| `CHECKOUT.ORDER.APPROVED` | exists (Orders V2) | "A buyer approved a checkout order" |
| `CHECKOUT.ORDER.COMPLETED` | exists | "For use by marketplaces and platforms only." |
| `CHECKOUT.PAYMENT-APPROVAL.REVERSED` | exists | problem after approval, before capture |
| `PAYMENT.AUTHORIZATION.CREATED` | exists (Payments v2) | |
| `PAYMENT.AUTHORIZATION.VOIDED` | exists (v2) | "voided either due to authorization reaching its 30 day validity period or ... manually voided" |
| `PAYMENT.CAPTURE.COMPLETED` | exists (v2) | |
| `PAYMENT.CAPTURE.PENDING` | exists (v2) | |
| `PAYMENT.CAPTURE.DECLINED` | exists (v2) | this is the v2 failure event |
| `PAYMENT.CAPTURE.DENIED` | exists, but **only under Payments v1 and Marketplaces** | subscribe anyway; cheap |
| `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED` | exist (v2) | reversal = PayPal pulled funds |
| `PAYMENT.PAYOUTSBATCH.SUCCESS` / `.DENIED` / `.PROCESSING` | exist | "do not contain item-related information" |
| `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` / `.FAILED` / `.UNCLAIMED` / `.RETURNED` / `.BLOCKED` / `.HELD` / `.REFUNDED` / `.CANCELED` | exist | |
| `CUSTOMER.DISPUTE.CREATED` / `.UPDATED` / `.RESOLVED` | exist | supersedes `RISK.DISPUTE.CREATED` |

### Subscribing
- Dashboard: App > Features > (Sandbox) Webhooks > Add Webhook. Enter the URL, pick events, and copy the **Webhook ID**.
- API: `POST /v1/notifications/webhooks` with body `{ "url": "https://...", "event_types": [{ "name": "PAYMENT.CAPTURE.COMPLETED" }, ...] }`. `url` and `event_types` are required; `*` subscribes to all. Webhooks schema; https://developer.paypal.com/api/rest/webhooks/
- Limits: "Up to 10 webhook URLs may be subscribed per app." "Only events associated with the specific app will be received". Listener must be on "HTTPS port 443".

### Verification by postback: `POST /v1/notifications/verify-webhook-signature`
All fields are required (Webhooks schema `verify_webhook_signature`):
```json
{
  "auth_algo":         "<PAYPAL-AUTH-ALGO header>",       // e.g. SHA256withRSA
  "cert_url":          "<PAYPAL-CERT-URL header>",
  "transmission_id":   "<PAYPAL-TRANSMISSION-ID header>",
  "transmission_sig":  "<PAYPAL-TRANSMISSION-SIG header>",
  "transmission_time": "<PAYPAL-TRANSMISSION-TIME header>",
  "webhook_id":        "<our webhook id from dashboard>",
  "webhook_event":     <raw event JSON>
}
-> 200 { "verification_status": "SUCCESS" | "FAILURE" }
```
"It is essential that the webhook_event data be posted back exactly as it was received... Parsing to an array/object followed by re-serializing back to a JSON string can fail verification." So splice the raw body string into the JSON text instead of using `JSON.stringify(parsed)`. https://developer.paypal.com/api/rest/webhooks/rest/

### Self-verification (PayPal's preferred method; the only one that works for simulator events)
Signed message: `` `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody) as unsigned decimal}` ``. Verify `PAYPAL-TRANSMISSION-SIG` (base64) with `crypto.createVerify('SHA256')` against the PEM downloaded from `PAYPAL-CERT-URL`, and cache the PEM. "You must use the original raw body". https://developer.paypal.com/api/rest/webhooks/rest/

The doc sample uses the `buffer-crc32` package. Node's built-in `zlib.crc32(buf)` returns the same unsigned value: checked locally on Node v26, `crc32('hello') = 907060870`. Per Node docs it was added in v22.2/v20.15 (not a PayPal source). So no dependency is needed.

Not in PayPal docs, but we should do it: before downloading the cert, check that `cert_url` is https on a `paypal.com` host.

### Simulator
"Postback verification to the verify-webhook-signature endpoint is not supported for mock events... For message signature verification purposes, the ID of mock webhooks is the string: `WEBHOOK_ID`." Mock events "are not associated with any App... cannot be resent". https://developer.paypal.com/api/rest/webhooks/rest/ , https://developer.paypal.com/api/rest/webhooks/simulator/

The simulator sample payload for `PAYMENT.AUTHORIZATION.CREATED` is a **v1-shaped** resource (`state`, `amount.total`, `parent_payment`). Do not use simulator payloads as fixtures for v2 parsing. The API alternative is `POST /v1/notifications/simulate-event` with `{ webhook_id?, url?, event_type, resource_version? }`.

### Delivery and retries
"Successful receipt requires your listener endpoint to respond with an HTTP 200 or other 2xx status code. Any non-2xx status code will cause PayPal to reattempt delivery up to 25 times over the course of 3 days... If unsuccessful after 3 days, delivery will be marked as Failed (but can be resent again manually from the Webhook Events dashboard)." https://developer.paypal.com/api/rest/webhooks/

**Response timeout: UNVERIFIED.** No PayPal page states one. Tried the overview, the integration guide, the simulator page, and the Webhooks schema. Respond fast: verify, persist, return 200, then do the work.

## 7. `@paypal/paypal-server-sdk` (TypeScript Server SDK)

- Version **2.5.0** (npm `time.modified` 2026-09-29). Repo https://github.com/paypal/PayPal-TypeScript-Server-SDK (last push 2026-08-21, not archived).
- README: "This SDK currently contains only 5 of PayPal's API endpoints." The 5 are the controllers: **Orders, Payments, Vault** (US only), **Transaction Search, Subscriptions**. There is also an `OAuthAuthorizationController.requestToken`.
- **No Payouts and no Webhooks** (no controller and no models; `src/index.ts` has no payout/webhook exports). Use raw `fetch` for both.
- The old `@paypal/checkout-server-sdk` is deprecated in favour of this package (npm `deprecated` field). `@paypal/payouts-sdk@1.1.1` points at `github.com/paypal/Payouts-NodeJS-SDK`, which returns 404. Don't use it.
- `PayPal-Request-Id` is supported as the `paypalRequestId` param on every POST method above. `paypalMockResponse` maps to the `PayPal-Mock-Response` header for negative testing.
- Method names: `OrdersController.createOrder`, `getOrder`, `patchOrder`, `confirmOrder`, `authorizeOrder`, `captureOrder`, `createOrderTracking`, `updateOrderTracking`; `PaymentsController.getAuthorizedPayment`, `captureAuthorizedPayment`, `reauthorizePayment`, `voidPayment`, `getCapturedPayment`, `refundCapturedPayment`, `getRefund`. Source: `src/controllers/*.ts`.
- Responses are `ApiResponse<T>` with `.result` (parsed, camelCase), `.statusCode`, `.headers`, and `.body` (raw). HTTP errors throw `ApiError` (also exported). Models are camelCase and map to snake_case on the wire, e.g. `purchaseUnits` → `purchase_units` and `customId` → `custom_id`.

```ts
// lib/paypal.ts (server only)
import {
  Client, Environment, OrdersController, PaymentsController, ApiError,
  CheckoutPaymentIntent, PaypalExperienceUserAction, PaypalWalletContextShippingPreference,
} from '@paypal/paypal-server-sdk';

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID!,
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  },
  environment: Environment.Sandbox,
  timeout: 15000, // default 0 = no timeout
});
export const orders = new OrdersController(client);
export const payments = new PaymentsController(client);

// 1. create order (AUTHORIZE)
const { result: order } = await orders.createOrder({
  paypalRequestId: `ord-${deal.id}`,
  prefer: 'return=representation',
  body: {
    intent: CheckoutPaymentIntent.Authorize,
    purchaseUnits: [{
      customId: deal.id,
      description: deal.title.slice(0, 127),
      amount: { currencyCode: 'USD', value: deal.amount }, // string, e.g. "25.00"
    }],
    paymentSource: { paypal: { experienceContext: {
      brandName: 'Handshake',
      userAction: PaypalExperienceUserAction.PayNow,
      shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
    } } },
  },
});
// order.id -> return to browser

// 2. authorize (after buyer approval)
const { result: authed } = await orders.authorizeOrder({
  id: orderId, paypalRequestId: `auth-${deal.id}`, prefer: 'return=representation',
});
const a = authed.purchaseUnits![0].payments!.authorizations![0];
// a.id, a.status, a.expirationTime

// 3. capture
const { result: cap } = await payments.captureAuthorizedPayment({
  authorizationId, paypalRequestId: `cap-${deal.id}`, prefer: 'return=representation',
  body: { finalCapture: true },
});
// cap.id, cap.status ('COMPLETED' | 'PENDING' | 'DECLINED' ...)

// 4. void (always the ORIGINAL authorization id)
await payments.voidPayment({ authorizationId: originalAuthId, paypalRequestId: `void-${deal.id}` }); // 204 -> result null

// 5. reauthorize (once, day 4..29)
const { result: re } = await payments.reauthorizePayment({
  authorizationId: originalAuthId, paypalRequestId: `reauth-${deal.id}`,
  body: { amount: { currencyCode: 'USD', value: deal.amount } },
});
// re.id = NEW authorization id, use it for capture

// error handling
try { /* ... */ } catch (e) { if (e instanceof ApiError) { e.statusCode; e.body; /* JSON with name/details[].issue */ } }
```

Raw fetch shapes for the gaps (same token; get one via `/v1/oauth2/token` or the SDK's `OAuthAuthorizationController`):
```ts
const base = 'https://api-m.sandbox.paypal.com';
// Payout
await fetch(`${base}/v1/payments/payouts`, { method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `po-${deal.id}` },
  body: JSON.stringify({ sender_batch_header: { sender_batch_id: `deal-${deal.id}`, email_subject: 'You have a payout from Handshake' },
    items: [{ recipient_type: 'EMAIL', receiver: sellerEmail, amount: { value: deal.amount, currency: 'USD' }, sender_item_id: deal.id }] }) });
// Webhook verify (postback) - splice raw body, don't re-stringify
await fetch(`${base}/v1/notifications/verify-webhook-signature`, { method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: `{"auth_algo":${JSON.stringify(h['paypal-auth-algo'])},"cert_url":${JSON.stringify(h['paypal-cert-url'])},` +
        `"transmission_id":${JSON.stringify(h['paypal-transmission-id'])},"transmission_sig":${JSON.stringify(h['paypal-transmission-sig'])},` +
        `"transmission_time":${JSON.stringify(h['paypal-transmission-time'])},"webhook_id":${JSON.stringify(WEBHOOK_ID)},"webhook_event":${rawBody}}` });
```
The SDK does not expose its cached token publicly in a documented way (UNVERIFIED). The simplest path is a tiny cached `getToken()` for the raw calls.

## 8. Browser side (`@paypal/react-paypal-js`)

- `@paypal/react-paypal-js` **10.6.0** and `@paypal/paypal-js` **11.2.1** (npm, both modified 2026-10-05). Repo: https://github.com/paypal/paypal-js (monorepo; `react-paypal-js` is no longer a separate repo).
- The package now has two APIs (package.json `exports`):
  - `@paypal/react-paypal-js/sdk-v6`: `PayPalProvider` + `PayPalOneTimePaymentButton` (V6 JS SDK). Requires `environment: "sandbox" | "production"` since 10.0.0 (BREAKING). It has **no `intent` option**: the V6 types have no intent field (`packages/paypal-js/types/v6/index.d.ts`), and the order's intent comes from the server. `createOrder` returns `{ orderId }` and `onApprove({ orderId })` "must return a Promise".
  - `@paypal/react-paypal-js` (root): legacy V5 `PayPalScriptProvider` + `PayPalButtons`, documented in https://github.com/paypal/paypal-js/blob/main/packages/react-paypal-js/README-PAYPAL-JS-SDK-V5.md .
- `intent` rule for V5: "The intent for the transaction... Defaults to capture. Important: When you integrate with a PayPal API, make sure the intent value you pass in the API call matches the value you pass in the JavaScript call." `authorize`: "The funds are authorized immediately and then reauthorized or captured later." https://developer.paypal.com/sdk/js/configuration/ . The authorize guide shows `&intent=authorize` on the script tag.

V5 flow (the one PayPal's authorize guide documents):
```tsx
'use client';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';

export function PayButton({ dealId }: { dealId: string }) {
  return (
    <PayPalScriptProvider options={{ clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID!, currency: 'USD', intent: 'authorize' }}>
      <PayPalButtons
        createOrder={async () => {
          const r = await fetch(`/api/deals/${dealId}/paypal/order`, { method: 'POST' });
          return (await r.json()).id;              // V5: return the order id string
        }}
        onApprove={async (data) => {
          await fetch(`/api/deals/${dealId}/paypal/authorize`, {
            method: 'POST', body: JSON.stringify({ orderID: data.orderID }),
          });                                       // server calls /authorize, stores auth id
        }}
      />
    </PayPalScriptProvider>
  );
}
```
V6 equivalent: `<PayPalProvider clientId=… environment="sandbox" pageType="checkout">` + `<PayPalOneTimePaymentButton createOrder={async () => ({ orderId })} onApprove={async ({ orderId }) => { await fetch(...authorize) }} />`. Whether V6 one-time buttons work with an `AUTHORIZE` order is **UNVERIFIED** (likely, since intent is server-side). V6 quickstart: https://docs.paypal.ai/payments/methods/paypal/sdk/js/v6/paypal-checkout .

Next.js App Router notes:
- Both APIs touch `window`, so put them in a `'use client'` component.
- The V6 bundle ships a bundle-level `use client` directive: CHANGELOG 9.0.0, "Updates the V6 rollup config to apply bundle-level use client directive to client bundle". https://github.com/paypal/paypal-js/blob/main/packages/react-paypal-js/CHANGELOG.md
- V6 also offers `fetchEligibleMethods` from `@paypal/react-paypal-js/sdk-v6/server` for server components (README "Server-Side Rendering").
- The client ID is public (`NEXT_PUBLIC_…`). The secret stays server-side.

## 9. Sandbox setup

Sources: https://developer.paypal.com/api/rest/ , https://developer.paypal.com/tools/sandbox/accounts/ , https://developer.paypal.com/payouts/use-payouts/set-up , https://developer.paypal.com/api/rest/webhooks/rest/

1. Log in at developer.paypal.com, toggle **Sandbox**, then **Apps & Credentials** > **Create App**. Choose Type **Merchant** and link it to the sandbox business account. Copy the Client ID and Secret. New accounts also get a "Default Application".
2. Accounts: a business (`sb-xxxx@business.example.com`) and a personal (`sb-xxxx@personal.example.com`) account are auto-created. Add more under **Testing Tools > Sandbox Accounts > Create account**. Use a second personal account as the "seller payout receiver" so buyer ≠ seller.
3. Buyer login credentials: **Testing Tools > Sandbox Accounts > ⋮ > View/Edit Account** shows the email and system-generated password. Log in at https://www.sandbox.paypal.com to view balances and transactions.
4. Payouts: no separate enablement is documented for sandbox. Check the app's Features list (UNVERIFIED, see Q5). Make sure the business account has balance.
5. Webhook: App > **Features > Sandbox Webhooks > Add Webhook**. Enter a public **HTTPS URL on port 443** and select events. Copy the **Webhook ID** into env (`PAYPAL_WEBHOOK_ID`). For local dev, any HTTPS tunnel that terminates on 443 works (e.g. ngrok, cloudflared; not PayPal-documented). The Render deploy URL is simpler and needs no tunnel. Troubleshooting: blocked 443, or the domain flagged by URL filters (PayPal suggests checking urlfiltering.paloaltonetworks.com).
6. Negative testing (beta): turn it on per business sandbox account under Settings > Negative Testing. Then send header `PayPal-Mock-Response: {"mock_application_codes": "<ERROR_NAME>"}`. It works on Payments v2 (capture/void authorization...) and Orders v2 (authorize, capture). https://developer.paypal.com/tools/sandbox/negative-testing/ , https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/

## 10. Disputes (feature cut; feasibility only)

`CUSTOMER.DISPUTE.CREATED` exists (event-names page). The Disputes API has **sandbox-only** endpoints to push a dispute through its lifecycle: `POST /v1/customer/disputes/{id}/require-evidence` and `POST /v1/customer/disputes/{id}/adjudicate` ("This method is for sandbox use only... to complete end-to-end dispute resolution testing"). Source: https://developer.paypal.com/api/customer-disputes/v1/schema.json . Those endpoints act on a dispute that already exists. Creating one in sandbox would mean the sandbox buyer opening a case from sandbox.paypal.com's Resolution Center against a **captured** payment. **UNVERIFIED**: no primary page found describing buyer-side dispute creation in sandbox (tried `/docs/disputes/`, `/docs/disputes/sandbox-testing/` (404), `/docs/disputes/test/` (404)). Disputes only apply after capture, so they are outside the hold window anyway. Feasible but fiddly. Keep it cut.

## 11. Rate limits and sandbox gotchas

- No published general rate limit. Unusual traffic can be throttled with 429 `RATE_LIMIT_REACHED`. "Do not poll and instead use webhooks"; cache tokens. https://developer.paypal.com/api/rest/reference/rate-limiting/ . Payouts: 400 POST/min.
- Capture `PENDING` is a real state (`PAYMENT.CAPTURE.PENDING`), with reasons listed in Q3. `RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION` and `UNILATERAL` are the usual sandbox culprits when the business account is non-US or unconfirmed, or when the currency is not held. Use **USD with a US sandbox business account** and handle PENDING as "not done yet; wait for COMPLETED/DECLINED webhook". The specific sandbox triggers are UNVERIFIED.
- Authorization can come back `PENDING` (`PENDING_REVIEW`). Don't treat that as funded.
- `invoice_id` uniqueness: a reused `invoice_id` triggers `DUPLICATE_INVOICE_ID`, which makes retried order creation painful. Use `custom_id` for the deal id.
- Payouts `amount` uses `currency`. Orders and Payments use `currency_code`.
- Payout create returns no item IDs. GET the batch, or wait for `PAYMENT.PAYOUTS-ITEM.*`.
- Void returns 204 with an empty body unless you send `Prefer: return=representation`.
- Webhooks are per app. Events from a different REST app on the same account are not delivered.
- Simulator payloads are mock, v1-shaped, unverifiable by postback, and not resendable.
- The 3-day honor period and the 29-day window can't be fast-forwarded in sandbox. Reauth (which needs day ≥4) is effectively untestable before the demo.
- Base URL: `https://api-m.sandbox.paypal.com`. Some doc samples use the older `api.sandbox.paypal.com`.

## 12. PayPal Agent Toolkit / MCP (agentic-commerce prize; not needed for the build)

- **PayPal Agent Toolkit**: https://github.com/paypal/agent-toolkit , npm `@paypal/agent-toolkit@1.11.0`.
  - "enables popular agent frameworks including OpenAI's Agent SDK, LangChain, Vercel's AI SDK, and Model Context Protocol (MCP) to integrate with PayPal APIs through function calling".
  - Tools: invoices (create/send/remind/cancel, recurring series), payments (`create_order`, `get_order`, `pay_order`, `create_refund`, `get_refund`), disputes (`list_disputes`, `get_dispute`, `accept_dispute_claim`), shipment tracking, catalog, subscriptions, and reporting (`list_transactions`, `get_merchant_insights`).
  - Usage: `import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk'`. There are no authorize/void/payout tools.
- **PayPal MCP server**:
  - Local: `npx -y @paypal/mcp --tools=all PAYPAL_ACCESS_TOKEN=… PAYPAL_ENVIRONMENT=SANDBOX` (npm `@paypal/mcp@1.8.1`).
  - Remote: `https://mcp.sandbox.paypal.com` (sandbox) or `https://mcp.paypal.com`, with SSE (`/sse`) and a second transport, authorized by a bearer token from client credentials. https://developer.paypal.com/tools/mcp-server/
  - Announcement: https://developer.paypal.com/community/blog/paypal-model-context-protocol/
- Possible prize angle: expose Handshake's own deal tools (create deal, submit evidence, check status) as an MCP server, and point to PayPal's MCP for invoices and reporting. This is an option, not a plan.

---

## Implications for Handshake

1. **Deal cap: 21 days is fine** (< 29-day authorization window, < 30-day auto-void). Keep it.
2. **A daily reauth job is not valid.** Reauth is impossible during days 0-3, allowed at most once per original authorization, and a reauth ID can't be reauthorized again. Policy:
   - Verdict on days 0-3: capture the original authorization.
   - Verdict on days 4-21: **capture the original authorization directly**. The docs allow capture up to 29 days, but funds are not guaranteed.
   - If that capture fails with a funds/expiry error, mark the deal `CAPTURE_FAILED` and tell both parties. **Skipped:** a reauth-then-capture fallback. Add it only if day-4+ capture failures actually show up. If we add it, do exactly one `reauthorize` right before capture, then capture the new ID.
   - Show the buyer that holds older than 3 days are "not guaranteed".
3. **Void always targets the ORIGINAL authorization id** (`CANNOT_BE_VOIDED` on a reauth). Store `originalAuthorizationId` permanently. Store `currentAuthorizationId` separately only if reauth is ever added. Treat `PREVIOUSLY_VOIDED` as success.
4. **Webhook subscriptions:**
   - Payments: `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.CAPTURE.REFUNDED`.
   - Payouts items: `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `.FAILED`, `.UNCLAIMED`, `.RETURNED`, `.BLOCKED`, `.HELD`.
   - Orders (optional): `CHECKOUT.ORDER.APPROVED`. The synchronous `onApprove` → `/authorize` path is the primary one.
   - Skip `PAYOUTSBATCH.*`, since it carries no item data, and `CUSTOMER.DISPUTE.*`, since the feature is cut.
   - Map events to deals via `resource.custom_id` (auth/capture) and `resource.payout_item.sender_item_id` (payouts).
   - Webhooks confirm state. The synchronous API responses are the first writer, so make handlers idempotent: unique key on `event.id`, and status transitions that only move forward.
5. **Webhook verification:** self-verify with CRC32 using `zlib.crc32` (no dependency) plus `crypto.createVerify('SHA256')`. Fetch the cert from `paypal-cert-url` after an allowlist check, and cache it in memory. This one code path verifies both real events (our webhook ID) and simulator events (`WEBHOOK_ID`). The postback path is the fallback. Read the raw body in the Next.js route via `await req.text()`, then `JSON.parse`. Return 200 quickly.
6. **SDK vs raw fetch:**

   | Call | Use |
   |---|---|
   | Create order, authorize order, capture, void, (reauth), get authorization | `@paypal/paypal-server-sdk` (typed; token cached) |
   | Payouts create/get | raw `fetch` |
   | Verify webhook | local crypto (raw `fetch` postback as fallback) |
   | Token for raw calls | ~10-line cached `getToken()` using `expires_in` minus a skew |

   One module, `lib/paypal.ts`.
7. **Idempotency key format:** `<action>-<dealId>`. With a cuid deal id (25 chars) this is ≤ 32 chars, under the 38-char guidance. Actions: `ord`, `auth`, `cap`, `void`, `reauth`, `po`.
   - One key per deal per action is the right semantics. A deal is captured or voided once, and a retry with the same key returns the original result.
   - `ord` keys expire after 6 h. If a buyer abandons checkout and returns later, a new order is needed: use `ord-<dealId>-<n>` with an attempt counter.
   - Payouts: `sender_batch_id = deal-<dealId>` (30-day dedupe) plus the same value as `PayPal-Request-Id`.
   - Never send two concurrent requests with the same key. Serialize per deal, e.g. `SELECT … FOR UPDATE` or a status-guarded `UPDATE … WHERE status = 'X'`.
8. **Deal id placement:** `purchase_units[0].custom_id = dealId`; `sender_item_id = dealId`. Omit `invoice_id`, or set it to `deal-<dealId>` only if it's needed for display. `DUPLICATE_INVOICE_ID` risk applies on retries.
9. **Order approval window:** the 6 h / 6 h limits mean "Pay" must create a fresh order each time it is clicked. Don't pre-create orders at deal creation.
10. **Currency:** USD only, with a US sandbox business account.
11. **Browser SDK:** use the documented V5 path (`PayPalScriptProvider` with `intent: 'authorize'`), because PayPal's authorize guide is written for it. V6 is the newer default but its authorize flow is unverified. Switch only if V5 misbehaves.
12. **Payout receiver:** the seller's PayPal email, collected at deal creation. In the demo use a second sandbox personal account. A non-sandbox email gives `UNCLAIMED`, which is useful for showing the unhappy path.

## Open risks (UNVERIFIED)

1. **Capturing the original authorization on days 4-29 without reauth.** The docs conflict. Guide and intent text say "capture up to 29 days". The Orders schema says the original "expires" after the honor period. Can't be tested in sandbox within the timeline.
2. **Reauthorize count.** Schema says "only once"; guide and operation text say "multiple". Error codes imply once per original. Treat as once.
3. **Sandbox Payouts enablement.** Whether the sandbox REST app needs a Payouts feature toggle. Check the dashboard on day 1.
4. **Sandbox business default balance amount.** Not stated. Check on sandbox.paypal.com.
5. **Webhook delivery timeout.** Not documented. Respond in under a few seconds.
6. **Payouts test values (ERRPYO…) and webhooks.** Unknown whether they emit webhooks. Assume not.
7. **V6 React buttons with AUTHORIZE orders.** Not documented. Use V5.
8. **Sandbox triggers for capture `PENDING`.** Reasons are enumerated, but no sandbox recipe was found except negative testing via `PayPal-Mock-Response`.
9. **Dispute creation in sandbox (buyer side).** No primary doc found (feature cut).
10. **Retention numbers for Orders and Payments idempotency keys (6 h / 45 d).** These come from the official SDK's generated docstrings. The OpenAPI schema header text doesn't repeat them.
11. **Capture without `amount` captures the full authorized amount.** Implied by the guide sample (no body). Send `final_capture: true` and, to be safe, the explicit amount.
12. **Accessing the SDK's cached token for raw calls.** Undocumented. Use our own small cache.
