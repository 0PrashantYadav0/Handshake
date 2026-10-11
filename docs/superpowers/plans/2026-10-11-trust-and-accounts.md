# Trust and accounts: implementation plan (2026-10-11)

Design: `docs/superpowers/specs/2026-10-11-trust-and-accounts-design.md` (cited below as "spec §n").
Each task is one GitHub issue (label `trust`) and one PR, squash-merged after CI passes.

## Order

```
TR-1 seal ──┬── TR-2 encrypt at rest
            ├── TR-3 2FA ── TR-4 step-up + payout email ── TR-5 signatures ──┬── TR-6 contract gate + page
            │                       │                                       ├── TR-8 dashboard
            │                       └── TR-9 wallet                          └── TR-10 landing
            └── TR-7 reconciliation (independent of the rest)
TR-6..TR-10 ── TR-11 end-to-end + seed + scenario ── TR-12 security review + docs
```

## Rules for every task

- Tests first for money and security paths; unit tests for pure code, integration tests on real Postgres with fakes.
- `npm run lint && npm run typecheck && npm test && npm run test:int` green before the PR.
- Integration tests run serially, one process per database.
- New error codes go in `lib/deal/errors.ts` and `docs/decisions.md` H2 in the same PR.
- Existing behaviour that is not named in the task stays as it is.

## TR-1 Field encryption library (spec §5)

- `lib/crypto/seal.ts`: `seal(text, aad)`, `open(text, aad)`, `sealBytes`, `openBytes`, keyring parsed from `DATA_KEYS`; kid in every value.
- `lib/env.ts`: `DATA_KEYS` required in production; `.env.example`, `render.yaml` (generated value), test setup.
- `next.config.ts`: HSTS header.
- **Done when:** unit tests cover round trip, tampered ciphertext, wrong AAD, unknown kid, plaintext refused, rotation (old kid decrypts, new kid encrypts).

## TR-2 Encrypt contract data at rest (spec §5)

- Seal at every write site (create, edit terms, add file, submit evidence, verdict writer, `writeEvent` payload keys).
- One `loadDealRow` opener used wherever `DEAL_INCLUDE` is loaded, plus `listDeals` and the file route.
- Seed seals its rows. `scripts/reseal.ts` re-seals every row with the active key (`npm run reseal`).
- **Done when:** an integration test reads raw rows with SQL and finds only `enc1.` values in every sealed column; all existing suites pass unchanged in behaviour; a value moved to another deal fails to open.

## TR-3 Two-factor auth (spec §4)

- `lib/auth/totp.ts` (RFC 6238, base32), `lib/auth/mfa.ts` (`requireSession` full vs partial, page guard helper).
- Schema: `users.totp_secret`, `totp_enabled_at`, `totp_last_step`, `recovery_codes text[]`.
- Routes: `POST /api/auth/2fa/setup` (new secret + otpauth URI + SVG QR), `POST /api/auth/2fa/enable` (first code, returns recovery codes), `POST /api/auth/2fa/verify` (code or recovery code, upgrades the session), `GET /api/auth/2fa/demo-code` (demo personas only, `DEMO_LOGIN=true`).
- Pages: `/signin` (moved from `/`), `/signin/2fa`, `/security/setup`, `/security` (status, regenerate recovery codes under step-up).
- Magic-link callback and demo sign-in issue partial sessions; every `/?next=` redirect becomes `/signin?next=`.
- **Done when:** integration tests prove partial sessions get `mfa_required` on every deal route, a code upgrades the session, a reused code fails, five wrong codes rate-limit, a recovery code works once, enrollment is forced for new users, demo personas complete 2FA with the demo code.

## TR-4 Step-up and verified payout email (spec §4 step-up, §8)

- `requireStepUp(user, totp)` checks a fresh code and consumes the step.
- `PATCH /api/me` with `paypal_email` needs `totp`, stores the address unverified and emails a code; `POST /api/me/paypal-email/verify`.
- Schema: `users.paypal_email_verified_at`, `paypal_email_code_hash`, `paypal_email_code_expires_at`, `paypal_email_code_attempts`.
- Seller accept and every payout require a verified email (`payout_email_unverified`).
- UI: profile form and the inline accept form ask for the code.
- **Done when:** integration tests cover step-up missing, wrong and replayed; code wrong, expired, reused, five attempts; payout refused to an unverified address; demo seller verified.

## TR-5 Digital signatures (spec §6)

- `lib/contract/canonical.ts` (pure, shared with the browser), `lib/contract/signature.ts` (verify with WebCrypto), `lib/contract/device-key.ts` (browser: IndexedDB key pair).
- Schema: `signing_keys` (user, JWK, fingerprint, label, revoked_at), `contract_signatures` (deal, role, terms version, hash, key, signature, signed_at; unique deal + role + version; append-only trigger).
- `accept` command carries `contract_hash`, `signature`, `public_key`, `totp`; the seller must have joined.
- UI: `SignContract` dialog (shows the hash, asks for the code, signs); `/security` lists keys and revokes under step-up.
- Test helper `signAs(user)` for the integration suites.
- **Done when:** tests cover a valid signature agreeing the terms, wrong hash, wrong key, revoked key, signature from the other party's key, signing before the seller joins, an edit invalidating both signatures.

## TR-6 Contract gate and contract page (spec §7, §6 verification page)

- `verifyContract` before start_payment, confirm_approval, capture and payout; `contract:verification_failed` event.
- `/deal/[code]/contract` with in-browser verification and the signed-contract download; evidence pack includes the bundle.
- **Done when:** integration tests change the amount, a condition and the item title directly in the database and show each money step refuses with `contract_invalid` and moves no money.

## TR-7 Reconciliation with PayPal (spec §9)

- PayPal adapter `getCapture`, `getAuthorization`, `getPayoutBatch` (real + fake).
- `lib/deal/reconcile.ts` run from tick; facts applied once.
- **Done when:** integration tests cover each stuck state resolving without a webhook, and a webhook arriving after a reconcile changing nothing.

## TR-8 Dashboard home (spec §10)

- `lib/deal/summary.ts` (pure builders) and `/dashboard` server page; Studio moves to `/dashboard/studio`.
- **Done when:** unit tests cover the four figures and the "Needs you" list on fixture deals in every state for both roles; the page renders for buyer and seller personas.

## TR-9 Wallet page (spec §10)

- `/wallet`: payout destination, holds, captures, payouts with PayPal ids and retry link.
- **Done when:** integration test of the wallet query for buyer and seller; page renders.

## TR-10 Landing page (spec §11)

- New `/` with hero, steps, security, buyers, sellers, FAQ, footer; signed-in state.
- **Done when:** page builds, passes the accessibility basics (headings, landmarks, contrast tokens), links to `/signin`.

## TR-11 End to end, seed and scenario (spec §13)

- Seed creates keys, signatures and 2FA for the personas so seeded deals verify.
- `scripts/sandbox/scenario.ts` signs and passes 2FA via the demo endpoints.
- Playwright spec: both personas, demo 2FA, create, join, sign both sides, reach the PayPal button.
- **Done when:** `npm run test:e2e -- two-party` passes locally against `next build && next start`.

## TR-12 Security review and docs

- Review every new route for auth level, step-up, rate limits and input caps.
- Update `docs/decisions.md`, `README.md` (env, security section), `.env.example`.
- **Done when:** findings fixed or filed; docs match the code.
