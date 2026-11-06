# Project plan

This document decides what gets built in which week, by whom, in what order, what proves each piece done, what is cut if the schedule slips, and how the hosted demo is kept alive until judging ends on 2026-12-15.

As of 2026-10-09. Names follow [decisions.md](decisions.md). Rules and dates come from [hackathon.md](hackathon.md). Every task names the document section it is built from and the command or scenario that proves it. Work is tracked as GitHub issues in milestones W1 to W5, one issue per task below, with the "Done when" column as the acceptance criteria (J5).

## Dates

Five working weeks separate today from submission; judging starts three weeks after that.

| Period | From | To | What it is |
| --- | --- | --- | --- |
| Today | 2026-10-09 (Friday) | | Docs reviewed; code starts |
| W1 | 2026-10-09 | 2026-10-15 | Scaffold, schema, CI, sandbox spikes, `lib/deal` against fakes |
| W2 | 2026-10-16 | 2026-10-22 | Real PayPal adapter, webhook receiver, routes, sessions, first-pass pages, Render deploy |
| W3 | 2026-10-23 | 2026-10-29 | Verdict job, uploads, evidence flow, eval set and runner, zero wrong captures |
| W4 | 2026-10-30 | 2026-11-05 | Demo kit, seed, dashboard, polish, evidence pack, outside testers |
| W5 | 2026-11-06 | 2026-11-11 | Hardening, SB-0 to SB-11 on the hosted URL, README, video, submission |
| Feature freeze | 2026-11-08 | | No new features after this day (A1) |
| Final deploy | 2026-11-09 | | The feature-frozen build; SB-0 to SB-11 on it (07 §9) |
| Video | 2026-11-10 | | Recorded on the hosted demo, uploaded to YouTube (07 §9) |
| Submit | 2026-11-11 | | README commit, e2e on the hosted URL, Devpost form; deploy freeze starts (A1, 07 §9) |
| Deadline | 2026-11-12 12:00 PST | | One day of buffer (hackathon.md) |
| Judging | 2026-12-01 | 2026-12-15 | Judges test the hosted app; demo deals are created on demand (A2) |

Fixed calendar items inside the weeks:

| Date | Item | Source |
| --- | --- | --- |
| 2026-10-10 | Accounts created: PayPal sandbox, Anthropic, Resend, Render credit, Discord post | 07 §3 |
| 2026-10-10 | Three sandbox holds created for the E11 capture spike (day 1) | 06 SB-0b, 07 §3.1 step 9 |
| 2026-10-12 | AG Grid live session "Build a payments dashboard without building a dashboard" | 09 §7 |
| 2026-10-13 | Day-4 capture of the first spike hold | 06 SB-0b |
| 2026-10-21 | Day-12 capture of the second spike hold | 06 SB-0b |
| 2026-10-30 | Day-21 capture of the third spike hold; cut-order decision point (end of W3) | 06 SB-0b, 01 "Cut order" |
| 2026-11-02 | AG Studio 45-day trial form submitted; agent-spike cut decision | 09 §7, §8 |
| 2026-11-06 | Chase the AG Studio key on Discord if it has not arrived | 09 §7 |
| 2026-11-30 | SB-1 run once more on the hosted URL before judging | 06 "Exit criteria" |
| Mondays 2026-11-16 to 2026-12-14 | Weekly health check of the hosted demo | 07 §8 |

## Milestones

Each milestone is the last day of its week and is done only when every line in its list is observed, not reported.

### M1: the deal module is correct against fakes, and the sandbox spikes have started (2026-10-15)

- `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:int` exit 0 locally and in GitHub Actions on `main`.
- `npm test` output names all 26 decision-function rows and the 2,000-case property test (06 "Decision function"), all 22 allowed C2 transitions and the generated disallowed-pair test (06 "Transition table").
- `npm run test:int` passes the "One per command" table, the "One per webhook event" table, the access-rules matrix, flows SB-1 to SB-5, SB-7, SB-8, SB-10, SB-11, the server-death and concurrency cases, and the append-only trigger test (06 "Integration cases").
- `scripts/sandbox/spike.ts payout --to <personal 2> --amount 1.00` has reached item `SUCCESS` (SB-0), three holds are authorized and their ids are in `scripts/sandbox/.state.json`, and the day-4 capture (2026-10-13) answered `COMPLETED` on the original authorization id (SB-0b).
- `tests/fixtures/webhooks/` holds recorded deliveries of `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` and `cert.pem`, and the webhook-signature unit test passes offline.

### M2: a deal reaches `held` on the hosted URL through the real PayPal popup (2026-10-22)

- `curl -fsS https://<host>/api/health` returns `200 {"ok":true}`; Render shows the web service, `handshake-db` and `handshake-tick` created from `render.yaml`; the first scheduled `handshake-tick` run exited 0.
- On the hosted URL, "Continue as buyer" → `/new` → a typed sentence → real extraction → "Accept terms and get link" → persona switch → "Join as seller" → "Accept terms" → PayPal popup with sandbox personal account 1 → status `held` with a `fact:authorization_created` event (01 "Judge walkthrough" rows 0:00 to 2:30).
- `npm run sandbox -- SB-6 --base https://<host>` passes with `payload.source` `"webhook"`; `SB-7` replay shows one `webhook_events` row for two deliveries; `SB-8` (`spike.ts capture ... --key capture-sb8-0` twice) returns one capture id.
- Spike 4 (02 §12): the measured Render response limit for a 40 s route is written into `02-system-design.md` §12 and `decisions.md` B5.
- `/ledger` on the hosted URL lists the deals of the signed-in persona in an AG Grid with sort and filter.
- The day-12 capture (2026-10-21) answered `COMPLETED`.

### M3: SB-1 reaches `paid` on the hosted URL and the eval shows zero wrong captures (2026-10-29)

- `npm run sandbox -- SB-1 --full --wait --base https://<host>` ends `paid` with the 11-row event trail of 06 "SB-1 happy path"; SB-2, SB-3, SB-4, SB-5, SB-10 and SB-11 pass on the hosted URL.
- `npm run eval` on `claude-sonnet-5-5` at `low` prints wrong captures `0` on two consecutive runs, decision match at least 24 of 30, refusals 0, p95 at most 12 s; both `eval/results/*.json` files are committed (06 "AI evaluation").
- `npm run test:int` passes the upload-limit and signed-URL cases; `GET /api/files/{id}` with `clock.advance(601_000)` answers 403.
- The cut-order decision (below) is recorded in the GitHub issues on 2026-10-30.

### M4: a judge completes the ten-minute walkthrough on the hosted URL with the demo kit (2026-11-05)

- The 01 "Judge walkthrough" table runs end to end on the hosted URL using only the `mug`, `lamp` and `bottle` chips and their "Use sample" buttons: `paid`, `voided` after two wrong submissions, `in_review` with approve and reject, and the `$250` chip stopping at `in_review` with `amount_over_limit`.
- `npm run seed` has run on Render; `/ledger` shows the 25 seeded deals plus the live ones; `/dashboard` renders the Studio theme, the nine widgets and the `deal-pipeline` custom widget (09 §5).
- `npm run test:e2e` passes locally against a production build.
- The day-21 capture (2026-10-30) result and the SB-0 result are recorded in `decisions.md` E11.
- Three outside testers have each submitted evidence from a phone; at least two finished unaided (06 "Outside testers").
- The AG Studio trial form was submitted on 2026-11-02; the key is on Render or the Discord chase is logged.

### M5: submitted (2026-11-11)

- 2026-11-08: the last feature commit is on `main` and CI is green.
- 2026-11-09: the final deploy is live; SB-0, SB-0b, SB-1 to SB-8, SB-10 and SB-11 outputs are pasted into the release issue (06 "Exit criteria").
- 2026-11-10: the video is public on YouTube, under three minutes, recorded on the hosted demo.
- 2026-11-11: the README commit with the video URL and the eval numbers is "Live" on Render; `PLAYWRIGHT_BASE_URL=https://<host> npm run test:e2e` passed; the repo is public with `LICENSE` at the root; the Devpost form shows "submitted"; the deploy freeze (07 §8) is in force.

## Task list

Fifty tasks, numbered in build order; the riskiest (PayPal hold behaviour, the money state machine, the hosted deploy, the verdict job) come first. Estimates are hours of combined developer and coding-agent time including tests. Area `user-action` marks work only the human can do.

Spec references use the document number and section: `02 §5.1` is [02-system-design.md](02-system-design.md) section 5.1; `06 "Fakes"` is the heading in [06-test-plan.md](06-test-plan.md); letters and digits such as `C2`, `E11` are entries in [decisions.md](decisions.md).

### W1: 2026-10-09 to 2026-10-15

| ID | Title | Area | Priority | Estimate | Depends on | Spec | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Create the PayPal sandbox: three accounts, one REST app, buyer login recorded | user-action | must | 2 | | 07 §3.1 steps 1 to 5; E1, E10 | (1) Custom-balance business account, custom-balance personal 1 and generated personal 2 exist; each personal login works at sandbox.paypal.com. (2) App `handshake` (type Merchant) has client id and secret. (3) The 07 §3.1 step 5 token call prints `payments/payouts`. (4) Personal 1 email and password are in a private note for the README; personal 2 email is `DEMO_SELLER_PAYPAL_EMAIL`. |
| T-02 | Create the Anthropic, Resend and Render accounts; claim the credit; post the AG Grid key request | user-action | must | 1 | | 07 §3.2, §3.3, §3.4 steps 1 to 2, §3.5 step 1; 09 §7 | (1) Keys `handshake-prod` and `handshake-local` exist; the Console shows a $75 monthly limit and the tier is noted. (2) `RESEND_API_KEY` exists. (3) Render Billing shows the $50 credit on 2026-10-11. (4) The Discord post asking for a Studio key valid through 2026-12-15, PRO-AI tier, is live. |
| T-03 | Repo scaffold: pinned packages, configs, env validation, health route, LICENSE, issues | infra | must | 4 | | dependencies.md "Install", "Known traps"; 07 §1, §2; 02 §4 (`lib/env.ts`, `lib/http.ts`); 04 §13 | (1) `npm ci` exits 0 and `npm ls --depth=0` shows the 31 pinned packages with no `invalid`. (2) `npm run lint`, `npm run typecheck`, `npm run build` exit 0; `curl localhost:3000/api/health` returns `{"ok":true}`. (3) `node -e "process.loadEnvFile()"` with a `.env` present exits 0 (dependencies.md "Not installed, on purpose"); `.env.example` has the 19 J3 names and no values. (4) `LICENSE` is the MIT text with `Copyright (c) 2026 Prashant Kumar Yadav`; GitHub milestones W1 to W5 exist with one issue per task in this table. |
| T-04 | Prisma schema, `init` and `constraints` migrations, `lib/db.ts` | infra | must | 4 | T-03 | 03 whole; I1 to I5; dependencies.md trap 11 | (1) `npx prisma migrate dev` applies `init` then `constraints` on a fresh `handshake` database. (2) In `psql`, `UPDATE deal_events SET cause='x'` and `DELETE FROM deal_events` raise `deal_events is append-only`; `TRUNCATE` works. (3) Every CHECK in 03 "Migration `constraints`" rejects its named bad row. (4) `npx prisma generate` writes `generated/prisma/` and `npm run typecheck` passes with `@/generated/prisma/client` imported from `lib/db.ts`. |
| T-05 | Test harness: Vitest projects, fakes, `lib/deps.ts`, `lib/clock.ts`, int helpers | testing | must | 5 | T-04 | 06 "Layout and commands", "Fakes", "Harness"; B3 | (1) `npm test` and `npm run test:int` run one smoke test each and exit 0; `global-setup.ts` throws on a URL not ending in `_test`. (2) `fakePaypal()` returns the stored response for a repeated `requestId`, and `failNext('captureAuthorization','timeout')` stores the capture then throws. (3) `fakeAi().judgeWith('missing_c2')`, `fakeEmail()` and `fixedClock('2026-10-20T10:00:00Z').advance(ms)` behave as 06 "Fakes" states. (4) `overrideDeps` is referenced by no file under `app/` or `lib/` (grep). |
| T-06 | CI workflow on GitHub Actions | infra | must | 2 | T-05 | 06 "CI"; 07 §6; J4 | (1) `.github/workflows/ci.yml` matches 06 "CI" step for step with the `postgres:18-alpine` service. (2) A push to `main` runs lint, typecheck, unit, integration and build green. (3) A deliberately failing unit test turns the run red, then is reverted. |
| T-07 | Pure deal core: `decide`, transition table, keys, code, terms, carrier, errors, money helpers | deal-core | must | 8 | T-05 | D6, D7, D9, E4, I4, H2; 05 §7; 02 §4, §8.1; 06 "Unit cases" | (1) `npm test` passes the 26 `decide()` rows and the 2,000-case property test by name. (2) `nextStatus` passes the 22 C2 rows and the generated 8-status × 17-trigger disallowed test, with the named cases in 06 "Transition table" in the output. (3) The idempotency-key, `public_code` (100,000 codes), carrier, money, date, error-mapping (16 codes, no extra member) and config tests pass. (4) `lib/deal/decide.ts` imports nothing from `lib/paypal/` or `lib/ai/`. |
| T-08 | Deal commands against fakes: create, addFile, edit_terms, join, accept, start_payment, confirm_approval, cancel, access, views | deal-core | must | 8 | T-07 | 02 §3, §5.1, §5.2, §8.2, §9.2; C2, C6, F4; 04 §3, §6, §7; 06 "One per command", "Terms versioning", "Access rules" | (1) `npm run test:int` passes the "One per command" rows for create through cancel, including the 6-hour order reuse and `order-{code}-2`. (2) The access-rules matrix passes, and the preview response has exactly the seven F4 keys. (3) Every command runs inside one transaction with `SELECT … FOR UPDATE` and writes exactly one `deal_events` row with a C6 `cause`. (4) The terms-versioning cases pass, including `paypal_email_required` and the re-appended code condition. |
| T-09 | Facts applied once and the webhook-to-fact mapping | deal-core | must | 6 | T-08 | C3, C4, E5, E7, E8; 02 §5.3, §5.5; 04 §11.4; 06 "Facts applied once", "One per webhook event" | (1) The `applyFact` unit cases pass, including `capture_completed` in `proof_submitted` → `captured` and `authorization_voided` in `captured` leaving status unchanged. (2) `applyPaypalEvent` passes every row of "One per webhook event" through the fake verifier, including the stray `AUTH-2` void with `void-AUTH-2` and the `held → held` detail-only payout event. (3) No webhook row ever throws `invalid_state`; unknown deals and unsubscribed types are stored, processed, 200. |
| T-10 | Verdict path, review, retry_payout, tick, and the SB flows against fakes | deal-core | must | 8 | T-09 | B5, B7, D8, E7; 02 §5.7, §5.8, §6, §8.2; 04 §9, §12; 06 "Flows SB-1 to SB-5 and SB-11", "SB-7", "SB-8", "SB-10", "Server death", "Concurrency", "Audit log", "Deadline selection" | (1) `npm run test:int` passes SB-1 to SB-5, SB-7, SB-8, SB-10 (both variants), SB-11, the server-death case and the three concurrency cases. (2) SB-1 writes the 11-row trail in `id` order with the exact causes and actors of 06. (3) `tick` passes the "Deadline selection" table and returns the `TickReport`; a failing void lands in `errors` without stopping the next deal. (4) `tests/unit/boundaries.test.ts` proves only `lib/deal/**` imports `lib/paypal/**` and `lib/ai/**` imports neither. |
| T-11 | Real PayPal adapter (six write methods, token cache) and `scripts/sandbox/spike.ts` | paypal | must | 6 | T-07 | E1 to E4; 02 §3.4, §8; 06 "Scripts"; research/paypal.md §2 to §5, §7; dependencies.md trap 18 | (1) `lib/paypal/index.ts` implements `createAuthorizeOrder`, `authorizeOrder`, `captureAuthorization`, `voidAuthorization` on the SDK with `timeout: 10_000` and `paypalRequestId`, and `createPayout`, `cancelPayoutItem` on raw `fetch` with `lib/paypal/token.ts`. (2) Adapter parsing unit tests pass on `tests/fixtures/paypal/*.json`; `PREVIOUSLY_VOIDED` maps to success. (3) `spike.ts create-hold --amount 25.00` prints an approve link and stores ids in `.state.json`; `authorize`, `capture`, `void`, `payout`, `status` run against the sandbox with the app's credentials. (4) The log line for a failed capture contains neither the bearer token nor the body (06 "Security checks"). |
| T-12 | Run the day-1 sandbox spikes: SB-0, SB-0b holds, SB-8, double void, UNCLAIMED payout, record webhooks | user-action | must | 2 | T-11, T-01 | E11; 06 SB-0, SB-0b, SB-8, "Webhooks locally and simulated"; 02 §12 spikes 1, 2, 3, 7; 07 §3.1 steps 7 to 9 | (1) On 2026-10-10: `spike.ts payout --to <personal 2> --amount 1.00` reaches `SUCCESS`, or the Payouts feature is enabled on the app and the rerun succeeds; the outcome is noted for E11. (2) Three holds are created, approved in the browser as personal 1, and authorized; a fourth hold is captured twice with `--key capture-sb8-0` and both calls return the same capture id (SB-8); one hold is voided twice (spike 7). (3) `spike.ts payout --to nobody-<timestamp>@example.com` yields `UNCLAIMED`. (4) With the tunnel pointed at `record-webhook.ts --port 3001`, the six E5 event types in M1 are written to `tests/fixtures/webhooks/` and `cert.pem` is saved; on 2026-10-13 the day-4 capture answers `COMPLETED`. |
| T-13 | Webhook signature verification and the recording proxy | paypal | must | 4 | T-12 | E6; 02 §9.4; 06 "Webhook signature", "Recording"; research/paypal.md §6 "Self-verification" | (1) `scripts/sandbox/record-webhook.ts` writes `<event_type>.<n>.json` in the 06 "Recorded webhook file shape". (2) `lib/paypal/verify.ts` passes every bullet of 06 "Webhook signature" offline with the recorded `PAYMENT.CAPTURE.COMPLETED` and `cert.pem`, including the three bad cert URLs and `crc32("hello") === 907060870`. (3) Re-serialised JSON fails verification; `WEBHOOK_ID` passes only outside production. |

W1 total: 60 hours. It is the heaviest week on purpose: everything that can invalidate the design (hold capture after day 3, Payouts enablement, signature verification, the state machine) is tried here. If T-09 or T-10 runs into W2, M2 does not move; T-21 and T-22 are the slack.

### W2: 2026-10-16 to 2026-10-22

| ID | Title | Area | Priority | Estimate | Depends on | Spec | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-14 | Sessions, magic link, demo personas, sign-out, profile, email adapters | web | must | 4 | T-08 | F1, F2, F3, F7; 02 §4 (`lib/auth`, `lib/email`), §9.1; 04 §4, §5; 06 "Config and sessions", "demo sign-in", "magic link", "sign out", "profile" | (1) The session unit tests pass: round-trip, expiry, wrong secret, purpose mismatch, cookie flags. (2) `POST /api/auth/demo` integration test passes, including the `paypal_email` restore after `PATCH /api/me` and 400 when `DEMO_LOGIN` is unset. (3) Magic-link callback redirects to `next` on success and to `/?error=invalid_link` otherwise; the console adapter prints the link when `RESEND_API_KEY` is empty. (4) `GET`/`PATCH /api/me` tests pass. |
| T-15 | Extraction job: client, `callJson`, schema, prompt, `extract()` and `finalizeTerms` | ai | must | 5 | T-07 | D1 to D4, D6; 05 §1, §2, §3; 06 "AI output validation" (extraction); research/claude-api.md §2, §3 | (1) `npm test` passes every extraction bullet in 06 "AI output validation" with the fake client, including `evidence_type: "file"` failing the parse and two `AiError`s → `ai_unavailable`. (2) `EXTRACT_SCHEMA` is hand-written JSON Schema with `enum` kept (dependencies.md trap 14) and a code comment saying why. (3) One live call with `ANTHROPIC_API_KEY` on the ten sentences of 05 §9.2 returns no 400 `BadRequestError` (05 §10.3 schema acceptance); `extract-v1` and the model id are returned for the `create` event payload. (4) The 15 s budget is two 7,000 ms attempts under one `AbortSignal.timeout(15_000)` (05 Assumption 1). |
| T-16 | Thin route handlers for deals, terms, join, accept, payment, authorize, cancel, events, evidence pack, list | web | must | 5 | T-14, T-15 | B4; 02 §4 (`app/api`), §3.3; 04 §1, §6, §7, §9.3, §10; H2 | (1) Each route is session → Zod → module → `toResponse(DealError)`; a grep finds no `prisma` import under `app/api/deals/`. (2) `callRoute` integration tests for every listed endpoint pass with the real handlers (06 "One per command" rows create to cancel, events, evidence pack, list, read). (3) An unhandled exception answers `500 internal_error` with no event written. |
| T-17 | Webhook receiver, `webhook_events` storage, `POST /api/jobs/tick` | paypal | must | 4 | T-13, T-09 | E6; 02 §4, §9.4; 04 §11, §12; 06 "Receiver behaviour", "tick"; research/stack.md §2 "Webhook raw body" | (1) The receiver tests pass: new verified → 200 and processed; same id → 200 and no new row; bad signature → 400, `verified = false`; processing throws → 500 and redelivery creates one payout; non-JSON → 400. (2) The handler verifies `request.text()` before parsing. (3) `POST /api/jobs/tick` answers 401 without the bearer (`timingSafeEqual`) and 200 `TickReport` with it. (4) A simulator event from 07 §3.1 step 8 through the tunnel is stored `verified = true`, processed, 200. |
| T-18 | First-pass pages: `/`, `/new`, `/deal/[code]` to `held`, header with persona switcher, PayPal button | web | must | 8 | T-16 | G1, G2, E9; 08 §1 to §5, §6 (steps 1, 2, 4; step 3 skippable until T-25), §7.1 to §7.6, §4.6 "First pass", §4.7; research/paypal.md §8 | (1) Locally, "Continue as buyer" → sentence → "Extract terms" → "Save terms" → "Accept terms and get link" → persona switch → "Join as seller" → "Accept terms" → persona switch → PayPal popup with personal 1 → `held`, with "Money held. Waiting for proof." (2) Every `data-testid` in 08 §4.7 that belongs to these pages exists. (3) `PayPalScriptProvider` is imported from the package root with `intent: "authorize"`; nothing imports `@paypal/react-paypal-js/sdk-v6`. (4) The "The hold wasn't confirmed" panel appears when authorize answers `paypal_error`, and the next click creates order `n + 1`. |
| T-19 | `render.yaml`, `next.config.ts`, production start, `playwright.config.ts` | infra | must | 2 | T-17 | J2; 07 §5; 06 "End to end" (`playwright.config.ts`); dependencies.md traps 9, 15, 16 | (1) `render.yaml` equals 07 §5 line for line (web `0.5c-512mb`, `preDeployCommand: npx prisma migrate deploy && npm run seed`, cron `*/10 * * * *`, Postgres `0.1c-256mb`, `diskSizeGB: 5`). (2) `npm run build && npm run start` serves `/api/health` locally with `NODE_ENV=production`. (3) No `proxy.ts` exists, or its matcher excludes `/api/deals/:code/files` and `/api/webhooks/paypal`. |
| T-20 | Apply the Blueprint on Render, set the dashboard env vars, create the hosted webhook, confirm the cron | user-action | must | 2 | T-19, T-01, T-02 | 07 §3.4 steps 3 to 7, §3.1 step 6, §2; research/stack.md §5 | (1) `curl -fsS https://<host>/api/health` returns 200. (2) App `handshake` has a webhook at `https://<host>/api/webhooks/paypal` with the eleven E5 events, and `PAYPAL_WEBHOOK_ID` and `APP_URL` are set in **handshake > Environment**. (3) **handshake-tick > Environment** shows `APP_HOST` equal to the web host, or the `sync: false` fallback of 07 Assumption 8 is applied; the next run (within 10 minutes) exits 0. (4) Render Billing shows the credit being drawn down; the workspace is still Hobby. |
| T-21 | Ledger on AG Grid Community | ag-grid | must | 4 | T-16 | FR-13; G3; 09 §3, §4; 08 §8; 04 §6.2 | (1) `/ledger` renders `listDeals` rows in `AgGridReact` with `AllCommunityModule`, default sort `last_event_at` descending, quick filter and a status pill cell. (2) `lib/status-labels.ts` exports `STATUS_LABEL` with `captured` as "Payment released". (3) An ESLint `no-restricted-imports` rule rejects `ag-grid-enterprise`, `ag-charts-enterprise` and `ag-charts-community` under `app/` and `lib/`; `npm run lint` passes. (4) The hosted `/ledger` shows the persona's deals after T-20. |
| T-22 | `scenario.ts`; SB-1 to `held`, SB-6, SB-7, SB-8 on the hosted URL; spikes 4 and 7 | testing | must | 5 | T-20, T-18 | 06 "Scripts", SB-1, SB-6, SB-7, SB-8; 02 §12 spikes 4 and 7; B5 | (1) `npm run sandbox -- SB-1 --base https://<host>` drives the deal to `held` and pauses correctly for the popup; the evidence half is M3. (2) SB-6 passes with `payload.source` `"webhook"`; SB-7's byte-identical replay answers 200 with one `webhook_events` row and no new `deal_events` row. (3) A temporary route that sleeps 40 s is called from outside Render; the result is recorded in 02 §12 and B5 and the route is deleted in the same day. (4) Spike 7's mapping (`PREVIOUSLY_VOIDED`, 204) is confirmed in `lib/paypal/index.ts`. |
| T-23 | Photograph the eval items and the demo kit items | user-action | must | 4 | | D12; 05 §9.1 "Photos"; 08 §12.1; 06 "Test data and fixtures" | (1) Eight household items (mug, headphones, book, sneakers, lamp, jacket, water bottle, keyboard) each have 2 listing photos, 2 to 3 clear proof photos from another angle on another day (one with the handwritten code from the 05 §9.1 list), a wrong-colour or wrong-model stand-in, a blurry or partial shot and a dark shot. (2) One note with `HS-ZZZZ`, one phone screen showing a code, one sheet with the 05 §6.2 injection sentence. (3) For `mug`, `lamp` and `bottle`: `ref-1.jpg`, `ref-2.jpg`, `code-base.jpg` (item beside a blank note card), plus `evidence/good/photo-1.jpg`, `photo-2.jpg`, `evidence/wrong-item/photo-1.jpg`, `photo-2.jpg`, `evidence/blurry/photo-1.jpg`. (4) Everything is downscaled to 1600 px JPEG quality 0.85 and the eval set is under 60 MB. |
| T-24 | Day-12 capture of the second spike hold | user-action | must | 0.5 | T-12 | 06 SB-0b; E11 | (1) On 2026-10-21 `spike.ts capture --auth <second id>` answers 201 `COMPLETED` on the original authorization id. (2) The output is pasted into the E11 spike issue. |

W2 total: 43.5 hours.

### W3: 2026-10-23 to 2026-10-29

| ID | Title | Area | Priority | Estimate | Depends on | Spec | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-25 | Uploads, signed file URLs, browser downscale, `/new` step 3 | web | must | 5 | T-16 | B6, H3, I2; 02 §4 (`lib/files`), §9.3; 04 §8; 08 §6.3, §7.7 (staging and downscale); 06 "Signed file URLs", "Upload limits"; research/stack.md §8, §9 | (1) The signed-URL unit tests and the upload-limit integration tests pass, including `Content-Length` over 2,621,440 rejected before the body is read and magic-byte sniffing. (2) `GET /api/files/{id}` round-trips bytes with the stored mime and `Cache-Control: private, max-age=600`; 601 s later it answers 403. (3) The browser downscales to 1600 px JPEG 0.85 before upload; "Use sample listing photos" is wired once T-33 lands, and plain file choice works now. (4) A non-decodable file (HEIC in Chrome) shows the 08 error copy instead of a silent failure. |
| T-26 | Verdict job: schema, prompt, image labelling, post-processing, failure mapping, injection defences | ai | must | 6 | T-15 | D2 to D5, D10, D11; 05 §4, §5, §6.2, §8; 06 "AI output validation" (verdict); research/claude-api.md §3 "Job 2", §4, §6 | (1) `npm test` passes every verdict bullet of 06 "AI output validation" with the fake client: casing, clamping, dropped ids, duplicate ids, empty `evidence_used` on a pass, reason trimming, the five `failureReason` strings, and "`judge()` never throws". (2) Images are base64 blocks each preceded by `Reference r1:` / `Evidence e1:` labels. (3) A unit test on the built prompt string shows notes and condition text delimited and described as evidence (D11). (4) One live call on `correct-01-mug` returns no 400 and a `judge-v1` `prompt_version`. |
| T-27 | Evidence, review and payout-retry routes wired to the real adapters | deal-core | must | 3 | T-26, T-25, T-10 | B5; 02 §4 (`lib/deps.ts`), §5.8; 04 §9.1, §9.2, §9.4; 05 §6.1; 06 "submit_evidence", "review", "retry_payout" | (1) `POST /api/deals/{code}/evidence` answers 200 with the final `DealView` after the verdict, capture and payout inside one request; the route tests pass with the fakes. (2) `hashCheck()` runs before `deps.ai.judge` in `lib/deal/verdict.ts`; a byte-identical listing photo yields `model === "none"`, `prompt_version` `guardrail-v1` and no model call. (3) `lib/deps.ts` builds the real Claude, PayPal and Resend adapters from `lib/env.ts` and the console email when `RESEND_API_KEY` is empty. (4) Locally with a tunnel, one deal goes `held` → `captured` → `paid` through the real sandbox and the real model. |
| T-28 | Deal page from `held` to the end: evidence form, wait screen, verdicts, fix request, buyer review, cancel, payout retry | web | must | 8 | T-27, T-18 | 08 §2, §7.3, §7.4, §7.7 to §7.11, §7.13; FR-30; 01 "Judge walkthrough" rows 4:00 to 9:00 | (1) The seller's evidence form uploads up to 6 photos, a tracking number labelled "Demo carrier (mock)" and a note; "Submit proof for checking" shows "Checking your proof…" and waits 45 s before a connection error. (2) The verdict table shows one row per condition with result, confidence and reason; the fix-request headings "One more try" and "The first proof failed. One more try." appear per role. (3) The buyer's `in_review` screen shows every verdict beside the evidence with "Release payment" and "Reject proof"; both reach the expected status. (4) The events timeline renders every C6 cause with the 08 §7.11 copy; "Cancel deal" and the payout-retry form work in their states. |
| T-29 | Eval cases (30 verdict, 10 extraction) and `eval/run.ts` | ai | must | 6 | T-23, T-26 | D12; 05 §9.1 to §9.3; 06 "AI evaluation"; research/claude-api.md §9 | (1) `eval/cases/` has 30 folders named `<group>-<nn>-<item>` in the 05 §9.1 counts, each with `deal.json`, `reference/`, `evidence/`, `tracking.txt` and `expected.json`; `eval/extract/sentences.json` has the ten sentences. (2) `npm run eval -- --only correct-01-mug` prints the per-run line and the summary block in the 05 §9.3 format and writes `eval/results/<YYYYMMDD-HHMM>-<model>-<effort>.json`. (3) The runner exits 1 when the wrong-capture rate is not 0 and refuses to start without `ANTHROPIC_API_KEY`. (4) The two byte-identical `listing-reused` cases report `model === "none"` and `raw_response.skipped === "hash_match"`. |
| T-30 | Baseline eval, UNVERIFIED measurements, prompt tuning, zero wrong captures | ai | must | 4 | T-29 | 05 §9.4, §10.3; 06 "AI evaluation" acceptance; D4, D9; research/claude-api.md "Open risks" 1, 2, 5, 6, 7, 12 | (1) `npm run eval -- --repeats 3` on `claude-sonnet-5-5` at `low`: wrong captures 0, decision match at least 24 of 30, refusals 0, p95 at most 12 s; then a second plain run also shows 0 wrong captures; both result files committed. (2) The 05 §10.3 table (10-image latency, schema acceptance, cold compile, flip rate, refusal rate, token count, tier limits) is filled in as a comment block in `eval/README.md`. (3) If p95 is under 8 s, the verdict call becomes 9 s with one retry (D4) and `decisions.md` D4 says so; otherwise D4 is unchanged. (4) Any prompt change bumps `prompt_version` and is re-run. |
| T-31 | SB-1 to `paid`, SB-2 to SB-5, SB-10, SB-11 on the hosted URL | testing | must | 4 | T-28, T-20 | 06 "Sandbox scenarios" table; C2; E7 | (1) `npm run sandbox -- SB-1 --full --wait --base https://<host>` ends `paid` with the 11-row trail; the capture shows in the business account and the payout in personal 2. (2) SB-2 (backdated `deadline_at` plus `POST /api/jobs/tick`) ends `voided` with `PAYMENT.AUTHORIZATION.VOIDED` stored. (3) SB-3, SB-4, SB-5 and SB-11 end in their expected statuses. (4) SB-10 shows `UNCLAIMED`, the item cancel, attempt 2 and `paid`. Outputs go into the release issue. |

W3 total: 36 hours.

### W4: 2026-10-30 to 2026-11-05

| ID | Title | Area | Priority | Estimate | Depends on | Spec | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-32 | Day-21 capture; record the E11 result | user-action | must | 1 | T-24 | 06 SB-0b; E11; 07 §3.1 step 9; 02 §12 spike 1 | (1) On 2026-10-30 `spike.ts capture --auth <third id>` answers 201 `COMPLETED`. (2) `decisions.md` E11 records the day-4, day-12 and day-21 results and the SB-0 outcome; the README "Disclosures" draft notes them. (3) If any capture failed: `deadline_days` is capped at 3 in `decisions.md` I3 and D6, the `conditions` CHECK and the UI copy follow, and a reauthorize-before-capture step is scheduled as a W4 must. |
| T-33 | Demo kit: `presets.json`, photos, font, sentence chips, "Use sample" buttons, canvas code photo | web | must | 6 | T-23, T-28 | F5, FR-20; 08 §12 whole, §6.1, §6.3, §7.7; 07 §1 (`public/demo/`) | (1) `public/demo/` matches 08 §12.1 file for file, including `fonts/handwriting.woff2` (Caveat) and `fonts/OFL.txt`. (2) `/new` shows the three preset chips and two extras from `presets.json`; "Use sample listing photos" stages `ref-1.jpg` and `ref-2.jpg`. (3) "Use sample evidence: Good / Wrong item / Blurry / Reuse listing photo" stage the set's photos plus the canvas-composed code photo showing this deal's code, and fill `TRK-DEMO-0000`. (4) The 08 §12.4 table holds on the hosted URL: `mug`+Good → `paid`; `lamp`+Wrong item twice → `voided`; `bottle`+Blurry → `in_review`; `mug-over-limit`+Good → `in_review` with `amount_over_limit`; `mug-subjective` shows the rejected block. |
| T-34 | Seed: two personas and 25 historical deals; run on Render | infra | must | 4 | T-08 | F6, FR-22; 03 "Seed"; 07 §3.4 step 6 | (1) `npm run seed` locally writes `demo-buyer@handshake.demo`, `demo-seller@handshake.demo` and 25 deals in the 03 distribution (draft 3, terms_agreed 2, held 4, in_review 2, captured 2, paid 8, voided 4), every `cause` a C6 string, `created_at` spread over 60 days. (2) Running it twice changes nothing but the two users' upsert. (3) The deal page renders a seeded deal with no `payments` row and no evidence. (4) After the pre-deploy step runs `npm run seed`, the hosted `/ledger` shows 25 seeded deals and `tick` skips them. |
| T-35 | Tick cron proven on Render | testing | must | 1 | T-20, T-31 | B7, J2; 07 §5 (cron), §3.4 step 4; 06 "tick" | (1) **handshake-tick > Events** shows a scheduled run that exited 0 with a `TickReport` in the web logs. (2) SB-2 on the hosted URL voids the backdated deal from the cron's own `curl` command, not only from a manual call. (3) A manual `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/tick` returns 200. |
| T-36 | `GET /api/dashboard/data`, `lib/dashboard-rows.ts`, Studio dashboard shell, sources, nine widgets, theme | ag-grid | should | 8 | T-21, T-34 | FR-23; G3; 09 §3, §5.1 to §5.5, §8 pieces 3 and 4; 04 §14; 08 §9; research/ag-grid.md §3, §8 | (1) `lib/dashboard-rows.ts` unit tests pass; `GET /api/dashboard/data` returns only the caller's deals with no emails or names, 401 signed out. (2) `/dashboard` loads Studio with `next/dynamic({ ssr: false })` behind a skeleton; `ag-studio` is imported only under `app/dashboard/`. (3) The nine 09 §5.4 widgets render over seeded and live deals with the `studioTheme.withParams` theme bound to the `--hs-*` tokens. (4) No "License Key Not Found" gating: with no key on localhost everything works; the hosted page shows at most the fading watermark. |
| T-37 | `deal-pipeline` custom widget with cross-filter | ag-grid | should | 4 | T-36 | 09 §5.6, §8 piece 5; research/ag-grid.md §3 "Custom widgets" | (1) The widget renders the status funnel from the Studio data source and clicking a stage cross-filters the other widgets. (2) It imports only `ag-grid-community`, `ag-grid-react` or plain SVG (dependencies.md trap 8). (3) If not working by 2026-11-03, cut 5 applies and a built-in `funnel-chart` over `deals.status` replaces it. |
| T-38 | Studio agent spike: Claude adapter and `POST /api/studio/agent` round-trip one tool call | ag-grid | could | 3 | T-36 | FR-24; G3; 09 §6.1 to §6.4, §8 piece 6; 04 §15; research/ag-grid.md §4; research/claude-api.md §5 | (1) "Show my voided deals" typed in the Studio prompt box round-trips one tool call through `app/dashboard/claude-adapter.ts` and the route with `thinking: { type: "between_tools" }`, `effort: "low"`, fixed model `claude-sonnet-5-5`. (2) The route requires a session and answers `rate_limited` 429 after 30 turns per user per 10 minutes. (3) Decision by end of 2026-11-02: continue to T-39 or apply cut 1. |
| T-39 | Studio agent finish: five built-in agents on Claude, `auditor` with `explain_verdict`, prompt starters, README prompts | ag-grid | could | 8 | T-38 | 09 §6.5, §6.6, §8 piece 7; 04 §15 | (1) The 09 §6.6 prompts each produce the expected widget or answer on the hosted `/dashboard`. (2) `explain_verdict` returns the stored verdict rows and reasons for a named deal code the user owns. (3) `max_tokens` 2000 and the 80-item input cap are enforced in the route. |
| T-40 | UI second pass and accessibility: lightbox, progress rings, share, confirmations, toasts, stepper, sticky bar, visual direction | web | should | 8 | T-33 | 08 §4.6 right column, §4.3 to §4.5, §11; G2; 01 "Requirements by judging criterion" (Design) | (1) Every right-column item of 08 §4.6 exists and the first-pass behaviour still works. (2) Keyboard focus order, labels and contrast meet 08 §11 on `/`, `/new`, `/deal/[code]`, `/ledger`. (3) The seller flow is usable on a 375 px wide viewport with the sticky bottom bar. (4) `npm run lint` and `npm run test:e2e` still pass. |
| T-41 | Evidence pack download button, `/me` page, email notifications | web | should | 3 | T-28, T-14 | FR-14, FR-31, FR-32; 08 §7.12, §10; 04 §10.2; 02 §5.6 | (1) "Download evidence pack (JSON)" saves `handshake-{code}-evidence-pack.json` with the 04 §10.2 keys and no top-level `evidence` or `verdicts`. (2) `/me` edits `display_name` (1 to 60 characters) and `paypal_email`. (3) The buyer is emailed on `in_review` and both parties on `capture_declined` through Resend when the key is set; the fake records the same two sends in tests. |
| T-42 | Playwright happy path and the PayPal popup helper | testing | must | 4 | T-33, T-19 | A5; 06 "End to end"; 08 §4.7; 02 Assumption 20 | (1) `tests/e2e/paypal-popup.ts` holds `approveInPopup(popup)` recorded with `npx playwright codegen` against the sandbox popup. (2) `npm run test:e2e` builds, starts, and passes the ten steps of 06 "End to end" locally, ending `captured` or `paid`. (3) The ledger assertion (new deal in the first row) and the evidence-pack assertion (`format` `handshake-evidence-pack/1`, 3 verdicts, at least 10 events) pass. |
| T-43 | Outside testers: three sellers on their own phones | user-action | must | 3 | T-33, T-20 | A5; 06 "Outside testers"; 02 §12 spike 8; research/stack.md "Open risks" 5 | (1) Three people recruited by 2026-10-30 each receive a share link and "you are selling this; prove it" and submit real photos from a phone with `TRK-DEMO-0000`. (2) Per tester: finished unaided yes/no, minutes, questions asked, verdict, recorded in the W4 issue. (3) At least one iPhone tester; HEIC behaviour in Safari and Chrome is recorded for spike 8. (4) Two of three finished unaided, or the blocking copy or control is fixed in T-40. |
| T-44 | AG Studio trial key: form on 2026-11-02, chase 2026-11-06, paste on Render | user-action | should | 1 | T-02 | G3; 09 §7; 07 §3.5 steps 3 to 6; research/ag-grid.md §2 | (1) The trial form at ag-grid.com/studio/license-pricing is submitted on 2026-11-02. (2) On arrival `AG_GRID_LICENSE_KEY` is set on Render and locally; the hosted `/dashboard` console shows no "License Key Not Found", "Trial Period Expired" or "Incompatible License Key" banner. (3) If no key by 2026-11-06, the Discord chase is posted; if the Discord key is longer, it is used instead. |

W4 total: 54 hours (must 19, should 24, could 11). The could and should items are the schedule's slack; see the cut order.

### W5: 2026-11-06 to 2026-11-11

| ID | Title | Area | Priority | Estimate | Depends on | Spec | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-45 | Hardening: security checklist, tester fixes, memory spike, freeze on 2026-11-08 | testing | must | 6 | T-40, T-43 | 06 "Security checks"; 02 §12 spike 9; 07 §9 "Repository and licence"; NFR-1 to NFR-5 | (1) Every box in 06 "Security checks" is ticked with its named test or command, including the `git grep` for secrets and the `.next/static` grep after `npm run build`. (2) Six 2 MB uploads on the hosted service keep memory under the `0.5c-512mb` ceiling in Render metrics (spike 9). (3) Tester-reported blockers from T-43 are fixed. (4) The last feature commit lands on 2026-11-08 and CI is green on it. |
| T-46 | README and docs for submission | docs | must | 4 | T-30, T-32 | A3, NFR-17, NFR-18; 07 §10, §9 "README and Devpost"; 01 "Later" | (1) `README.md` has every 07 §10 section in order: hosted URL, the sandbox personal 1 login, persona steps, "How it works" with D9 verbatim, Disclosures (sandbox, USD, carrier mock, composed code photo, platform as merchant, Resend limit, 21-day cap), Tools used, Evaluation results with the two eval numbers and run date, Run it locally, Deploy it, Tests, What a production build adds, Licence. (2) `docs/README.md` indexes the folder. (3) A fresh clone on a second machine runs from the README alone in under ten minutes (user). (4) `.env.example` still lists exactly the 19 J3 names. |
| T-47 | Final deploy 2026-11-09, SB-0 to SB-11 on the hosted URL, e2e on the hosted URL, release issue | testing | must | 4 | T-45 | 07 §9 "The last three days"; 06 "Exit criteria", "Sandbox scenarios" table | (1) The feature-frozen build is "Live" on Render on 2026-11-09. (2) SB-0, SB-0b (recorded), SB-1 to SB-8, SB-10 and SB-11 outputs with deal codes and trails are in the release issue. (3) `PLAYWRIGHT_BASE_URL=https://<host> npm run test:e2e` passes. (4) The 07 §9 "Hosted demo" boxes are ticked: seed present, webhook matches, cron ran in the last 24 hours, `DEMO_LOGIN=true`. |
| T-48 | Record and upload the demo video | user-action | must | 4 | T-47 | A3; 01 "Success for the demo video"; hackathon.md "What a submission must contain" | (1) Screen recordings of the hosted demo cover the five 01 segments: problem (0:00 to 0:20), Deal 1 paid, Deal 2 voided, Deal 3 buyer decides, trail and dashboard with the decision function on screen, close with the URL and repo. (2) Under three minutes, no third-party trademarks or copyrighted music. (3) Public on YouTube on 2026-11-10; the URL plays in a private window. |
| T-49 | Make the repo public, commit the README with the video URL, submit the Devpost form, start the freeze | user-action | must | 2 | T-48, T-46 | A1, A3; hackathon.md "Repository status"; 07 §9 "README and Devpost", §8 rule 1 | (1) `github.com/0PrashantYadav0/Handshake` is public and the About section shows "MIT license". (2) The README commit with the video URL and the eval numbers is the last deploy and is "Live"; CI is green on it. (3) The Devpost form has the text description (with the sandbox buyer login), tools used, repo URL, hosted URL and video URL, and shows "submitted" on 2026-11-11. (4) No further push to `main` until 2026-12-16 except the 07 §8 exceptions. |
| T-50 | Post-submission monitoring through 2026-12-15 | user-action | must | 4 | T-49 | A2; 07 §8; 06 "Exit criteria" (2026-11-30 run) | (1) The weekly Monday check table of 07 §8 is completed on 2026-11-16, 11-23, 11-30, 12-07 and 12-14 and logged in a monitoring issue. (2) On 2026-11-30, `npm run sandbox -- SB-1 --base https://<host>` ends `paid`. (3) Any failure follows the 07 §8 fix order: restart, env var edit, README-only credential commit, hotfix branch last. |

W5 total: 24 hours, leaving 2026-11-06 and 11-07 for slippage from W4.

Whole plan: 50 tasks, about 217 hours; user-action tasks: T-01, T-02, T-12, T-20, T-23, T-24, T-32, T-43, T-44, T-48, T-49, T-50.

## Risk register

Each risk names the task that owns its mitigation; the first six are the ones that can change the design, so they sit in W1 to W3.

| # | Risk | Likelihood | Impact | Mitigation | Owner task |
| --- | --- | --- | --- | --- | --- |
| R1 | Capturing the original hold after day 3 fails (`AUTHORIZATION_EXPIRED` or 422); research/paypal.md "Open risks" 1 | Medium | High: the 21-day deal cap is wrong | Three-hold spike on days 4, 12, 21; on failure cap `deadline_days` at 3 and add one reauthorize before capture (02 §12 spike 1) | T-12, T-24, T-32 |
| R2 | Sandbox Payouts needs a feature toggle or scope; research/paypal.md "Open risks" 3 | Medium | Low: one dashboard change | SB-0 on day 1; enable the feature and rerun | T-12 |
| R3 | Render cuts a 40 s response; research/stack.md "Open risks" 1 | Medium | Medium: the verdict request fails visibly; the deal is finished by `tick` or webhooks | Spike 4 in W2; if cut, AI timeout 12 s and PayPal 5 s (02 §12) | T-22 |
| R4 | Verdict p95 above 12 s or a cold grammar compile past the 17 s timeout; research/claude-api.md "Open risks" 1, 2 | Medium | Medium: deals land in `in_review` instead of `captured` | Baseline eval measures p50/p95 and cold latency first; D4 retry switch; `effort` stays `low` | T-30 |
| R5 | Hand-written JSON schemas rejected with 400 on first use; research/claude-api.md "Open risks" 5 | Medium | Low: fixed in minutes | One live call per job in the week each job is built | T-15, T-26 |
| R6 | Model flips a `fail` or `unclear` to `pass` between runs and captures wrongly; research/claude-api.md "Open risks" 12 | Low | Critical: the one thing the demo must never do | `PASS_THRESHOLD` 0.85, the `decide()` property test, two consecutive zero-wrong-capture eval runs, D9's confident-fail rule | T-07, T-30 |
| R7 | W1 overruns (60 hours of agent and review time) | High | Medium: M1 slips into W2 | T-21 and T-22 are W2 slack; the cut-order date 2026-10-30 is fixed | T-09, T-10 |
| R8 | `APP_HOST` cross-service variable does not resolve, so the cron never runs and holds are never voided; 07 Assumption 8 | Medium | High: holds outlive deals during judging | Check the cron's environment after the first apply; `sync: false` fallback | T-20, T-35 |
| R9 | Recorded webhook fixtures missing because the tunnel or recorder failed during the spike | Low | Medium: signature test and SB-7 replay have no input | Record during T-12 while the spike creates every event type; rerun any missing event with the spike script | T-12, T-13 |
| R10 | Prisma 8 RC or TypeScript 7 sneaks in; dependencies.md traps 1 and 3 | Medium | Medium: broken install or lint | `save-exact=true`, exact pins, never `npm i prisma`, never `npm audit fix --force` | T-03 |
| R11 | AG Studio trial key arrives late, expires before 2026-12-15, or is not PRO-AI tier; research/ag-grid.md "Open risks" 1 | Medium | Low: watermark and console banner, nothing disabled | Discord request now; form on 2026-11-02; chase 2026-11-06; features work without a key | T-02, T-44 |
| R12 | The Studio Claude adapter cannot round-trip a tool call; research/ag-grid.md "Open risks" 2 | Medium | Low: FR-24 is could | 3-hour spike with a hard cut date of 2026-11-02 | T-38 |
| R13 | Studio API names in the research are wrong (`results.rows`, `field.key`, date types); research/ag-grid.md "Open risks" 8 | High | Low: type errors while coding | Read `node_modules/ag-studio/dist/types` first; `dynamic({ ssr: false })` from the start | T-36 |
| R14 | HEIC photos from an iPhone fail to decode in the browser; research/stack.md "Open risks" 5 | High for iPhone sellers | Medium: a tester cannot submit | Client error copy in T-25; an iPhone tester in T-43; the demo kit avoids the path for judges | T-25, T-43 |
| R15 | The sandbox buyer password (public in the README) is changed by a stranger, or the buyer or business balance runs dry during judging | Medium | High: no judge can place a hold | Custom-balance accounts; weekly balance check; the 07 §8 recovery row (reset or replacement account, README-only commit, Devpost text edit) | T-01, T-50 |
| R16 | A push to `main` during judging breaks the hosted demo | Low | High | Deploy freeze from 2026-11-11 with the two 07 §8 exceptions; post-submission work on an unmerged branch | T-49 |
| R17 | Anthropic 429, 529 or a refusal during a judge's run | Low | Low: the deal goes to `in_review`, which is a first-class screen | `buyer_review` on every AI failure; $75 spend cap; concurrency 3 on evals | T-28 |
| R18 | Render credit does not cover every line item; research/stack.md "Open risks" 6 | Low | Low: about $35 out of pocket | Check Billing on 2026-10-11; stay on Hobby | T-02, T-20 |
| R19 | Outside testers unavailable in W4 | Medium | Low: one submission box unticked | Recruit three by 2026-10-30; the kit lets the developer stand in for one | T-43 |
| R20 | A secret in the repo history when it goes public | Low | High | `.env` gitignored from T-03; `git grep` and `git log -S` checks before T-49 | T-45, T-49 |

## Cut order

Cuts are applied from the top of this list on 2026-10-30, the end of W3, and stop as soon as the remaining plan fits in the days to 2026-11-08; two items have their own earlier or later decision dates. Each cut is recorded in its GitHub issue (J5). The source is 01 "Cut order" and 09 §8.

| # | Cut | Decide by | Trigger | What remains |
| --- | --- | --- | --- | --- |
| 1 | FR-24 Studio agent (T-38, T-39) | 2026-11-02 end of day | T-38 has not round-tripped one tool call | The dashboard without a prompt box (09 §6.7); if the spike's built-in harness works, keep it |
| 2 | FR-28 verified Resend domain | 2026-10-30 | Any slip at all; it was never scheduled as a task | Magic links reach only the account owner's address |
| 3 | FR-32 email notifications become console-logged (T-41 part 3) | 2026-10-30 | M3 incomplete | The deal page shows the same state |
| 4 | FR-27 magic link UI (T-14's form on `/`) | 2026-10-30 | M3 incomplete | Only the two persona buttons; `POST /api/auth/demo` is the only sign-in |
| 5 | FR-23 `deal-pipeline` custom widget (T-37) → built-in `funnel-chart` | 2026-11-03 | The widget does not cross-filter by then | Theme and layout still score; the "custom widget" box is unticked |
| 6 | FR-9 `retry_payout` UI and SB-10 on the hosted URL (T-28 part 4, T-31 part 4) | 2026-10-30 | M3 incomplete | The module's `retry_payout` stays tested against fakes; a failed payout shows its reason on the page |
| 7 | FR-9 declined path and FR-10 `tick:reverify` on the hosted URL | 2026-10-30 | M3 incomplete | Both remain in `lib/deal` under the fakes; only the hosted verification is dropped; the deadline void stays |
| 8 | FR-31 `/me` page (T-41 part 2) | 2026-11-05 | M4 incomplete | `PATCH /api/me` behind the inline PayPal email form on the deal page |
| 9 | FR-23 dashboard (T-36), last | 2026-11-05 | M4 incomplete and the walkthrough or e2e still red | `/dashboard` leaves the header and the four Studio packages go; the ledger stands |

Never cut: FR-1 to FR-8, FR-11 to FR-14, FR-19 to FR-22, FR-25, FR-26, FR-29, FR-30, NFR-15, the capture-and-payout core of FR-9, the deadline void of FR-10, the ledger (09 §8), the demo kit, the seed, the Playwright happy path, the README and the video.

## Submission checklist

Every box is ticked on the hosted Render URL, not on localhost, on 2026-11-11 before the Devpost form is submitted. Sources: hackathon.md "What a submission must contain", 07 §9, 06 "Exit criteria".

Repository and licence (A3):

- [ ] `github.com/0PrashantYadav0/Handshake` is public.
- [ ] `LICENSE` at the root is the unmodified MIT text with `Copyright (c) 2026 Prashant Kumar Yadav`; GitHub About shows "MIT license".
- [ ] `git grep -nE 'sk-ant-|re_[A-Za-z0-9]{20,}|postgresql://[^ ]*:[^ @]*@' -- ':!docs/**'` and `git log -p -S 'sk-ant-'` find nothing; `.env` is gitignored; only `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is in `.next/static`.
- [ ] `.env.example` lists the twenty J3 names with no values.

Code and tests (A5, J4, D12):

- [ ] CI is green on the submission commit: lint, typecheck, unit, integration, build.
- [ ] `PLAYWRIGHT_BASE_URL=https://<host> npm run test:e2e` passed on 2026-11-11.
- [ ] SB-0, SB-0b, SB-1 to SB-8, SB-10 and SB-11 passed on the hosted URL after the 2026-11-09 deploy; outputs are in the release issue. SB-9 and SB-12 are cut.
- [ ] The E11 results (day-4/12/21 captures, Payouts toggle) are in `decisions.md` E11 and `deadline_days` limits match them.
- [ ] `npm run eval` on the submitted model and `prompt_version`: 0 wrong captures on 2 consecutive runs, at least 24 of 30, 0 refusals; result files committed; the two numbers and the run date are in the README.
- [ ] Every 06 "Security checks" box is ticked on the submission commit.
- [ ] Two of three outside testers finished unaided.

Hosted demo (A2, J2, F3, F5, F6):

- [ ] `GET /api/health` returns 200; Render shows `render.yaml` applied with no drift.
- [ ] Every `sync: false` variable is set; `DEMO_LOGIN` is `true`; `APP_URL` equals the live host.
- [ ] The `handshake` webhook points at `https://<host>/api/webhooks/paypal` with the eleven E5 events and `PAYPAL_WEBHOOK_ID` matches.
- [ ] `handshake-tick` ran successfully in the last 24 hours.
- [ ] `npm run seed` has run on Render; the ledger shows the 25 seeded deals.
- [ ] The 01 "Judge walkthrough" with the `mug`, `lamp` and `bottle` chips reaches `paid`, `voided` and `in_review`, and the `$250` chip reaches `in_review` with `amount_over_limit`.
- [ ] `AG_GRID_LICENSE_KEY` is set and valid past 2026-12-15, or the Discord key is; the hosted `/dashboard` console shows no licence banner.
- [ ] The Anthropic monthly limit is set; Render Billing shows the credit; the sandbox business balance is above $100 and personal 1 above $1,000.

README, video and Devpost (A3, E9, E10, D7, F5):

- [ ] README has every 07 §10 section: hosted URL, sandbox personal 1 login, persona steps, disclosures, tools used, eval numbers, run and deploy steps, tests, "What a production build adds", licence.
- [ ] A fresh clone on a second machine runs from the README alone in under ten minutes.
- [ ] The video is under three minutes, public on YouTube, recorded on the hosted demo, with no third-party trademarks or copyrighted music; its URL is in the README and the form.
- [ ] The Devpost form has the text description (with the sandbox buyer login), tools used, repo URL, hosted URL and video URL, and is submitted on 2026-11-11.
- [ ] The deploy freeze starts the moment the form is submitted.

## Post-submission plan

The hosted demo is frozen at the submission commit from 2026-11-11 and checked every Monday until judging ends; the rules and the check table are 07 §8, repeated here so this plan is complete.

Rules from 2026-11-11 to 2026-12-15:

1. No pushes to `main`. Exceptions: a demo that is down and cannot be restored by a restart or an env var edit; a README-only commit carrying a replacement sandbox buyer credential.
2. No Blueprint sync, plan change, region change, disk change or Postgres upgrade; no migrations.
3. Env var edits only to paste a longer AG Studio key or rotate a leaked secret.
4. Spend caps stay: Anthropic $75/month, Render Hobby with the three services, Resend free tier, disk 5 GB.
5. No pre-made live deals (A2); `tick` voids anything past `deadline_at` within 10 minutes.
6. The sandbox accounts, the REST app and the Render webhook are never edited or deleted, except the balance-recovery case below.

Calendar:

| Date | Do | Pass looks like |
| --- | --- | --- |
| 2026-11-16 (Mon) | First weekly check (table below) | Every row passes |
| 2026-11-23 (Mon) | Weekly check | Every row passes |
| 2026-11-30 (Mon) | Weekly check plus `npm run sandbox -- SB-1 --full --wait --base https://<host>` (06 "Exit criteria") | `paid`; sandbox app, webhook, Anthropic key and AG Studio key confirmed alive the day before judging |
| 2026-12-01 | Judging opens; nothing to do | |
| 2026-12-07 (Mon) | Weekly check | Every row passes |
| 2026-12-14 (Mon) | Last weekly check | Every row passes |
| 2026-12-15 | Judging ends; the freeze lifts on 2026-12-16 | |
| 2026-12-21 | Winners announced (hackathon.md) | |

Weekly check, about 15 minutes:

| Check | How | Pass looks like |
| --- | --- | --- |
| Health | `curl -fsS https://<host>/api/health` | 200 |
| Deploy state | Render > handshake > Events | Last deploy is the submission commit, "Live", nothing since |
| Cron | Render > handshake-tick > Events | Yesterday's run exited 0 |
| Credit | Render > Billing | Remaining credit at least $15.50 × months left |
| A full deal | The README judge steps with the `mug` chip and "Use sample evidence: Good" | `paid` within about seven minutes; `fact:payout_succeeded` in the timeline |
| Webhooks | PayPal dashboard > app `handshake` > Webhook Events | Every delivery for that deal answered 200 |
| Business balance | sandbox.paypal.com as the business account | Above $100; below it, the 07 §8 replacement-account procedure (new custom-balance business account, new REST app with the eleven-event webhook, four env vars pasted on Render) |
| Buyer balance | sandbox.paypal.com as personal 1 | Above $1,000; no open hold older than 21 days |
| Model spend | Claude Console > Usage | Well under $75; no 429 lines in Render logs |
| AG Studio key | Hosted `/dashboard` console | No licence banner; expiry after 2026-12-15 |
| Disk | Render > handshake-db > Metrics | Under 4 GB |
| Buyer login | sandbox.paypal.com with personal 1 | The README credentials work; otherwise reset the password or create a replacement account, push the README-only commit, edit the Devpost text |

If any row fails, the fix order is: restart the web service, then an env var edit, then a README-only commit for a buyer credential, then and only then a hotfix branch merged to `main` and noted in the README "Disclosures".

## Assumptions

Choices made here that [decisions.md](decisions.md) does not fix. Each is the simplest option consistent with it.

1. Week boundaries are the ones given for this plan (W1 2026-10-09 to 10-15 through W5 11-06 to 11-11); J5 names the milestones but not their dates. The cut-order decision point is the end of W3, 2026-10-30, as 01 Assumption 11 sets it.
2. The extraction job (05 §3) ships in W2 (T-15), not W3, because `POST /api/deals` and the first-pass `/new` page cannot work without it and M2 needs a real deal on the hosted URL. W3 owns the verdict job, the D8 guardrail, the evidence flow and the eval.
3. M2's SB-1 runs to `held` only; the evidence half of SB-1 is M3. SB-7 at M2 proves the receiver's once-only storage with a recorded `PAYMENT.CAPTURE.COMPLETED` replay; the "one payout" half of SB-7 is re-checked after SB-1 completes in W3.
4. The ledger (T-21) is built in W2, on the 2026-10-18 date 09 §8 sets for it, rather than in W4; it is a must and the first grid judges see.
5. The spike holds are created on 2026-10-10, so day 4 is 2026-10-13, day 12 is 2026-10-21 and day 21 is 2026-10-30. A fourth $1 hold is captured on day 1 so that SB-8 and the `PAYMENT.CAPTURE.COMPLETED` fixture do not wait for day 4.
6. During the W1 recording, `record-webhook.ts --forward http://localhost:3000/api/webhooks/paypal` points at a receiver that does not exist yet; the recorder writes each file before forwarding and logs the failed forward. The receiver is T-17 in W2.
7. The W2 first-pass `/new` lets the buyer skip step 3 (listing photos) until T-25 lands, because H3 caps reference photos at 4 but requires none and `accept` does not check for them.
8. Spike 4 (the 40 s route) is a temporary route deployed and deleted on the same day in W2; its result is written into 02 §12 and B5.
9. The 05 §10.3 measurements are recorded in `eval/README.md` beside the committed result files; no document names a home for them.
10. The demo kit is the 08 §12 kit (`mug` $18, `lamp` $35, `bottle` $22); where 07 §8 and §10 still say "$80 blue ceramic mug", the 08 kit wins, as 01 Assumption 10 states, and T-46 updates the README text to the kit's sentences.
11. The GitHub issues for T-01 to T-50 are created by the coding agent with `gh` as part of T-03; the human owns the user-action issues.
12. Estimates count combined developer and agent hours including tests and review; W1 at 60 hours is accepted as the heaviest week, with T-21 and T-22 as W2 slack if T-09 or T-10 overruns.
13. Outside testers are recruited by 2026-10-30 (end of W3) so they can run in W4 against the kit; the protocol is 06 "Outside testers".
14. The post-submission monitoring issue is the single log for the weekly checks; nothing is written to `docs/` after 2026-11-11.
