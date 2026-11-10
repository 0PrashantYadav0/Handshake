# Product requirements

This document decides what Handshake must do for the PayPal AI Hackathon, for whom, in what priority, and what a judge must see on the hosted demo.

As of 2026-10-09. Supersedes the original brief (a Claude Doc, not kept in the repo) where they differ; every name follows [decisions.md](decisions.md). Rules and dates are in [hackathon.md](hackathon.md).

Handshake lets two strangers agree a deal in one sentence, holds the buyer's money through a PayPal authorization, and releases it only when AI-checked proof matches the terms and a fixed rule in code says so.

## Problem and users

In a deal between strangers, whoever goes first carries all the risk. Buyers fear paying for something that never arrives; sellers fear shipping to someone who never pays. Neither side has evidence they can show if the deal goes wrong.

| User | Situation | What they need |
| --- | --- | --- |
| Buyer | Buying from an individual seller found on social media or a marketplace | Not to be charged unless the item matches what was promised |
| Seller | Selling to a buyer they have never dealt with | Certainty that the money exists before shipping, and proof if a dispute follows |
| Reviewer (the buyer, in this build) | The AI could not decide | The evidence and the AI's reasons on one screen, and two buttons |
| Judge | Tests the hosted demo 2026-12-01 to 2026-12-15 with one browser | To play both sides and reach `paid` in ten minutes without a second account or any install |

## Goals and non-goals

The product goal is a deal that goes from sentence to money moved without anyone contacting support, and without the model ever touching money.

**Goals**

- A deal goes from sentence to `paid`, or to `voided`, without either side contacting support.
- The AI never moves money; the decision function in code does (D9).
- Every deal leaves a complete, exportable evidence trail that can be rebuilt from the database alone.
- A judge completes a full deal in one browser in ten minutes, on demand, any day until 2026-12-15 (A2).

**Non-goals for the hackathon**

| Non-goal | Why |
| --- | --- |
| Real money, currencies other than USD, a native mobile app | Sandbox only; USD only (A6); the seller flow is a mobile-first web page |
| Seller identity checks or ratings | Out of scope for a demo |
| Acting as a licensed escrow service | The product is described as "pay on proof"; the platform's sandbox business account is the merchant (E10) |
| Disputes, GitHub PR proof, split payouts, PDF export | Cut (A5); see "Later" below |
| Reauthorizing holds | PayPal allows effectively one reauthorization per hold and none in the first 3 days, so deals are capped at 21 days instead (B7) |
| A platform fee | The payout is the full captured amount (E7) |
| Giving the model tools | Agentic Commerce is not a target (A4); the model only returns JSON |

## User stories

User stories US-1 to US-10 are unchanged from the brief; US-11 to US-16 are new.

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
| US-11 | Judge | Sign in as the demo buyer or the demo seller with one click and switch between them | I can play both sides in one browser |
| US-12 | Judge | Fill the sentence, reference photos and evidence from samples | I do not need my own photos to test |
| US-13 | Seller | Fix my PayPal email and retry a failed payout | A typo does not lose the money |
| US-14 | Either | Cancel a deal before proof is submitted | A hold is released when we both walk away |
| US-15 | Either | See a dashboard of deal history | I can see outcomes, not just rows |
| US-16 | Either | Ask the dashboard a question in plain English | I get a chart without building one |

## Functional requirements

Functional requirements keep the brief's IDs; FR-15 to FR-18 are moved to the "Later" table, and FR-19 onward are new. The "Decision" column names the entry in [decisions.md](decisions.md) that fixes the detail.

| ID | Requirement | Priority | Decision |
| --- | --- | --- | --- |
| FR-1 | Create a deal from one sentence of at most 500 characters. Extraction receives the sentence and today's date only and returns `item_title`, `amount_minor`, `currency`, `deadline_days` and 1 to 4 conditions, each with `evidence_type` `photo` or `tracking`. When any photo condition exists, the server (never the model) appends the condition "Photo shows the deal code {code} written by hand", so a deal has at most 5 conditions. `amount_minor` and `deadline_days` may be `null`; the UI asks for them before the deal is created. | Must | D6, H3 |
| FR-2 | Subjective or uncheckable parts of the sentence go to `rejected[]` with a suggested rewording, shown to the buyer. A sentence with zero checkable conditions is rejected with `condition_not_checkable`. | Must | D6, H2 |
| FR-3 | Share a deal by its link `/deal/{code}`, where `{code}` is `HS-` plus 4 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`. A signed-in user who is not a party sees a preview (`code`, `item_title`, `amount_minor`, `currency`, `deadline_days`, `conditions`, buyer `display_name`) of a `draft` deal with no seller and may `join` as seller. | Must | F4, I4 |
| FR-4 | Both parties accept the same `terms_version` before payment. A buyer `edit_terms` increments `terms_version` and clears both acceptances. The `accept` that makes both accepted versions equal moves the deal to `terms_agreed`, and only if the seller has a `paypal_email` (else `paypal_email_required`). | Must | C2 |
| FR-5 | `start_payment` creates a PayPal order with intent `AUTHORIZE` for the deal amount in USD, with `public_code` in the purchase unit's `custom_id` (key `order-{code}-{n}`, `n = payments.order_attempts`; a stored order under 6 h old and still unapproved is reused without a PayPal call). After the buyer approves in the PayPal popup, the app authorizes the order and stores the original `authorization_id`, `authorized_at` and `auth_expires_at`, and sets `deadline_at = authorized_at + deadline_days`. The `authorization_created` fact is applied once, from the authorize response or the webhook, whichever arrives first. If the buyer closes the tab after approving, `CHECKOUT.ORDER.APPROVED` authorizes the order server-side. | Must | C2, C3, E2, E3, E8, E9 |
| FR-6 | Accept evidence: up to 6 photos, one tracking number, one note of at most 1,000 characters. Photos are JPEG, PNG or WebP up to 2 MB each; the browser downscales to 1600 px on the long edge at JPEG quality 0.85 before upload. The buyer uploads up to 4 reference photos at creation. A deal has at most two submissions: the first, and one more after a fix request. | Must | B6, H3, I2 |
| FR-7 | For every condition, return `pass`, `fail` or `unclear` with a confidence and a reason. The verdict runs inside `POST /api/deals/{code}/evidence` (AI call capped at 17 s inside a 19 s abort signal; the request takes 6 to 12 s typically and about 40 s worst case with the PayPal calls; the UI waits 45 s) and the response is `200` with the final state. Any model failure, timeout, refusal, schema mismatch or missing verdict yields `unclear` for the affected conditions. An evidence photo whose `sha256` equals any reference photo's fails every photo condition without a model call. Tracking conditions are judged from the mock carrier status (FR-26). | Must | B5, D4, D7, D8 |
| FR-8 | A fixed decision function in code, never the model, maps the verdicts to `capture`, `request_fix` (at most once per deal), `void` or `buyer_review`. The function is shown below and is unit-tested row by row. | Must | D9 |
| FR-9 | Capture uses the original `authorization_id` with key `capture-{code}-{n}` (`n = payments.capture_attempts`, advanced only by a decline). On the first sight of capture `COMPLETED` (API response or `PAYMENT.CAPTURE.COMPLETED`), create a Payouts batch to the seller's `paypal_email` for the captured amount; no platform fee. `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` moves the deal to `paid`. A failed, blocked, returned or unclaimed payout keeps the deal `captured` and stores the reason (`UNCLAIMED` keeps `paypal_item_id`). **Should** (cut order 6): the seller fixes `paypal_email` and calls `retry_payout`, which creates attempt `n + 1` after `FAILED`, `BLOCKED` or `RETURNED`, or after `UNCLAIMED` once the item cancel succeeds. **Should** (cut order 7): `PAYMENT.CAPTURE.DECLINED` moves a `captured` deal to `in_review` and notifies both parties. | Must; Should for `retry_payout` and the declined path | C2, C4, E5, E7 |
| FR-10 | The `tick` job (every 10 minutes) voids `held` and `in_review` deals whose `deadline_at` has passed (Must). **Should** (cut order 7): it also re-runs the verdict for deals stuck in `proof_submitted` for more than 2 minutes. It does nothing else and skips `seeded = true` rows. | Must; Should for the verdict re-run | B7, C5 |
| FR-11 | Cap every deal at 21 days after authorization: `deadline_days` is 1 to 21, and `deadline_at` is never later than `authorized_at` + 21 days, inside PayPal's 29-day authorization validity. There is no reauthorize call anywhere; capture on days 4 to 21 uses the original hold. (Replaces the brief's reauthorize requirement.) | Must | B7, E3, E11, I3 |
| FR-12 | Record every accepted command and every applied PayPal fact as exactly one row in the append-only `deal_events` table, in the same transaction as the change (including rows that leave `status` unchanged; file uploads write none), with `from_status`, `to_status`, `actor` (`buyer`, `seller`, `system`, `paypal`, `ai`), `cause` (exactly one of the C6 strings) and a `payload` with the ids needed to explain the step; every `fact:*` payload carries `source` and `paypal_request_id` or `paypal_event_id`. | Must | C6 |
| FR-13 | `/ledger` lists the signed-in user's deals on AG Grid Community with sort, filter and a status column, including seeded history. | Must | G1, G3, F6 |
| FR-14 | `GET /api/deals/{code}/evidence-pack` returns the evidence pack as JSON: the deal, conditions, evidence rows with each file's `sha256` and a signed URL, verdicts with `model` and `prompt_version`, payments, payouts and every `deal_event`. PDF is Later. | Must | A5, B2, D10, H1 |
| FR-19 | Demo personas: when `DEMO_LOGIN=true`, `POST /api/auth/demo { persona: "buyer" \| "seller" }` signs in as the seeded `demo-buyer@handshake.demo` or `demo-seller@handshake.demo`, and the header shows a persona switcher that keeps the current URL. The demo seller's `paypal_email` is `DEMO_SELLER_PAYPAL_EMAIL`. | Must | F3 |
| FR-20 | Demo kit under `public/demo/`, with the files, sentences and sets exactly as [08-ui-spec.md](08-ui-spec.md) sections 12.1 and 12.2: `public/demo/presets.json` with three presets, each one item with its own price, deadline, listing photos and paired evidence set (`mug` $18, 5 days, paired with `good` and `reuse-listing`; `lamp` $35, 7 days, paired with `wrong-item`; `bottle` $22, 7 days, paired with `blurry`) and two extras that reuse the mug's photos (`mug-over-limit`, $250, shows `amount_over_limit`; `mug-subjective`, $45 with "looks nice", shows the rejected-conditions block); `reference/{mug,lamp,bottle}/ref-1.jpg`, `ref-2.jpg`, `code-base.jpg`; `evidence/{good,wrong-item,blurry}/`; `fonts/handwriting.woff2` and `fonts/OFL.txt`. Every preset sentence states the price and the deadline, so `/new` never asks for them. Sentence chips and "Use sample" buttons fill the sentence and upload the photos. The handwritten-code photo is composed in the browser on a canvas (sample photo plus the deal code in a handwriting font) because codes are generated per deal. The README discloses this. | Must | F5 |
| FR-21 | On-demand demo deal: no pre-made live deals exist. A judge creates a deal and reaches `paid` in one session, any day from 2026-11-12 to 2026-12-15. Seeded deals carry `seeded = true` and have no PayPal objects. | Must | A2, F6 |
| FR-22 | Seed data: the two demo users plus 25 historical deals in mixed statuses, flagged `seeded = true`, with full `deal_events` histories (including fix requests and buyer reviews) but no PayPal objects, so the ledger and dashboard have something to show. The distribution is the one in [03-database-schema.md](03-database-schema.md) "Seed": draft 3 (two with `seller_id` null), terms_agreed 2, held 4, in_review 2, captured 2, paid 8, voided 4; none is ever in `proof_submitted`. `tick` and every command skip `seeded = true` rows, so seeded deals are read-only. | Must | F6 |
| FR-23 | `/dashboard` renders an AG Studio dashboard over `GET /api/dashboard/data` with a custom theme and one custom widget. The AG Studio trial key is requested on or after 2026-11-01 so it lasts through judging. | Should | G3 |
| FR-24 | A custom Claude-backed Studio agent via `POST /api/studio/agent` with thinking off, so a user can ask the dashboard a question in plain English. | Could | G3 |
| FR-25 | USD only. Extraction returns `currency` as `"USD"` or `null`; any other value is rejected with `unsupported_currency`. Amounts are at most 1,000,000 minor units. | Must | A6, H3 |
| FR-26 | Mock carrier, disclosed: a tracking number whose last character is an even digit is `delivered`, an odd digit is `in_transit`, anything else is `unknown`. The demo kit uses `TRK-DEMO-0000`. The README and the tracking field on the evidence form say the carrier is a mock. | Must | D7 |
| FR-27 | Magic-link sign-in: `POST /api/auth/magic-link { email }` emails a 15-minute link via Resend; `GET /api/auth/callback?token=…` sets the session. In development the link is printed to the console. | Should | F1, F2 |
| FR-28 | A verified Resend sending domain so magic links reach any address, not only the account owner's. | Could | F2 |
| FR-29 | Cancel: the buyer or the seller may `cancel` a deal in `draft`, `terms_agreed` or `held`; the deal becomes `voided` and the authorization, if any, is voided. | Must | C2 |
| FR-30 | Buyer review: on an `in_review` deal the buyer sees every condition's verdict, confidence and reason next to the evidence and chooses `review { approve }` (capture) or `review { reject }` (void). A deal still `in_review` at `deadline_at` is voided. | Must | C2, C5 |
| FR-31 | Profile: `GET /api/me` and `PATCH /api/me { display_name, paypal_email }`, called from the inline PayPal email form on the deal page (08 section 7.5). The seller must set `paypal_email` before the deal can reach `terms_agreed`. **Should** (cut order 8): the `/me` page. | Must; Should for the `/me` page | F7, C2 |
| FR-32 | Email notifications: the buyer is emailed when a deal enters `in_review`; both parties are emailed on `capture_declined`. The deal page shows the same state without email, so the demo does not depend on delivery. | Should | B3, C2, F2 |

### Decision function (FR-8)

The decision function is the only thing that turns verdicts into money movement. It is pure, lives in `lib/deal/`, and never changes without a row-by-row unit test (D9).

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

`PASS_THRESHOLD` and `AUTO_CAPTURE_MAX_MINOR` are env vars (J3) with the defaults shown. On the second submission a `fail` voids only when the model is confident; a low-confidence `fail` goes to the buyer, because void is the one irreversible automated action against the seller (D9). The D8 hash guardrail writes `fail` rows with `confidence` 1, so a reused listing photo always voids on attempt 2.

### Deal lifecycle (FR-4, FR-5, FR-8 to FR-11, FR-29, FR-30)

`deals.status` is exactly one of `draft`, `terms_agreed`, `held`, `proof_submitted`, `in_review`, `captured`, `paid`, `voided` (C1). The full transition table is C2 in [decisions.md](decisions.md); [02-system-design.md](02-system-design.md) repeats it. Any other transition throws `invalid_state` and writes no event.

### Later

These requirements stay listed so the README can say what a production build adds. None is built for the hackathon.

| ID | Requirement | Why later |
| --- | --- | --- |
| FR-14 (PDF) | Export the evidence pack as PDF | A PDF renderer adds a dependency and a render path for no judging value; the JSON pack already holds everything (A5) |
| FR-15 | Detect a PayPal dispute by webhook and attach it to the deal | Sandbox dispute creation has no primary documentation (research/paypal.md, "Open risks" 9) and the `disputed` state and `disputes` table are cut (A5) |
| FR-16 | Submit the evidence pack to the Disputes API | Depends on FR-15 |
| FR-17 | Accept a merged GitHub pull request as proof | Needs the `link` evidence type, a GitHub integration and a different judge prompt; the demo is about physical goods (A5, D6) |
| FR-18 | Split a captured payment between several recipients | Payouts batches support it, but a second recipient adds a UI and a payout-failure matrix for no demo value (A5) |

### Cut order

Thirty days separate the start of code from the 2026-11-08 freeze, for one developer and a coding agent. If the work is behind at the end of W3 (2026-10-30), cuts are applied from the top of this list and stop as soon as the plan fits. Each cut is recorded in its GitHub issue (J5). [09-ag-studio.md](09-ag-studio.md) section 8 holds the hour budget for items 1 and 5.

| # | Cut | What remains |
| --- | --- | --- |
| 1 | FR-24 Studio agent. Trigger: the 3-hour spike has not round-tripped one tool call by the end of 2026-11-02 (09 section 8) | The dashboard without a prompt box (09 section 6.7) |
| 2 | FR-28 verified Resend domain | Magic links reach only the account owner's address (F2) |
| 3 | FR-32 email notifications become console-logged only | The deal page shows the same state; the `email` dep stays the console fake |
| 4 | FR-27 magic link | The landing page shows only the two persona buttons; `POST /api/auth/demo` is the only sign-in |
| 5 | FR-23 `deal-pipeline` custom widget, replaced by a built-in `funnel-chart` over `deals.status` (09 section 8 step 3) | Theme and layout still score; the "custom widget" box is unticked |
| 6 | FR-9 `retry_payout` and SB-10 | A failed payout writes `fact:payout_failed`, the deal stays `captured` and the page shows the reason; no `POST /api/deals/{code}/payout/retry` |
| 7 | FR-9 declined path (`capture_declined` → `in_review`) and FR-10 verdict re-run (`tick:reverify`) | The webhook is stored in `webhook_events` and processed as a detail-only event; the deadline void in `tick` stays |
| 8 | FR-31 `/me` page | `PATCH /api/me` behind the inline PayPal email form on the deal page (08 section 7.5) |
| 9 | FR-23 dashboard, last | `/dashboard` leaves the header and the four Studio packages go; the ledger stands |

Never cut: FR-1 to FR-8, FR-11 to FR-14, FR-19 to FR-22, FR-25, FR-26, FR-29, FR-30, NFR-15, the capture-and-payout core of FR-9 and the deadline void of FR-10. The four items in cuts 6 to 8 are labelled Should in the table above, so the Must set equals exactly what the demo video shows.

## Non-functional requirements

Non-functional requirements NFR-1 to NFR-9 keep the brief's meaning with the decided numbers; NFR-10 onward are new.

| ID | Area | Requirement | Decision |
| --- | --- | --- | --- |
| NFR-1 | Safety | No code path lets model output call a PayPal endpoint. Only `lib/deal/` calls authorize, capture, void or Payouts, and only from the decision function or a user command. | B2, D9 |
| NFR-2 | Safety | Deals above 200.00 USD (`amount_minor > 20000`) always need buyer confirmation before capture. | D9 |
| NFR-3 | Correctness | Every PayPal write carries a `PayPal-Request-Id` of at most 38 characters: `order-{code}-{n}` (`n = payments.order_attempts`, from 1), `auth-{code}` (once per deal), `void-{code}` (at most once per deal, on the stored `authorization_id`, or on a late authorization when none is stored), `void-{authorization_id}` (once per stray authorization on a deal that already stores a different one; `payments` untouched, event `fact:late_authorization_voided`; never used for the stored authorization), `capture-{code}-{n}` (`n = payments.capture_attempts`, from 0, reused on timeout, 5xx or crash); Payouts use `sender_batch_id` `payout-{code}-{n}`. Webhooks are processed at most once, keyed by PayPal event id. A PayPal fact is applied once from whichever source arrives first. Our own API has no `Idempotency-Key` header; double submits are rejected by the state machine. | B8, C3, E4, E6 |
| NFR-4 | Security | Webhook signatures are verified in our own code (cert from `PAYPAL-CERT-URL` on a `.paypal.com` host, CRC32 message, RSA-SHA256); a bad signature is stored with `verified = false` and answered `400`. Secrets live only in environment variables; `.env.example` has names and no values. | E6, J3 |
| NFR-5 | Security | A user reads a deal only as its buyer or seller (`not_a_party`), with one exception: a signed-in non-party may read the preview of a `draft` deal with no seller. | F4 |
| NFR-6 | Performance | The evidence request answers in 6 to 12 s typically and about 40 s worst case: the AI call is capped at 17 s inside a 19 s abort signal and the PayPal capture and payout add up to 20 s more; the UI waits 45 s. Extraction has a 15 s timeout with one retry; the verdict has 17 s per attempt with no retry (9 s with one retry if the eval shows p95 under 8 s). Whether Render's proxy allows a 40 s response is UNVERIFIED (02 section 12 spike 4). | B5, D4 |
| NFR-7 | Privacy | Photos are stored in Postgres (`files.bytes`) and served only by `GET /api/files/{id}` with an HMAC-signed URL that expires after 10 minutes. | B6 |
| NFR-8 | Usability | The seller completes their side on a phone browser with no install; the seller flow is mobile-first. | G1 |
| NFR-9 | Auditability | The evidence pack is rebuilt from the database alone: photos, verdicts (with `raw_response`), payments, payouts and events are all in Postgres. | B6, D10, I1 |
| NFR-10 | Availability | The hosted demo stays up from submission (2026-11-12) through 2026-12-15 on paid Render plans (web `0.5c-512mb`, Postgres `0.1c-256mb`, cron `*/10 * * * *`), inside the $50 credit. `GET /api/health` answers `200`. | A2, J2, H1 |
| NFR-11 | Lifetime | No deal outlives its hold: the 21-day cap leaves an 8-day margin before PayPal's 29-day authorization validity. | B7, C5 |
| NFR-12 | Recovery | A server restart mid-verdict loses nothing: `tick` re-runs the verdict for deals stuck in `proof_submitted` for more than 2 minutes (Should; cut order 7), a capture retry reuses `capture-{code}-{n}` so PayPal returns the first capture, and a failed webhook handler answers `500` so PayPal retries. | B7, E4, E6 |
| NFR-13 | Traceability | Every verdict row stores `model`, `prompt_version` (`extract-v1`, `judge-v1`) and `raw_response`. | D10 |
| NFR-14 | Prompt safety | Notes and text inside images are delimited and described as evidence, never followed as instructions; two eval cases test injection. | D11 |
| NFR-15 | AI quality | `npm run eval` runs 30 cases and prints the decision-match rate and the wrong-capture rate; the wrong-capture rate must be zero before submission. | D12 |
| NFR-16 | Cost | A verdict with 10 photos costs about $0.07 on Sonnet; the full eval about $2.40; hosting about $35 to 2026-12-15. | D5, J2 |
| NFR-17 | Disclosure | The README states: sandbox only; USD only; the carrier is a mock; the handwritten-code photo is composed in the browser; the platform's sandbox business account is the merchant and production would use multiparty onboarding. | D7, E10, F5 |
| NFR-18 | Submission | The repo is public with `LICENSE` (MIT) at the root, a README with run instructions, the hosted URL, sandbox test logins and the tools used, and a YouTube video under 3 minutes with no third-party trademarks. | A3 |

## Acceptance for the demo

The demo is accepted when every box below is ticked on the hosted Render URL, with no manual database edits. Test IDs refer to the sandbox scenarios in [06-test-plan.md](06-test-plan.md).

- [ ] A deal created on demand reaches `paid` in the sandbox (SB-1).
- [ ] A deal with wrong-item evidence gets one fix request, then reaches `voided` on the second wrong submission, and the buyer's hold is released in the sandbox (SB-2).
- [ ] A deal with blurry evidence reaches `in_review`; `approve` reaches `captured` then `paid`, and `reject` reaches `voided` (SB-4, SB-5).
- [ ] Closing the PayPal tab after approval still produces `held` (SB-6); a webhook delivered twice writes one event (SB-7).
- [ ] `/ledger` shows the three live deals and the seeded history with correct status and events.
- [ ] `GET /api/deals/{code}/evidence-pack` downloads for each of the three deals and matches the events shown.
- [ ] `/dashboard` renders with an AG Studio key valid through 2026-12-15, or renders with the watermark and no missing feature if the key lapses (hackathon.md, "Sponsor facts we rely on").
- [ ] The week-1 sandbox spike has confirmed capture of the original hold on days 4 to 21 (SB-0b, the day-4/12/21 capture script in 06) and whether Payouts needs a sandbox feature toggle (SB-0) (E11; both UNVERIFIED in research/paypal.md). SB-9 (reauthorize) and SB-12 (disputes) are cut and their ids are not reused (B7, A5).
- [ ] The $250 sentence with "Use sample evidence: Good" reaches `in_review` with reason `amount_over_limit`, and the $45 sentence shows the rejected-conditions block on `/new` (08 section 12.4).
- [ ] The one Playwright happy-path test passes locally before each deploy (A5, J4).
- [ ] Three outside testers each completed a deal from a phone as seller (A5).
- [ ] The README contains the sandbox personal login for the PayPal popup and the demo persona instructions (A3, E9).

## Judge walkthrough

A judge with one browser and no account goes from the landing page to a paid deal in about seven minutes, then sees a wrong-item deal voided and the dashboard, inside ten. Every status below is `deals.status`; the quoted text is the copy and the button labels from [08-ui-spec.md](08-ui-spec.md). Each deal uses one preset chip from the demo kit (08 section 12.2) with its paired evidence set: `mug` ("$18 mug, 5 days") with "Good", `lamp` ("$35 lamp, 7 days") with "Wrong item", `bottle` ("$22 bottle, 7 days") with "Blurry". The sandbox personal login for the PayPal popup comes from the README.

| Time | Who | Does | Must see |
| --- | --- | --- | --- |
| 0:00 | Judge | Opens the hosted URL `/` | "Pay on proof." with its sub-line, "Continue as buyer", "Continue as seller", a link to the README |
| 0:15 | Buyer | Clicks "Continue as buyer", lands on `/new`, clicks the first sentence chip ("$18 mug, 5 days"), clicks "Extract terms" | Within 15 s, retry included: `item_title`, "$18.00 USD", 2 to 5 conditions with "Photo shows the deal code HS-XXXX written by hand" last, and the days field already filled with 5 (the sentence states the deadline, so there is no "How many days?" prompt). The buyer clicks "Save terms" |
| 1:00 | Buyer | Clicks "Use sample listing photos" (`reference/mug/ref-1.jpg`, `ref-2.jpg`), clicks "Accept terms and get link" | The share link `/deal/HS-XXXX`, "Copy link", "You accepted version 1." and "Open deal page" |
| 1:30 | Buyer | Opens the deal | Status `draft`; "You accepted version 1. Share the link with your seller." No accept button |
| 1:45 | Seller | Uses the header switcher: "Seller". Same URL reloads | The preview (item, amount, deadline, conditions, buyer name) and "Join as seller" |
| 2:00 | Seller | Clicks "Join as seller", then "Accept terms" | Status `terms_agreed`; "Waiting for Demo Buyer to approve the hold" |
| 2:30 | Buyer | Switches to "Buyer". Clicks the PayPal button, logs into the popup with the README's sandbox personal account, approves | Popup closes. Status `held`; "Money held. Waiting for proof." with "$18.00" and the deadline 5 days out. The event list shows `fact:authorization_created` |
| 4:00 | Seller | Switches to "Seller". Clicks "Use sample evidence: Good" on the evidence form | The `good` photos plus the composed photo showing this deal's code; tracking `TRK-DEMO-0000` with the label "Demo carrier (mock)"; an empty note |
| 4:15 | Seller | Clicks "Submit proof for checking" | "Checking your proof…" with "Usually under 15 seconds, at most about 40." Then status `captured`: each condition `pass` with confidence of at least 0.85 and a one-sentence reason; "Payment released to you" |
| 5:00 | Either | Waits or refreshes | Status `paid`; "Paid": "$18.00 was sent to <DEMO_SELLER_PAYPAL_EMAIL>". The event list shows `fact:capture_completed` and `fact:payout_succeeded` |
| 5:30 | Either | Opens `/ledger` | An AG Grid with the new deal on top and the 25 seeded deals; sorting by any column and filtering by status work |
| 6:15 | Either | Opens the deal from the grid, clicks "Download evidence pack (JSON)" | A JSON file named `handshake-HS-XXXX-evidence-pack.json` with the deal, conditions, evidence, verdicts, payments, payouts and events |
| 6:45 | Buyer, Seller | Repeats 0:15 to 4:00 with the `lamp` chip ("$35 lamp, 7 days"; "$35.00 USD", days filled with 7) and "Use sample evidence: Wrong item" | After submit: status `held`; the "matches the listing photos" condition `fail` with its reason; seller heading "One more try", buyer heading "The first proof failed. One more try." |
| 9:00 | Seller | Clicks "Use sample evidence: Wrong item" again, clicks "Submit proof for checking" | Status `voided`; "Deal voided", "The proof failed twice.", "The hold of $35.00 was released. Nothing was charged." The event list shows `decision:void` and `fact:authorization_voided` |
| 9:30 | Either | Opens `/dashboard` | The AG Studio dashboard: custom theme, KPI and chart widgets over seeded and live deals, the custom widget, and (if FR-24 is built) the agent prompt box |

To see the buyer-decides path instead of the wrong-item path at 6:45, the buyer picks the `bottle` chip ("$22 bottle, 7 days"; "$22.00 USD", days filled with 7) and the seller uses "Use sample evidence: Blurry": status `in_review`, the buyer sees "Your decision: Claude couldn't decide" with every verdict and reason, and "Release payment" (→ `captured` → `paid`) or "Reject proof" (→ `voided`) works. Two extra chips in the kit each show one thing, both using the mug's photos: the $250 sentence (`mug-over-limit`) with "Use sample evidence: Good" passes every condition and still stops at `in_review` with "Your decision: this deal is over the auto-release limit" (`amount_over_limit`, D9); the $45 sentence (`mug-subjective`, "looks nice") shows the rejected-conditions block on `/new` with its suggested rewording (FR-2).

The first paid deal takes about five minutes; the remaining five are history, export and the second deal.

## Success for the demo video

The video shows three deals end to end in under three minutes, on the hosted demo, with no third-party trademarks or copyrighted music (A3). It is the only thing many judges will watch before opening the demo.

| Segment | Time | Deal | What is on screen |
| --- | --- | --- | --- |
| Problem and audience | 0:00 to 0:20 | none | One sentence on who goes first in a stranger-to-stranger deal, and who Handshake is for |
| Deal 1: paid | 0:20 to 1:20 | The `mug` preset ($18, 5 days), evidence set `good` | Sentence typed, conditions extracted, seller accepts on a phone, PayPal hold with "Money held", evidence submitted, every condition `pass` with a reason, `captured`, then `paid` with the payout arriving in sandbox personal account 2 (and the capture in the business account, E7, E10) |
| Deal 2: voided after a wrong item | 1:20 to 2:00 | The `lamp` preset ($35, 7 days), evidence set `wrong-item` twice | The "matches the listing photos" condition `fail` with the reason, "One more try", second wrong submission, "Deal voided", the hold released in the PayPal sandbox |
| Deal 3: buyer decides an unclear one | 2:00 to 2:35 | The `bottle` preset ($22, 7 days), evidence set `blurry` | A condition `unclear`, `in_review`, the buyer's review screen with evidence and reasons side by side, "Release payment", `captured` then `paid` |
| Trail and dashboard | 2:35 to 2:55 | all three | The ledger with the three deals, the evidence pack JSON opened, the AG Studio dashboard, and the decision function on screen for two seconds with the words "the model never moves money" |
| Close | 2:55 to 3:00 | none | Hosted URL and repo |

The video is cut from screen recordings of the hosted demo, not a local build, so what judges see later matches it.

## Requirements by judging criterion

Each functional requirement serves one judging criterion first (hackathon.md, "Judging") and, where relevant, one prize. The criteria have equal weight; ties break on criterion 1, so technological implementation gets the most requirements.

| FR | Primary criterion | Prize it supports |
| --- | --- | --- |
| FR-1 | 4 Innovation: one sentence replaces a contract form | Best Use of PayPal + AI |
| FR-2 | 1 Technological implementation: the model is told what it may not judge | Best Use of PayPal + AI |
| FR-3 | 2 Design: a share link and a preview, no sign-up wall | |
| FR-4 | 2 Design: both sides see one versioned set of terms | |
| FR-5 | 1 Technological implementation: `AUTHORIZE` intent, original authorization stored, webhook safety net | Best Use of PayPal + AI |
| FR-6 | 2 Design: phone-first evidence upload | |
| FR-7 | 1 Technological implementation: per-condition multimodal verdicts with structured output | Best Use of PayPal + AI |
| FR-8 | 4 Innovation: a fixed rule in code decides money, not the model | Best Use of PayPal + AI |
| FR-9 | 1 Technological implementation: capture, Payouts, declined and failed paths | Best Use of PayPal + AI |
| FR-10 | 1 Technological implementation: deadline void with no manual step | Best Use of PayPal + AI |
| FR-11 | 1 Technological implementation: lifetime fits PayPal's authorization rules | Best Use of PayPal + AI |
| FR-12 | 3 Potential impact: an audit trail is what a real dispute needs | |
| FR-13 | 2 Design: one ledger for every deal | Best Use of AG Grid |
| FR-14 | 3 Potential impact: evidence a seller can hand to PayPal or a court | |
| FR-19 | 5 Presentation: a judge plays both sides in one browser | |
| FR-20 | 5 Presentation: a judge needs no photos of their own | |
| FR-21 | 5 Presentation: the demo works on the day it is judged | |
| FR-22 | 2 Design: the ledger and dashboard are not empty | Best Use of AG Grid |
| FR-23 | 1 Technological implementation: AG Studio theme and custom widget | Best Use of AG Grid |
| FR-24 | 4 Innovation: a Claude agent inside the Studio Agent Framework | Best Use of AG Grid |
| FR-25 | 1 Technological implementation: one currency, no silent mismatch | |
| FR-26 | 5 Presentation: a disclosed mock keeps the tracking path demonstrable | |
| FR-27 | 2 Design: real sign-in for real users | |
| FR-28 | 2 Design: magic links reach everyone | |
| FR-29 | 2 Design: walking away releases the hold | Best Use of PayPal + AI |
| FR-30 | 3 Potential impact: a human makes the close calls | Best Use of PayPal + AI |
| FR-31 | 2 Design: the seller controls where money goes | |
| FR-32 | 2 Design: the buyer learns a decision is waiting | |

## Assumptions

Choices made here that [decisions.md](decisions.md) does not fix. Each is the simplest option consistent with it.

1. FR-14 (JSON evidence pack) is Must, not the brief's Should: `getEvidencePack` is in the module's public interface (B2), the endpoint is in H1, and the walkthrough and video both use it.
2. The evidence pack JSON contains the deal, conditions, evidence rows with each file's `sha256` and a signed URL (10-minute expiry), verdicts with `model` and `prompt_version`, payments, payouts and every `deal_event`. The download is named `handshake-{code}-evidence-pack.json` (08 section 7.12).
3. The demo kit is exactly [08-ui-spec.md](08-ui-spec.md) section 12: three presets (`mug` $18, 5 days, with `good` and `reuse-listing`; `lamp` $35, 7 days, with `wrong-item`; `bottle` $22, 7 days, with `blurry`) and two extras on the mug's photos (`mug-over-limit` $250, `mug-subjective` $45). Every preset sentence states the price and the deadline, so extraction fills `amount_minor` and `deadline_days` and `/new` never asks. The items may change only if the sentences and photos change together and the file names stay.
4. The persona switcher keeps the current URL and reloads the page as the other persona.
5. Seeded deals follow the distribution in [03-database-schema.md](03-database-schema.md) "Seed" (draft 3, terms_agreed 2, held 4, in_review 2, captured 2, paid 8, voided 4); none is ever in `proof_submitted`, and `tick` and every command skip `seeded = true` rows, so a deal with no PayPal objects is never acted on.
6. Email notifications (FR-32) are Should because Resend's test sender only delivers to the account owner's address (F2); the deal page is the primary channel.
7. The tracking field on the evidence form carries the label "Demo carrier (mock)" in addition to the README disclosure.
8. The time from capture `COMPLETED` to `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` in the sandbox is UNVERIFIED (research/paypal.md gives no figure); the walkthrough budgets one minute and lets the judge refresh.
9. The buyer may `accept` before a seller has joined (C2 allows `accept` by one party in `draft`), which saves one persona switch in the walkthrough.
10. The on-screen copy quoted in the walkthrough is taken from [08-ui-spec.md](08-ui-spec.md); where 08 changes, 08 wins.
11. The cut order's trigger date is the end of W3 (2026-10-30), the last milestone that leaves a full week for the Must set before the 2026-11-08 freeze; J5 names the milestones but not their dates.
