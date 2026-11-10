# Trust and accounts: design (2026-10-11)

Status: approved by the user's request of 2026-10-11 ("create plan first and then work on it"). Tickets: GitHub issues labelled `trust`.

## 1. What the user asked for

1. A proper landing page.
2. Proper two-factor auth for buyers and sellers.
3. Every function the product needs to work, not a prototype.
4. Contracts encrypted end to end.
5. A dashboard for buyer and seller after login, with real detail.
6. A digital signature from both parties on every contract.
7. Money paths tested and robust: wallet integration, contract verification, transfer of money.

## 2. Constraints that shape the design

- **The server must read the contract.** Claude turns the sentence into conditions and judges the evidence against them, and fixed code decides capture or void. A zero-knowledge design, where only the two browsers hold the key, would remove the product's core feature. So "end to end" here means: encrypted in transit (HTTPS with HSTS), encrypted at rest field by field with keys the database never sees, and signed by both parties so any change is detectable. Section 5 states exactly what is encrypted and who can read it.
- **PayPal is the wallet.** The buyer pays from their PayPal wallet (Orders v2 with intent AUTHORIZE, already built). The seller is paid to their PayPal wallet (Payouts, already built). "Wallet integration" adds a verified payout destination, a wallet view, and reconciliation against PayPal.
- **Still a sandbox.** Nothing here moves real money. Everything is built and tested against the fakes and the recorded fixtures until the user supplies sandbox credentials (issues #1, #2).
- **One Render instance.** Rate limits and the single-use token set stay in memory (existing ponytail notes). Nothing here needs a second instance.

## 3. Architecture changes at a glance

| Area | New code | Touches |
|---|---|---|
| Field encryption | `lib/crypto/seal.ts` | `lib/deal/*` write and load paths, seed, file route, env |
| Two-factor auth | `lib/auth/totp.ts`, `lib/auth/mfa.ts`, `/api/auth/2fa/*`, `/signin`, `/signin/2fa`, `/security` | session token, `requireSession`, page guards, demo personas |
| Step-up | `requireStepUp` in `lib/auth/mfa.ts` | accept (sign), payout email change, key revoke |
| Payout email verification | `/api/me/paypal-email/*` | `users` columns, seller accept, payouts |
| Signatures | `lib/contract/*`, `components/SignContract.tsx`, `/deal/[code]/contract` | accept command, schema, seed, scenario script |
| Contract gate | `verifyContract` in `lib/contract/verify.ts` | start_payment, confirm_approval, capture, payout |
| Dashboard | `/dashboard` (new home), `lib/deal/summary.ts` | Studio moves to `/dashboard/studio` |
| Wallet | `/wallet` | reads payments and payouts |
| Reconciliation | `lib/deal/reconcile.ts`, PayPal `get*` calls | tick job, fakes |
| Landing | `app/page.tsx` | sign-in moves to `/signin` |

## 4. Two-factor auth

**Factors.** Factor one is the email magic link (possession of the mailbox). Factor two is a TOTP authenticator app (RFC 6238: HMAC-SHA1, 6 digits, 30 s step, one step of drift either way). Ten recovery codes back it up.

**Session.** The session JWT gains `mfa: boolean`. After the magic link the user holds a partial session (`mfa: false`, 15 minutes). A partial session can only reach `/signin/2fa`, `/security/setup` and their API routes. Every other API route and page requires `mfa: true`. Verifying a code re-issues a full 30-day session.

**Enrollment is mandatory.** A user without TOTP is sent to `/security/setup` after the magic link. Setup shows a QR code (rendered as SVG with `uqr`) and the base32 secret, asks for one code to confirm, then shows the recovery codes once.

**Storage.** `users.totp_secret` is sealed with the field-encryption key (section 5). `users.totp_last_step` stops a code from being used twice. `users.recovery_codes` holds SHA-256 hashes; a used code is removed with one atomic `array_remove` update. Recovery codes are 10 random base32 characters, so a fast hash is enough.

**Limits.** Five wrong codes per user per 10 minutes, then `rate_limited`. A recovery code signs in and tells the user how many remain.

**Step-up.** Three actions need a fresh code even inside a full session: signing a contract, changing the payout email, and revoking a signing key. The code travels in the same request as the action, so it is used once.

**Demo personas.** With `DEMO_LOGIN=true` the two personas are enrolled with fixed published secrets. The 2FA screen shows their current code with a "Use demo code" button, labelled demo only. With `DEMO_LOGIN` off the personas cannot sign in at all, as today.

## 5. Encryption at rest

**Algorithm.** AES-256-GCM from `node:crypto`, random 96-bit IV per value, 128-bit tag.

**Keys.** `DATA_KEYS="k2:<secret>,k1:<secret>"`, each secret at least 32 characters; the AES key is SHA-256 of the secret. A bare secret with no `kid:` prefix is kid `k1`, so Render's `generateValue` works as is. The first key encrypts; any listed key decrypts. Rotation is: add a new key first, redeploy, re-seal with `npm run reseal`, drop the old key. Production refuses to boot without the variable. Tests and local dev use a fixed key from `.env`.

**Format.** Strings become `enc1.<kid>.<iv>.<ciphertext+tag>` in base64url. Bytes become `0x45 0x31`, kid length, kid, IV, then ciphertext with the tag appended. Decryption refuses anything without the prefix, so plaintext cannot be slipped into a sealed column.

**Binding.** The additional authenticated data is `<table>.<column>:<deal_id>` (or `<user_id>` for user columns). A value copied into another deal or another column fails to decrypt.

**What is sealed.**

| Table | Columns |
|---|---|
| deals | `source_text`, `item_title` |
| conditions | `text` |
| evidence | `value` (tracking number, note) |
| files | `bytes` (reference and evidence photos) |
| verdicts | `reason`, `raw_response` (stored as `{ "sealed": "enc1…" }`) |
| deal_events | payload keys `source_text`, `note`, `tracking_number`, `item_title` |
| users | `totp_secret` |

Amounts, statuses, dates, PayPal ids and emails stay in plain text. The ledger, the tick job and PayPal need them, and they are not the contract's content.

**Where it happens.** One loader, `loadDealRow`, wraps every `findUnique(..., include: DEAL_INCLUDE)` and opens the sealed fields. Writes seal at the four write sites: create, edit terms, add file, submit evidence, plus the verdict writer and `writeEvent`. Everything above that line keeps working on plain values.

**Who can read.** The two parties through the app, and the verifier inside the app. A database dump, a backup, or a Postgres operator sees ciphertext. PayPal sees the item title in the order description, as it must.

**In transit.** `Strict-Transport-Security: max-age=63072000; includeSubDomains` is added to the existing security headers. Render terminates TLS.

## 6. Digital signatures

**Keys.** Each browser makes an ECDSA P-256 key pair with WebCrypto, `extractable: false`, and keeps it in IndexedDB. The private key never leaves the device. The public key (JWK `x`, `y`) is registered on the server the first time it signs, inside the signing request, under step-up. A user can hold several keys (one per device). `/security` lists them by fingerprint and can revoke one under step-up.

**Contract document.** `lib/contract/canonical.ts` builds one canonical JSON document per terms version: format version, deal code, terms version, item title, amount, currency, deadline days, the numbered conditions, and both parties' user id and email. Keys are sorted and there is no whitespace. Its SHA-256 is the contract hash. The same pure function runs in the browser and on the server.

**What is signed.** The UTF-8 bytes of `Handshake contract v1\n<contract hash>`, signed with ECDSA SHA-256. The signature is the raw 64-byte `r || s` WebCrypto output, base64url.

**Signing replaces accepting.** The accept command now carries `contract_hash`, `signature`, `public_key` and the step-up `totp`. The server recomputes the hash from the database, checks it matches, verifies the signature against the key, stores the key if new, and stores a `contract_signatures` row. Terms are agreed when both parties have signed the current version. Editing terms bumps the version, so old signatures no longer count.

**Seller first.** Both parties must be named before anyone signs, so the buyer signs after the seller joins. Before that the buyer sees "Share the link; you both sign once the seller joins."

**Verification page.** `/deal/[code]/contract` shows the canonical document, its hash, and each signature with signer, key fingerprint and time. The browser re-verifies both signatures with WebCrypto and says so. "Download signed contract" saves the document plus signatures as JSON, which anyone can verify offline. The evidence pack includes it too.

## 7. Contract verification before money moves

`verifyContract(deal)` recomputes the canonical hash from the current rows and verifies both signatures for the current terms version. It runs before `start_payment` creates an order, before `confirm_approval` authorizes, before any capture, and before any payout. A failure throws `contract_invalid`, writes a `contract:verification_failed` event, and moves no money. If it fails while the money is held, the hold is left alone and the deadline void releases it, the safe default.

Because the signatures cover the terms, an edit made straight in the database (a changed amount, a reordered condition) is caught here, on top of the encryption binding.

## 8. Payout destination (seller wallet)

- Setting or changing `paypal_email` requires step-up and sends a 6-digit code to that address. `paypal_email_verified_at` is set when the code is entered. The code is hashed, single use, valid 15 minutes, five attempts.
- A seller can sign only with a verified payout email. A payout is sent only to a verified email.
- The demo seller persona's sandbox email is marked verified on sign-in.

## 9. Reconciliation with PayPal

Webhooks can be late or lost. A new step in the tick job asks PayPal directly:

- Payments in `capture_pending` for over 10 minutes: GET the capture and apply the same fact the webhook would.
- Payouts `pending` with a batch id for over 30 minutes: GET the payout batch and apply its item status.
- Payments `approved` with an authorization id and no hold for over 10 minutes: GET the authorization.

The PayPal adapter gains `getCapture`, `getAuthorization` and `getPayoutBatch`, with fakes. Facts are applied once (existing rule), so a webhook and a reconcile racing each other are safe.

## 10. Dashboard and wallet

**`/dashboard` (home after sign-in).**

- Four figures: money you have on hold as buyer, money held for you as seller, released this month, paid out to you.
- "Needs you" list: sign terms, pay, submit proof, review, retry a payout, each linking to the deal.
- Two tables, Buying and Selling: item, other party, amount, status, next step, deadline.
- Security card: 2FA on, recovery codes left, signing keys, payout email verified.
- A link to the AG Studio analytics, which moves to `/dashboard/studio` unchanged.

**`/wallet`.** The payout destination with its verified state; active holds with authorization id and expiry; captures with capture id; payouts with batch id, item id, status, failure reason and a retry link.

The figures come from one query module, `lib/deal/summary.ts`, unit-tested on fixtures.

## 11. Landing page

`/` becomes a full landing page: hero with the one-line promise and two calls to action, how it works in four steps, a security section (PayPal hold, 2FA, signatures, encryption, fixed decision rule), separate "For buyers" and "For sellers" blocks, an FAQ in native `<details>`, and a footer. Sign-in moves to `/signin`; every `/?next=` redirect moves with it. Signed-in visitors see "Go to your dashboard".

## 12. Error codes added to H2

| Code | HTTP | When |
|---|---|---|
| `mfa_required` | 401 | Partial session on a full-session route |
| `totp_invalid` | 400 | Wrong, reused or expired code |
| `signature_invalid` | 400 | Hash mismatch, bad signature, unknown or revoked key |
| `contract_invalid` | 409 | The contract gate failed before a money step |
| `payout_email_unverified` | 409 | Seller signing or payout without a verified email |

## 13. Testing

- Unit: TOTP against the RFC 6238 vectors; seal round trip, tamper, wrong binding, key rotation; canonical JSON stability; signature verify with Node WebCrypto; summary builders.
- Integration (real Postgres, fakes): 2FA sign-in, enrollment, replay, lockout, recovery codes; step-up on every guarded action; signing and the both-signed transition; tamper in the database caught by the gate before order, capture and payout; payout email verification; reconciliation for each stuck state; ciphertext actually stored (read raw rows).
- End to end (Playwright, DEMO_LOGIN, local): sign in as both personas with demo 2FA, create, join, both sign, reach the PayPal step. The PayPal popup part stays in the sandbox-only spec (#42).
- Existing suites keep passing; the test helpers sign on behalf of parties.

## 14. Out of scope

- Zero-knowledge encryption (section 2).
- WebAuthn passkeys as a login factor. TOTP covers 2FA today; passkeys can replace it later without schema churn beyond a new table.
- "Log in with PayPal" to prove payout account ownership. It needs app configuration on the user's PayPal developer account; the email code covers ownership of the address for now.
- KMS-held keys. `DATA_KEYS` comes from the Render environment.

## 15. Amendments after the independent review (issue #67)

- **Contract format 2.** The signed document also covers the listing photos' SHA-256 and the decision rule (`pass_threshold`, `auto_capture_max_minor`). The rule is snapshotted on the deal at creation and `decide()` uses the snapshot, so a later change to the environment cannot change a signed deal. Listing photos can be added only before anyone signs. The signed message is `Handshake contract v2\n<hash>`.
- **Failure counting.** Wrong second-factor codes are counted in Postgres with one atomic update before each check (§4 "Limits"), not in memory.
- **Sessions.** Tokens carry `sv`; every request compares it with `users.session_version`. `/security` has "Sign out everywhere".
- **Demo personas.** Exempt from lockout; payout address, key revocation and recovery codes are locked; `DEMO_LOGIN=true` refuses to boot unless `PAYPAL_API_BASE` is the sandbox.
- **Gate coverage.** The order-approved webhook and reconciliation verify the contract before recording a hold; reconciliation voids a hold on a contract that no longer verifies. A refused void re-sends a capture only on `AUTHORIZATION_ALREADY_CAPTURED`.
- **Legacy plaintext.** `npm run reseal` seals plaintext columns; `--seal-plaintext-events` seals event payloads in one transaction that lifts and restores the append-only trigger.
- **Tick** runs every 10 minutes.
