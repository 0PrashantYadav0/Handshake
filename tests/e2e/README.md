# End-to-end test

One Playwright test (`happy-path.spec.ts`) runs the ten steps of the judge happy path from docs/06-test-plan.md "End to end" against the real UI, the real PayPal sandbox and the real Claude API. Each run places one $18 sandbox hold and spends about $0.08 of Claude.

## Runner variables

| Variable | Meaning |
| --- | --- |
| `PLAYWRIGHT_BASE_URL` | Unset: Playwright builds and starts the app itself (`npm run build && npm run start`, waits on `/api/health`). Set: runs against that host and starts nothing. |
| `E2E_PAYPAL_BUYER_EMAIL`, `E2E_PAYPAL_BUYER_PASSWORD` | Sandbox personal account 1 (README "Try it"). Unset: steps 1 to 5 run, then the test skips at the PayPal popup. |

The app under test uses its normal `.env`: `DEMO_LOGIN=true`, `DEMO_SELLER_PAYPAL_EMAIL`, `ANTHROPIC_API_KEY`, PayPal sandbox keys, a reachable database. Steps 2 and 7 call Claude, so the key must be set even for the partial run.

## Run

```sh
npx playwright install chromium                                  # once
E2E_PAYPAL_BUYER_EMAIL=... E2E_PAYPAL_BUYER_PASSWORD=... npm run test:e2e
```

Against a deployed host:

```sh
PLAYWRIGHT_BASE_URL=https://<host> E2E_PAYPAL_BUYER_EMAIL=... E2E_PAYPAL_BUYER_PASSWORD=... npm run test:e2e
```

Traces and videos are kept on failure under `test-results/`; open with `npx playwright show-trace test-results/<run>/trace.zip`.

## The PayPal popup

`paypal-popup.ts` holds the only code that knows the popup's DOM (`#email`, `#btnNext`, `#password`, `#btnLogin`, then a Pay Now / Continue button). PayPal changes these without notice. On day 1 of sandbox access, re-record them:

```sh
npm run start &
npx playwright codegen --target playwright-test http://localhost:3000/deal/<code-in-terms_agreed>
```

and paste the popup steps into `approveInPopup`.
