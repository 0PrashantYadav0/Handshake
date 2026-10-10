> Original brief, exported 2026-10-09 from https://claude.ai/artifact/WUfZLJt14WMczryiEVHmt3 — superseded by the matching docs/0N-*.md where they differ.

# Product requirements

Handshake lets two strangers agree a deal in one sentence, holds the buyer's money through PayPal, and releases it only when AI-checked proof matches the terms.

## Problem and users

In a deal between strangers, whoever goes first carries all the risk. Buyers fear paying for something that never arrives; sellers fear shipping to someone who never pays.

| User | Situation | What they need |
| --- | --- | --- |
| Buyer | Buying from an individual seller found on social media or a marketplace | Not to be charged unless the item matches what was promised |
| Seller | Selling to a buyer they have never dealt with | Certainty that the money exists before shipping, and proof if a dispute follows |
| Reviewer (the buyer, in this build) | The AI could not decide | The evidence and the AI's reasons on one screen |

## Goals and non-goals

**Goals**

- A deal goes from sentence to paid, or to voided, without either side contacting support
- The AI never moves money; a fixed rule in code does
- Every deal leaves a complete, exportable evidence trail

**Non-goals for the hackathon**

- Real money, multiple currencies, a mobile app
- Seller identity checks or ratings
- Acting as a licensed escrow service; the product is described as "pay on proof"

## User stories

| ID | As a | I want to | So that |
| --- | --- | --- | --- |
| US-1 | Buyer | Describe a deal in one sentence | I don't fill in a form |
| US-2 | Buyer | See the conditions the AI extracted and edit them | The terms say what I meant |
| US-3 | Seller | Open a link and accept or decline the terms | I know exactly what I must prove |
| US-4 | Buyer | Approve the payment with PayPal without being charged | My money is safe until proof arrives |
| US-5 | Seller | Upload photos and a tracking number | I can show I delivered |
| US-6 | Both | See a verdict per condition with a reason | The outcome is explainable |
| US-7 | Seller | Fix a failed condition once | An honest mistake does not kill the deal |
| US-8 | Buyer | Decide when the AI is unsure | A human makes the close calls |
| US-9 | Seller | Download the evidence pack | I can answer a dispute |
| US-10 | Either | See all my deals in one ledger | I can track status and history |

## Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 | Create a deal from free text; return item, amount, currency, deadline and 1 to 5 conditions | Must |
| FR-2 | Reject conditions that cannot be checked from evidence, and ask for a rewording | Must |
| FR-3 | Share a deal by link; the other party joins with an email magic link | Must |
| FR-4 | Both parties must accept the same version of the terms before payment | Must |
| FR-5 | Create a PayPal order with intent AUTHORIZE and authorize it after buyer approval | Must |
| FR-6 | Accept evidence: up to 6 images, one tracking number, one free-text note | Must |
| FR-7 | Produce a verdict per condition: pass, fail or unclear, with confidence and reason | Must |
| FR-8 | Apply the decision function: capture, request a fix, void, or send to buyer review | Must |
| FR-9 | Pay the seller through Payouts after a successful capture | Must |
| FR-10 | Void the hold when the deadline passes with no passing proof | Must |
| FR-11 | Reauthorize open holds before the honor period ends; cap deals at 21 days | Must |
| FR-12 | Record every state change with actor, time and cause | Must |
| FR-13 | Show a ledger of the user's deals with sort, filter and status | Must |
| FR-14 | Export an evidence pack as PDF or JSON | Should |
| FR-15 | Detect a PayPal dispute by webhook and attach it to the deal | Should |
| FR-16 | Submit the evidence pack to the Disputes API | Stretch |
| FR-17 | Accept a merged GitHub pull request as proof | Stretch |
| FR-18 | Split a captured payment between several recipients | Stretch |

## Non-functional requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-1 | Safety | No code path lets model output call a PayPal endpoint directly |
| NFR-2 | Safety | Deals above 200 USD always need buyer confirmation before capture |
| NFR-3 | Correctness | Every PayPal write call carries an idempotency key; webhooks are processed at most once |
| NFR-4 | Security | Webhook signatures are verified; secrets live only in environment variables |
| NFR-5 | Security | A user can read only deals where they are buyer or seller |
| NFR-6 | Performance | A verdict returns within 20 seconds for 6 images |
| NFR-7 | Privacy | Evidence files are private; links are signed and expire |
| NFR-8 | Usability | The other party can complete their side on a phone browser with no install |
| NFR-9 | Auditability | The evidence pack can be rebuilt from the database alone |

## Acceptance for the demo

- [ ] A deal reaches Paid in the sandbox with no manual database edits
- [ ] A deal with wrong evidence reaches Voided and the buyer's hold is released
- [ ] An unclear verdict reaches the buyer and both of their choices work
- [ ] The ledger shows all three deals with correct history
