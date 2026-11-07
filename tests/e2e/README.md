# End-to-end tests

Three Playwright specs. `npm run test:e2e` runs all three; name a spec to run one.

- `two-party.spec.ts` needs no external service. It makes a draft with the fake model (`make-draft.ts`), signs in both demo personas through the demo second factor, joins, signs the contract on both sides with browser keys, checks the deal reaches `terms_agreed`, verifies both signatures on the contract page and downloads the signed bundle, and finds the seller's key on `/security`. Run it on every change to sign-in, signing or the deal page.
- `happy-path.spec.ts` runs the ten steps of the judge happy path from docs/06-test-plan.md "End to end" against the real UI, the real PayPal sandbox and the real Claude API. Each run places one $18 sandbox hold and spends about $0.08 of Claude.
- `agents.spec.ts` runs the agent desk on the real Claude API and the real PayPal sandbox. The hijack test always runs and calls Claude, but places no hold. The honest and cheating tests need the sandbox buyer and place one sandbox hold each.

Shared steps (demo 2FA, signing) live in `flows.ts`.

## Two-party run

The server needs `DEMO_LOGIN=true` and `DEMO_SELLER_PAYPAL_EMAIL` (the demo seller's address counts as verified). Without `PLAYWRIGHT_BASE_URL`, Playwright runs `next start`, which refuses to serve (500 on `/api/health`, so the runner waits out its 180 s timeout) unless every required env var in `lib/env.ts` is set; placeholders are fine for this spec. `make-draft.ts` writes to `E2E_DATABASE_URL`, else `DATABASE_URL` from `.env`; it must be the server's database.

```sh
npm run build && npm run start &                                  # or any running server
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test two-party  # on https:// it skips unless E2E_DATABASE_URL is that host's database
```

## Runner variables

| Variable | Meaning |
| --- | --- |
| `PLAYWRIGHT_BASE_URL` | Unset: Playwright builds and starts the app itself (`npm run build && npm run start`, waits on `/api/health`). Set: runs against that host and starts nothing. |
| `E2E_PAYPAL_BUYER_EMAIL`, `E2E_PAYPAL_BUYER_PASSWORD` | Sandbox personal account 1 (README "Try it"). Unset: steps 1 to 5 run, then the test skips at the PayPal popup. |

The app under test uses its normal `.env`: `DEMO_LOGIN=true`, `DEMO_SELLER_PAYPAL_EMAIL`, `ANTHROPIC_API_KEY`, PayPal sandbox keys, a reachable database. Steps 2 and 7 call Claude, so the key must be set even for the partial run.

## Happy-path run

```sh
npx playwright install chromium                                  # once
E2E_PAYPAL_BUYER_EMAIL=... E2E_PAYPAL_BUYER_PASSWORD=... npx playwright test happy-path
```

Against a deployed host:

```sh
PLAYWRIGHT_BASE_URL=https://<host> E2E_PAYPAL_BUYER_EMAIL=... E2E_PAYPAL_BUYER_PASSWORD=... npx playwright test happy-path
```

Traces and videos are kept on failure under `test-results/`; open with `npx playwright show-trace test-results/<run>/trace.zip`.

## The PayPal popup

`paypal-popup.ts` holds the only code that knows the popup's DOM (`#email`, `#btnNext`, `#password`, `#btnLogin`, then a Pay Now / Continue button). PayPal changes these without notice. On day 1 of sandbox access, re-record them:

```sh
npm run start &
npx playwright codegen --target playwright-test http://localhost:3000/deal/<code-in-terms_agreed>
```

and paste the popup steps into `approveInPopup`.
