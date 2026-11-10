# Handshake UI specification

This document fixes the pages, layouts, states, button labels and copy of the Handshake web app so that the frontend can be built from it, `docs/decisions.md` and `docs/research/` alone.

As of 2026-10-09.

Decisions this document implements: G1 (pages), G2 (Tailwind v4, no component library, visual direction chosen at build time with the frontend-design skill), G3 (AG Grid Community ledger, AG Studio dashboard), F3 (demo personas), F4 (non-party preview), F5 (demo kit). State, command, endpoint and error names are spelled exactly as in [decisions.md](decisions.md). Requirements referenced as FR-n / NFR-n are from [01-requirements.md](01-requirements.md). External facts are cited from [research/stack.md](research/stack.md), [research/paypal.md](research/paypal.md), [research/claude-api.md](research/claude-api.md) and [research/ag-grid.md](research/ag-grid.md).

What this document does not decide: fonts, exact colours, spacing scale, icon set, radius, shadows. The frontend-design skill decides those at build time within the constraints in section 1.

## 1. Design principles

The product holds other people's money, so the interface must feel calm and show the deal's status at every moment.

| Principle | What it means in practice |
| --- | --- |
| Calm | One primary action per screen. No marketing language inside the app. No modals except confirmations that move or release money. Motion only for progress (upload, verdict wait) and must respect `prefers-reduced-motion`. |
| Trustworthy | Every money-related statement names the amount and what happens next ("PayPal holds $80.00. Nothing is charged until proof passes."). The AI's role is always stated: it judges; a fixed rule in code decides. |
| Status always visible | The deal's status pill is in the page header on every deal page and on every ledger row. The "What happens next" card is the first thing under the header. |
| One accent colour | One brand accent for primary buttons, links, focus rings and the "active" states (`held`, `proof_submitted`). Everything else is neutral. Status semantics (section 2) use four muted semantic colours that are never used for buttons. PayPal's own button keeps PayPal's styling. |
| Mobile-first for the seller | Every seller screen (preview, accept, evidence upload, verdict, payout) is designed at 360 px wide first. Touch targets are at least 44 px tall. The seller never needs a desktop (NFR-8). |
| Plain words | No jargon in copy: "hold" not "authorization", "released" not "captured", "proof" not "evidence set". The audit timeline is the one place where raw PayPal and status names appear, and they appear next to a plain-words sentence. |
| No colour-only meaning | Status, verdict result and validation state always carry an icon and a word, never just a colour. |

Breakpoints: single column below Tailwind's `md` (768 px); two columns at `md` and above. There is one colour scheme (no dark-mode toggle).

CSS tokens: `app/globals.css` defines exactly these custom properties on `:root`. Tailwind utilities, the AG Grid theme (section 8) and the AG Studio theme ([09-ag-studio.md](09-ag-studio.md) section 5.5) all read them; no second palette exists. The frontend-design skill picks the values.

| Token | Used for |
| --- | --- |
| `--hs-font` | Body font stack |
| `--hs-bg` | Page background |
| `--hs-surface` | Card, grid and widget background |
| `--hs-ink` | Body text |
| `--hs-muted` | Secondary text, placeholders |
| `--hs-border` | Card and input borders |
| `--hs-accent` | Primary buttons, links, focus rings, the `accent` colour role |
| `--hs-status-draft`, `--hs-status-terms_agreed`, `--hs-status-held`, `--hs-status-proof_submitted`, `--hs-status-in_review`, `--hs-status-captured`, `--hs-status-paid`, `--hs-status-voided` | One per `deals.status`, mapped from the colour roles in section 2; the pills and the dashboard charts use the same eight |

## 2. Status vocabulary

The eight states of `deals.status` (decision C1) each have one pill label, one colour role and one icon. The same `StatusPill` component is used on the deal page, the ledger and the dashboard custom widget. The labels live once, in `lib/status-labels.ts` as `STATUS_LABEL` ([09-ag-studio.md](09-ag-studio.md) section 4.2), with exactly the values in this table; `captured` is "Payment released" everywhere.

| `deals.status` | Pill label | Colour role | Icon | Meaning in one line |
| --- | --- | --- | --- | --- |
| `draft` | Draft | neutral (outlined) | pencil | Terms being written or accepted |
| `terms_agreed` | Terms agreed | neutral (filled) | check | Both accepted; buyer has not approved the hold |
| `held` | Money held | accent | lock | PayPal holds the money; waiting for proof |
| `proof_submitted` | Checking proof | accent, pulsing dot | hourglass | Verdict running (seconds) |
| `in_review` | Buyer review | warning | hand | A human decides |
| `captured` | Payment released | success (outlined) | arrow-right | Capture requested; payout in progress |
| `paid` | Paid | success (filled) | check-circle | Seller paid; deal complete |
| `voided` | Voided | danger (muted) | x-circle | Hold released; nothing charged |

Colour roles: `neutral`, `accent`, `warning`, `success`, `danger`. The frontend-design skill picks hues; every text/background pair must meet WCAG AA 4.5:1.

Verdict results use the same pattern: **Pass** (success, check), **Fail** (danger, x), **Unclear** (warning, question mark).

Secondary statuses shown as small text under the pill, never as a second pill:

| Source | Values shown | Copy |
| --- | --- | --- |
| `payments.status` (I3) | `created`, `approved` | "Approval pending" |
| | `authorized` | "Hold placed {date}" |
| | `capture_pending` | "Capture pending at PayPal" |
| | `captured` | "Captured {date}" |
| | `declined` | "Capture declined" |
| | `voided` | "Hold released {date}" |
| `payouts.status` (E7) | `pending` | "Paying the seller…" |
| | `success` | "Seller paid {date}" |
| | `failed` | "Payout failed" |
| `deals.seeded` (F6) | `true` | "Sample deal" badge |

Money is formatted from `amount_minor` with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` on `amount_minor / 100` (A6: USD only). Dates are shown in the viewer's local time as "29 Oct 2026, 14:05" with the ISO UTC string in a `title` attribute; relative time ("in 12 days", "2 h ago") is added where a deadline matters.

## 3. Personas and flows

Three people use the app: a buyer, a seller, and a judge who plays both in one browser.

| Persona | Device | Signs in with | Goal |
| --- | --- | --- | --- |
| Buyer | Desktop or phone | Magic link (F2) or demo persona `buyer` (F3) | Describe the deal, approve the hold, decide if the AI is unsure |
| Seller | Phone | Magic link or demo persona `seller` | Accept terms, upload proof, get paid |
| Judge | Desktop, one browser | Demo personas, switched from the header | Play the whole deal end to end in under five minutes |

### 3.1 Buyer flow

1. `/` → "Email me a sign-in link" (or "Continue as buyer" in demo mode).
2. `/new` → type one sentence → review extracted terms → add up to 4 listing photos → accept → copy the share link.
3. Seller joins and accepts; buyer refreshes `/deal/[code]` (or is already polling) and sees the PayPal button.
4. PayPal popup → sandbox login → approve → "Approved. Placing the hold…" → status `held`.
5. Wait. The seller's proof is checked; if the rule sends it to `in_review`, the buyer gets the review screen and chooses "Release payment" or "Reject proof".
6. `/ledger` shows the deal; "Download evidence pack" works from the deal page at any time.

### 3.2 Seller flow (phone)

1. Opens the share link → signed-out → `/?next=/deal/HS-XXXX` → signs in.
2. Preview (F4): item, amount, deadline, conditions, buyer name → "Join as seller".
3. If `paypal_email` is empty, an inline form asks for it → "Accept terms".
4. Waits for the hold (status `terms_agreed` → `held`). The page polls.
5. "Add your proof": photos (downscaled in the browser), tracking number, note → "Submit proof for checking" → wait screen (typically 6 to 12 s, about 40 s worst case; B5) → verdict.
6. If one condition failed: "One more try" (same form, failed conditions marked). If released: payout status, then "Paid".

### 3.3 Judge flow (persona switcher)

When `DEMO_LOGIN=true` the header shows a "Demo" badge and a segmented control **Buyer | Seller**. Clicking a segment calls `POST /api/auth/demo { persona }`, then `router.refresh()` so the current page re-renders as the other party. The judge never leaves `/deal/[code]`.

1. `/` → "Continue as buyer" → `/new`.
2. Pick a preset sentence chip (the first is the $18 mug, 5 days) → "Extract terms" → review (price and days are already filled from the sentence) → "Use sample listing photos" → "Accept terms and get link" → "Open deal page".
3. Header: switch to **Seller** → page re-renders as the preview → "Join as seller" → "Accept terms" (the demo seller already has `paypal_email` from `DEMO_SELLER_PAYPAL_EMAIL`).
4. Switch to **Buyer** → PayPal button → sandbox buyer login (credentials in the README) → approve → `held`.
5. Switch to **Seller** → "Use sample evidence: Good" (also fills `TRK-DEMO-0000`) → "Submit proof for checking" → verdict → `captured` → `paid` after the payout webhook (the page polls).
6. Repeat with preset 2 (the $35 lamp) and "Wrong item" (fix path, then void), preset 3 (the $22 bottle) and "Blurry" (buyer review path), or the "$250 mug" extra and "Good" (amount over the auto-release limit). Every "Use sample" button stages the photos of the preset the deal was created with (section 12.4). Then `/ledger`, `/dashboard`, "Download evidence pack".

## 4. Shared chrome and page behaviour

Every page shares one header, one data-fetching rule and one set of loading, empty and error patterns.

### 4.1 Header

Left: wordmark "Handshake" linking to `/`. Centre (desktop) / hidden behind a menu button (mobile): "New deal" (`/new`), "Ledger" (`/ledger`), "Dashboard" (`/dashboard`). Right: the signed-in user's `display_name` (or email) linking to `/me`, and "Sign out" (`POST /api/auth/sign-out`, then go to `/`). Signed-out users see only the wordmark and "Sign in" (`/`).

Demo mode (`DEMO_LOGIN=true`, read on the server and passed as a prop): a "Demo" badge and the **Buyer | Seller** segmented control described in 3.3, with the active persona highlighted and announced (`aria-pressed`).

### 4.2 Data fetching

- First paint of `/deal/[code]`, `/ledger` and `/me` happens in a server component that calls the `lib/deal/` query functions (`getDeal`, `listDeals`, `getEvents`) and `users` directly with the session user (B2). Everything after first paint goes through the API routes in H1.
- After every action the page refetches `GET /api/deals/{code}` and `GET /api/deals/{code}/events`. There are no optimistic updates.
- Polling: while the tab is visible, the deal page refetches every 5 s in these cases and stops after 2 minutes: (a) `terms_agreed` with `payment.status` in `created` or `approved` after an `onApprove` (waiting for the hold, E8; what happens when the 2 minutes end is in 7.6); (b) `proof_submitted`; (c) `captured` with the latest payout `pending`; (d) `draft` or `terms_agreed` while waiting for the other party. When polling stops a "Check again" button is left. In every other state there is no polling; a "Refresh" text button sits under the status pill.
- Signed photo URLs expire after 10 minutes (B6). An `<img>` `onError` triggers one refetch of the deal to get fresh URLs.

### 4.3 Loading, empty and error patterns

| Situation | Pattern |
| --- | --- |
| Page load | First pass (4.6): the text "Loading…". After SB-1: skeleton blocks in the shape of the page (header line, status pill, two cards). No spinner. |
| Button action | The button shows a spinner and its label changes to the progressive form ("Accepting…", "Saving…"); it is disabled; other buttons on the card are disabled. |
| Long wait (verdict) | A dedicated wait screen (section 7.8) with elapsed seconds and an `aria-live="polite"` region. |
| Empty list | One sentence and one button (ledger: "No deals yet." → "New deal"). |
| Inline validation | Message under the field, field gets `aria-invalid` and `aria-describedby`; focus moves to the first invalid field on submit. |
| Action error | A dismissible banner at the top of the card that triggered it, with the copy from 4.4. Focus moves to the banner. |
| Page-level error | Full-page message with one link: not found, private, signed out (4.4). |

### 4.4 Error copy

Every API error has the shape `{ "error": { "code", "message" } }` (H2). The UI maps `code` to the copy below; for `invalid_input` it shows the server's `message` when present, otherwise the generic line. Network failures and 5xx other than `paypal_error` use the last row.

| `code` | HTTP | Copy shown | Where |
| --- | --- | --- | --- |
| `invalid_input` | 400 | "Check the highlighted fields." (or the server message) | Under the field or as a card banner |
| `not_signed_in` | 401 | Redirect to `/?next={current path}`; the sign-in panel says "Sign in to continue." | Any page |
| `not_a_party` | 403 | Page: "This deal is private." / "Only its buyer and seller can see it." Link: "Go to your ledger". | `/deal/[code]` |
| `deal_not_found` | 404 | Page: "No deal with code {code}." / "Check the link you were sent." Link: "Go to your ledger". | `/deal/[code]` |
| `file_too_large` | 413 | "That photo is over 2 MB. Choose a smaller one." | Upload |
| `invalid_state` | 409 | "This deal has moved on. Showing the latest state." then refetch | Any action |
| `terms_not_accepted` | 409 | "Both of you must accept the current terms before payment." | PayPal panel |
| `terms_version_mismatch` | 409 | "The terms changed while you were looking. Showing the latest version." then refetch | Accept only (edits send no version, 6.2) |
| `paypal_email_required` | 409 | Shows the inline PayPal email form (7.5) with "Add the PayPal email where you'll be paid, then accept." | Accept |
| `condition_not_checkable` | 422 | "We couldn't find anything checkable in that sentence. Say what a photo or a tracking number should show, for example 'matches the listing photos' or 'tracking shows delivered'." | `/new` step 1 |
| `unsupported_currency` | 422 | "Only US dollars are supported. Write the price as $ or USD." | `/new` step 1 |
| `too_many_files` | 422 | "Up to 4 listing photos." / "Up to 6 photos." | Upload |
| `rate_limited` | 429 | "Too many questions in a row. Wait a few minutes and ask again." | Dashboard agent panel only (09 section 6) |
| `internal_error` | 500 | "Something went wrong on our side. Try again." | Any |
| `paypal_error` | 502 | "PayPal couldn't complete that (debug id {debug_id}). Try again in a moment." | PayPal panel, review, cancel, payout retry; the evidence request has its own copy (7.8) |
| `ai_unavailable` | 503 | "The model didn't answer. Try again." (the sentence stays in the textarea) | `/new` step 1 |
| anything else | – | "Something went wrong on our side. Try again." | Any |

The `debug_id` is read from the server's `message` string; if absent, the parenthesis is omitted. The list above is the whole H2 list; the UI maps nothing else.

### 4.5 Confirmations

Confirmations are dialogs with a title, one sentence, a destructive or primary button and a "Go back" button. They trap focus and return it to the trigger. Only these actions confirm:

| Trigger | Title | Sentence | Buttons |
| --- | --- | --- | --- |
| Cancel deal (`draft`, `terms_agreed`) | Cancel this deal? | "No money is held. The deal is closed for both of you. This can't be undone." | "Cancel deal" (danger) / "Go back" |
| Cancel deal (`held`) | Cancel this deal? | "The hold of {amount} on the buyer's PayPal is released. This can't be undone." | "Cancel deal" (danger) / "Go back" |
| Edit terms after any acceptance | Edit the terms? | "Editing clears both acceptances. Both of you must accept the new version before payment." | "Edit terms" (primary) / "Go back" |
| Release payment (`in_review`) | Release {amount} to {seller}? | "PayPal charges your account and pays the seller. This can't be undone." | "Release payment" (primary) / "Go back" |
| Reject proof (`in_review`) | Reject the proof? | "The hold of {amount} is released and the seller is not paid. This can't be undone." | "Reject proof" (danger) / "Go back" |

Submitting proof does not confirm; the button label and helper text are explicit instead (7.7). First pass (4.6): only "Release payment" and "Reject proof" confirm.

### 4.6 First pass

The UI is built in two passes so the happy path is on the hosted URL before any polish. The first pass is what SB-1 in [06-test-plan.md](06-test-plan.md) runs against; everything in the right-hand column is built only after SB-1 passes on the hosted URL, and nothing in this document depends on it.

| Area | First pass | Built after SB-1 passes |
| --- | --- | --- |
| Page load (4.3) | The text "Loading…" | Skeleton blocks |
| Photos (6.3, 7.2, 7.9, 7.10) | Plain grids; each thumbnail is an `<a target="_blank">` to the signed full-size URL | Lightbox with "Close" and left/right; swipeable strips on mobile |
| Uploads (6.3, 7.7) | The line "Uploading 2 of 4" under the grid | Per-thumbnail progress rings |
| Share (6.4, 7.4) | "Copy link" only | "Share…" with `navigator.share` |
| Confirmations (4.5) | "Release payment" and "Reject proof" only | "Cancel deal" and "Edit terms" confirmations |
| Toasts (7.6, 10) | None; the refetched page is the feedback | "Hold placed" and "Saved." toasts |
| `/new` stepper (6) | Four headings in sequence, forward only | Clickable completed steps |
| Mobile sticky bar (7.2) | None; the card's button scrolls with the page | Sticky bottom bar |

### 4.7 Test hooks

The Playwright happy path in [06-test-plan.md](06-test-plan.md) "End to end" locates elements by `data-testid`. These attributes are part of the UI, not of the test.

| `data-testid` | Element |
| --- | --- |
| `persona-buyer`, `persona-seller` | The two segments of the **Buyer \| Seller** control (4.1) and the two "Continue as…" buttons on `/` (5) |
| `preset-sentence` | Every preset sentence chip on `/new` (6.1); the first chip in DOM order is preset 1 |
| `extract-terms` | "Extract terms" (6.1) |
| `save-terms` | "Save terms" (6.2) |
| `use-sample-reference` | "Use sample listing photos" (6.3); rendered only once `presets.json` has loaded in demo mode |
| `accept-and-share` | "Accept terms and get link" (6.3) |
| `deal-code` | The element whose text is exactly the code, on `/new` step 2 and in the deal header (7.2) |
| `deal-status` | A `<span hidden>` inside `StatusPill` whose text is the raw `deals.status`; the pill itself carries `data-status="{deals.status}"` |
| `join` | "Join as seller" (7.5) |
| `accept-terms` | "Accept terms" on the deal page (7.5) |
| `use-sample-evidence-{setId}` (today `good`, `wrong-item`, `blurry`, `reuse-listing`) | The "Use sample evidence" buttons (7.7): one per set in the deal's preset, generated from `presets.json`, not a fixed four |
| `tracking-input` | The tracking number input (7.7) |
| `submit-evidence` | "Submit proof for checking" (7.7) |
| `verdict-row` | Each row (desktop) or card (mobile) of the verdict table (7.9) |
| `review-approve`, `review-reject` | "Release payment" and "Reject proof" (7.10) |

## 5. Page `/`: landing and sign-in

Purpose: say what Handshake is in one screen and get the visitor signed in.

Layout, top to bottom (mobile; desktop puts the sign-in panel to the right of the hero):

1. Header (4.1).
2. Hero: heading "Pay on proof." Sub-line: "Agree a deal in one sentence. PayPal holds the money. Claude checks the proof. A fixed rule releases it." No image.
3. Sign-in panel (card):
   - Signed out, demo mode: heading "Try the demo". Two buttons: "Continue as buyer" → `POST /api/auth/demo { "persona": "buyer" }` → `/new`; "Continue as seller" → persona `seller` → `/ledger`. Helper: "Two seeded accounts. Switch sides any time from the header." Then a divider "or" and the email form below.
   - Signed out, email form: label "Email", `<input type="email" required>`, button "Email me a sign-in link" → `POST /api/auth/magic-link { email }`. Success replaces the form: "Check your email." / "The link works for 15 minutes." In development a second line reads "Development: the link is printed to the server console." (F2). Helper under the form: "No password. The link signs you in on this device for 30 days."
   - Signed in: "You're signed in as {display_name or email}." Buttons: "New deal" → `/new`, "Your ledger" → `/ledger`.
   - If the URL has `?next=`, the panel heading is "Sign in to continue" and a successful sign-in goes to `next` (relative paths only; otherwise ignored).
4. "How it works" as four numbered steps, one line each: "1. The buyer describes the deal in a sentence; Claude turns it into checkable conditions. 2. Both accept. PayPal holds the buyer's money; nothing is charged. 3. The seller uploads photos and a tracking number; Claude judges each condition. 4. A fixed rule in code releases the money, asks for one fix, voids the hold, or asks the buyer."
5. Callout "What the AI never does": "It never moves money. Capture and void are called only by a rule in code that is unit-tested line by line. Every step is logged and exportable."
6. Footer: "Sandbox only. No real money." · link "Source on GitHub" · link "README".

Magic-link callback: `GET /api/auth/callback?token=…` sets the cookie and redirects to `next` or `/ledger`. An expired or invalid token lands on `/?error=invalid_link` ([04-api-spec.md](04-api-spec.md) section 4.2) and the sign-in panel shows "That link has expired or was already used. Request a new one."

## 6. Page `/new`: create a deal

Purpose: turn one sentence into accepted terms and a share link, in four steps on one page. A signed-out visitor is redirected to `/?next=/new`.

A stepper at the top shows "1 Describe · 2 Review terms · 3 Listing photos · 4 Share". Completed steps are clickable only backwards within the same session; after step 2 is saved, going back to step 1 starts a new deal (the old draft stays in the ledger and can be cancelled there). First pass (4.6): forward only.

### 6.1 Step 1: Describe

- Heading: "Describe the deal in one sentence".
- Textarea, label "Your sentence", `maxLength` 500 (H3) with a live counter "0 / 500". Helper: "Include the item, the price in US dollars, and what the seller must show: photos, a tracking number, or both. Keep it to one deal."
- Demo mode: a row of chips above the textarea labelled "Try one:", one per entry in `public/demo/presets.json` → `presets[]` (section 12), in file order, each carrying `data-preset="{preset.id}"`. A second, smaller row labelled "Extras:" holds the `extras[]` chips. Clicking a chip replaces the textarea text.
- Button "Extract terms" (primary, disabled when empty). On click: `POST /api/deals { "text" }`.
- Loading: button becomes "Reading your sentence…" with a spinner; a skeleton of the terms card appears below. Extraction takes up to 15 s with one retry (D4), so the skeleton carries the line "Usually a few seconds; at most 30."
- Errors: `condition_not_checkable`, `unsupported_currency`, `ai_unavailable`, `invalid_input` (4.4) shown under the textarea; the sentence stays so it can be edited.
- Success: `201` with the draft deal (code, `item_title`, `amount_minor`, `currency`, `deadline_days`, `conditions`, `rejected`). Move to step 2 and focus its heading.

### 6.2 Step 2: Review terms

- Heading: "Check what Claude understood". Helper: "You can edit anything. The seller sees exactly this."
- Code line: "Deal code {code}" with a "Copy" button.
- Fields:
  - "Item" text input, `maxLength` 80, prefilled with `item_title`.
  - "Price (USD)" decimal input (`inputMode="decimal"`, step 0.01, min 0.01, max 10,000.00 which is the 1,000,000 minor-unit limit in H3). Prefilled from `amount_minor / 100`. If `amount_minor` is `null` the field is empty, outlined in the warning colour, with the prompt "What's the price? Your sentence didn't say." The field is required.
  - "Seller has … days to deliver proof" number input, min 1, max 21 (I3). Prefilled from `deadline_days`. If `null`: empty, prompt "How many days? Most deals use 14.", required. Helper: "Counted from the moment the hold is placed, at most 21 days."
  - "Conditions" list. Each row: text input (required, non-empty), evidence type `<select>` with "Photo" (`photo`) / "Tracking" (`tracking`), and a "Remove" icon button. "Add condition" adds a row; the list allows at most 4 editable rows (D6).
  - The server-added condition "Photo shows the deal code {code} written by hand" (D6, matched by its exact text) is rendered last, read-only, with a lock icon and helper "Added automatically whenever a photo condition exists. It proves the photos were taken for this deal." It is not sent back in `PATCH`; the server re-appends it.
- Rejected conditions block, shown only when `rejected` is non-empty: heading "Left out: a photo or tracking number can't prove these". Each item: the original text in quotes, then "Suggested instead: {suggestion}" and a button "Use suggestion" that appends the suggestion as a new photo condition (the user may change the type). The block disappears once all items are used or dismissed with "Dismiss".
- Button "Save terms" (primary). Validation before send: price and days present and in range; at least one condition; no empty condition text. On click, if nothing changed, go to step 3 without a request; otherwise `PATCH /api/deals/{code}/terms { item_title, amount_minor, deadline_days, conditions: [{ text, evidence_type }] }` ([04-api-spec.md](04-api-spec.md) section 6.4; no version field, the per-deal row lock serialises edits). The server bumps `terms_version` (C2) and the response `DealView` carries the new value, which the accept call in 6.3 sends.

### 6.3 Step 3: Listing photos

- Heading: "Add listing photos (optional)". Helper: "Up to 4. Claude compares the seller's proof photos with these. Skip this if your conditions are tracking-only."
- `<input type="file" accept="image/*" multiple>` behind a button "Choose photos"; on mobile the OS sheet offers camera or gallery. Files are staged client-side (thumbnails in a 2-column grid on mobile, 4-column on desktop) each with a "Remove" button and the resized size ("412 KB"). Count "2 of 4".
- Each file is downscaled in the browser before anything else (section 7.7). A file that fails to decode shows "Please choose a JPEG or PNG photo." and is not staged.
- Demo mode: button "Use sample listing photos" stages the `reference[]` of the preset whose sentence equals the deal's `source_text` (12.4), or of preset 1 when none matches.
- Button "Accept terms and get link" (primary) and a text button "Skip photos" (same action without uploads). On click: for each staged file `POST /api/deals/{code}/files` (multipart, `purpose=reference`), each answering `201 FileRef` (04 section 3), with the line "Uploading 2 of 4" (progress rings after SB-1, 4.6); then `POST /api/deals/{code}/accept { terms_version }`. Any upload error stops the sequence, keeps the staged files, and shows the error from 4.4 on that thumbnail.
- There is no delete endpoint for uploaded files (H1), so removal is possible only while staged.

### 6.4 Step 4: Share

- Heading: "Send this link to the seller".
- Read-only input with `{APP_URL}/deal/{code}` and a "Copy link" button (`navigator.clipboard.writeText`; label becomes "Copied" for 2 s). After SB-1 (4.6): on devices with `navigator.share`, a second button "Share…" opens the native sheet.
- Line: "You accepted version {terms_version}." Then: "The seller signs in, adds their PayPal email and accepts. Then you approve the hold with PayPal on the deal page."
- Buttons: "Open deal page" (primary, `/deal/{code}`), "New deal" (text).

## 7. Page `/deal/[code]`: the deal

Purpose: show one deal's status to its buyer or seller and offer exactly the actions the state machine allows (C2). This is the only page the seller needs.

### 7.1 What the page reads

The page renders from `GET /api/deals/{code}` and `GET /api/deals/{code}/events`. The types are those of [04-api-spec.md](04-api-spec.md) section 3, copied here verbatim; the page is coded against them and nothing else.

```ts
type Status = "draft" | "terms_agreed" | "held" | "proof_submitted" | "in_review" | "captured" | "paid" | "voided";
type Role = "buyer" | "seller";
type Actor = "buyer" | "seller" | "system" | "paypal" | "ai";
type EvidenceType = "photo" | "tracking";
type VerdictResult = "pass" | "fail" | "unclear";
type Decision = "capture" | "request_fix" | "buyer_review" | "void";
type DecisionReason = "all_pass" | "fail" | "unclear" | "low_confidence" | "amount_over_limit";   // 05 section 7; an AI failure is "unclear"
type CarrierStatus = "delivered" | "in_transit" | "unknown";
type PaymentStatus = "created" | "approved" | "authorized" | "capture_pending" | "captured" | "declined" | "voided";
type PayoutStatus = "pending" | "success" | "failed";
type Mime = "image/jpeg" | "image/png" | "image/webp";

type Party = { display_name: string | null; email: string };

type Condition = {
  id: string;
  position: number;            // 1-based display order; the code condition is always last
  text: string;
  evidence_type: EvidenceType;
  system: boolean;             // true for the server-added "Photo shows the deal code {code} written by hand"
};

type FileRef = {
  id: string;
  purpose: "reference" | "evidence";
  mime: Mime;
  size_bytes: number;
  sha256: string;              // lowercase hex, 64 chars
  url: string;                 // signed, relative, valid 10 minutes from the response
  created_at: string;
};

type Verdict = {
  condition_id: string;
  result: VerdictResult;
  confidence: number;          // 0.00 to 1.00
  reason: string;              // one sentence
  evidence_used: string[];     // labels r1..r4, e1..e6, "tracking", "note" (05 section 4.2), the verdicts.evidence_used column (05 section 4.7 post-processed labels; D8 guardrail rows list the matching evidence and reference labels); [] for AI-failure and seeded rows
  model: string;               // e.g. "claude-sonnet-5-5"
  prompt_version: string;      // e.g. "judge-v1"
};

type Submission = {
  submission_no: 1 | 2;
  submitted_at: string;
  files: FileRef[];            // evidence photos, in upload order
  tracking_number: string | null;
  carrier_status: CarrierStatus | null;
  note: string | null;
  verdicts: Verdict[];         // empty until transaction V of 9.1 commits; may be present while status is proof_submitted (PayPal call pending)
  decision: Decision | null;   // null while status is proof_submitted
  decision_reason: DecisionReason | null;   // set by decide() with the decision; null while decision is null
  decided_at: string | null;
};

type Payment = {
  status: PaymentStatus;
  paypal_order_id: string;
  authorization_id: string | null;   // the ORIGINAL authorization id (decisions E3)
  authorized_at: string | null;
  auth_expires_at: string | null;
  capture_id: string | null;
};

type Payout = {
  attempt: number;             // 1 for the first attempt
  status: PayoutStatus;
  amount_minor: number;
  sender_batch_id: string;     // "payout-{code}-{attempt}"
  paypal_batch_id: string | null;   // null until the Payouts call has answered
  paypal_item_id: string | null;    // from the first PAYOUTS-ITEM.* webhook; needed to cancel an UNCLAIMED item (decisions E5)
  failure_reason: string | null;
  created_at: string;
};

type DealView = {
  code: string;
  role: Role;                  // the caller's role
  status: Status;
  item_title: string;
  source_text: string;
  amount_minor: number | null; // null until the buyer fills it in
  currency: "USD";
  deadline_days: number | null;
  deadline_at: string | null;  // null until held
  terms_version: number;
  buyer_accepted_version: number | null;
  seller_accepted_version: number | null;
  fix_attempts_used: 0 | 1;
  buyer: Party;
  seller: (Party & { has_paypal_email: boolean; paypal_email: string | null }) | null;   // paypal_email is filled only when role = "seller"; null for the buyer
  conditions: Condition[];
  reference_files: FileRef[];
  submissions: Submission[];
  payment: Payment | null;     // null until start_payment; always null on seeded deals
  payouts: Payout[];           // ascending by attempt
  seeded: boolean;
  created_at: string;
  updated_at: string;
};

type DealPreview = {           // what a signed-in non-party sees (decisions F4)
  role: "preview";
  code: string;
  item_title: string;
  amount_minor: number | null;
  currency: "USD";
  deadline_days: number | null;
  conditions: Condition[];
  buyer: { display_name: string | null };
};

type DealEvent = {
  id: string;                  // BigInt as decimal string; strictly increasing per deal
  from_status: Status | null;  // null only on "create"
  to_status: Status;
  actor: Actor;
  cause: string;               // see section 16
  payload: Record<string, unknown>;
  created_at: string;
};

type Me = { id: string; email: string; display_name: string | null; paypal_email: string | null; created_at: string };
```

`DealEvent.cause` is the C6 vocabulary (04 section 16), copied in 7.11. `Me` is read by `/me` (section 10), not by the deal page.

How the page derives what it shows from these types:

| Need | Derived from |
| --- | --- |
| Preview or full view | `role === "preview"` is a `DealPreview`; the page renders only items 1, 2 and 4 of 7.2. |
| Photo labels `r1`…`r4`, `e1`…`e6` | Array position: `reference_files[i]` is `r{i+1}`; `submissions[k].files[j]` is `e{j+1}` within that submission. Not sent by the API. |
| Latest proof attempt | `submissions[submissions.length - 1]` (ascending by `submission_no`). |
| Latest payout attempt | `payouts[payouts.length - 1]` (ascending by `attempt`); "no payout" when the array is empty. |
| The seller's own PayPal address | `seller.paypal_email`, filled only when `role = "seller"`. The buyer gets `null` there and sees only `seller.has_paypal_email`. |
| Buyer-review reason | `Submission.decision_reason` of the attempt (`decision = "buyer_review"`): `unclear` (also what an AI failure, timeout, refusal or schema mismatch yields, D4), `low_confidence`, `amount_over_limit`, or `fail` (a second-attempt fail below `PASS_THRESHOLD`, D9). The same value is `payload.reason` of the matching `decision:buyer_review` event (C6). |
| Why a deal is `voided` | The first event with `to_status = "voided"` and `from_status !== "voided"`; its `cause` and `actor` key the copy in 7.4. |
| Evidence used by a verdict | `Verdict.evidence_used` (labels `e1`…`e6`, `r1`…`r4`, `tracking`, `note`); `[]` for AI-failure and seeded rows, which render no chips; D8 guardrail rows carry the matching labels (05 section 4.7) and render chips. |

Carrier status for a tracking number is computed in the browser with the same pure function the server uses (D7, `lib/carrier.ts`): last character even digit → `delivered` shown as "delivered", odd digit → `in_transit` shown as "in transit", anything else → "unknown".

### 7.2 Layout

Mobile (single column, top to bottom):

1. Header (4.1).
2. Deal header: `item_title` as `h1`; line "Deal {code}" with a "Copy" button; `StatusPill` with the secondary status under it (section 2); "Sample deal" badge when `seeded`; line "Buyer {buyer name} · Seller {seller name or 'not joined yet'}"; amount in large type; deadline line: before `held` "Seller has {deadline_days} days after the hold is placed", from `held` on "Proof due {deadline_at} ({relative})", hidden once `captured`, `paid` or `voided`.
3. "What happens next" card: the role- and state-specific heading, helper text and buttons from 7.4. After SB-1 (4.6): on mobile, when this card has a primary button for the current viewer, the button is repeated in a sticky bottom bar so it stays reachable while scrolling.
4. Terms card: "Terms · version {terms_version}". Conditions as a numbered list, each with an evidence-type tag ("Photo" / "Tracking"). Acceptance line: "Buyer accepted v{n} · Seller accepted v{n}" or "not yet". Buyer-only "Edit terms" button in `draft`, and in `terms_agreed` only while `payment` is `null` (02 section 5.1: once a PayPal order exists the terms are frozen and "Cancel deal" is the way out); confirm per 4.5 if anyone has accepted. Editing opens the same fields as 6.2 inline in this card with "Save terms" / "Cancel"; the request is the `PATCH` of 6.2.
5. Listing photos card (hidden when there are none): `reference_files` thumbnails labelled r1…r4 by position; each is an `<a target="_blank">` to its `url` (lightbox after SB-1, 4.6).
6. Proof card(s): one per `submissions[]` entry, newest first, titled "Proof · attempt {submission_no} · {submitted_at}": `files` as a grid labelled e1…e6 by position (swipeable strip on mobile after SB-1); "Tracking {tracking_number} · {carrier_status}" with the tag "sandbox carrier" in demo mode; the note in a quoted block; then the verdict table (7.9) and the decision line. In `held` for the seller, the evidence form (7.7) replaces the empty card.
7. Payment card: hidden until `payment` is non-null. Lines: "Hold placed {authorized_at}", "Hold valid until {auth_expires_at}", "Capture {capture_id}" when set, and the `payment.status` copy from section 2. Buyer and seller both see it. With `payouts` non-empty, the latest attempt is shown: the seller sees "Payout to {seller.paypal_email}: {status copy}" and, on `failed`, the `failure_reason` and the "Retry payout" button; the buyer sees "Payout to seller: {status copy}" without the email. Earlier attempts are listed under a "Previous attempts" disclosure as "Attempt {attempt}: {status} {failure_reason}".
8. Timeline card (7.11).
9. Footer actions: "Download evidence pack (JSON)" (7.12) and, where allowed, "Cancel deal" as a text-style danger button.

Desktop (`md` and up): two columns. Left (two thirds): sections 3, 4, 5, 6. Right (one third): 7, 8, 9. The deal header spans both columns. No sticky bar.

### 7.3 State matrix

What each role sees and can do, per `deals.status`. "N" is a signed-in non-party; a signed-out visitor is always redirected to `/?next=/deal/{code}`. Button labels are exact.

| `status` | Buyer sees / can do | Seller sees / can do | N (non-party) |
| --- | --- | --- | --- |
| `draft`, no seller | Share link + "Copy link"; "Accept terms" (if not accepted) or "You accepted v{n}"; "Edit terms"; "Cancel deal" | – | Preview: "Join as seller" |
| `draft`, seller joined | "Waiting for {seller} to accept" or "{seller} accepted. Accept to continue." ; "Accept terms" / "Edit terms" / "Cancel deal" | "Review the terms"; "Accept terms" (inline PayPal email form first if `paypal_email` is null); "Cancel deal" | Private (403) |
| `terms_agreed`, `payment` null | PayPal button panel; "Edit terms"; "Cancel deal" | "Waiting for {buyer} to approve the hold"; "Cancel deal" | Private |
| `terms_agreed`, `payment.status = created` | PayPal button panel; "Cancel deal" (no "Edit terms": a PayPal order exists, 02 section 5.1) | Same as above | Private |
| `terms_agreed`, `payment.status = approved`, `payment.authorization_id` null | SB-6 recovery panel for 2 minutes, then the "The hold wasn't confirmed" panel with the PayPal button (7.6); "Cancel deal" | Same as above | Private |
| `terms_agreed`, `payment.status = approved`, `payment.authorization_id` set (a `PENDING` authorization, 02 section 7) | "PayPal is reviewing the payment" panel (7.6): "Check again"; "Cancel deal". No PayPal button: `start_payment` is `invalid_state` while the pending authorization is stored | Same as above | Private |
| `held`, `fix_attempts_used = 0` | "Money held. Waiting for proof."; "Cancel deal" | Evidence form; "Submit proof for checking"; "Cancel deal" | Private |
| `held`, `fix_attempts_used = 1` | "The first proof failed. The seller has one more try."; previous verdict; "Cancel deal" | "One more try" evidence form with failed conditions marked; "Submit proof for checking"; "Cancel deal" | Private |
| `proof_submitted` | "Checking the seller's proof…" (polling); no actions | Wait screen (if they just submitted) or "Checking your proof…" (polling); no actions | Private |
| `in_review`, `payment.status !== 'declined'` (from the rule) | Review screen; "Release payment" / "Reject proof" | "Waiting for {buyer} to decide" + verdicts; no actions | Private |
| `in_review`, `payment.status === 'declined'` (after `fact:capture_declined`) | "PayPal declined the capture."; "Release payment" (retries) / "Reject proof" | "PayPal declined the capture. Waiting for {buyer}."; no actions | Private |
| `captured` | "Payment released." + latest payout status; no actions | "Payment released to you." + latest payout status; "Retry payout" when the latest `payouts` entry is `failed`, or `pending` with `paypal_batch_id` null (02 section 8.2) | Private |
| `paid` | "Deal complete. {seller} was paid."; no actions | "Paid. {amount} sent to {seller.paypal_email}."; no actions | Private |
| `voided` | "Deal voided." + reason; no actions | Same | Private |

"Download evidence pack (JSON)" is available to buyer and seller in every state. "Refresh" is available everywhere.

### 7.4 Copy by state

Headings (`h2`) and helper text for the "What happens next" card. `{amount}` is formatted money; `{deadline}` is `deadline_at` with relative time.

**`draft`**

| Viewer | Heading | Helper |
| --- | --- | --- |
| Buyer, no seller | Share the link with your seller | "They sign in, add their PayPal email and accept. You'll approve the hold after that." (share link + "Copy link" + "Share…" below) |
| Buyer, seller joined, seller not accepted | Waiting for {seller} to accept | "They're looking at version {terms_version}. You can still edit; editing clears both acceptances." |
| Buyer, seller accepted, buyer not | {seller} accepted. Accept to continue. | "Once you accept version {terms_version}, you'll approve the hold with PayPal." |
| Seller, not accepted | Review the terms | "Accepting means you'll prove each condition with photos or tracking before {deadline_days} days after the hold is placed. Nothing is charged to anyone yet." |
| Seller, accepted, buyer not | You accepted version {terms_version} | "Waiting for {buyer} to accept and approve the hold." |
| Preview | {buyer} invited you to a deal | "Joining doesn't commit you. You'll accept the terms in the next step." |

After an `edit_terms` the party who had accepted sees a banner on this card: "Terms changed to version {terms_version}. Both of you must accept again."

**`terms_agreed`**

| Viewer | Heading | Helper |
| --- | --- | --- |
| Buyer, hold not approved | Approve the hold with PayPal | "PayPal holds {amount} on your account. Nothing is charged until the proof passes or you release it yourself. If the deal is voided or the deadline passes, the hold is released." (PayPal panel, 7.5) |
| Buyer, approved, hold not confirmed (`authorization_id` null) | Approved. Confirming the hold… | "You approved in PayPal but we haven't confirmed the hold yet. PayPal usually confirms within a minute. You can close this page; we'll finish it." Button "Check again". |
| Buyer, `PENDING` authorization stored (`authorization_id` set) | PayPal is reviewing the payment | "We'll place the hold when PayPal confirms it. You can close this page; we'll finish it." Buttons "Check again", "Cancel deal". |
| Seller | Waiting for {buyer} to approve the hold | "You'll be told here when the money is held. Don't ship before that." |

**`held`**

| Viewer | Heading | Helper |
| --- | --- | --- |
| Buyer, `fix_attempts_used = 0` | Money held. Waiting for proof. | "Nothing has been charged. If the seller's proof doesn't pass by {deadline}, the hold is released automatically." |
| Buyer, `fix_attempts_used = 1` | The first proof failed. One more try. | "{n} condition(s) failed. The seller can fix them once before {deadline}. If it clearly fails again the hold is released; if Claude is unsure, you decide." |
| Seller, `fix_attempts_used = 0` | Ship it, then add your proof | "Upload photos that show each condition, enter the tracking number, and submit before {deadline}. Claude checks them against the terms; a fixed rule then releases the money, asks you to fix one thing, or asks the buyer." |
| Seller, `fix_attempts_used = 1` | One more try | "Your first proof failed {n} condition(s), marked below. Fix them and resubmit before {deadline}. If it clearly fails again the deal is voided and the hold is released; if Claude is unsure, the buyer decides." (D9) |

**`proof_submitted`**

| Viewer | Heading | Helper |
| --- | --- | --- |
| Buyer | Checking the seller's proof… | "This usually takes under 15 seconds, at most about 40. If the check could not finish, Handshake re-runs it at the next check (within 10 minutes) or when an operator runs it; nothing is charged until then." (B5, B7, J2) |
| Seller | Checking your proof… | Same, plus the wait screen (7.8) when this browser submitted. |

**`in_review`**

The buyer rows are keyed by `decision_reason` of the latest attempt (7.1), except the last, which is keyed by `payment.status === 'declined'`.

| Viewer | Heading | Helper |
| --- | --- | --- |
| Buyer, `decision_reason` `unclear` | Your decision: Claude couldn't decide | "{n} of {m} conditions came back unclear. Look at the proof and decide. If you do nothing, the hold is released on {deadline}." |
| Buyer, `decision_reason` `low_confidence` | Your decision: confidence was too low | "Claude's confidence was below what the rule requires. Look at the proof and decide. If you do nothing, the hold is released on {deadline}." |
| Buyer, `decision_reason` `fail` (second attempt, D9) | Your decision: the second proof may have failed | "{n} condition(s) failed on the second try, but Claude wasn't confident enough for the rule to void the deal. Look at the proof and decide. If you do nothing, the hold is released on {deadline}." |
| Buyer, `decision_reason` `amount_over_limit` | Your decision: this deal is over the auto-release limit | "Every condition passed. Deals above the auto-release limit always need your confirmation. If you do nothing, the hold is released on {deadline}." |
| Buyer, `payment.status === 'declined'` | PayPal declined the capture | "The proof passed, but PayPal declined the capture (details in the timeline). Try again, or reject the proof to release the hold." |
| Seller | Waiting for {buyer} to decide | "Claude couldn't decide on its own, so the buyer is looking at your proof. You'll see the result here." (or "PayPal declined the capture. Waiting for {buyer}." when `payment.status === 'declined'`) |

**`captured`**

"Payout" below is the latest `payouts` entry (7.1); `{paypal_email}` is `seller.paypal_email`, filled only for the seller.

| Viewer | Heading | Helper |
| --- | --- | --- |
| Buyer | Payment released | "{amount} is being charged to your PayPal and paid to {seller}. The deal is complete once the payout lands." |
| Seller, payout `pending` with `paypal_batch_id` set, or no payout yet | Payment released to you | "PayPal is sending {amount} to {paypal_email}. This usually takes a minute." |
| Seller, payout `pending` with `paypal_batch_id` null (02 section 6.9 case D) | Payout not confirmed | "We didn't hear back from PayPal. Retry to send the payout again." Button: "Retry payout" (primary; `POST /api/deals/{code}/payout/retry`; 02 section 7) |
| Seller, payout `failed` | Payout failed | "PayPal couldn't pay {paypal_email}: {failure_reason}. Check your PayPal email on your profile, then retry." Buttons: "Retry payout" (primary; `POST /api/deals/{code}/payout/retry`), "Edit profile" (`/me`). With `failure_reason` `UNCLAIMED` the helper adds "That address has no PayPal account yet. Retrying cancels the unclaimed payment first." (E7) |
| Buyer, payout `failed` | Payment released. Payout to the seller failed. | "The seller has been asked to check their PayPal email and retry. You've already paid." |

**`paid`**

| Viewer | Heading | Helper |
| --- | --- | --- |
| Buyer | Deal complete | "{seller} was paid {amount} on {date}. Thanks for using Handshake." |
| Seller | Paid | "{amount} was sent to {seller.paypal_email} on {date}." |

**`voided`**: heading "Deal voided". The helper is keyed on the first event with `to_status = 'voided'` and `from_status !== 'voided'` (7.1), not on the last event: every void that had a hold is followed by a `fact:authorization_voided` row, so the last event would say "PayPal voided the hold" for every cancel, reject, deadline and second-failure void. The `cause` values are the C6 vocabulary:

| `cause` of that event | `actor` | Helper |
| --- | --- | --- |
| `cancel` | `buyer` | "The buyer cancelled the deal." |
| `cancel` | `seller` | "The seller cancelled the deal." |
| `tick:deadline` | `system` | "The deadline passed with no passing proof." |
| `decision:void` | `system` | "The proof failed twice." |
| `review:reject` | `buyer` | "The buyer rejected the proof." |
| `fact:authorization_voided` | `paypal` | "PayPal voided the hold." |
| anything else | – | "The deal was closed." |

Followed by: "The hold of {amount} was released. Nothing was charged." when `payment` is non-null with `authorized_at` set, otherwise "No money was ever held."

### 7.5 Accepting and the PayPal email form

"Accept terms" calls `POST /api/deals/{code}/accept { terms_version }`. On `paypal_email_required` (C2) the card shows, in place of the button, a one-field form: label "PayPal email", helper "Where you're paid when the proof passes. In the sandbox use the seller test account's email from the README.", button "Save and accept". It calls `PATCH /api/me { paypal_email }` then `accept` again. The email is also editable later on `/me`.

"Join as seller" (preview) calls `POST /api/deals/{code}/join`, which answers the full `DealView` with `role = "seller"`, and the page re-renders with the "Review the terms" copy.

### 7.6 PayPal button integration

The buyer sees, inside the "Approve the hold with PayPal" card:

1. The helper sentence from 7.4.
2. Demo mode only, a note: "Sandbox: in the PayPal window, sign in with the test buyer account from the README (Testing Tools › Sandbox Accounts). No real money is involved." with "README" as a link that opens in a new tab.
3. PayPal's own button, rendered by `@paypal/react-paypal-js` 10.x using the legacy `PayPalScriptProvider` with `intent: "authorize"` and `PayPalButtons` (E9; research/paypal.md §8 "Browser side", V5 flow). It is not restyled. Until the script loads, a grey block of the button's height is shown; if nothing renders after 10 s the block is replaced by "PayPal's button didn't load. Turn off ad blockers for this site and reload."
4. Under the button: "Secure checkout by PayPal. Handshake never sees your PayPal password."

```tsx
'use client';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';

export function HoldButton({ code, onHeld, onWaiting, onFail }: {
  code: string; onHeld: () => void; onWaiting: () => void; onFail: (msg: string) => void;
}) {
  return (
    <PayPalScriptProvider options={{ clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID!, currency: 'USD', intent: 'authorize' }}>
      <PayPalButtons
        createOrder={async () => {
          const r = await fetch(`/api/deals/${code}/payment`, { method: 'POST' });   // start_payment (C2): reuses the stored order or creates order-{code}-{n+1} (E4)
          if (!r.ok) throw await r.json();
          return (await r.json()).order_id;                                            // V5: return the order id string
        }}
        onApprove={async (data) => {
          onWaiting();                                                                 // "Approved. Placing the hold…"
          const r = await fetch(`/api/deals/${code}/payment/authorize`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ order_id: data.orderID }),
          });
          r.ok ? onHeld() : onFail(await r.text());                                    // paypal_error → refetch, then "PayPal is reviewing" (authorization_id set) or "The hold wasn't confirmed" (null); anything else → SB-6 recovery panel
        }}
        onCancel={() => onFail('cancel')}
        onError={() => onFail('error')}
      />
    </PayPalScriptProvider>
  );
}
```

`createOrder` and `onApprove` are quoted from research/paypal.md section 8 "Browser side" (V5 flow). `onCancel` and `onError` are UNVERIFIED: no research document cites them. Day-1 check: confirm both props exist in `node_modules/@paypal/paypal-js/types/components/buttons.d.ts` after install. If either is absent, drop it from `HoldButton` and show its row's copy below when `createOrder` or `onApprove` rejects instead.

States of the panel:

| Moment | What the buyer sees |
| --- | --- |
| `createOrder` fails with `terms_not_accepted` | Banner from 4.4; the button stays. |
| `createOrder` fails with `paypal_error` | Banner "PayPal couldn't complete that (debug id …). Try again in a moment." |
| PayPal popup closed without approving (`onCancel`; UNVERIFIED, see above) | Banner "You closed PayPal before approving. Nothing was charged. Try again when you're ready." Button stays. |
| `onError` (UNVERIFIED, see above) | Banner "PayPal returned an error. Try again in a moment, or reload the page." |
| `onApprove` fired, authorize in flight | Interstitial replaces the button: heading "Approved. Placing the hold…", spinner, "Don't close this page. This takes a few seconds." |
| Authorize returns `200` | Refetch; the page shows `held` with the "Money held" copy. After SB-1 (4.6), a one-time toast: "Hold placed. {amount} is held, not charged." |
| Authorize answers `paypal_error` and the refetched deal has `payment.status = approved` with `payment.authorization_id` set (the authorization came back `PENDING`; 04 section 7.2, 02 section 7) | The "PayPal is reviewing the payment" panel below. `PAYMENT.AUTHORIZATION.CREATED` moves the deal to `held` when PayPal clears it (02 section 5.3). |
| Authorize answers `paypal_error` with `payment.authorization_id` still null (PayPal error, or the authorization came back `DENIED`; 04 section 7.2) | The "The hold wasn't confirmed" panel below, at once. No webhook will complete a denied authorization, so there is nothing to wait for. |
| Authorize fails for any other reason (network, 5xx) or the tab was closed after approval (SB-6) | On the next render with `payment.status = approved` and `authorization_id` null (or `created` after an `onApprove`), the recovery panel: heading "Approved. Confirming the hold…", helper from 7.4, button "Check again". The page polls every 5 s for 2 minutes; `CHECKOUT.ORDER.APPROVED` completes the hold server-side (E8). When the 2 minutes end with the deal still `terms_agreed`, the "The hold wasn't confirmed" panel replaces it. |

"The hold wasn't confirmed" panel: heading "The hold wasn't confirmed", helper "PayPal didn't confirm the hold. Try again, or cancel the deal. Nothing was charged.", then the PayPal button again (items 3 and 4 above) and "Cancel deal". It is shown only while `payment.authorization_id` is null. `createOrder` calls `start_payment`; with the stored order no longer `created`, C2 creates order `n + 1` under key `order-{code}-{n+1}` (E4).

"PayPal is reviewing the payment" panel: heading and helper from 7.4, buttons "Check again" (refetch) and "Cancel deal" (7.13; `cancel` voids the pending authorization, 02 section 5.1). No PayPal button: `start_payment` is `invalid_state` while a `PENDING` authorization is stored (02 sections 5.1 and 7), and a second order would make a second hold. The polling of 4.2 (a) runs for 2 minutes; when it stops, this panel stays with "Check again".

The PayPal order is created only when the button is clicked, never in advance (research/paypal.md "Implications" item 9).

### 7.7 Evidence upload (seller, `held`)

The form sits in the Proof card position (7.2 item 6). Top to bottom:

1. Heading from 7.4 ("Ship it, then add your proof" or "One more try").
2. Checklist "What your photos must show": the deal's conditions as a list with evidence-type tags. In fix mode, each condition that failed in attempt 1 is marked with the Fail icon and "Failed last time: {reason}".
3. Photos:
   - Label "Photos (up to 6)". Helper: "Clear and well lit, the whole item in frame." Plus, when the deal has the handwritten-code condition: "One photo must show the deal code {code} written by hand next to the item."
   - Button "Add photos" wrapping `<input type="file" accept="image/*" multiple>` (no `capture` attribute, so the OS sheet offers both camera and gallery).
   - Staged thumbnails in a 3-column grid, each labelled e1…e6 in order, with a "Remove" button and the resized size. Counter "3 of 6".
   - Every file is downscaled before staging with the `downscale(file, 1600, 0.85)` function in research/stack.md §9 "Browser image downscale" (long edge 1600 px, JPEG quality 0.85; B6). `createImageBitmap(file, { imageOrientation: 'from-image' })` applies EXIF rotation and the re-encode strips EXIF. If `downscale` throws (undecodable input such as HEIC in Chrome; HEIC handling on iOS Safari is UNVERIFIED in the research) the file is not staged and the row reads "Please choose a JPEG or PNG photo." The original file is never uploaded.
   - Listing-photo check: after downscaling, the staged blob is hashed in the browser (`crypto.subtle.digest('SHA-256', await blob.arrayBuffer())`, hex-encoded) and compared with every `reference_files[].sha256` (7.1). The server stores exactly the uploaded bytes, so the hashes are comparable. A match marks the thumbnail with the Fail icon and "This is one of the listing photos; remove it", and "Submit proof for checking" stays disabled until it is removed. This is a warning layer only; D8 on the server remains the guardrail, and the "Reuse listing photo" sample button stages its file with the check skipped so judges can see D8 fire.
   - A seventh file shows "Up to 6 photos." and is ignored. A resized blob over 2 MB (unlikely at 1600 px) shows "That photo is over 2 MB after resizing. Try a smaller one."
4. Tracking number: text input, label "Tracking number" (in demo mode the label carries a "Demo carrier (mock)" badge), `autocapitalize="characters"`. Required when a `tracking` condition exists; helper "Required for: {tracking condition text}". Demo mode adds: "Sandbox carrier: a number ending in an even digit shows as delivered, an odd digit as in transit." The live carrier status ("delivered", "in transit", "unknown") is shown under the field as the user types, using the pure function from 7.1.
5. Note: textarea, label "Note to the buyer (optional)", `maxLength` 1000 with counter. Helper: "Anything the buyer should know. Claude reads it as information, never as instructions."
6. Demo mode "Use sample evidence" row (section 12): one button per entry in the deal's preset `sets` (12.4), labelled from the set's `label` (today "Good", "Wrong item", "Blurry", "Reuse listing photo") with `data-testid` `use-sample-evidence-{setId}` (4.7); the buttons follow `presets.json`, not a fixed list, and the row is rendered only once the kit has loaded. Each replaces the staged list (the staged photos are cleared), stages the set's photos plus the canvas-composed code photo (12.3) from the same preset, and fills the tracking number with `TRK-DEMO-0000`. A line under the row says what each set is for. In fix mode the tracking number is prefilled from attempt 1 (04 section 9.1).
7. Button "Submit proof for checking" (primary, full width on mobile). Helper under it: "Submitting is final for this attempt. If a condition fails, you get one fix." In fix mode: "This is your last attempt."
   Disabled until: at least one photo when any `photo` condition exists; a tracking number when a `tracking` condition exists; no staged photo flagged by the listing-photo check.
8. On click: upload each staged file with `POST /api/deals/{code}/files` (multipart, `purpose=evidence`), each answering `201 FileRef`, with the live line "Uploading 2 of 4" (progress rings after SB-1, 4.6); then `POST /api/deals/{code}/evidence { file_ids, tracking_number, note }`. The verdict runs inside that request, which returns `200` with the final `DealView` (B5). An upload error stops before `evidence` is posted, keeps the staged files, and shows the error on the failed thumbnail.

### 7.8 Verdict wait screen

While `POST .../evidence` is in flight the Proof card becomes the wait screen:

- Heading "Checking your proof…".
- Three steps with a check mark as each completes: "Photos uploaded" → "Comparing photos with the terms" → "Applying the rule". The second step shows a pulsing dot and the elapsed seconds ("12 s").
- The conditions list, each with a pulsing dot that turns into the verdict icon when the response arrives.
- Line: "Usually under 15 seconds, at most about 40. Keep this page open. Nothing moves until this finishes." (B5: typically 6 to 12 s; about 40 s worst case with the PayPal calls.)
- `aria-live="polite"` region announcing step changes; no animation under `prefers-reduced-motion` (the dot is static).
- On `200`: render the Proof card with verdicts (7.9) and the "What happens next" card for the new status. Focus moves to the decision line.
- On `paypal_error` (04 section 9.1 step 6: the verdict ran but the capture or void call failed; the deal stays `proof_submitted`): refetch the deal, render the Proof card with the verdicts from the latest submission (empty if none were stored), and the line "PayPal couldn't complete the payment step (debug id {debug_id}). The result is saved; the payment step is retried automatically." The "What happens next" card shows the `proof_submitted` copy from 7.4.
- On a network failure or no response after 45 s (B5: the UI waits 45 s): "We lost the connection while checking. Reload to see the result. If the check could not finish, Handshake re-runs it at the next check (within 10 minutes) or when an operator runs it; nothing is charged until then." (B7, J2). Button "Reload".
- On `invalid_state` (double submit): the generic refetch from 4.4.

### 7.9 Verdict display

Inside each Proof card, after the photos, tracking and note:

Table "Verdict", one row per condition in `position` order:

| Column | Content |
| --- | --- |
| Result | Icon + word: Pass / Fail / Unclear |
| Condition | The condition text |
| Confidence | "92%" plus a short horizontal bar (width = confidence); `aria-label="Confidence 92 percent"` |
| Reason | The one-sentence `reason` as written by the model (or by the guardrail, D8) |
| Evidence used | Chips for each label in `Verdict.evidence_used` (7.1): `e1`…`e6` render the matching proof thumbnail of this attempt, `r1`…`r4` the matching listing thumbnail, `tracking` a chip "Tracking", `note` a chip "Note". Thumbnail chips open the full-size photo (`<a target="_blank">`; lightbox after SB-1, 4.6). An empty array (AI-failure or seeded row) shows "—"; a D8 guardrail row lists the matching evidence and reference labels, so it shows chips. |

Each row (desktop) or stacked card (mobile, same order) carries `data-testid="verdict-row"` (4.7).

Decision line under the table, with the Pass/Fail/Unclear icon of the outcome, keyed by `Submission.decision` and `Submission.decision_reason` (7.1):

| `decision` | `decision_reason` | Copy |
| --- | --- | --- |
| `capture` | `all_pass` | "All conditions passed with high confidence and the amount is within the auto-release limit, so the rule released the payment." |
| `request_fix` | `fail` | Seller: "{n} condition(s) failed. You can fix and resubmit once." Buyer: "{n} condition(s) failed. The seller has one chance to fix them." |
| `void` | `fail` | "{n} condition(s) clearly failed on the second attempt. The deal is voided and the hold released." (D9: a second-attempt fail voids only at confidence of at least `PASS_THRESHOLD`) |
| `buyer_review` | `unclear` | "Claude couldn't decide on {n} condition(s), so the buyer decides." (also the AI-failure case, D4) |
| `buyer_review` | `low_confidence` | "Claude's confidence was below the rule's threshold, so the buyer decides." |
| `buyer_review` | `fail` | "{n} condition(s) failed on the second attempt, but Claude wasn't confident enough to void the deal, so the buyer decides." (D9) |
| `buyer_review` | `amount_over_limit` | "Every condition passed. Deals above the auto-release limit always go to the buyer." |

Followed by one fixed line in small type: "The result and confidence come from Claude ({model}). The decision comes from a fixed rule in code, never from the model." where `{model}` is `verdicts[0].model` of the attempt; with no verdict rows the sentence omits the parenthesis.

Unclear rows produced by an AI failure, timeout, refusal or schema mismatch (D4) show whatever `reason` the server stored; the UI adds nothing.

### 7.10 Buyer review screen (`in_review`, buyer)

The "What happens next" card becomes the review screen:

1. Heading and helper from 7.4 for the latest attempt's `decision_reason` or the `payment.status === 'declined'` variant.
2. "Look at the proof": the latest attempt's photos at large size (3-column grid on desktop, 2-column on mobile; each an `<a target="_blank">`; swipeable strip and lightbox after SB-1, 4.6), the tracking line with carrier status, the note in a quoted block, the listing photos in a smaller grid titled "Compare with the listing photos".
3. The verdict table (7.9) for the latest attempt; unclear rows first.
4. Buttons: "Release payment" (primary) → confirm (4.5) → `POST /api/deals/{code}/review { "decision": "approve" }`; "Reject proof" (danger, secondary) → confirm → `{ "decision": "reject" }`. Both disabled while the other is in flight. Below: "If you do nothing, the hold is released automatically on {deadline}." (C5).
5. Errors: `paypal_error` and `invalid_state` per 4.4. After success the page refetches and shows `captured` or `voided`.

The seller sees the same sections 2 and 3 with the "Waiting for {buyer} to decide" heading and no buttons.

### 7.11 Events timeline

Card "Timeline", rows from `GET /api/deals/{code}/events` in ascending `id` (oldest first, so it reads as a story). Each row:

- Time (local, with UTC ISO in `title`).
- Actor badge: Buyer / Seller / System / PayPal / AI (`actor` from C6).
- Sentence from the table below; `cause` is exactly one of the C6 strings, so a value outside the table is shown raw (it means a bug, not a new cause).
- "{from_status} → {to_status}" in monospace with the pill labels in `title`.
- "Details" disclosure showing `payload` as pretty-printed JSON (PayPal ids, verdict ids, versions). Every `fact:*` payload also carries `source` (`"api"` or `"webhook"`) and `paypal_request_id` or `paypal_event_id`; the disclosure shows them as they are.

The `cause` list is decision C6, verbatim; the `actor` column is C6's. File uploads write no event.

| `cause` | `actor` | Sentence |
| --- | --- | --- |
| `create` | buyer | "Buyer created the deal from one sentence." |
| `edit_terms` | buyer | "Buyer edited the terms (now version {payload.terms_version})." |
| `join` | seller | "Seller joined." |
| `accept` | buyer or seller | "{Actor} accepted version {payload.terms_version}." |
| `start_payment` | buyer | "Buyer started PayPal checkout (order attempt {payload.order_attempt})." |
| `submit_evidence` | seller | "Seller submitted proof (attempt {payload.submission_no})." |
| `verdict` | ai | "Claude judged attempt {payload.submission_no}." |
| `decision:capture` | system | "Rule: release the payment." |
| `decision:request_fix` | system | "Rule: ask the seller for one fix." |
| `decision:buyer_review` | system | "Rule: ask the buyer to decide ({payload.reason})." |
| `decision:void` | system | "Rule: void the deal." |
| `review:approve` | buyer | "Buyer approved the proof." |
| `review:reject` | buyer | "Buyer rejected the proof." |
| `cancel` | buyer or seller | "{Actor} cancelled the deal." |
| `retry_payout` | seller | "Seller retried the payout (attempt {payload.attempt})." |
| `tick:deadline` | system | "The deadline passed; the hold was released." |
| `tick:reverify` | system | "The check was re-run after an interruption." |
| `fact:authorization_created` | paypal | "PayPal placed the hold." |
| `fact:late_authorization_voided` | paypal | "PayPal confirmed a hold after the deal closed; it was voided." |
| `fact:capture_completed` | paypal | "PayPal completed the capture." |
| `fact:capture_pending` | paypal | "PayPal is still processing the capture." |
| `fact:capture_declined` | paypal | "PayPal declined the capture." |
| `fact:authorization_voided` | paypal | "PayPal voided the hold." |
| `fact:payout_succeeded` | paypal | "PayPal paid the seller." |
| `fact:payout_failed` | paypal | "The payout failed ({payload.failure_reason})." |

`{Actor}` is "Buyer" or "Seller" from the row's `actor`.

### 7.12 Evidence pack download

Button "Download evidence pack (JSON)" in the footer actions (and in the Timeline card header on desktop). It navigates to `GET /api/deals/{code}/evidence-pack`, which answers with `Content-Disposition: attachment; filename="handshake-{code}-evidence-pack.json"`. Helper under the button: "Everything about this deal in one file: terms and versions, photo hashes, each verdict with its reason, PayPal ids, and the full timeline. Built from the database, so it can be reproduced." PDF export is not in this build (A5); the UI does not mention PDF.

### 7.13 Cancel deal

"Cancel deal" appears for buyer and seller in `draft`, `terms_agreed` and `held` (C2). It confirms (4.5) then calls `POST /api/deals/{code}/cancel`. After success the page shows `voided` with "The {buyer/seller} cancelled the deal."

### 7.14 Seeded sample deals

When `seeded` is true (F6) the deal header shows the "Sample deal" badge and the "What happens next" card starts with: "This is a seeded sample. It has events but no live PayPal hold, so payment actions are not available." The PayPal card is hidden. All other cards render as usual.

## 8. Page `/ledger`: all my deals

Purpose: one sortable, filterable table of every deal the user is buyer or seller of (FR-13, US-10), built on AG Grid Community (G3; research/ag-grid.md §5 "AG Grid React for the ledger").

Layout, top to bottom:

1. Header.
2. Title row: `h1` "Your deals", count "{n} deals", buttons "New deal" (primary) and "Open dashboard" (secondary, `/dashboard`).
3. Toolbar: `<input type="search" placeholder="Search deals">` bound to the grid's `quickFilterText`; a row of status chips (one per state, label from section 2, toggle) that sets the grid's status filter; "Clear filters" text button.
4. The grid in a container 560 px tall on desktop; on mobile the container is `calc(100vh - header - toolbar)` and the grid scrolls horizontally with the Code column pinned left.
5. Below the grid (mobile only): "Tip: tap a row to open the deal."

Grid: `AgGridProvider` with `AllCommunityModule`, `themeQuartz.withParams({ accentColor: 'var(--hs-accent)', fontFamily: 'var(--hs-font)', backgroundColor: 'var(--hs-surface)', foregroundColor: 'var(--hs-ink)', borderColor: 'var(--hs-border)', spacing: 6 })` so it inherits the tokens in section 1, `getRowId = code`, `onRowClicked` → `/deal/{code}`, `defaultColDef { sortable, filter, resizable }`, default sort `last_event_at` descending. The component itself is [09-ag-studio.md](09-ag-studio.md) section 4.3.

Columns, from `GET /api/deals` rows (`LedgerRow` in 09 section 4.1, plus `seeded`):

| Column | Field | Rendering |
| --- | --- | --- |
| Code | `code` | Link cell renderer to `/deal/{code}` (keyboard-accessible); pinned left |
| Item | `item_title` | Text, `flex: 1`; "Sample" badge when `seeded`, and the search box finds "sample" |
| Role | `role` | "Buyer" / "Seller" |
| Other party | `counterparty` | Display name or "—" |
| Amount | `amount_minor` | Money formatter; right-aligned; number filter |
| Status | `status` | `StatusPill` cell renderer; set filter via the chips |
| Deadline | `deadline_at` | Local date-time or "—" |
| Last event | `last_event_cause` | Timeline sentence from 7.11, else raw |
| Confidence | `lowest_confidence` | "92%" or "—" (lowest confidence of the latest attempt); hidden by default so the rest fit |
| Last activity | `last_event_at` | Relative time with ISO in `title` |

Below 640 px the grid shows Item, Amount and Status only; a tap on the row opens the deal.

Empty state (no rows): the grid is replaced by "No deals yet." and a "New deal" button. Loading: a skeleton of six rows. The row data is fetched on the server for first paint and refetched with "Refresh" (no polling).

## 9. Page `/dashboard`: your dashboard

Purpose: show the signed-in user's money and AI outcomes in AG Studio with a custom theme and one custom widget (G3). This section defines only the page shell; the dashboard itself is [09-ag-studio.md](09-ag-studio.md) section 5 (layout, the three sources, the nine widgets, the theme, `mode="edit"`, the client-side fetch of `GET /api/dashboard/data`, the `deal-pipeline` custom widget) and the agent is 09 section 6. 09 is the only place those are specified.

Layout:

1. Header.
2. Title row: `h1` "Your dashboard", sub-line "Your deals as buyer or seller, including seeded samples. No names or emails." Button: "Your ledger" (`/ledger`).
3. The Studio canvas filling the rest of the viewport (`height: calc(100vh - header - title)`), rendered by `DashboardClient` from 09 section 5.1. While it loads: the text "Loading dashboard…" in the first pass (4.6), the `DashboardSkeleton` of 09 after SB-1.

Data scope: `GET /api/dashboard/data` returns only deals where the caller is buyer or seller (04 section 14, 09 section 5.2; the F4 access rule), so no deal code, amount or status of a stranger ever reaches the browser. The seeded deals are between the two demo personas, so either persona sees all of them.

Licence: a missing or expired `AG_GRID_LICENSE_KEY` shows AG Grid's own fading watermark and a console banner but does not disable features (research/ag-grid.md "Summary"). The page adds no copy about it.

## 10. Page `/me`: profile

Purpose: let a user set the two fields the deal flow needs (F7).

Layout: header; `h1` "Your profile"; a single card:

- "Email" read-only line (`email` from `GET /api/me`).
- "Display name" text input, `maxLength` 60 (04 section 1.3), helper "Shown to the other party instead of your email."
- "PayPal email" `<input type="email">`, helper "Where you're paid when you sell. Required before you can accept a deal as seller. In the sandbox, use the seller test account's email from the README." Demo seller: prefilled from `DEMO_SELLER_PAYPAL_EMAIL`.
- Button "Save" → `PATCH /api/me { display_name, paypal_email }`. Success: the line "Saved." under the button (a toast after SB-1, 4.6). Error `invalid_input` → "Enter a valid email address." under the field.
- Divider, then "Sign out" (secondary) → `POST /api/auth/sign-out` → `/`.

If the page was reached from a `paypal_email_required` prompt (`/me?next=/deal/HS-XXXX`), "Save" returns to `next`.

## 11. Accessibility basics

These are requirements, not suggestions.

- Every input has a visible `<label>`; helper and error text are linked with `aria-describedby`; invalid fields set `aria-invalid`.
- Visible focus ring in the accent colour on every interactive element, including AG Grid cells and the lightbox controls.
- Text contrast at least 4.5:1; status pills, verdict icons and chips also meet it; the pulsing dot has a static fallback.
- Status and verdict are never colour-only: icon plus word everywhere (section 2).
- Images: listing photos `alt="Listing photo {n}"`, proof photos `alt="Proof photo {n}, attempt {submission_no}"`, the composed code photo `alt="Handwritten deal code {code}"`.
- Dialogs use `role="dialog"`, `aria-modal`, trap focus, close on Escape and return focus to the trigger.
- The wait screen and action banners use `aria-live="polite"`; the "Hold placed" toast uses `role="status"`.
- Touch targets at least 44 px tall on mobile; the sticky bottom bar never covers the last focusable element (page gets bottom padding equal to the bar's height).
- `prefers-reduced-motion`: no pulsing, no slide transitions; progress is shown with text and static icons.
- The PayPal button is a third-party iframe; the card gives it a heading so screen-reader users know what it is for.
- Keyboard: every row in the ledger is reachable through the Code link; the grid itself supports arrow-key navigation (AG Grid default).

## 12. Demo kit (`public/demo/`)

Purpose: let a judge run every path without owning photos (F5). The kit is shown only when `DEMO_LOGIN=true`. The README discloses that the sample photos, the composed code photo and the carrier status are demo aids.

This section is the kit's definition; [01-requirements.md](01-requirements.md) FR-20 and [07-setup-deployment.md](07-setup-deployment.md) section 1 point here. Three presets, each one item with its own price, deadline, listing photos and evidence set, so the judge walkthrough, the README and this document describe one kit.

| Preset `id` | Item | Sentence price and deadline | Paired evidence set | Path it shows |
| --- | --- | --- | --- | --- |
| `mug` | Blue ceramic mug | $18, 5 days | `good` (and `reuse-listing`) | `capture` → `captured` → `paid` |
| `lamp` | Wooden desk lamp | $35, 7 days | `wrong-item` | `request_fix`, then `void` |
| `bottle` | 1 L stainless steel water bottle | $22, 7 days | `blurry` | `buyer_review` → `in_review` |

Two extras reuse the mug's photos: `mug-over-limit` ($250; `buyer_review` with reason `amount_over_limit`) and `mug-subjective` ($45 with "looks nice"; shows the rejected-conditions block on `/new`). The items are three of the six to eight household objects photographed for the eval set (D12) and may be swapped as long as the sentences and photos change together and the file names stay.

### 12.1 Files

| Path | What it is | Used by |
| --- | --- | --- |
| `public/demo/presets.json` | Presets, extras, sample sets, tracking number, code-photo boxes (12.2) | `/new` chips, "Use sample" buttons |
| `public/demo/reference/{mug,lamp,bottle}/ref-1.jpg`, `ref-2.jpg` | Two listing photos per preset (our own photos, 1600 px long edge) | "Use sample listing photos" |
| `public/demo/reference/{mug,lamp,bottle}/code-base.jpg` | The preset's own item beside a blank paper note card, 1600 px long edge | Canvas composition (12.3) |
| `public/demo/evidence/good/photo-1.jpg`, `photo-2.jpg` | The mug, new angles, different background, clearly not the listing photos | "Good" |
| `public/demo/evidence/wrong-item/photo-1.jpg`, `photo-2.jpg` | A different desk lamp (other colour and shape) | "Wrong item" |
| `public/demo/evidence/blurry/photo-1.jpg` | The bottle, motion-blurred and partly out of frame | "Blurry" |
| `public/demo/fonts/handwriting.woff2` | Caveat, regular 400, Latin subset (SIL OFL 1.1) | Canvas composition |
| `public/demo/fonts/OFL.txt` | The OFL licence text that must accompany the font | Disclosure |

Obtaining the font without adding a dependency: `cd /tmp && npm pack @fontsource/caveat`, unpack, copy `files/caveat-latin-400-normal.woff2` to `public/demo/fonts/handwriting.woff2` and the package's `LICENSE` (the OFL text) to `public/demo/fonts/OFL.txt`; commit both. The README "Disclosures" names the font and its licence.

### 12.2 `presets.json`

The photos are path-traced renders from `scripts/demo/photo-studio/`; see `public/demo/README.md`.

```json
{
  "tracking_number": "TRK-DEMO-0000",
  "font": "/demo/fonts/handwriting.woff2",
  "presets": [
    {
      "id": "mug",
      "label": "$18 mug, 5 days",
      "sentence": "I'll pay $18 for the blue ceramic mug if it arrives within 5 days, matches the listing photos and tracking shows delivered",
      "reference": ["/demo/reference/mug/ref-1.jpg", "/demo/reference/mug/ref-2.jpg"],
      "code_photo": { "base": "/demo/reference/mug/code-base.jpg", "box": { "x": 880, "y": 620, "w": 560, "h": 220, "angle": -0.04 } },
      "sets": {
        "good":          { "label": "Good",                "purpose": "Every condition passes; the payment is released.", "photos": ["/demo/evidence/good/photo-1.jpg", "/demo/evidence/good/photo-2.jpg"] },
        "reuse-listing": { "label": "Reuse listing photo", "purpose": "A listing photo as proof; fails without a model call.", "photos": ["/demo/reference/mug/ref-1.jpg"], "skip_listing_check": true }
      }
    },
    {
      "id": "lamp",
      "label": "$35 lamp, 7 days",
      "sentence": "I'll pay $35 for the wooden desk lamp if it arrives within 7 days, matches the listing photos and tracking shows delivered",
      "reference": ["/demo/reference/lamp/ref-1.jpg", "/demo/reference/lamp/ref-2.jpg"],
      "code_photo": { "base": "/demo/reference/lamp/code-base.jpg", "box": { "x": 860, "y": 640, "w": 560, "h": 220, "angle": 0.03 } },
      "sets": {
        "wrong-item": { "label": "Wrong item", "purpose": "A different lamp; one fix is requested, a second failure voids.", "photos": ["/demo/evidence/wrong-item/photo-1.jpg", "/demo/evidence/wrong-item/photo-2.jpg"] }
      }
    },
    {
      "id": "bottle",
      "label": "$22 bottle, 7 days",
      "sentence": "I'll pay $22 for the 1 L stainless steel water bottle if it arrives within 7 days, matches the listing photos and tracking shows delivered",
      "reference": ["/demo/reference/bottle/ref-1.jpg", "/demo/reference/bottle/ref-2.jpg"],
      "code_photo": { "base": "/demo/reference/bottle/code-base.jpg", "box": { "x": 900, "y": 600, "w": 540, "h": 220, "angle": -0.02 } },
      "sets": {
        "blurry": { "label": "Blurry", "purpose": "Unreadable proof; the buyer decides.", "photos": ["/demo/evidence/blurry/photo-1.jpg"] }
      }
    }
  ],
  "extras": [
    { "id": "mug-over-limit", "label": "$250 mug (over the auto-release limit)", "preset": "mug",
      "sentence": "I'll pay $250 for the blue ceramic mug if it arrives within 5 days, matches the listing photos and tracking shows delivered" },
    { "id": "mug-subjective", "label": "$45 mug, subjective wording", "preset": "mug",
      "sentence": "I'll pay $45 for the blue ceramic mug if it arrives within 5 days, matches the listing photos and looks nice" }
  ]
}
```

```ts
type Box = { x: number; y: number; w: number; h: number; angle: number };
type SampleSet = { label: string; purpose: string; photos: string[]; skip_listing_check?: true };
type Preset = { id: string; label: string; sentence: string; reference: string[]; code_photo: { base: string; box: Box }; sets: Record<string, SampleSet> };
type Extra = { id: string; label: string; sentence: string; preset: string };   // preset = the Preset whose photos it uses
type Presets = { tracking_number: string; font: string; presets: Preset[]; extras: Extra[] };
```

`box` is the pixel rectangle of the blank note card inside that preset's `code-base.jpg` and the rotation in radians; it changes only if the base photo is re-shot. Every sentence states the price and the deadline, so extraction fills `amount_minor` and `deadline_days` and step 2 of `/new` never has to ask.

### 12.3 Canvas-composed code photo

Deal codes are generated per deal (I4), so the handwritten-code photo is composed in the browser from the preset's base photo and the deal code (F5). Every sample set adds it as the last photo.

```ts
export async function composeCodePhoto(code: string, m: Preset['code_photo'], font: string): Promise<Blob> {
  const face = new FontFace('HsHand', `url(${font})`);
  document.fonts.add(await face.load());
  const img = await createImageBitmap(await (await fetch(m.base)).blob());
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.translate(m.box.x + m.box.w / 2, m.box.y + m.box.h / 2);
  ctx.rotate(m.box.angle);
  ctx.font = `${Math.floor(m.box.h * 0.55)}px HsHand`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1b1b1b';
  ctx.fillText(code, 0, 0, m.box.w * 0.9);
  img.close();
  return new Promise((ok, fail) => c.toBlob(b => (b ? ok(b) : fail(new Error('encode failed'))), 'image/jpeg', 0.85));
}
```

The blob goes through the same staging and upload path as a chosen file (it is already 1600 px and JPEG, so `downscale` is a no-op on it).

### 12.4 Which preset a deal belongs to, and what each sample triggers

The sample buttons on a deal page always use the photos of the preset the deal was created with. The page finds it without any client-side storage: `DealView.source_text` (7.1) is compared with every `presets[].sentence` and `extras[].sentence` after trimming; an extra resolves to its `preset`. When nothing matches (the judge edited the sentence or typed their own) the `mug` preset is used. The chip on `/new` carries `data-preset` for the same id so the "Use sample listing photos" button in 6.3 can use it before the deal exists. This works across browser contexts, which the e2e test in [06-test-plan.md](06-test-plan.md) needs (the seller runs in a second context).

With "Use sample listing photos" at creation and the preset's paired set:

| Preset, button | Photos staged | Tracking | Expected verdicts | Rule outcome | Status after |
| --- | --- | --- | --- | --- | --- |
| `mug`, Good | good/1, good/2, mug code photo | `TRK-DEMO-0000` (delivered) | all `pass` | `capture` | `captured` → `paid` |
| `lamp`, Wrong item | wrong-item/1, wrong-item/2, lamp code photo | same | "matches the listing photos" `fail` | `request_fix` (attempt 1); attempt 2: `void` when the fail's confidence is at least `PASS_THRESHOLD`, otherwise `buyer_review` (D9) | `held` → then `voided` (or `in_review`) |
| `bottle`, Blurry | blurry/1, bottle code photo | same | item condition `unclear` | `buyer_review` (reason `unclear`) | `in_review` |
| `mug`, Reuse listing photo | mug ref-1 (byte-identical; the client check in 7.7 is skipped), mug code photo | same | every photo condition `fail` at confidence 1 without a model call (D8) | `request_fix` (attempt 1) / `void` (attempt 2; D9: D8 rows always void) | `held` / `voided` |
| `mug-over-limit`, Good | as `mug`, Good | same | all `pass` | `buyer_review` (reason `amount_over_limit`; `AUTO_CAPTURE_MAX_MINOR` is 20000) | `in_review` |

`mug-subjective` shows the rejected-conditions block on `/new` ("looks nice" is subjective; the suggestion is checkable) and then behaves as `mug`. Typing a tracking number ending in an odd digit (for example `TRK-DEMO-0001`) shows "in transit" and leads to an `unclear` tracking verdict and `buyer_review`.

## 13. Non-goals

The UI does not include: a PDF evidence pack (A5), any dispute screen (A5), seller ratings or identity badges, a notifications centre or in-app chat, push or real-time updates beyond the polling in 4.2, a dark-mode toggle, localisation, image cropping or editing, reordering of staged photos, deletion of uploaded files, an admin console, a public deal page for signed-out visitors, currencies other than USD, or a native app.

## Assumptions

Choices made here because `docs/decisions.md` does not settle them:

1. The deal page is coded against the `DealView`, `DealPreview` and `DealEvent` types of 04 section 3 verbatim (7.1). Photo labels, the latest attempt, the latest payout and the preview are derived in the component; the seller's own PayPal address is `seller.paypal_email`, which 04 fills only for the seller.
2. Buyer-review and decision-line copy is keyed on `Submission.decision_reason` (04 section 3 `DecisionReason`: `all_pass`, `fail`, `unclear`, `low_confidence`, `amount_over_limit`). An AI failure is `unclear`; there is no separate reason value for it in the type, so the UI has no copy for one.
3. The deal page does not call `GET /api/me`; the header's name comes from the session user read on the server (4.2) and the seller's PayPal address from `seller.paypal_email`. `Me` is used only by `/me` (section 10).
4. `POST /api/deals` returns `201` with the draft `DealView` plus a `rejected: [{ text, suggestion }]` array that is not persisted.
5. `PATCH /api/deals/{code}/terms` takes `{ item_title, amount_minor, deadline_days, conditions: [{ text, evidence_type }] }` (04 section 6.4), no version field; the server strips and re-appends its code condition. A stale accept is caught by `accept`'s `terms_version_mismatch`.
6. `POST /api/deals/{code}/accept` takes `{ terms_version }`; `POST /api/deals/{code}/payment` returns `{ order_id }`; `POST /api/deals/{code}/payment/authorize` takes `{ order_id }`; `POST /api/deals/{code}/evidence` takes `{ file_ids, tracking_number, note }`; `POST /api/deals/{code}/review` takes `{ decision: "approve" | "reject" }`; `cancel`, `join` and `payout/retry` take no body.
7. `POST /api/deals/{code}/files` responds `201 FileRef` (04 section 3).
8. `GET /api/deals` rows are `LedgerRow` from 09 section 4.1 plus `seeded`; the ledger's default sort is `last_event_at` descending.
9. `GET /api/dashboard/data` returns 09 section 5.2's `DashboardData` for the caller's deals only; this document specifies only the `/dashboard` page shell.
10. The evidence pack is served as an attachment named `handshake-{code}-evidence-pack.json` and includes file `sha256` values, not file bytes.
11. The buyer accepts at the end of `/new` ("Accept terms and get link"); accepting again on the deal page is possible after an edit.
12. Staged files are uploaded only on "Accept terms and get link" / "Submit proof for checking", because H1 has no file-delete endpoint.
13. The demo kit UI (sentence chips, sample buttons, sandbox notes) is shown only when `DEMO_LOGIN=true`; the pure carrier function lives in `lib/carrier.ts` and is imported by the browser.
14. `deal_events.cause` is exactly one of the C6 strings; the timeline table in 7.11 is keyed on the full string and shows anything else raw.
15. Seeded deals (F6) are between the two demo users so they appear in both personas' ledgers; their `payment` is `null`.
16. The demo kit is defined in section 12 (`presets.json`, `reference/<preset>/`); 01 FR-20 and 07 section 1 point here. It is three presets plus two extras that reuse the mug's photos. A deal's preset is found by comparing `source_text` with the preset sentences; no `sessionStorage` is used, because the e2e seller runs in a second browser context.
17. Polling intervals (5 s, 2-minute cap) are UI choices; the 45 s client wait on the evidence request is B5.
18. "Edit terms" in `terms_agreed` is shown only while `payment` is `null` (02 section 5.1); after that "Cancel deal" is the way out.
19. The `voided` helper and the ledger never key on the last event; the void cause is the first event with `to_status = 'voided'` and `from_status !== 'voided'`.
20. After a denied or unconfirmed authorization (`payment.authorization_id` null) the buyer gets the PayPal button back ("The hold wasn't confirmed" panel, 7.6); the next `start_payment` creates order `n + 1` (C2, E4). A `PENDING` authorization (`authorization_id` set, `payment.status = approved`) shows only "Check again" and "Cancel deal", because `start_payment` is `invalid_state` then (02 section 7).
21. The listing-photo check in 7.7 hashes the downscaled blob with `crypto.subtle` and compares it with `reference_files[].sha256`; it is a warning layer, and D8 on the server stays the guardrail.
22. The handwriting font is Caveat (SIL OFL 1.1) taken from the `@fontsource/caveat` npm package without adding a dependency; the OFL text is committed beside it.
23. The first-pass / after-SB-1 split in 4.6 and the `data-testid` hooks in 4.7 (named in 06) are part of this specification; `deal-status` is a hidden span with the raw status so the e2e test can read it while the pill shows the label.
24. The CSS tokens are exactly the names 09 section 5.5 lists, defined in `app/globals.css` (section 1); `STATUS_LABEL` in `lib/status-labels.ts` holds the section 2 labels, with `captured` as "Payment released".
