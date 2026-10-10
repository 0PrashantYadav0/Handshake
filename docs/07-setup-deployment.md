# Setup and deployment

This document decides how Handshake is laid out, configured, run locally, deployed on Render, kept alive through judging and described in the README; a developer or coding agent can set up every account and ship from it without looking anything else up.

As of 2026-10-09.

Every name (env var, command, endpoint, plan, table) is spelled as in [decisions.md](decisions.md). Facts about PayPal, Claude, AG Grid, Render, Resend, Prisma and Node come from [research/paypal.md](research/paypal.md), [research/claude-api.md](research/claude-api.md), [research/ag-grid.md](research/ag-grid.md) and [research/stack.md](research/stack.md); the section relied on is named in brackets. Anything those files mark UNVERIFIED stays marked here. Package versions are pinned in [dependencies.md](dependencies.md). The module layout matches [02-system-design.md](02-system-design.md).

## 1. Repository layout

One Next.js app at the repo root with one deep module per concern under `lib/` (B1, B2); nothing lives in `src/`.

```
handshake/
  .github/workflows/ci.yml   GitHub Actions: lint, typecheck, unit, integration, build (J4)
  .node-version              24.21.0 (J1); Render reads it before engines
  .env.example               every name in section 2, no values (J3)
  .gitignore                 .env, node_modules/, .next/, generated/, test-results/, playwright-report/
  compose.yaml               local Postgres 18 (section 4)
  render.yaml                Render Blueprint: web, Postgres, cron (section 5)
  prisma.config.ts           Prisma 7 config; loads .env with process.loadEnvFile() (section 4 step 4)
  next.config.ts
  package.json               scripts in section 4
  playwright.config.ts       testDir tests/e2e; one happy-path test (A5)
  vitest.config.mts          projects "unit" and "int"
  tsconfig.json              "@/*" alias to the repo root
  LICENSE                    MIT, "Copyright (c) 2026 Prashant Kumar Yadav"
  README.md                  section 10
  app/                       Next.js App Router
    page.tsx                 "/" landing + sign-in (G1)
    new/                     "/new"
    deal/[code]/             "/deal/[code]"
    ledger/                  "/ledger" (AG Grid Community)
    dashboard/               "/dashboard" (AG Studio)
    me/                      "/me"
    api/                     one route.ts per endpoint in H1; thin handlers (B4)
  lib/
    deal/                    the deal module (B2): handle, applyPaypalEvent, tick, queries, decide, transitions, events
    paypal/                  @paypal/paypal-server-sdk client, raw-fetch Payouts and token cache, webhook verification, fake (E1, E6)
    ai/                      prompts, hand-written JSON schemas, Claude client, fake (D1 to D11)
    auth/                    jose session cookie, magic link, demo personas (F1 to F3)
    files/                   upload validation, sha256, HMAC-signed URLs (B6)
    email/                   Resend adapter, console adapter, Email interface (02 section 4)
    db.ts                    Prisma singleton with @prisma/adapter-pg (I5)
  generated/prisma/          Prisma client output; gitignored, built by "prisma generate", imported as "@/generated/prisma/client"
  prisma/
    schema.prisma            tables in I1
    migrations/              prisma migrate dev output, committed
    seed.ts                  demo users + about 25 seeded deals (F6); idempotent
  eval/
    cases/<name>/            deal.json, reference/, evidence/, tracking.txt, expected.json (D12)
    run.ts                   "npm run eval"
  tests/                     laid out exactly as 06-test-plan.md "Layout and commands"
    unit/                    Vitest project "unit", *.test.ts; no network, no database
    int/                     Vitest project "int", *.int.test.ts; real Postgres (handshake_test), fakes for PayPal, AI, email
      helpers.ts             resetDb, signIn, callRoute, deal builders, webhookEvent
      global-setup.ts        runs "prisma migrate deploy" against TEST_DATABASE_URL once (section 4 step 8)
    e2e/
      happy-path.spec.ts     the one Playwright happy path (A5)
      paypal-popup.ts        approveInPopup(popup): PayPal popup selectors recorded with "npx playwright codegen"
    fixtures/                webhooks/, images/, paypal/ (06-test-plan.md "Test data and fixtures")
    stubs/empty.ts           alias target for "server-only" in vitest.config.mts
  scripts/sandbox/           sandbox scripts from 06-test-plan.md "Scripts"
    spike.ts                 E11 spikes: SB-0 payout, SB-0b create-hold / capture
    scenario.ts              runs one scenario by id against a running app, e.g. "npm run sandbox -- SB-1 --base http://localhost:3000"
    record-webhook.ts        records a real webhook delivery as a test fixture
  public/demo/               the demo kit, laid out exactly as 08-ui-spec.md section 12.1 (F5)
    presets.json             presets (mug, lamp, bottle), extras, sample sets, tracking number, code-photo boxes (08 section 12.2)
    reference/mug/           ref-1.jpg, ref-2.jpg (two listing photos, our own, 1600 px long edge); code-base.jpg (the item beside a blank paper note card; the canvas draws the code on it)
    reference/lamp/          the same three files for the lamp
    reference/bottle/        the same three files for the bottle
    evidence/good/           photo-1.jpg, photo-2.jpg: the mug, new angles, different background
    evidence/wrong-item/     photo-1.jpg, photo-2.jpg: a different desk lamp (other colour and shape)
    evidence/blurry/         photo-1.jpg: the bottle, motion-blurred and partly out of frame
    fonts/handwriting.woff2  Caveat, regular 400, Latin subset (SIL OFL 1.1), for the composed code photo
    fonts/OFL.txt            the OFL 1.1 text that must travel with the font
  docs/                      this folder: 01-requirements.md, 02-system-design.md, 03-database-schema.md, 04-api-spec.md,
                             05-ai-spec.md, 06-test-plan.md, 07-setup-deployment.md, 08-ui-spec.md, 09-ag-studio.md,
                             decisions.md, hackathon.md, dependencies.md, brief/, research/
```

Nothing under `public/` is git-ignored, so `fonts/OFL.txt` needs no `.gitignore` exception; it is committed like every other demo file.

## 2. Environment variables

These nineteen names (J3) are the whole configuration; `.env.example` lists each with an empty value and nothing else.

| Name | Purpose | Example format | Local (`.env`) | Render (`render.yaml`) |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Postgres connection string for `@prisma/adapter-pg` | `postgresql://postgres:postgres@localhost:5432/handshake` | the compose database | `fromDatabase` (internal URL) [stack: 5(a)] |
| `APP_URL` | Public base URL in share links and magic links | `https://handshake.onrender.com` | `http://localhost:3000` | `sync: false`; confirm after the first deploy |
| `SESSION_SECRET` | Signs the `hs_session` HS256 JWT (F1) | 44-character base64 | `openssl rand -base64 32` | `generateValue: true` |
| `FILE_URL_SECRET` | HMAC key for signed `GET /api/files/{id}` URLs (B6) | 44-character base64 | `openssl rand -base64 32` | `generateValue: true` |
| `PAYPAL_CLIENT_ID` | Sandbox REST app client id, server side | long alphanumeric | app `handshake-local` (section 3.1) | `sync: false`; app `handshake` |
| `PAYPAL_CLIENT_SECRET` | Sandbox REST app secret | long alphanumeric | app `handshake-local` | `sync: false`; app `handshake` |
| `PAYPAL_API_BASE` | REST base URL [paypal: 11] | `https://api-m.sandbox.paypal.com` | that value | `value:` |
| `PAYPAL_WEBHOOK_ID` | Webhook id used in signature verification (E6) | alphanumeric id from the dashboard | the tunnel webhook on `handshake-local` | the Render webhook on `handshake`; entered in the dashboard after the first deploy |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Same client id, inlined into the browser bundle for `PayPalScriptProvider` (E9) | same as `PAYPAL_CLIENT_ID` | same as `PAYPAL_CLIENT_ID` | `sync: false`; a change needs a rebuild, not a restart |
| `ANTHROPIC_API_KEY` | Claude API key read by `@anthropic-ai/sdk` [claude: 2] | `sk-ant-…` | key `handshake-local` (section 3.2) | `sync: false`; key `handshake-prod` |
| `AI_MODEL` | Model id for both jobs (D1) | `claude-sonnet-5-5` | `claude-sonnet-5-5` | `value:` |
| `RESEND_API_KEY` | Resend sending key (F2) | `re_…` | empty: the console adapter prints links | `sync: false` |
| `EMAIL_FROM` | Sender of magic links and notifications | `Handshake <onboarding@resend.dev>` | that value | `value:` |
| `PASS_THRESHOLD` | Minimum verdict confidence that counts as pass (D9) | `0.85` | `0.85` | `value:` |
| `AUTO_CAPTURE_MAX_MINOR` | Largest amount captured without buyer review (D9) | `20000` | `20000` | `value:` |
| `CRON_SECRET` | Bearer token for `POST /api/jobs/tick` (H1) | 44-character base64 | `openssl rand -base64 32` | `generateValue: true`; the cron service reads it with `fromService` |
| `DEMO_LOGIN` | Enables `POST /api/auth/demo` and the persona switcher (F3) | `true` | `true` | `value: "true"` |
| `DEMO_SELLER_PAYPAL_EMAIL` | `paypal_email` of the demo seller; receives Payouts (F3, E7) | `sb-xxxx@personal.example.com` | sandbox personal account 2 | `sync: false` |
| `AG_GRID_LICENSE_KEY` | AG Studio trial key passed to `AgStudioProvider` (G3) | long string from the trial email | empty (no watermark on localhost) | `sync: false`; pasted on or after 2026-11-01 |

Render sets `PORT` (10000) and `NODE_ENV=production` itself; neither is in `.env.example` [stack: 2, 5]. `NODE_ENV=production` is set at runtime only, so devDependencies (Prisma CLI, tsx) are installed at build [stack: summary 13]. `dotenv` is not installed ([dependencies.md](dependencies.md) "Not installed, on purpose"); section 4 step 4 shows how Prisma and the scripts read `.env`.

## 3. Accounts to create

Five accounts plus a tunnel that needs none; four accounts are created on day one, and the AG Studio trial waits until November so it lasts through judging.

| When | Account | Produces |
| --- | --- | --- |
| 2026-10-10 | PayPal Developer (sandbox) | 2 REST apps, 3 sandbox accounts, 2 webhooks, the buyer login for the README |
| 2026-10-10 | Anthropic Console | `ANTHROPIC_API_KEY` x2, a spend limit |
| 2026-10-10 | Resend | `RESEND_API_KEY` |
| 2026-10-10 | Render (Hobby workspace) | the $50 credit, three services from `render.yaml` |
| 2026-10-10 | Cloudflare quick tunnel (no account) | an HTTPS URL for local webhooks |
| 2026-10-10 | PayPal Discord | the AG Grid key request |
| 2026-11-01 to 2026-11-07 | AG Studio 45-day trial | `AG_GRID_LICENSE_KEY` valid past 2026-12-15 |

### 3.1 PayPal sandbox

Source: [paypal: 9 "Sandbox setup"], [paypal: 5 "Sandbox requirements"], [paypal: 6 "Subscribing"], [paypal: 6 "Simulator"].

1. Log in at developer.paypal.com and switch the dashboard to **Sandbox**.
2. **Testing Tools > Sandbox Accounts.** A business account (`sb-xxxx@business.example.com`) and a personal account (`sb-xxxx@personal.example.com`) already exist; the default balance of a generated account is UNVERIFIED [paypal: 5 "Sandbox requirements"]. Do not use the generated personal account as the buyer. Click **Create account > Create Custom Account** and create a **personal** account with the largest balance the form allows: custom balances are available only there [paypal: 5 "Sandbox requirements"]. Every judge deal authorizes against this balance, and an abandoned deal keeps its hold until `tick` voids it at `deadline_at` (B7), so holds pile up during 2026-12-01 to 12-15. Repeat **Create Custom Account** for a **business** account with the largest balance the form allows: captures land in it net of PayPal's fee and every payout plus its $0.25 item fee leaves it (step 5), so the generated business account's UNVERIFIED default would run dry during judging. Then click **Create account** once more for a second **personal** account (a generated one is fine; it only receives payouts). Country US, currency USD for all three [paypal: 11]. The generated accounts stay unused. Roles from now on: business = Handshake merchant (E10); personal 1 = the custom-balance buyer who logs into the PayPal popup; personal 2 = the seller's payout receiver (`DEMO_SELLER_PAYPAL_EMAIL`).
3. For each personal account, open **⋮ > View/Edit Account** and record the email and the system-generated password. Personal 1 goes in the README and in the Devpost text description (E9; section 8 recovery row); personal 2's email goes in `DEMO_SELLER_PAYPAL_EMAIL`. Log in once at https://www.sandbox.paypal.com with each to confirm they work, note the business balance (the default amount is UNVERIFIED) and confirm personal 1 shows the custom balance.
4. **Apps & Credentials > Create App.** Name `handshake`, Type **Merchant**, linked to the custom-balance business account from step 2. Copy **Client ID** and **Secret**. Repeat for a second app named `handshake-local`. Two apps, because webhooks are delivered per app [paypal: 11]: the Render deployment and the local machine each get only their own events.
5. Day-1 Payouts check (E11). Run the token call and confirm the `scope` string contains `https://uri.paypal.com/payments/payouts` [paypal: 1]:

   ```bash
   TOKEN_JSON=$(curl -s -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
     -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials")
   echo "$TOKEN_JSON" | grep -o 'payments/payouts'                                   # must print payments/payouts
   TOKEN=$(echo "$TOKEN_JSON" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')     # used by step 8
   ```

   Then open the app's **Features** list. Whether sandbox Payouts needs a feature enabled there is UNVERIFIED [paypal: open risk 3]; if a payout later fails with `REQUIRED_SCOPE_MISSING` or `AUTHORIZATION_ERROR`, enable Payouts in that list. Payouts are funded from the business balance, and captures land in the same balance net of PayPal's transaction fee (the capture resource's `seller_receivable_breakdown` has gross, fee and net [paypal: 3 "Capture"]), while the payout sends the gross `amount_minor` plus the $0.25 item fee shown in the sandbox samples [paypal: 5]. So each demo deal costs the balance PayPal's capture fee plus the $0.25 payout item fee; section 8 watches that drain weekly.
6. Webhook for the hosted app: open app `handshake` > **Features > Sandbox Webhooks > Add Webhook**. URL `https://<render host>/api/webhooks/paypal` (the host comes from section 5 step 4; create this webhook after the first deploy). Tick exactly these eleven events (E5):

   ```
   CHECKOUT.ORDER.APPROVED
   PAYMENT.AUTHORIZATION.CREATED
   PAYMENT.AUTHORIZATION.VOIDED
   PAYMENT.CAPTURE.COMPLETED
   PAYMENT.CAPTURE.PENDING
   PAYMENT.CAPTURE.DECLINED
   PAYMENT.PAYOUTS-ITEM.SUCCEEDED
   PAYMENT.PAYOUTS-ITEM.FAILED
   PAYMENT.PAYOUTS-ITEM.BLOCKED
   PAYMENT.PAYOUTS-ITEM.RETURNED
   PAYMENT.PAYOUTS-ITEM.UNCLAIMED
   ```

   Save, then copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID` on Render. The listener must be HTTPS on port 443; PayPal retries a non-2xx answer up to 25 times over 3 days [paypal: 6 "Delivery and retries"].
7. Webhook for local work: open app `handshake-local` and add the same eleven events with the tunnel URL from section 3.6. Copy its Webhook ID into `.env`. The tunnel URL changes every session, so this webhook's URL is edited each time (section 4 step 11).
8. Simulator: mock events cannot be verified by postback and are signed with the literal webhook id `WEBHOOK_ID`; outside production the receiver accepts that id (E6). Fire one from the shell to prove the signature path and the `200`:

   ```bash
   curl -s -X POST https://api-m.sandbox.paypal.com/v1/notifications/simulate-event \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"url":"https://<tunnel host>/api/webhooks/paypal","event_type":"PAYMENT.AUTHORIZATION.CREATED"}'
   ```

   Simulator payloads are v1-shaped mocks and match no deal; they are stored in `webhook_events`, marked processed, answered `200`, and never used as fixtures for v2 parsing [paypal: 6 "Simulator"].
9. Week-1 spike (E11): the three-hold schedule is [06-test-plan.md](06-test-plan.md) SB-0b (`scripts/sandbox/spike.ts create-hold` three times on W1 day 1; capture the first on day 4, the second on day 12, the third on day 21), so the spike starts on W1 day 1. Capturing the original authorization after day 3 is UNVERIFIED [paypal: open risk 1]. If any capture fails with `AUTHORIZATION_EXPIRED` or a 422, apply [02-system-design.md](02-system-design.md) section 12 spike 1: cap `deadline_days` at 3 in decisions I3/D6 and add the reauthorize-before-capture step; record the outcome in decisions E11 and in the README's "Disclosures" section.
10. Negative testing is off by default and is only needed for a scenario in [06-test-plan.md](06-test-plan.md) that mocks a PayPal error. It is turned on per business sandbox account under **Settings > Negative Testing**, after which the header `PayPal-Mock-Response: {"mock_application_codes": "<ERROR_NAME>"}` works on Orders v2 and Payments v2 [paypal: 9 step 6].

### 3.2 Anthropic

Source: [claude: 2 "TypeScript SDK"], [claude: 9 "Rate limits and cost"].

1. Sign in at the Claude Console (platform.claude.com) and create an organisation if there is none.
2. Create two API keys: `handshake-prod` (Render) and `handshake-local` (development and `npm run eval`). The zero-argument SDK client reads `ANTHROPIC_API_KEY`; set only that variable.
3. Open the **Rate limits** page and note the tier. Start tier gives each 5.5 model 1,000 RPM, 2M input tokens/min, 400K output tokens/min and a $500/month spend cap; a new organisation may begin in an Evaluation tier with lower, unpublished limits.
4. Set a monthly spend limit of $75 in the Console (section "Assumptions", item 4). A hit cap returns `429` with no `retry-after` until the next month; the verdict path turns that into `unclear` and the decision function into `buyer_review` (D4, D9), so money never moves on a cap hit, but a judge would see `in_review`.
5. Budget: about $0.08 per deal, $2.40 per 30-case Sonnet eval, $30 to $35 for the model and effort comparison sweep.

### 3.3 Resend

Source: [stack: 7 "Resend"].

1. Sign up at resend.com with the developer's own address. That address is the only one the test sender can deliver to.
2. **API Keys > Create API Key** with sending access; copy it into `RESEND_API_KEY`.
3. Use the test sender without verifying a domain: `EMAIL_FROM=Handshake <onboarding@resend.dev>`. Limits: 100 emails per UTC day, 3,000 per month, 10 requests per second. Sending to any other address returns `403 validation_error`, so magic links are optional for judges and demo personas are the judge path (F2, F3).
4. FR-28 (could): verifying a domain the team owns (DNS records in the Resend dashboard) lets magic links reach anyone.
5. Locally, leave `RESEND_API_KEY` empty: the console adapter prints the link (B3, F2).

### 3.4 Render

Source: [stack: 5 "Render"], [stack: "Implications for Handshake"], [hackathon.md](hackathon.md) "Sponsor facts we rely on".

1. Sign up at render.com with the GitHub account that owns `0PrashantYadav0/Handshake`. Stay on the Hobby workspace ($0). Do not upgrade to Pro ($25/mo).
2. Claim the $50 hackathon credit through the Render claim link on the Devpost resources page. The next day, open **Billing** and confirm the credit shows; whether it applies to every line item is UNVERIFIED [stack: 5(c)].
3. **Blueprints > New Blueprint Instance**, connect the repository, branch `main`. Render reads `render.yaml` (section 5) and prompts once for every `sync: false` value. Enter them from section 2; for `PAYPAL_WEBHOOK_ID` enter `pending` and for `AG_GRID_LICENSE_KEY` enter nothing. Click **Apply**. This creates the web service `handshake`, the database `handshake-db` and the cron job `handshake-tick`.
4. Wait for build, then pre-deploy (`npx prisma migrate deploy`), then live. Open `https://<host>/api/health` and expect `200`. Then open **handshake-tick > Environment** and confirm `APP_HOST` equals the web service's host: the research documents `fromService: { envVarKey }` [stack: 5(a)] but not that it resolves a built-in variable such as `RENDER_EXTERNAL_HOSTNAME` across services, so this is UNVERIFIED. If `APP_HOST` is empty, change the cron's `APP_HOST` in `render.yaml` to `sync: false`, re-apply the Blueprint and paste the host; without it the daily `tick` never runs and no deadline is ever voided.
5. Create the webhook (section 3.1 step 6) with that host, then in **handshake > Environment** set `PAYPAL_WEBHOOK_ID` and correct `APP_URL` if the host differs from `https://handshake.onrender.com`. Saving triggers a deploy.
6. Seed the hosted database once: **handshake > Shell**, run `npm run seed`. Re-running is harmless (section 1, `prisma/seed.ts`).
7. Later secrets never go in `render.yaml`; `sync: false` values are prompted only at first creation and are edited in the dashboard afterwards.
8. Render deploys every push to `main` (section "Assumptions", item 6). Playwright runs locally before each push (J4).

### 3.5 AG Grid and AG Studio

Source: [ag-grid: 2 "Licensing"], [ag-grid: "Recommendation for Handshake", "Licence strategy"], [ag-grid: 7].

1. Now: post on the PayPal Discord asking the AG Grid team for a Studio key valid through 2026-12-15, stating that judges test the hosted app until then. Whether they issue one is UNVERIFIED.
2. Build with no key. On localhost there is no watermark, only a console banner; the ledger uses AG Grid Community, which needs no key ever.
3. Between 2026-11-01 and 2026-11-07, fill the 45-day trial form at https://www.ag-grid.com/studio/license-pricing/ (first name, last name, email). A key requested 2026-11-01 expires about 2026-12-16; requested earlier it expires before judging ends. How fast the key arrives is UNVERIFIED, so request it at the start of that window.
4. Paste the key into `AG_GRID_LICENSE_KEY` on Render (**handshake > Environment**) and locally. The server page passes it to `AgStudioProvider` as a prop; it is validated in the browser, so it is not a server secret, but it is never committed.
5. On the hosted `/dashboard`, open the browser console. Expect no "License Key Not Found", "Trial Period Expired" or "Incompatible License Key" banner with `AgStudioAiModule` registered (the trial being PRO-AI tier is UNVERIFIED).
6. If the key lapses, the dashboard still works: a watermark fades after about five seconds and a console banner appears. Nothing is gated.

### 3.6 Cloudflare tunnel

Source: [stack: 11 "Webhook tunnel"].

1. `brew install cloudflared` (formula 2026.10.0). No account, no domain.
2. `cloudflared tunnel --url http://localhost:3000` prints `https://<words>.trycloudflare.com`. That host goes in the `handshake-local` webhook URL.
3. Limits: 200 in-flight requests, no server-sent events, and the URL dies when the process stops. Nothing in Handshake needs more.
4. Most local work needs no tunnel: the PayPal popup and every API call work on `http://localhost:3000`; only webhook delivery needs it. For a day without webhooks, `confirm_approval` still moves the deal to `held` (C2) and the capture response still triggers the payout (C4); only `payout_succeeded` (deal → `paid`) depends on a webhook.

## 4. Local development

A fresh clone runs in under ten minutes with these steps in this order.

1. Install Node 24.21.0 (the version in `.node-version`); `node --version` must print `v24.21.0`. Install Docker Desktop and `cloudflared` (section 3.6).
2. Clone and install:

   ```bash
   git clone git@github.com:0PrashantYadav0/Handshake.git handshake && cd handshake
   npm ci
   ```

   `npm ci` runs `postinstall`, which runs `prisma generate` into `generated/prisma/` at the repo root (git-ignored; [dependencies.md](dependencies.md) trap 11). Never run `npm i prisma` unpinned: it installs the Prisma 8 release candidate [stack: summary 2].
3. Start Postgres 18 and create the test database:

   ```yaml
   # compose.yaml
   services:
     db:
       image: postgres:18-alpine
       environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: handshake }
       ports: ['5432:5432']
       volumes: ['pgdata:/var/lib/postgresql']
   volumes: { pgdata: {} }
   ```

   ```bash
   docker compose up -d
   docker compose exec db createdb -U postgres handshake_test
   ```

   The volume mounts at `/var/lib/postgresql`, not `.../data`, because the PG 18 image keeps `PGDATA` under `/var/lib/postgresql/18/docker` [stack: 11].
4. Create `.env` from `.env.example` and fill it:

   ```bash
   cp .env.example .env
   ```

   ```dotenv
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/handshake
   APP_URL=http://localhost:3000
   SESSION_SECRET=            # openssl rand -base64 32
   FILE_URL_SECRET=           # openssl rand -base64 32
   PAYPAL_CLIENT_ID=          # app handshake-local, section 3.1 step 4
   PAYPAL_CLIENT_SECRET=      # app handshake-local
   PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
   PAYPAL_WEBHOOK_ID=         # handshake-local webhook, section 3.1 step 7
   NEXT_PUBLIC_PAYPAL_CLIENT_ID=   # same value as PAYPAL_CLIENT_ID
   ANTHROPIC_API_KEY=         # key handshake-local, section 3.2
   AI_MODEL=claude-sonnet-5-5
   RESEND_API_KEY=            # empty: links print to the console
   EMAIL_FROM=Handshake <onboarding@resend.dev>
   PASS_THRESHOLD=0.85
   AUTO_CAPTURE_MAX_MINOR=20000
   CRON_SECRET=               # openssl rand -base64 32
   DEMO_LOGIN=true
   DEMO_SELLER_PAYPAL_EMAIL=  # sandbox personal account 2
   AG_GRID_LICENSE_KEY=       # empty until the trial key arrives
   ```

   Next.js loads `.env` for the app. Prisma 7 does not load `.env`; `prisma.config.ts`, `prisma/seed.ts` and `eval/run.ts` call `process.loadEnvFile()` (UNVERIFIED on Node 24.21.0: no research file documents it; [dependencies.md](dependencies.md) "Not installed, on purpose"), which is a no-op failure on Render and in CI where variables are injected. Day-1 check: with a `.env` present, `node -e "process.loadEnvFile()"` must exit 0; if not, `npm i -D dotenv` and replace the three `try` lines with `import 'dotenv/config'` (research/stack.md section 3):

   ```ts
   // prisma.config.ts
   import { defineConfig } from 'prisma/config';

   try { process.loadEnvFile(); } catch {}            // .env is optional; Render and CI inject env vars

   export default defineConfig({
     schema: 'prisma/schema.prisma',
     migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
     datasource: { url: process.env.DATABASE_URL }, // not env(): env() throws when unset and breaks "prisma generate" at build
   });
   ```

   [stack: 3 "Prisma 7.10"]
5. Apply migrations: `npx prisma migrate dev`. In Prisma 7 this neither generates the client nor seeds [stack: summary 3]. To add a migration: `npx prisma migrate dev --name <change>`; for hand-edited SQL such as the append-only trigger on `deal_events` (C6): `npx prisma migrate dev --create-only --name <change>`, edit, then `npx prisma migrate dev`.
6. Seed: `npm run seed` creates `demo-buyer@handshake.demo`, `demo-seller@handshake.demo` and about 25 deals with `seeded = true` (F6).
7. Run: `npm run dev`, open http://localhost:3000, click "Continue as buyer".
8. Tests:

   ```bash
   npm test            # unit (Vitest project "unit"), no database
   npm run test:int    # integration against TEST_DATABASE_URL (default handshake_test), serial; 06-test-plan.md owns the Vitest config
   npx playwright install chromium   # once
   npm run test:e2e    # builds, starts next start on :3000, runs the one happy path
   ```
9. Lint and types: `npm run lint` (eslint; `next lint` no longer exists) and `npm run typecheck`.
10. Eval: `npm run eval` runs the 30 cases in `eval/cases/` and prints the decision-match rate and the wrong-capture rate (D12). It calls the real API: about $2.40 on Sonnet. Challengers: `AI_MODEL=claude-opus-5-5 npm run eval` and `AI_MODEL=claude-haiku-5-5 npm run eval` (D1).
11. Webhooks locally: in a second terminal `cloudflared tunnel --url http://localhost:3000`, copy the printed host, then in the PayPal dashboard edit the `handshake-local` webhook's URL to `https://<words>.trycloudflare.com/api/webhooks/paypal`. If a new webhook is created instead of edited, copy its new Webhook ID into `.env` and restart `npm run dev`. Repeat each session.
12. Run the daily job by hand: `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/tick`.

The `package.json` scripts those steps rely on:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "postinstall": "prisma generate",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --project unit",
    "test:int": "vitest run --project int --no-file-parallelism",
    "test:e2e": "playwright test",
    "eval": "tsx eval/run.ts",
    "seed": "tsx prisma/seed.ts",
    "sandbox": "tsx scripts/sandbox/scenario.ts"
  }
}
```

`build` runs `prisma generate` because Prisma 7 no longer generates on install or on `migrate dev` [stack: 3]. `test:int` needs no inline variable: `vitest.config.mts` sets `DATABASE_URL` for the `int` project from `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/handshake_test`) and `tests/int/global-setup.ts` runs `prisma migrate deploy` against it, both defined in [06-test-plan.md](06-test-plan.md) "Layout and commands".

## 5. Deploy on Render

The whole deployment is this one Blueprint (J2): a web service, a Postgres and a cron job, all paid, about $15.50 a month.

```yaml
# render.yaml
services:
  - type: web
    name: handshake
    runtime: node
    plan: 0.5c-512mb                       # $7/mo; never spins down
    buildCommand: npm ci && npm run build  # build = prisma generate && next build
    preDeployCommand: npx prisma migrate deploy
    startCommand: npm run start            # next start; Render sets PORT=10000
    healthCheckPath: /api/health
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: handshake-db
          property: connectionString
      - key: APP_URL
        sync: false
      - key: SESSION_SECRET
        generateValue: true
      - key: FILE_URL_SECRET
        generateValue: true
      - key: CRON_SECRET
        generateValue: true
      - key: PAYPAL_CLIENT_ID
        sync: false
      - key: PAYPAL_CLIENT_SECRET
        sync: false
      - key: PAYPAL_API_BASE
        value: https://api-m.sandbox.paypal.com
      - key: PAYPAL_WEBHOOK_ID
        sync: false
      - key: NEXT_PUBLIC_PAYPAL_CLIENT_ID
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: AI_MODEL
        value: claude-sonnet-5-5
      - key: RESEND_API_KEY
        sync: false
      - key: EMAIL_FROM
        value: "Handshake <onboarding@resend.dev>"
      - key: PASS_THRESHOLD
        value: "0.85"
      - key: AUTO_CAPTURE_MAX_MINOR
        value: "20000"
      - key: DEMO_LOGIN
        value: "true"
      - key: DEMO_SELLER_PAYPAL_EMAIL
        sync: false
      - key: AG_GRID_LICENSE_KEY
        sync: false

  - type: cron
    name: handshake-tick
    runtime: node
    plan: 0.5c-512mb                       # $1/mo minimum
    schedule: "0 6 * * *"                  # 06:00 UTC daily (J2)
    buildCommand: "true"
    startCommand: >-
      curl -fsS --max-time 120 --retry 3 -X POST
      -H "Authorization: Bearer $CRON_SECRET"
      "https://$APP_HOST/api/jobs/tick"
    envVars:
      - key: APP_HOST                      # UNVERIFIED: cross-service envVarKey to a built-in variable; see 3.4 step 4
        fromService:
          name: handshake
          type: web
          envVarKey: RENDER_EXTERNAL_HOSTNAME
      - key: CRON_SECRET
        fromService:
          name: handshake
          type: web
          envVarKey: CRON_SECRET

databases:
  - name: handshake-db
    plan: 0.1c-256mb                       # $6/mo, 100 connections
    diskSizeGB: 5                          # omit it and Render gives 15 GB at $0.30/GB
    postgresMajorVersion: "18"
```

Why each line is what it is [stack: 5, "Implications for Handshake"]:

| Line | Reason |
| --- | --- |
| `plan: 0.5c-512mb` | Render's current name for `starter`. Free web services spin down after 15 minutes idle and take about a minute to wake; judges would hit that. |
| `preDeployCommand` | Runs after build on a separate instance, before the new version serves; a failure aborts the deploy and the old build keeps serving. Paid web services only. Migrations never go in `buildCommand`: a failed deploy would already have migrated. |
| `healthCheckPath: /api/health` | Must answer 2xx within 5 s; the route touches no database and no model. |
| no `region` | Web and database both default to `oregon`; the internal `connectionString` only works in one region. |
| no `previews` | Disabled by default; full-stack previews need Pro anyway. |
| cron `curl` | Hits the app over HTTPS with `CRON_SECRET`, so the job reuses app code with no second build. `tick` is idempotent (B7), so a retry or a manual run is safe. Native runtimes include `curl`. |
| `schedule: "0 6 * * *"` | Render cron schedules are UTC; 06:00 UTC is 22:00 PST, outside judges' working hours. |
| `diskSizeGB: 5` | Photos live in Postgres (B6); 100 deals at about 6 MB is 600 MB. Disk can grow but never shrink. |
| `0.1c-256mb` | Free Postgres expires 30 days after creation and is deleted after a 14-day grace period, before judging. |
| no PgBouncer | `pg` Pool `max: 10` on one instance against 100 allowed connections. |

Deploy flow: push to `main` → `npm ci && npm run build` → `npx prisma migrate deploy` → `next start` → health check → traffic switches. Zero-downtime deploys mean the old build runs against the new schema for a moment, so migrations stay backward compatible with the previous build; there are no migrations at all after 2026-11-11 (section 8).

## 6. CI

GitHub Actions runs on every push and pull request: lint, typecheck, unit tests, integration tests against a Postgres 18 service container, and the production build (J4). Playwright is not in CI; it runs locally before each push. The workflow below is the one in [06-test-plan.md](06-test-plan.md) "CI", copied so this document is complete; 06 owns it, and any change is made there first.

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18-alpine
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: handshake_test }
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
        ports: ['5432:5432']
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/handshake_test
      TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/handshake_test
      APP_URL: http://localhost:3000
      SESSION_SECRET: ci-only-session-secret-at-least-32-chars
      FILE_URL_SECRET: ci-only-file-url-secret-at-least-32-chars
      CRON_SECRET: ci-only-cron-secret-at-least-32-characters
      PAYPAL_CLIENT_ID: ci
      PAYPAL_CLIENT_SECRET: ci
      PAYPAL_API_BASE: https://api-m.sandbox.paypal.com
      PAYPAL_WEBHOOK_ID: WEBHOOK_ID
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: ci
      ANTHROPIC_API_KEY: ci
      AI_MODEL: claude-sonnet-5-5
      RESEND_API_KEY: ci
      EMAIL_FROM: Handshake <onboarding@resend.dev>
      PASS_THRESHOLD: '0.85'
      AUTO_CAPTURE_MAX_MINOR: '20000'
      DEMO_LOGIN: 'true'
      DEMO_SELLER_PAYPAL_EMAIL: seller@example.com
      AG_GRID_LICENSE_KEY: ''
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:int
      - run: npm run build
```

Every one of the nineteen J3 names is set to a dummy value so `next build` and the adapters' constructors never fail on a missing name; none is used by a test, because the integration tests swap in fakes through `deps` (B3), so no real PayPal, Anthropic or Resend key exists in CI. `TEST_DATABASE_URL` is the test runner's own variable (section 4 step 8), not a J3 name. `npx prisma migrate deploy` is not a workflow step: `tests/int/global-setup.ts` runs it. `actions/checkout@v7` and `actions/setup-node@v7` are the current releases [stack: "Pinned versions"].

## 7. Monthly cost

Hosting costs about $15.50 a month and about $35 for 2026-10-09 to 2026-12-15, inside the $50 Render credit; model spend is the only other bill.

| Item | Plan or rate | Per month | 2026-10-09 to 2026-12-15 | Source |
| --- | --- | --- | --- | --- |
| Render web `handshake` | `0.5c-512mb` | $7.00 | $15.40 | [stack: 5(c)] |
| Render Postgres `handshake-db` | `0.1c-256mb` | $6.00 | $13.20 | [stack: 5(c)] |
| Render Postgres disk | 5 GB at $0.30/GB | $1.50 | $3.30 | [stack: 5(c)]; the free-GB credit is UNVERIFIED |
| Render cron `handshake-tick` | `0.5c-512mb`, $1 minimum | $1.00 | $3.00 (three calendar months) | [stack: 5(c)] |
| Render workspace | Hobby | $0 | $0 | [stack: 5(c)] |
| **Render total** | | **$15.50** | **about $35, covered by the $50 credit** | |
| Anthropic, live deals | Sonnet 5.5 at `effort: low`, about $0.08 per deal | about $8 for 100 deals | about $12 for 150 deals | [claude: 9] |
| Anthropic, eval | $2.40 per Sonnet run; $30 to $35 for the comparison sweep | varies | about $45 (one sweep, five plain runs) | [claude: 9] |
| Resend | free tier, 3,000/month | $0 | $0 | [stack: 7] |
| PayPal sandbox | | $0 | $0 | [paypal: 9] |
| AG Studio | 45-day trial | $0 | $0 | [ag-grid: 2] |
| Cloudflare quick tunnel | | $0 | $0 | [stack: 11] |
| **Everything** | | | **about $95, of which the $35 Render share is paid by the credit** | |

Render bills per second and prorates. The Anthropic spend limit from section 3.2 ($75/month) caps the only open-ended line.

## 8. Keeping the demo alive through 2026-12-15

The hosted demo is frozen at the submission commit and checked once a week; nothing else touches it.

Rules from 2026-11-11 (submission) to 2026-12-15 (end of judging):

1. No pushes to `main`. Render deploys every push, and a deploy during judging risks a broken build, a migration against live rows and a watermark change. Post-submission work goes on a branch that is never merged before 2026-12-16. Two named exceptions: a hosted demo that is down and cannot be restored by a restart or an environment variable change; and a README-only commit carrying a replacement sandbox buyer credential (the recovery row below). A README-only commit changes no code, so the redeploy it triggers rebuilds the same app.
2. No Blueprint sync, no plan change, no region change, no disk change, no Postgres upgrade.
3. Environment variable edits are allowed only to paste a longer AG Studio key or to rotate a leaked secret. Each edit redeploys the same commit.
4. Spend caps stay on: Anthropic $75/month; Render stays on Hobby with the three services above and nothing else; Resend stays on the free tier; the Postgres disk stays at 5 GB.
5. No live deals are pre-made (A2). Judges create deals on demand; `tick` voids any `held` or `in_review` deal past `deadline_at` every day at 06:00 UTC (B7), so nothing outlives its 29-day PayPal hold.
6. The sandbox accounts, the two REST apps and the Render webhook are never edited or deleted. The `handshake-local` app may change freely; it delivers nothing to Render.

Weekly check, every Monday from 2026-11-16 to 2026-12-14, about 15 minutes:

| Check | How | Pass looks like |
| --- | --- | --- |
| Health | `curl -fsS https://<host>/api/health` | `200` |
| Deploy state | Render > handshake > Events | Last deploy is the submission commit and is "Live"; no deploy since |
| Cron | Render > handshake-tick > Events (or Logs) | Yesterday's run exited 0 |
| Credit | Render > Billing | Remaining credit ≥ $15.50 × months left |
| A full deal | As a judge, the README steps 1 to 6 exactly: "Continue as buyer"; first "Try one:" chip (the $18 mug, 5 days); "Extract terms"; "Save terms"; "Use sample listing photos"; "Accept terms and get link"; "Open deal page"; header **Seller**; "Join as seller"; "Accept terms"; header **Buyer**; PayPal button with personal account 1; header **Seller**; "Use sample evidence: Good"; "Submit proof for checking" | `paid` within about seven minutes; `fact:payout_succeeded` in the event list |
| Webhooks | PayPal dashboard > app `handshake` > Webhook Events | Every delivery for that deal answered `200` |
| Business balance | sandbox.paypal.com as the business account | Balance above $100: each deal drains PayPal's capture fee plus the $0.25 payout item fee (section 3.1 step 5), and the judging window holds many deals. Below $100, top up through **Testing Tools > Sandbox Accounts > Create account > Create Custom Account** [paypal: 5 "Sandbox requirements"]: a replacement business account with the largest balance the form allows, a new REST app linked to it with the eleven-event webhook (section 3.1 steps 4 and 6), and its client id, secret and webhook id pasted into `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` and `PAYPAL_WEBHOOK_ID` on Render, which redeploys the same commit (rule 3). This is the one case where rule 6 yields |
| Buyer balance | sandbox.paypal.com as personal 1 | Available balance above $1,000; no open hold older than 21 days (`tick` voids every `held` and `in_review` deal at `deadline_at`, at most 21 days, B7) |
| Model spend | Claude Console > Usage | Month-to-date well under $75; no `429` lines in Render logs |
| AG Studio key | Hosted `/dashboard`, browser console | No licence banner; the key's expiry date is after 2026-12-15 |
| Disk | Render > handshake-db > Metrics | Storage under 4 GB |
| Buyer login | sandbox.paypal.com with personal account 1 | The README credentials still work |
| Buyer login recovery | If the login fails (the password is public in the README; a stranger may change it, or the balance may run dry): **Testing Tools > Sandbox Accounts > ⋮ > View/Edit Account** and reset the password, or **Create Custom Account** for a replacement personal account with the largest balance the form allows | The new credential works in the popup; it is pushed in a README-only commit (rule 1 exception) and pasted into the Devpost text description, which needs no deploy, so a README redeploy is never on the critical path |

If any row fails, the fix order is: restart the web service from the Render dashboard, then an environment variable edit, then a README-only commit for a buyer credential, then and only then a code push from a hotfix branch merged to `main`, noted in the README's "Disclosures".

## 9. Pre-submission checklist

Submission is 2026-11-11, one day before the 2026-11-12 12:00 PST deadline (A1); every box is ticked on the hosted Render URL, not on localhost.

Repository and licence (A3, [hackathon.md](hackathon.md)):

- [ ] `github.com/0PrashantYadav0/Handshake` is public (it is private as of 2026-10-09).
- [ ] `LICENSE` at the repo root holds the unmodified MIT text with `Copyright (c) 2026 Prashant Kumar Yadav`, and GitHub's About section shows "MIT license" [stack: 12].
- [ ] No secret in the repo history, the client bundle or the logs: `.env` is gitignored, `git log -p -S 'sk-ant-'` and `-S 're_'` find nothing, the only `NEXT_PUBLIC_` variable is the PayPal client id.
- [ ] `.env.example` lists the nineteen names in section 2 with no values.

Code and tests (A5, J4, D12):

- [ ] CI is green on the submission commit.
- [ ] `npm run test:e2e` (the one Playwright happy path) passes locally against a production build.
- [ ] `npm run eval` on the submission commit prints a wrong-capture rate of 0; the decision-match rate and the run date are in the README.
- [ ] Every sandbox scenario in [06-test-plan.md](06-test-plan.md) passes against the hosted URL; SB-9 (reauthorize) and SB-12 (disputes) are cut (B7, A5).
- [ ] The E11 spike results are recorded: capture of the original hold on day 4 or later, and whether sandbox Payouts needed a feature toggle.
- [ ] Three outside testers each finished a deal from a phone as seller (A5).

Hosted demo (A2, J2, F3, F5, F6):

- [ ] `GET /api/health` returns `200`; the dashboard shows `render.yaml` applied with no drift.
- [ ] Every `sync: false` variable is set; `DEMO_LOGIN` is `true`; `APP_URL` equals the live host.
- [ ] The PayPal webhook for app `handshake` points at `https://<host>/api/webhooks/paypal` with the eleven E5 events, and `PAYPAL_WEBHOOK_ID` matches it.
- [ ] `handshake-tick` ran successfully in the last 24 hours.
- [ ] `npm run seed` has run on the hosted database: the ledger shows about 25 seeded deals.
- [ ] A judge walkthrough from [01-requirements.md](01-requirements.md) with the three presets in `public/demo/presets.json` reaches `paid` (mug, "Good"), `voided` (lamp, "Wrong item" twice) and `in_review` (bottle, "Blurry"), and the $250 preset with "Good" reaches `in_review` (08 section 12.4).
- [ ] `AG_GRID_LICENSE_KEY` is set and valid past 2026-12-15, or the Discord key is; the hosted `/dashboard` shows no licence banner.
- [ ] Anthropic monthly limit is set; Render Billing shows the credit.

README and Devpost (A3, A5, E9, E10, D7, F5):

- [ ] README has every section in section 10, including the hosted URL, the sandbox personal login for the PayPal popup, the demo persona instructions, the disclosures, the tools used and the eval numbers.
- [ ] README lists the cuts as "What a production build adds": PDF evidence pack, disputes (FR-15, FR-16), GitHub PR proof (FR-17), split payouts (FR-18), multiparty onboarding.
- [ ] A fresh clone on a second machine runs from the README alone in under ten minutes.
- [ ] The video is under three minutes, public on YouTube, recorded on the hosted demo, with no third-party trademarks or copyrighted music; its URL is in the README and the Devpost form.
- [ ] The Devpost form has the text description (including the sandbox buyer login, section 8 recovery row), the tools used, the repo URL, the hosted URL and the video URL, and is submitted on 2026-11-11.
- [ ] The deploy freeze (section 8) starts the moment the form is submitted.

The last three days, in order, so the README's video link and the final deploy never collide with the freeze:

| Date | Do | Done when |
| --- | --- | --- |
| 2026-11-09 | Final deploy of the feature-frozen build (A1: freeze 2026-11-08). Run SB-0 to SB-11 from [06-test-plan.md](06-test-plan.md) against the hosted URL | Every script's output is in the release issue; the hosted deal reaches `paid` |
| 2026-11-10 | Record the video on the hosted demo at that build; upload it to YouTube as public | The YouTube URL exists and plays |
| 2026-11-11 | Commit the README with the video URL and the eval numbers. This commit is the submission commit and the last deploy. Run `npm run test:e2e` with `PLAYWRIGHT_BASE_URL=https://<host>` against the hosted URL. Submit the Devpost form. The freeze starts | CI green on that commit; Render shows it "Live"; the form shows "submitted" |

## 10. README outline

The README is written for a judge with one browser and ten minutes; its sections, in this order, are:

```
# Handshake: pay on proof
One paragraph: a buyer describes a deal in one sentence; Claude extracts checkable
conditions; both accept; PayPal holds the money (AUTHORIZE, not charged); the seller
uploads photos and a tracking number; Claude judges each condition; a fixed rule in
code, never the model, captures, requests one fix, voids or asks the buyer; the seller
is paid through PayPal Payouts; every step is in an append-only audit log.
Hosted demo: https://<host>    Video: https://youtube.com/<id>    Licence: MIT

## Try it as a judge (10 minutes)
1. Open the hosted URL. Click "Continue as buyer". No account, no password: the demo
   personas are demo-buyer@handshake.demo and demo-seller@handshake.demo, and the
   Buyer | Seller control in the header swaps between them so one browser plays both
   sides.
2. On /new click the first "Try one:" chip ("I'll pay $18 for the blue ceramic mug if it
   arrives within 5 days, matches the listing photos and tracking shows delivered"), then
   "Extract terms". Click "Save terms", then "Use sample listing photos", then
   "Accept terms and get link", then "Open deal page".
3. In the header switch to Seller. Click "Join as seller", then "Accept terms".
4. Switch to Buyer. Click the PayPal button and log into the popup with the sandbox
   buyer:
     email:    <sandbox personal account 1 email>
     password: <sandbox personal account 1 password>
   Approve. The deal shows "Money held. Waiting for proof." ($18.00 held, not charged).
5. Switch to Seller. Click "Use sample evidence: Good" (it also fills the tracking number
   TRK-DEMO-0000), then "Submit proof for checking".
6. Within about a minute the deal is paid. Open /ledger, /dashboard and
   "Download evidence pack".
Second run: the $35 lamp chip with "Use sample evidence: Wrong item", submitted twice,
ends voided after one fix request.
Third run: the $22 bottle chip with "Use sample evidence: Blurry" ends in buyer review;
switch to Buyer and click "Release payment" or "Reject proof".
Fourth run: the $250 chip with "Use sample evidence: Good" also ends in buyer review,
because $250 is over the automatic release limit.
The seller's payout lands in sandbox personal account 2:
     email:    <sandbox personal account 2 email>
     password: <sandbox personal account 2 password>
   (log in at https://www.sandbox.paypal.com to see it)

## How it works
The state machine (draft → terms_agreed → held → proof_submitted → captured → paid, with
in_review and voided), the decision function verbatim from decisions.md D9, and the
sentence "the AI returns JSON; only fixed code calls PayPal".

## Disclosures
- Sandbox only, USD only. No real money moves.
- The carrier is a mock: a tracking number ending in an even digit is "delivered", an
  odd digit "in_transit", anything else "unknown". The demo uses TRK-DEMO-0000.
- The handwritten-code photo in the sample evidence is composed in the browser (a sample
  photo plus the deal code in a handwriting font) because codes are generated per deal.
- Platform as merchant: the Handshake sandbox business account receives the capture and
  pays the seller through Payouts. Production would use PayPal multiparty onboarding.
- Magic-link email only reaches the account owner's address (Resend test sender); judges
  use the demo personas.
- Deals are capped at 21 days; there is no reauthorization.

## Tools used and how
| Tool | Used for |
| PayPal Orders v2 (intent AUTHORIZE), Payments v2 capture and void, Payouts v1,
  Webhooks v1 (self-verified signatures), JS SDK buttons via @paypal/react-paypal-js | hold, release, refund-free void, seller payout |
| Claude claude-sonnet-5-5 via @anthropic-ai/sdk: structured outputs with hand-written
  JSON schemas, vision on base64 photos, effort low | term extraction, per-condition verdicts |
| AG Grid Community 36.2 | the /ledger |
| AG Studio 3.0 | the /dashboard: custom theme, custom widget, Claude-backed agent (if built) |
| Render | web service, Postgres 18, daily cron, from render.yaml |
| Resend | magic links and notifications |
| Next.js 16, React 19, TypeScript 5.9, Prisma 7.10, Postgres 18, Tailwind CSS v4, Zod, jose | the app |
| <typeface name> handwriting font, SIL OFL 1.1 (public/demo/fonts/OFL.txt) | the composed deal-code photo in the demo kit |
| Claude Code | the coding agent that built it from docs/ |

## Evaluation results
From the last "npm run eval" before submission: model, prompt versions (extract-v1,
judge-v1), 30 cases, decision-match rate, wrong-capture rate (0), run date.

## Run it locally
Section 4 of docs/07-setup-deployment.md, condensed to the twelve commands.

## Deploy it
"Blueprint from render.yaml"; link to docs/07-setup-deployment.md section 5.

## Tests
npm test, npm run test:int, npm run test:e2e, npm run eval, npm run sandbox -- SB-1 --base <url>.

## What a production build adds
PDF evidence pack; disputes by webhook and Disputes API submission (FR-15, FR-16);
merged GitHub pull request as proof (FR-17); split payouts (FR-18); multiparty
onboarding so the seller is the payee; a verified sending domain.

## Licence
MIT. See LICENSE.
```

The angle-bracket values in the outline are filled from sections 3.1 and 5 at submission time; they are sandbox credentials and are meant to be public.

## Assumptions

Choices this document makes that [decisions.md](decisions.md) does not fix. Each is the simplest option consistent with it.

1. The Prisma client is generated into `generated/prisma/` at the repo root (git-ignored, imported as `@/generated/prisma/client`, as in [dependencies.md](dependencies.md) and [02-system-design.md](02-system-design.md) section 4); the singleton lives in `lib/db.ts`. Neither is a module named in B2, so `lib/db.ts` is a single file beside the modules.
2. Two sandbox REST apps (`handshake` for Render, `handshake-local` for development), each with one webhook, because PayPal delivers webhooks per app; this keeps local events off the hosted database and vice versa.
3. A verified webhook event that matches no deal (simulator mocks, or events for another environment) is stored in `webhook_events`, marked processed and answered `200`, not `500`, so PayPal does not retry it for three days.
4. The Anthropic monthly spend limit is $75, set in the Console; the research confirms the Start-tier $500 cap but not the name of the Console page where a lower limit is set.
5. `TEST_DATABASE_URL` is a test-runner variable (default `postgresql://postgres:postgres@localhost:5432/handshake_test`), not in J3 or `.env.example`; [06-test-plan.md](06-test-plan.md) owns the Vitest config and global-setup.
6. Render's auto-deploy on push to `main` is left at its default; the deploy freeze is enforced by not pushing, not by a dashboard setting.
7. `PAYPAL_WEBHOOK_ID` is entered as `pending` at Blueprint creation and replaced in the dashboard after the first deploy, because the webhook URL needs the Render host first.
8. The cron service has one extra variable of its own, `APP_HOST`, filled from the web service's `RENDER_EXTERNAL_HOSTNAME`; it is not an app variable and is not in `.env.example`. Whether a cross-service `envVarKey` resolves a built-in variable is UNVERIFIED and is checked after the first Blueprint apply (section 3.4 step 4), with `sync: false` as the fallback.
9. `npm run seed` is idempotent and is run once on Render from the service Shell; it is not part of `preDeployCommand`, which stays exactly `npx prisma migrate deploy` (J2).
10. The AG Studio trial is requested in the window 2026-11-01 to 2026-11-07 so the key is in place before the 2026-11-08 feature freeze and expires on or after 2026-12-16.
11. `npm run sandbox` runs `scripts/sandbox/scenario.ts`, which takes a scenario id and `--base <url>` as in [06-test-plan.md](06-test-plan.md) "Scripts"; the spikes run through `scripts/sandbox/spike.ts` directly with `tsx`.
