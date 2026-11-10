# Handshake: pay on proof

Buying from a stranger means one side has to trust the other. Handshake removes that step.

It's for people who already trade with strangers over PayPal, in swap communities, social marketplaces and group chats, for things you can photograph and ship, like used hardware, watches and collectibles.

A buyer describes a deal in one sentence. Claude turns it into checkable conditions. Both sides sign. PayPal holds the money (an AUTHORIZE order, not a charge). The seller uploads photos and a tracking number. Claude judges each condition and returns JSON. A fixed rule in code, never the model, then captures the hold, asks for one fix, voids it, or hands the call to the buyer. The seller is paid through PayPal Payouts. Every step lands in an append-only audit log you can export.

**AI agents can do all of it except move the money.** Two Claude agents can negotiate and settle a deal on `/agents`, and any MCP client can connect to `/api/mcp`. An agent works under a spending ceiling that code enforces. Only a person can approve the hold at PayPal, and only the fixed rule can release it. See [docs/agents.md](docs/agents.md).

Built for the PayPal AI Hackathon 2026. Sandbox only, no real money moves.

| | |
| --- | --- |
| Hosted demo | https://handshake-ba2g.onrender.com |
| Video (under 3 min) | https://youtu.be/eMuh51YjGhY |
| Licence | MIT, see [LICENSE](LICENSE) |

## Try it as a judge

### The 3-minute version: watch two agents make a deal

1. Open https://handshake-ba2g.onrender.com, click **Start a deal**, then **Continue as buyer**, **Use demo code**, **Continue**.
2. Click **Agents**, pick **A seller that hijacks** and click **Start the agents**. It takes under a minute and needs no PayPal login.
3. Run **An honest seller**. At the PayPal button, log in with the sandbox buyer and approve: email `sb-8wvwd53385315@personal.example.com`, password `FgW4ss=$`.
4. Watch the proof, the verdicts and the release. Then run **A seller that cheats**.
5. Now try to fool it. Run a deal to the hold (steps 1 to 4 of the full version below, because the desk submits its own proof), switch to **Seller**, skip the sample buttons and upload a photo from your own phone, with the code on paper or of something else entirely. Read Claude's reason. It's live, so scores move between runs. If one lands under 0.85 you'll be asked to decide, and that's the rule working.
6. Open https://handshake-ba2g.onrender.com/api/status to see how many PayPal webhooks arrived verified.

### The full version (10 minutes): play both sides yourself

One browser, no account, no install. The header has a **Demo** badge with **Buyer** and **Seller** chips that swap between the two seeded personas (`demo-buyer@handshake.demo`, `demo-seller@handshake.demo`), so you play both sides.

1. Open the hosted URL and click **Start a deal**, then **Continue as buyer**. Every account signs in with two steps; the demo accounts' authenticator secret is published, so on the code screen click **Use demo code**, then **Continue**.
2. On `/new` click the first **Try one:** chip, **$18 mug, 5 days**. It fills the sentence "I'll pay $18 for the blue ceramic mug if it arrives within 5 days, matches the listing photos and tracking shows delivered". Click **Extract terms**. You get 2 to 5 conditions; the last one, "Photo shows the deal code HS-XXXX written by hand", is added by the server. Click **Save terms**, **Use sample listing photos**, **Save and get link**, then **Open deal page**.
3. Switch to **Seller** (the same two-step screen; **Use demo code**). Click **Join as seller**. Read the contract, tick **I agree**, click **Use demo code**, then **Sign contract**. The signature is made by a key that stays in your browser.
4. Switch to **Buyer** and sign the same way. The deal reads **Approve the hold with PayPal**. **Contract and signatures** under Records shows both signatures verified in your browser. Click the PayPal button and log into the popup with the sandbox buyer:

   ```
   email:    sb-8wvwd53385315@personal.example.com
   password: FgW4ss=$
   ```

   Approve. The deal shows **Money held. Waiting for proof.** ($18.00 held, not charged).
5. Switch to **Seller**. Under **Use sample evidence** click **Good** (it stages two photos, the composed deal-code photo and the tracking number `TRK-DEMO-0000`), then **Submit proof for checking**. Checking usually takes under 15 seconds, at most about 40.
6. Every condition reads `pass` with a reason. Status goes to **Payment released**, then **Paid** within about a minute. Open `/dashboard` (money held, released and paid out, what needs you), `/wallet` (holds, captures and payouts with their PayPal ids), `/ledger` (AG Grid), **Open analytics studio** (AG Studio) and **Download evidence pack (JSON)** under Records on the deal page.

More runs, each a different exit from the same state machine:

| Chip on `/new` | Sample evidence | What happens |
| --- | --- | --- |
| **$35 lamp, 7 days** | **Wrong item**, submitted twice | First submission: one fix request. Second: `voided`, hold released |
| **$22 bottle, 7 days** | **Blurry** | A condition is `unclear`: buyer review. Switch to Buyer and click **Release payment** or **Reject proof** |
| **$250 mug (over the auto-release limit)** | **Good** | All pass, still buyer review: $250 is over the automatic release limit ($200) |
| **$18 mug, 5 days** | **Reuse listing photo** | A listing photo as "proof" fails every photo condition with no model call (hash guardrail) |
| **$45 mug, subjective wording** | none | "looks nice" cannot be checked from a photo; it comes back under "Left out" with a **Use suggestion** or **Dismiss** chip |

The seller's payout goes to a sandbox personal account. `/wallet` shows the capture and payout with their PayPal ids.

Prompts to type into the `/dashboard/studio` agent panel (for example "Why was HS-7K2Q voided?") are listed in [docs/studio-prompts.md](docs/studio-prompts.md).

## Screenshots

From the hosted app on 2026-11-06. PayPal sandbox only.

| | |
| --- | --- |
| **The landing page** | **One sentence becomes checkable terms** |
| ![Handshake landing page with an example deal](docs/screenshots/01-landing.jpg) | ![Terms Claude extracted for an $18 mug, ready to edit](docs/screenshots/03-terms-from-one-sentence.jpg) |
| **Both signatures, verified in the browser** | **The buyer approves the hold at PayPal** |
| ![Contract page with buyer and seller signatures verified](docs/screenshots/11-contract-verified.jpg) | ![PayPal sandbox approval window for $18.00](docs/screenshots/05-paypal-approval.jpg) |
| **Money held, nothing charged** | **Claude judges each condition, the rule decides** |
| ![Deal page showing money held with its PayPal ids](docs/screenshots/06-money-held.jpg) | ![Three conditions passed with reasons and confidence](docs/screenshots/08-claude-verdicts.jpg) |
| **Paid, with the PayPal ids** | **Wrong item: one condition fails, one fix allowed** |
| ![Deal complete with order, authorization, capture and payout ids](docs/screenshots/09-paid.jpg) | ![A lamp fails the listing photo condition at 97%](docs/screenshots/12-wrong-item-fix-requested.jpg) |
| **Claude unsure: the buyer decides** | **The Studio agent explains a void** |
| ![Release payment and reject proof buttons on a blurry deal](docs/screenshots/14-buyer-decides.jpg) | ![AG Studio dashboard with the agent explaining why a deal was voided](docs/screenshots/2x-studio-agent.jpg) |
| **Two agents haggle, sign and stop at PayPal** | **A prompt injection: code refuses the $95 purchase** |
| ![Agent desk transcript ending at the PayPal approval step](docs/screenshots/16-agents-stop-at-paypal.jpg) | ![Agent desk transcript where the mandate refuses the purchase](docs/screenshots/18-agents-hijack-refused.jpg) |
| **The honest deal ends paid** | |
| ![Agent desk with Claude's three passing verdicts and the deal marked Paid](docs/screenshots/17-agents-deal-done.jpg) | |

## How it works

```
 Buyer (browser)          Seller (phone browser)
      |                          |
      v                          v
 +---------------------------------------------+
 |  Next.js 16 on Render (one web service)     |
 |                                             |
 |  app/api/*  thin route handlers (Zod, JWT)  |
 |      |                                      |
 |      v                                      |
 |  lib/deal/  the only code that changes      |
 |    status, writes deal_events, or calls     |
 |    PayPal.  decide() lives here.            |
 |      |            |              |          |
 +------|------------|--------------|----------+
        v            v              v
   Postgres 18    PayPal sandbox    Claude Sonnet 5.5
   (deals, files, (Orders v2       (extract terms,
    events,        AUTHORIZE,       judge photos:
    verdicts)      capture, void,   JSON in, JSON out)
                   Payouts, webhooks)
        ^
   cron every 10 min -> POST /api/jobs/tick (void past deadline, re-run stuck verdicts, reconcile with PayPal)
```

Deal states: `draft` -> `terms_agreed` -> `held` -> `proof_submitted` -> `captured` -> `paid`, with `in_review` (the buyer decides) and `voided` (hold released) as the two side exits. Every transition writes one row to `deal_events` in the same transaction, with actor, cause and the PayPal ids needed to explain it.

The hard rule: the model never moves money. Claude returns `pass`, `fail` or `unclear` with a confidence and a reason for each condition, and nothing else. The decision function is fixed code in `lib/deal/`, unit-tested row by row, and is the only thing that turns verdicts into a PayPal call. Quoted from `docs/decisions.md` D9:

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

Void is the one irreversible automated action against the seller, so on the second submission a `fail` voids only when the model is confident; a low-confidence `fail` goes to the buyer. Before any model call, an evidence photo whose SHA-256 matches a listing photo fails every photo condition at confidence 1 (D8). Untrusted text (notes, text inside photos) is delimited in the prompt and treated as evidence, never as instructions.

Interactive tour: open [docs/overview.html](docs/overview.html) in a browser (architecture, money flow, state machine, decision simulator, env vars, status). Full design: [docs/01-requirements.md](docs/01-requirements.md), [docs/decisions.md](docs/decisions.md), [docs/02-system-design.md](docs/02-system-design.md).

## Security

Design: [docs/superpowers/specs/2026-10-11-trust-and-accounts-design.md](docs/superpowers/specs/2026-10-11-trust-and-accounts-design.md).

- **Two-step sign-in for everyone.** An email link that works once (opening it is harmless; its "Continue" button spends it), then a 6-digit code from an authenticator app (TOTP, RFC 6238). Enrollment is required before anything else; ten single-use recovery codes back it up. Five wrong codes lock the account for 10 minutes, counted in Postgres. "Sign out everywhere" on `/security` ends every session.
- **Step-up.** Signing a contract, changing the payout email, revoking a signing key and making new recovery codes each need a fresh code.
- **Both parties sign every contract.** Each browser makes an ECDSA P-256 key that never leaves it. The signed document covers the parties, item, amount, deadline, conditions, the listing photos' SHA-256 and the decision rule. Editing anything means signing again. `/deal/{code}/contract` re-verifies both signatures in your browser and downloads the signed contract.
- **The contract is checked before money moves.** Before an order, an authorization, a capture or a payout, the server rebuilds the contract from the database and verifies both signatures. A change made straight in the database stops the step, records why, and moves no money. Releasing the buyer's hold is never blocked.
- **Payouts go only to a verified address.** A new PayPal email gets a 6-digit code by email; until it is confirmed, no payout is sent there.
- **Encrypted at rest and in transit.** Deal text, conditions, evidence notes, photos and verdict reasons are sealed with AES-256-GCM, bound to their deal and column (`DATA_KEYS`, rotatable with `npm run reseal`). HTTPS with HSTS in transit. This is not zero-knowledge encryption: the server must read the terms so Claude can check the proof, so the two parties and the in-app verifier can read a contract, and a database dump cannot.
- **Content Security Policy.** Every page gets a fresh nonce; only the app's own scripts, and the PayPal SDK they load, can run. No plugins, no framing, no form posts off-site.
- **Reconciliation.** Every 10 minutes the tick job asks PayPal about captures, holds and payouts still waiting on a webhook, and applies what PayPal reports, once.
- **Demo accounts.** With `DEMO_LOGIN=true` the two personas share a published authenticator secret, so their payout address, keys and recovery codes are locked, and the app refuses to start in demo mode unless PayPal is the sandbox.

## Disclosures

| What | Detail |
| --- | --- |
| Sandbox only, USD only | No real money moves. Holds are PayPal sandbox authorizations against a custom-balance personal account. |
| Mock carrier | There is no carrier API. A tracking number ending in an even digit is `delivered`, an odd digit `in_transit`, anything else `unknown`. The demo uses `TRK-DEMO-0000`. |
| Composed code photo | The handwritten deal-code photo in the sample evidence is composed in the browser on a canvas (a sample photo plus the deal code in the Caveat handwriting font) because codes are generated per deal. |
| Generated sample photos | The sample photos in `public/demo/` and the eval set in `eval/cases/` are path-traced 3D renders from `scripts/demo/photo-studio/`, not photographs, so everything is ours and free of third-party marks. Claude judges them as it would any photo, and you can upload your own instead. The eval numbers below measure these renders; real phone photos are noisier. |
| Limits | Per 10 minutes, in memory, per instance: 20 new deals (extractions) per user, 3 magic links per email and 10 per IP, 120 deal reads per user, 30 Studio agent turns per user. Over the limit the API answers `rate_limited`; the magic-link route answers `ok` either way so it does not reveal accounts. |
| Agent limits | The live desk runs as the Demo Buyer and is limited to 12 runs per 10 minutes per account and 60 per hour overall, because it spends model tokens. `POST /api/mcp` takes 120 requests per 10 minutes per user, however many keys the user has (JSON-RPC error -32002), and two requests over 1 MB at a time overall (503). `propose_deal` also counts against the 20 new deals above. In demo mode anyone can make an agent key for the shared demo personas; the ceiling and the PayPal approval still apply. |
| Platform as merchant | The Handshake sandbox business account receives the capture and pays the seller through Payouts. A production build would use PayPal multiparty onboarding so the seller is the payee. |
| Seeded history | The ledger and dashboard show about 25 seeded historical deals (`deals.seeded = true`) with events but no PayPal objects, so there is something to sort and chart. Deals you create are real sandbox deals. |
| AG Studio trial | `/dashboard/studio` runs on an AG Studio 45-day trial key. If the key's tier does not cover the AI module, Studio shows a licence banner and watermark; the features still work. |
| Demo login | Magic-link email only reaches the account owner's address (Resend test sender), so judges use the two demo personas. The seller persona's payout address comes from `DEMO_SELLER_PAYPAL_EMAIL` and is reset each time you switch to that persona, so edits on `/me` do not stick. |
| 21-day cap | Deals are capped at 21 days after the hold. There is no reauthorization; past the deadline the 10-minute job voids the hold. |
| 3-day honor period | PayPal honors an authorization's funds for 3 days and allows capture for up to 29. Deals here run up to 21 days, so a capture after day 3 can be declined. A decline returns the deal to the buyer for a new try. The sandbox can't fast-forward time, so this path is tested against a fixture, not live. Production would reauthorize after day 3. |
| Long holds, measured | One sandbox hold was captured 21 days after authorization, on its original authorization id with no reauthorization (authorization `21Y15276XD1807710`, capture `56598020KB204891K`, 2026-11-05). The planned captures on days 4 and 12 were not run, so this is one data point at the longest gap, and it is sandbox only. Sandbox Payouts needed a US sandbox business account, not a feature toggle (first app: 403 `PAYOUT_NOT_AVAILABLE`; US app: `SUCCESS`, 2026-10-15). |
| Payout retry, not finished in the sandbox | Retrying an unclaimed payout cancels the old item first, so the seller can't be paid twice. In the sandbox that cancel answered 500 `INTERNAL_SERVICE_ERROR` on all 7 answered tries over 14 hours for deal HS-RNUK (batch `C87YL9VCPFZYQ`), and on 2 of 3 other test items. The app answers 502, sends no second payout, and the deal stays `captured` with the failure shown. So the real sandbox run reached `failed` with `UNCLAIMED` but not attempt 2; the retry itself is covered only by integration tests against a fake PayPal. |
| No shipping address | Orders use `NO_SHIPPING`, so PayPal collects no address and the seller never gets one from Handshake. Nothing ships in the demo. Production would use `GET_FROM_FILE` and show the seller that address, because PayPal Seller Protection depends on shipping to the address on the transaction. |
| No refunds | The seller is paid right after capture and Handshake has no refund step. After that, a buyer's recourse is a PayPal dispute against the platform account. Disputes are on the production list. |
| Ignored reviews | If a buyer ignores a review, the hold is voided at the deadline, even when the parcel arrived. That favours the buyer. Production needs a neutral reviewer for this case. |
| PayPal Agent Toolkit | Not used, on purpose, and neither is PayPal's MCP server. The toolkit gives a model tools such as `create_order`, `pay_order` and `create_refund`, and at version 1.11.0, when we checked, it had no authorize, void or payout tools. Handshake keeps PayPal behind a fixed rule, and our own MCP server has no tool that approves a hold or captures. |

## Tools used and how

| Tool | Used for |
| --- | --- |
| PayPal Orders v2 (intent `AUTHORIZE`), Payments v2 (authorize, capture, void), Payouts v1, Webhooks v1 | Hold the buyer's money at terms acceptance, capture or void it from `decide()`, pay the seller, and learn about captures, voids and payouts from webhooks. Signatures are verified in our own code (cert from `PAYPAL-CERT-URL`, CRC32, RSA-SHA256). Every write carries a `PayPal-Request-Id`; every PayPal fact is applied once, from the API response or the webhook, whichever arrives first. `@paypal/paypal-server-sdk` 2.5 for Orders and Payments, raw `fetch` for Payouts and verification, `@paypal/react-paypal-js` for the button. |
| Claude `claude-sonnet-5-5` via `@anthropic-ai/sdk` | Three jobs, all structured outputs against hand-written JSON schemas at `effort: low`: extract `item_title`, amount, deadline and 1 to 4 checkable conditions from the sentence (subjective parts come back in `rejected[]` with a rewording); judge each condition from labelled base64 photos, the mock carrier status and the note; take one negotiation turn for an agent, whose limits code enforces. Every verdict row stores `model`, `prompt_version` and `raw_response`. |
| AG Grid Community 36.2 | `/ledger`: every deal of the signed-in persona, sortable, filterable, with status chips and a quick filter. |
| AG Studio 3.0 | `/dashboard/studio`: three sources from `/api/dashboard/data`, nine widgets on the canvas, a theme bound to the app's CSS tokens, a custom `deal-pipeline` widget (click a stage to cross-filter the page), and the built-in Studio agents plus a custom `auditor` agent, all answered by `claude-sonnet-5-5` through `POST /api/studio/agent`. The one server-run tool, `explain_verdict`, reads the signed-in user's own deal and audit log; the agent cannot change a deal or move money. The prompt box appears only when `ANTHROPIC_API_KEY` is set. Prompts that work: [docs/studio-prompts.md](docs/studio-prompts.md). Loaded client-side only. |
| Render | One Blueprint (`render.yaml`): web service, Postgres 18, a cron every 10 minutes that calls `POST /api/jobs/tick`. Paid plans so nothing sleeps during judging. |
| Prisma 7.10 + Postgres 18 | Schema, migrations (append-only trigger on `deal_events`), photos stored as `bytea` and served through HMAC-signed URLs that expire after 10 minutes. |
| Next.js 16, React 19, TypeScript 5.9, Tailwind CSS v4, Zod, jose, Resend | The app, validation, HS256 session cookies, magic-link email. |
| Caveat (SIL OFL 1.1, `public/demo/fonts/OFL.txt`) | The composed deal-code photo in the demo kit. |
| MCP (Model Context Protocol) | `POST /api/mcp` serves nine tools over Streamable HTTP with JSON responses, so any MCP client can run a deal under an agent key: [docs/agents.md](docs/agents.md). |
| Claude Code | The coding agent that built the app from the specs in `docs/`. |

## Evaluation results

`npm run eval` runs every case folder in `eval/cases/` through the real judge and compares `decide()`'s output with the case's `expected.json`. The set is 30 cases in seven groups (correct item, wrong item, listing photo reused, missing deal code, blurry, tracking not delivered, two prompt-injection cases; [docs/05-ai-spec.md](docs/05-ai-spec.md) section 9.1) plus ten extraction sentences with `--extract`. Two numbers matter: the decision-match rate, and the wrong-capture rate, which must be zero or the runner exits 1. Each run writes `eval/results/<date>-<model>-<effort>.json`.

| Model | Prompt versions | Cases | Decision match | Wrong captures | Latency | Run date |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-sonnet-5-5`, effort low, 3 repeats | judge-v1 | 30 (90 runs) | 87/90 (96.7%) | 0 of 63 | p50 3.5 s, p95 4.8 s | 2026-11-05 |
| `claude-sonnet-5-5`, effort low, second run | judge-v1 | 30 | 29/30 (96.7%) | 0 of 21 | p50 3.4 s, p95 4.1 s | 2026-11-05 |

Results: `eval/results/20261105-1819-claude-sonnet-5-5-low.json` and `20261105-1820-claude-sonnet-5-5-low.json`. Every miss is one case Claude passed at 0.80, under the 0.85 threshold, so a person decides: the safe direction. Both prompt-injection cases held in every run, and no case changed decision between repeats. Extraction (extract-v1) matched 10 of 10 sentences in a separate run: `eval/results/20261015-1142-claude-sonnet-5-5-low.json`, 2026-10-15. An earlier run with two wrong captures is kept in `eval/results/`; it traced to two bad test photos, as explained in [eval/README.md](eval/README.md).

The eval photos are generated renders of eight original items (see Disclosures), so these numbers don't promise the same result on phone photos.

See [eval/README.md](eval/README.md) for flags, challenger models and how to add a case.

## Run it locally

Needs Node 24 (`.node-version` pins 24.21.0; `package.json` allows up to 26), Postgres 18 and, for webhooks, `cloudflared`. The commands below use Docker for Postgres; any Postgres 18 works if `DATABASE_URL` and `TEST_DATABASE_URL` point at it. Full detail, including account setup, in [docs/07-setup-deployment.md](docs/07-setup-deployment.md) sections 3 and 4.

```bash
git clone https://github.com/0PrashantYadav0/Handshake.git handshake && cd handshake
npm ci                                                   # postinstall runs prisma generate
docker compose up -d                                     # Postgres 18 on :5432
docker compose exec db createdb -U postgres handshake_test
cp .env.example .env                                     # then fill it, see the table below
npx prisma migrate dev
npm run seed                                             # two personas + about 25 historical deals
npm run dev                                              # http://localhost:3000: Start a deal, Continue as buyer, Use demo code, Continue
```

If port 3000 is taken, run `npm run dev -- -p 3011` and set `APP_URL` to match.

`npm ci` prints peer-dependency warnings and an audit count, and Prisma suggests an upgrade. Versions are pinned on purpose, so skip `npm audit fix --force` and `npm i prisma@latest`.

Without PayPal and Anthropic keys the app still starts, and demo sign-in, `/ledger`, `/agents` and `/dashboard` load. Extracting terms needs `ANTHROPIC_API_KEY` (it answers 503 without one), and holds need the PayPal app.

Webhooks locally: `cloudflared tunnel --url http://localhost:3000`, then point a webhook on your PayPal app at `https://<words>.trycloudflare.com/api/webhooks/paypal`. Run the job by hand with `curl -fsS -X POST -H "Authorization: Bearer <CRON_SECRET from .env>" http://localhost:3000/api/jobs/tick`.

`instrumentation.ts` checks these at server start with `lib/env.ts`. `next dev` only warns about a missing or malformed one; `next start` (production) refuses to serve and answers 500 everywhere, so a local production run needs every required name filled, even with placeholders. `npm run check-env` runs the same check without starting the server, then tries the PayPal, Anthropic and Resend keys against their services (`NODE_ENV=production npm run check-env` for the Render rules); it prints names and verdicts, never values.

| Env var | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/handshake` |
| `APP_URL` | `http://localhost:3000` |
| `SESSION_SECRET`, `FILE_URL_SECRET`, `CRON_SECRET` | Random strings, at least 32 characters each (`openssl rand -base64 32`) |
| `DATA_KEYS` | Field encryption keyring: `k1:<secret>` with a secret of at least 32 characters, or `k2:<secret>,k1:<secret>` (the first encrypts; any listed key decrypts). Never change a key in place: prepend a new one, deploy, run `npm run reseal` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | A sandbox REST app (type Merchant) from developer.paypal.com; the public id is the same client id |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` |
| `PAYPAL_WEBHOOK_ID` | The webhook on that app, subscribed to the order, authorization, capture and payout events. May be empty in development, required in production |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | Anthropic Console key; `claude-sonnet-5-5` (the default when unset) |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` is always required: `"Handshake <onboarding@resend.dev>"`, with the quotes in `.env`. `RESEND_API_KEY` may be empty in development, where magic links print to the server console; it is required in production (`lib/env.ts` refuses to boot without it) |
| `PASS_THRESHOLD`, `AUTO_CAPTURE_MAX_MINOR` | `0.85`, `20000` |
| `DEMO_LOGIN`, `DEMO_SELLER_PAYPAL_EMAIL` | `true`; the sandbox personal account that receives payouts |
| `AG_GRID_LICENSE_KEY` | AG Studio trial key. Optional: without it everything still works, and `/dashboard/studio` can show a licence notice |

## Deploy it

Everything is one Blueprint: `render.yaml` declares the web service (`npm ci && npm run build`, `npx prisma migrate deploy && npm run seed` before each deploy), the Postgres 18 database and the cron that runs the job every 10 minutes. In Render choose **New > Blueprint**, point it at the repo, then fill the `sync: false` env vars (PayPal, Anthropic, Resend, `DEMO_SELLER_PAYPAL_EMAIL`, `AG_GRID_LICENSE_KEY`, `APP_URL`). The pre-deploy step also runs the seed, which is idempotent. Register a PayPal webhook on the Render hostname. Step by step, including a manual route without the Blueprint: [docs/deploy-render.md](docs/deploy-render.md); the reasoning: [docs/07-setup-deployment.md](docs/07-setup-deployment.md) section 5.

## Tests

```bash
npm test                               # unit: state machine, decide(), facts, webhook verification, session, carrier
npm run test:int                       # integration against TEST_DATABASE_URL (default handshake_test; the name must end in _test), serial: routes, flows, payment, webhooks, tick, rate limits, Studio agent
npx playwright install chromium        # once
E2E_PAYPAL_BUYER_EMAIL=... E2E_PAYPAL_BUYER_PASSWORD=... npx playwright test happy-path
                                       # builds and starts the app, runs the judge happy path end to end (sandbox personal account 1);
                                       # without the two variables it runs up to the PayPal popup and skips the rest
PLAYWRIGHT_BASE_URL=https://<host> E2E_PAYPAL_BUYER_EMAIL=... E2E_PAYPAL_BUYER_PASSWORD=... npx playwright test agents
                                       # the agent desk on real Claude and the sandbox: honest, cheating and hijacking sellers
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test two-party
                                       # against https://<host> it skips unless E2E_DATABASE_URL is that host's database, because the draft is written straight to the database
                                       # both demo personas: 2FA, join, sign on both sides, contract verified in the browser;
                                       # needs no Anthropic or PayPal key (tests/e2e/make-draft.ts)
npm run eval                           # the judge eval, calls the real API; prints the estimated cost at the end
npm run sandbox -- SB-1 --base <url>   # sandbox scenarios SB-1, SB-6, SB-7, SB-8, SB-11 against a running app
npm run reseal                         # after prepending a new kid:secret to DATA_KEYS: re-seals contract data with it (trust spec §5)
npm run reseal -- --seal-plaintext-events  # once, on a database with rows from before encryption
npm run lint && npm run typecheck
```

Details: [tests/e2e/README.md](tests/e2e/README.md) (`PLAYWRIGHT_BASE_URL` to run against a deployed host), [scripts/sandbox/README.md](scripts/sandbox/README.md) (`--dry`, `--wait`, `--full`, `--upload`), [eval/README.md](eval/README.md). CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit and integration tests and the build on every push.

## What a production build adds

- PDF evidence pack (the pack is JSON today).
- Disputes: open from the `CUSTOMER.DISPUTE.CREATED` webhook and submit the pack through the Disputes API.
- A merged GitHub pull request as a proof type, for software work.
- Split payouts and a platform fee.
- PayPal multiparty onboarding so the seller is the payee instead of the platform.
- A real carrier lookup, a verified email sending domain, and reauthorization after day 3.
- Encryption keys held in a KMS instead of the environment, passkeys (WebAuthn) as the second factor, and "Log in with PayPal" to prove the payout account.
- Rate limits shared across instances.

## Licence

MIT. Copyright (c) 2026 Prashant Kumar Yadav. See [LICENSE](LICENSE). AG Studio is used under AG Grid's trial terms and is fetched from npm at install; the repo contains only our own widget, theme and agent code.
