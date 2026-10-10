> Original brief, exported 2026-10-09 from https://claude.ai/artifact/WUfZLJt14WMczryiEVHmt3 — superseded by the matching docs/0N-*.md where they differ.

# Setup and deployment

A judge should be able to run Handshake locally in under ten minutes, or use the hosted URL with the test logins in the README. This tab doubles as the README outline.

## Repository layout

```
handshake/
  app/                 Next.js pages and API routes
    api/               Route handlers listed in the API tab
    deal/[code]/       Buyer and seller deal page
    ledger/            AG Grid ledger
  lib/
    paypal/            Typed PayPal client: orders, payments, payouts, webhooks
    ai/                Prompts, schemas, model client
    decision.ts        The decision function
    state-machine.ts   Allowed transitions and event writing
    jobs/              Reauthorize and expiry jobs
  prisma/              Schema and migrations
  eval/                The 30 test cases and the runner
  tests/               Unit, integration and Playwright tests
  scripts/             Sandbox scenario scripts, seed data
  LICENSE              MIT
  README.md
  .env.example
```

## Environment variables

| Name | Purpose |
| --- | --- |
| DATABASE_URL | Postgres connection string |
| APP_URL | Public base URL, used in share links and PayPal return URLs |
| SESSION_SECRET | Signs the session cookie |
| PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET | Sandbox REST app credentials |
| PAYPAL_API_BASE | https://api-m.sandbox.paypal.com |
| PAYPAL_WEBHOOK_ID | Used to verify webhook signatures |
| AI_API_KEY, AI_MODEL | Model provider key and model name |
| STORAGE_BUCKET, STORAGE_KEY, STORAGE_SECRET, STORAGE_ENDPOINT | S3-compatible bucket for evidence files |
| EMAIL_API_KEY | Sends magic links; in development, links are printed to the console |
| PASS_THRESHOLD | Default 0.85 |
| AUTO_CAPTURE_MAX_MINOR | Default 20000 |
| CRON_SECRET | Protects the job endpoints |

Commit `.env.example` with every name and no values.

## PayPal sandbox setup

1. Sign in at developer.paypal.com and create a REST app in sandbox mode; copy the client id and secret.
2. Create three sandbox accounts: one business (Handshake), one personal (buyer), one personal (seller).
3. Fund the business account if Payouts needs a balance, and confirm Payouts is enabled for the app.
4. Add a webhook pointing at `/api/webhooks/paypal` and subscribe to the events in the API tab; copy the webhook id.
5. For local work, expose your machine with a tunnel and use that URL for the webhook.

## Run locally

1. `git clone` the repo and run `npm install`.
2. Copy `.env.example` to `.env` and fill it in.
3. Start Postgres, then run `npx prisma migrate dev`.
4. Run `npm run seed` to create the demo users and two sample deals.
5. Run `npm run dev` and open the app.
6. Run `npm test` for unit and integration tests, and `npm run eval` for the AI test set.

## Deploy on Render

| Render service | Setting |
| --- | --- |
| Web service | Build `npm ci && npx prisma migrate deploy && npm run build`; start `npm start` |
| Postgres | One instance; its URL goes in DATABASE_URL |
| Cron job | Daily; calls the reauthorize and expiry endpoints with CRON_SECRET |

Keep the whole setup in a `render.yaml` file so the deployment is reproducible, and set every environment variable in the Render dashboard, not in the repo. After the first deploy, update the PayPal webhook URL and APP_URL to the Render address.

## Before submitting

- [ ] LICENSE is at the repo root and shows in the GitHub About section
- [ ] README has the hosted URL, sandbox buyer and seller test logins, and the steps above
- [ ] README states the platform-as-merchant shortcut and any mocked carrier data
- [ ] README names every tool used and how: PayPal APIs, the AI model, AG Grid, Render
- [ ] A fresh clone on another machine runs with only the README
- [ ] Seed data loads the two demo deals used in the video
