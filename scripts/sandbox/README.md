# Sandbox scripts

Real PayPal sandbox calls against a running Handshake. Spec: `docs/06-test-plan.md` "Sandbox scenarios".

| Script | What |
| --- | --- |
| `spike.ts` | Raw PayPal calls (create-hold, authorize, capture, void, payout, status); ids in `.state.json` |
| `record-webhook.ts` | Recording proxy for the tunnel; writes `tests/fixtures/webhooks/<event>.<n>.json` |
| `scenario.ts` | Drives SB-1, SB-6, SB-7, SB-8, SB-11 through the HTTP API with the demo personas |

## scenario.ts

```
npm run sandbox -- SB-1  --base http://localhost:3000 [--dry] [--wait] [--full] [--upload] [--set good]
npm run sandbox -- SB-6  --base <url>
npm run sandbox -- SB-7  --base <url> --code HS-XXXX [--fixture <recorded json>]
npm run sandbox -- SB-8  --base <url>
npm run sandbox -- SB-11 --base <url>
```

- The server needs `DEMO_LOGIN=true`; the seller persona needs a verified PayPal email: set `DEMO_SELLER_PAYPAL_EMAIL` on the server (the persona's sandbox address counts as verified). Each persona passes the demo second factor and signs the contract with a key made by the script.
- `--dry` prints the step plan and makes no request.
- Browser steps (PayPal approval, "Use sample" evidence) print the URL and persona. With `--wait` the script pauses for Enter; without it, it polls `GET /api/deals/{code}` until the status moves (webhooks must reach the server: tunnel, 07 section 4 step 11).
- SB-1 stops at `held`; `--full` continues to `paid` and checks the 11-row trail. `--upload` pushes the kit photos through the API instead of pausing; the code photo is then the uncomposed base, so the hand-written-code condition may fail.
- SB-7 replays a `PAYMENT.CAPTURE.COMPLETED` recording that names the deal's capture id (byte for byte, same headers); without one it asks for a dashboard resend.
- SB-8 is `spike.ts capture --key capture-sb8-0` twice; the script prints the commands and compares the two ids you paste.
- Every run ends with `PASS <id>: ...` or `FAIL <id>: <reason>` and exit code 1 on FAIL.
