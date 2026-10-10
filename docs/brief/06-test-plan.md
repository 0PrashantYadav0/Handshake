> Original brief, exported 2026-10-09 from https://claude.ai/artifact/WUfZLJt14WMczryiEVHmt3 — superseded by the matching docs/0N-*.md where they differ.

# Test plan

Testing has one priority above all others: money must never move on a wrong or missing verdict.

## Levels

| Level | Tool | Covers | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | Decision function, state machine transitions, money and date helpers, schema validation | Every commit |
| Integration | Vitest with a test Postgres and a mocked PayPal client | API routes, webhook handler, idempotency, access rules | Every commit |
| Sandbox | Scripts against the PayPal sandbox | Real authorize, capture, void, reauthorize, payout, webhooks | Before each deploy |
| AI evaluation | The 30-case test set | Verdict quality and final decisions | On every prompt or model change |
| End to end | Playwright | Buyer and seller completing a deal in two browsers | Before each deploy |
| User | Five people outside the project | Whether a stranger can finish a deal unaided | Week 5 |

## Unit cases that must exist

- Decision function: every row of its truth table, including a missing verdict and confidence exactly 0.85
- State machine: each allowed transition succeeds; each disallowed one throws and writes no event
- Terms: editing after acceptance clears both acceptances
- Expiry: a deal past its deadline with no passing proof is selected by the job

## Sandbox scenarios

| ID | Scenario | Expected result |
| --- | --- | --- |
| SB-1 | Happy path with passing evidence | Order authorized, captured, payout succeeded, status paid |
| SB-2 | Wrong item, then no fix before the deadline | One fix requested, then authorization voided, status voided |
| SB-3 | Wrong item, then correct evidence | Fix accepted, captured, paid |
| SB-4 | Unclear verdict, buyer approves | Captured, paid |
| SB-5 | Unclear verdict, buyer rejects | Voided |
| SB-6 | Buyer approves in PayPal, then closes the tab | The approval webhook completes the authorization |
| SB-7 | Same webhook delivered twice | Second delivery ignored; one event row |
| SB-8 | Capture request sent twice with one idempotency key | One capture in PayPal |
| SB-9 | Hold older than 3 days | Reauthorize job stores a new authorization id |
| SB-10 | Payout fails (invalid recipient email) | Status stays captured; payout flagged for retry |
| SB-11 | Buyer cancels before proof | Authorization voided |
| SB-12 | Buyer opens a dispute in the sandbox | Dispute row created, status disputed (confirm sandbox support first) |

## Security checks

- [ ] A third signed-in user gets 403 on every deal endpoint
- [ ] A webhook with a bad signature is stored as unverified and not processed
- [ ] An evidence file URL stops working after its expiry
- [ ] No secret appears in the repo, the client bundle or the logs

## Exit criteria for submission

- [ ] All unit and integration tests pass in CI
- [ ] SB-1 to SB-11 pass on the hosted Render URL
- [ ] The AI evaluation shows zero wrong captures
- [ ] Four of the five outside testers finish a deal without help
