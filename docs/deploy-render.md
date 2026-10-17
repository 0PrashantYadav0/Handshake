# Deploy on Render: step by step

The short checklist for putting Handshake online. The reasoning behind each setting lives in [07-setup-deployment.md](07-setup-deployment.md) sections 3.4, 5 and 8.

You end up with three Render pieces: a web service `handshake` ($7/month), a Postgres `handshake-db` ($6/month plus $1.50 for 5 GB disk), and a cron job `handshake-tick` that calls the app every 10 minutes ($1/month minimum). About $15.50 a month, about $30 to $35 through 2026-12-15.

## 0. Before you start

- [ ] `npm run check-env` passes on your machine. The deploy uses the same PayPal app, Anthropic key and Resend key.
- [ ] Render account signed in with the GitHub account that owns the repo. Workspace **Hobby**. Never pick Pro.
- [ ] A card is on file under **Billing**. Render requires one for paid services. Indian cards need international or online transactions turned on in the bank app first.
- [ ] The $50 credit has been claimed from the [Devpost resources page](https://paypalaihackathon.devpost.com/resources). The next day, check that **Billing** shows it.

The free plans don't work for this app:
- a free web service sleeps after 15 minutes, so a judge waits about a minute;
- a free Postgres is deleted after 30 days, before judging;
- cron jobs have no free plan.

Pick **one** of the two routes below. They produce the same result.

## Route A: Blueprint (fewer clicks)

1. **New > Blueprint**, pick the repo, branch `main`. Render reads `render.yaml`.
2. It asks once for every secret. Enter them from your `.env`, with these exceptions:
   - `PAYPAL_WEBHOOK_ID`: type `pending`. Step 4 of "After either route" replaces it.
   - `AG_GRID_LICENSE_KEY`: leave it empty.
   - `APP_URL`: type `https://handshake.onrender.com`. Correct it after the first deploy if Render gives a different host.
3. Click **Apply**. Render generates `SESSION_SECRET`, `FILE_URL_SECRET`, `DATA_KEYS` and `CRON_SECRET` by itself.
4. When the deploy is live, open **handshake-tick > Environment** and check that `APP_HOST` holds the web host, for example `handshake.onrender.com`. If it is empty, set it by hand. Without it the cron never reaches the app.

Then continue at "After either route".

## Route B: manual, no Blueprint

Create the pieces yourself in this order. Keep everything in the **same region** (Oregon is fine): the database's internal URL only works inside one region.

### B1. Postgres

**New > Postgres**

| Field | Value |
| --- | --- |
| Name | `handshake-db` |
| PostgreSQL version | 18 |
| Region | Oregon |
| Instance type | Basic-256mb ($6/month) |
| Storage | 5 GB (storage can grow later but never shrink) |

When it is ready, copy the **Internal Database URL**.

### B2. Web service

**New > Web Service**, connect the repo, branch `main`.

| Field | Value |
| --- | --- |
| Name | `handshake` |
| Region | the same as the database |
| Language / runtime | Node (the version comes from `.node-version`, 24.21.0) |
| Build command | `npm ci && npm run build` |
| Start command | `npm run start` |
| Instance type | Starter, 0.5 CPU / 512 MB ($7/month) |
| Advanced > Pre-deploy command | `npx prisma migrate deploy` |
| Advanced > Health check path | `/api/health` |
| Advanced > Auto-deploy | On commit |

Never put the migration in the build command. If a deploy fails after its build has already migrated, the database is left changed under the old code.

**Environment variables** (Advanced > Add environment variable). Generate each of the four secrets on your machine with `openssl rand -base64 32`, a different value for each:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the Internal Database URL from B1 |
| `APP_URL` | `https://handshake.onrender.com` (fix it after the first deploy if the host differs) |
| `SESSION_SECRET` | new `openssl rand -base64 32` |
| `FILE_URL_SECRET` | new `openssl rand -base64 32` |
| `DATA_KEYS` | new `openssl rand -base64 32`. **Never change it later**: it encrypts stored data. To rotate, prepend a new key (`k2:<new>,k1:<old>`) |
| `CRON_SECRET` | new `openssl rand -base64 32`. Also used in B3 |
| `PAYPAL_CLIENT_ID` | from `.env` |
| `PAYPAL_CLIENT_SECRET` | from `.env` |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | the same as `PAYPAL_CLIENT_ID` |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` |
| `PAYPAL_WEBHOOK_ID` | `pending` for now |
| `ANTHROPIC_API_KEY` | from `.env` |
| `AI_MODEL` | `claude-sonnet-5-5` |
| `RESEND_API_KEY` | from `.env` (required in production) |
| `EMAIL_FROM` | `Handshake <onboarding@resend.dev>` |
| `PASS_THRESHOLD` | `0.85` |
| `AUTO_CAPTURE_MAX_MINOR` | `20000` |
| `DEMO_LOGIN` | `true` |
| `DEMO_SELLER_PAYPAL_EMAIL` | from `.env` |
| `AG_GRID_LICENSE_KEY` | leave empty until the AG Studio key arrives |

Don't set `PORT` or `NODE_ENV`; Render sets both itself. Don't reuse the `SESSION_SECRET`, `FILE_URL_SECRET`, `DATA_KEYS` or `CRON_SECRET` values from your local `.env`.

Click **Create Web Service** and wait for **Live**. The server checks every variable at start: if one is missing or malformed, `/api/health` fails and the logs name the variable.

### B3. Cron job

**New > Cron Job**, connect the same repo, branch `main`.

| Field | Value |
| --- | --- |
| Name | `handshake-tick` |
| Region | the same as the web service |
| Schedule | `*/10 * * * *` |
| Language / runtime | Node |
| Build command | `true` |
| Command | `curl -fsS --max-time 120 --retry 3 -X POST -H "Authorization: Bearer $CRON_SECRET" "https://$APP_HOST/api/jobs/tick"` |
| Instance type | Starter |

Environment variables:

| Name | Value |
| --- | --- |
| `APP_HOST` | the web host without `https://`, for example `handshake.onrender.com` |
| `CRON_SECRET` | exactly the same value as on the web service |

## After either route

1. **Health.** Open `https://<host>/api/health` and expect `200`.
2. **APP_URL.** If the host isn't `handshake.onrender.com`, set `APP_URL` on the web service to the real one. If you used Route B, also set the cron's `APP_HOST`. Saving redeploys.
3. **Cron.** Open **handshake-tick > Trigger Run**, then check its log. It should exit 0 and print a small JSON body.
4. **Webhook.** In the PayPal developer dashboard:
   - Open the same app you use locally, then **Features > Sandbox Webhooks > Add Webhook**.
   - URL: `https://<host>/api/webhooks/paypal`.
   - Tick these eleven events:
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
   - Save, copy the new **Webhook ID**, and set it as `PAYPAL_WEBHOOK_ID` on the web service. Saving redeploys.
5. **Seed.** Run `npm run seed` once from **handshake > Shell**. Running it again is harmless.
6. **Hand back.** Send the host URL in the chat. The agent then runs the scenario scripts and the Playwright happy path against it (issues #22, #31, #35, #47) and records the webhook fixtures (#12, #13).

## Later

- Every push to `main` redeploys. From 2026-11-11 to 2026-12-15 nothing is pushed (07 section 8).
- Edit secrets in the dashboard, never in `render.yaml` or the repo.
- After 2026-12-15, delete the three services so billing stops.
