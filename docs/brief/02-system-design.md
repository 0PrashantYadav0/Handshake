> Original brief, exported 2026-10-09 from https://claude.ai/artifact/WUfZLJt14WMczryiEVHmt3 — superseded by the matching docs/0N-*.md where they differ.

# System design

Handshake is one Next.js service with a Postgres database; the browser never calls PayPal's server APIs or the AI model directly.

## Components

_[diagram: system components · one server, three outside services]_

PayPal is the only two-way link: the server calls its APIs, and PayPal calls back through webhooks. The browser's one direct contact with PayPal is the approval button from the JavaScript SDK.

| Component | Responsibility |
| --- | --- |
| Web app | Pages for the deal, evidence upload, verdicts and the ledger; API routes; session handling |
| PayPal client | A typed wrapper for orders, authorizations, payouts and webhook verification; adds idempotency keys |
| AI client | Sends prompts, validates JSON against the schemas, stores raw responses |
| Decision function | Pure code that turns verdicts into one of four actions |
| State machine | The only module allowed to change `deals.status`; writes a `deal_events` row on every change |
| Background jobs | Reauthorize holds near the end of the honor period; void deals past their deadline; refresh tracking |
| Postgres | All state; the audit log |
| File storage | Private evidence files, served through short-lived signed URLs |

## Deal state machine

| From | Trigger | To | Side effect |
| --- | --- | --- | --- |
| draft | Both parties accept the same terms version | terms_agreed | None |
| terms_agreed | PayPal authorization created | held | Store authorization id and expiry times |
| held | Seller submits evidence | proof_submitted | Run the verdict call |
| proof_submitted | Decision is capture | captured | Call capture |
| proof_submitted | Decision is request fix | held | Mark the one fix attempt as used |
| proof_submitted | Decision is buyer review | in_review | Notify the buyer |
| proof_submitted | Decision is void | voided | Call void |
| in_review | Buyer approves | captured | Call capture |
| in_review | Buyer rejects | voided | Call void |
| captured | Payout succeeded | paid | None |
| terms_agreed or held | Either party cancels, or the deadline passes | voided | Call void if a hold exists |
| paid | PayPal dispute created | disputed | Create the disputes row |

Any transition not in this table is rejected with `invalid_state`.

## Happy path sequence

1. The buyer posts one sentence; the server calls the AI and stores the deal as draft.
2. The buyer shares the link; the seller joins, adds a PayPal email, and both accept.
3. The buyer clicks the PayPal button; the server creates the order with intent AUTHORIZE.
4. The buyer approves in PayPal; the server authorizes the order and the deal becomes held.
5. The seller uploads files to storage through signed URLs, then submits the evidence set.
6. The server fetches the carrier status, calls the AI once, and stores a verdict per condition.
7. The decision function returns capture; the server captures the authorization.
8. The capture webhook arrives; the server sends the payout to the seller.
9. The payout webhook arrives; the deal becomes paid.

## Design decisions

- **Webhooks are the source of truth for payment state.** API responses update the UI optimistically, but status changes only when the matching webhook is processed, or after a direct status check if it is late.
- **Idempotency everywhere.** Each PayPal write uses a key derived from the deal id and the action, so a retry can never capture twice.
- **The AI is isolated.** It receives data and returns JSON. It has no tools and no credentials.
- **Failure is safe.** A model error, an invalid verdict or a carrier outage leads to buyer review, never to capture or void.
- **Platform as merchant.** In this build the Handshake sandbox business account receives the capture and pays the seller through Payouts. Production would make the seller the payee through PayPal's multiparty onboarding.
- **Time limits.** PayPal holds last 29 days with a 3-day honor period, so deals are capped at 21 days and a daily job reauthorizes open holds.
