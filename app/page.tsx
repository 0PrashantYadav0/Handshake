// / : the landing page (trust spec §11). Sign-in lives at /signin; signed-in visitors get dashboard links instead.
// Server component, no client JS: the FAQ is native <details>, anchors scroll with CSS.
import Link from "next/link";
import { currentUser } from "@/lib/auth/current";
import { StatusPill } from "@/components/StatusPill";

const REPO = "https://github.com/0PrashantYadav0/Handshake";

const STEPS = [
  ["Describe the deal", "The buyer writes one sentence. Claude turns it into two to five conditions that a photo or a tracking number can prove, and flags anything too vague to check."],
  ["Both sign, PayPal holds", "Buyer and seller each sign the exact terms on their own device. The buyer approves a PayPal authorization: the money is held, not charged."],
  ["The seller proves it", "Photos, a tracking number and the deal code written by hand. Claude judges each condition as pass, fail or unclear, with a reason."],
  ["The rule decides", "Fixed code releases the payment, asks for one fix, hands an uncertain call to the buyer, or voids the hold so the money goes back."],
] as const;

const TRUST = [
  ["Held, not charged", "PayPal authorizes the buyer's payment and holds it. Nothing is captured until the rule releases it. If the deadline passes without accepted proof, the hold is voided automatically."],
  ["Two-step sign-in for every account", "An email link, then a six-digit code from an authenticator app. Signing a contract or changing a payout email asks for a fresh code."],
  ["Both parties sign the exact terms", "Each browser makes its own ECDSA P-256 signing key, and the private key never leaves the device. Change one word and the signatures stop matching. Anyone can check them offline from the downloaded contract."],
  ["Encrypted in transit and at rest", "HTTPS everywhere. The deal sentence, conditions, tracking notes and photos are stored with AES-256-GCM, so a database copy or backup shows only ciphertext. Only the two parties and the verifier inside the app can read the contract."],
  ["Checked again before money moves", "Before every PayPal step (creating the order, authorizing, capturing, paying out) the server rebuilds the contract and verifies both signatures. If anything was altered, no money moves."],
  ["A full audit trail", "Every step is logged with who did it, why, and the PayPal ids behind it. Download it with the photos and verdicts as an evidence pack."],
] as const;

const RULE = [
  ["A condition fails on the first try", "ask the seller for one fix"],
  ["A confident fail on the second try", "void the hold"],
  ["An unsure fail on the second try", "the buyer decides"],
  ["Anything unclear or under 0.85 confidence", "the buyer decides"],
  ["The deal is over $200", "the buyer decides"],
  ["Every condition passes", "release the payment"],
] as const;

const BUYERS = [
  "Your money stays in your PayPal account as a hold until the proof checks out.",
  "You set the conditions in plain words. Anything too vague to check is flagged before anyone signs.",
  "No proof by the deadline? The hold is voided and the money is yours again. There is no dispute to file.",
  "When the AI is unsure, you make the call, with the photos and its reasons in front of you.",
];

const SELLERS = [
  "The buyer's money is held before you ship, so you know it is there.",
  "Prove delivery with photos and a tracking number instead of waiting for a reply.",
  "If a photo misses a condition, you get one chance to fix the submission.",
  "Paid through PayPal Payouts to the PayPal email you confirmed with a code.",
];

const FAQ = [
  ["What if the seller never ships?", "Nothing is charged. When the deadline passes (at most 21 days after the hold), a job that runs every 10 minutes voids the authorization and PayPal releases the hold on the buyer's money."],
  ["What if the AI is unsure?", "An unclear verdict, or any confidence below 0.85, never releases money on its own. The deal goes to the buyer, who sees the photos, the conditions and Claude's reasons, then releases the payment or rejects the proof. Deals over $200 always go to the buyer."],
  ["When is my money actually taken?", "Only when the payment is released: either the rule captures the hold after every condition passes, or you release it yourself in review. Until then your PayPal account shows an authorization hold, not a charge."],
  ["What if the item is wrong?", "The first failed check asks the seller for one fix. On the second try, a confident failure voids the hold and the money goes back to the buyer; a less certain one goes to the buyer to decide."],
  ["How do sellers get paid?", "After the payment is captured, Handshake sends the amount to the seller through PayPal Payouts, only to a payout email the seller has confirmed with a code. In this sandbox build Handshake is the merchant of record; a production build would use PayPal's multiparty onboarding so the seller is paid directly."],
  ["Is this real money?", "No. Handshake runs on the PayPal sandbox only. Accounts, holds, captures and payouts are test objects, and no real money moves."],
  ["What data is stored, and how is it protected?", "Your email, name and payout email, and for each deal the sentence, conditions, photos, tracking number, verdicts and an event log. The contract text, photos, tracking notes, verdict reasons and your authenticator secret are encrypted at rest with AES-256-GCM. Amounts, statuses, dates, emails and PayPal ids stay readable because the ledger and PayPal need them."],
  ["Is it end-to-end encrypted?", "Not in the zero-knowledge sense. The app has to read the terms to check the proof against them. Everything is encrypted in transit and at rest, and only the two parties and the verifier inside the app can read the contract. PayPal sees the item title in the order description."],
] as const;

const CONDITIONS = [
  ["Mug is blue ceramic and matches the listing photos", "0.96"],
  ["Tracking shows delivered", "1.00"],
  ["Photo shows the deal code HS-7Q2K written by hand", "0.93"],
] as const;

function Actions({ signedIn, anchor }: { signedIn: boolean; anchor: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      {signedIn ? (
        <>
          <Link href="/dashboard" className="hs-btn">Go to your dashboard</Link>
          <Link href="/new" className="hs-btn-secondary">New deal</Link>
        </>
      ) : (
        <>
          <Link href="/signin?next=/new" className="hs-btn">Start a deal</Link>
          {anchor && <a href="#how" className="hs-btn-secondary">See how it works</a>}
        </>
      )}
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-1 h-4 w-4 shrink-0 text-[var(--hs-accent)]">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

// The hero illustration: a real-looking deal from the demo presets, sentence to verdicts to outcome.
function DealSlip() {
  return (
    <figure className="hs-card relative overflow-hidden p-0 md:p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--hs-border)] px-5 py-3 text-sm">
        <span className="font-mono text-[var(--hs-muted)]">HS-7Q2K</span>
        <StatusPill status="captured" />
      </div>
      <div className="px-5 py-5">
        <blockquote className="hs-display text-xl leading-snug md:text-2xl">
          &ldquo;I&rsquo;ll pay $18 for the blue ceramic mug if it arrives within 5 days, matches the listing photos and tracking shows delivered.&rdquo;
        </blockquote>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--hs-muted)]">
          <span className="inline-flex items-center gap-1.5"><Check />Signed by buyer</span>
          <span className="inline-flex items-center gap-1.5"><Check />Signed by seller</span>
          <span className="inline-flex items-center gap-1.5"><Check />$18.00 held by PayPal</span>
        </p>
        <ul className="mt-5 grid gap-2.5 border-t border-[var(--hs-border)] pt-4 text-sm">
          {CONDITIONS.map(([text, conf]) => (
            <li key={text} className="flex items-start gap-3">
              <span className="hs-verdict mt-px" data-result="pass" aria-hidden>✓</span>
              <span className="flex-1">{text}</span>
              <span className="tabular-nums text-[var(--hs-muted)]"><span className="sr-only">Pass, confidence </span>{conf}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="border-t border-[var(--hs-border)] bg-[var(--hs-bg)] px-5 py-3 text-sm text-[var(--hs-muted)]">
        Every condition passed, so the rule released $18.00 to the seller.
      </figcaption>
    </figure>
  );
}

export default async function Home() {
  const me = await currentUser();
  const signedIn = me !== null;
  return (
    <>
      <main>
        <section aria-labelledby="hero-h" className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
          <div>
            <h1 id="hero-h" className="text-6xl md:text-8xl">Pay on proof.</h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-[var(--hs-muted)] md:text-xl">
              Describe the deal in one sentence. PayPal holds the buyer&rsquo;s money, Claude checks the seller&rsquo;s photos and tracking against what you both signed, and a fixed rule in code releases the payment or sends it back.
            </p>
            <div className="mt-8">
              <Actions signedIn={signedIn} anchor />
            </div>
            <p className="hs-help mt-4">
              {signedIn ? `Signed in as ${me.display_name ?? me.email}.` : "PayPal sandbox only: no real money moves."}
            </p>
          </div>
          <DealSlip />
        </section>

        <section id="how" aria-labelledby="how-h" className="scroll-mt-6 border-t border-[var(--hs-border)]">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
            <h2 id="how-h" className="hs-display text-3xl md:text-4xl">How it works</h2>
            <p className="mt-3 max-w-prose text-[var(--hs-muted)]">Four steps from a sentence to a released payment. Nobody has to trust the other side&rsquo;s word.</p>
            <ol className="mt-10 grid gap-8 lg:grid-cols-4 lg:gap-6">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="relative pl-14 lg:pl-0 lg:pt-14">
                  {i < STEPS.length - 1 && (
                    <span aria-hidden className="absolute bottom-[-2rem] left-5 top-10 w-px bg-[var(--hs-border)] lg:bottom-auto lg:left-10 lg:right-[-1.5rem] lg:top-5 lg:h-px lg:w-auto" />
                  )}
                  <span aria-hidden className="hs-display absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--hs-accent)] bg-[var(--hs-surface)] text-xl leading-none text-[var(--hs-accent)]">{i + 1}</span>
                  <h3 className="font-semibold"><span className="sr-only">Step {i + 1}: </span>{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--hs-muted)]">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="trust" aria-labelledby="trust-h" className="scroll-mt-6 border-y border-[var(--hs-border)] bg-[var(--hs-surface)]">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 md:px-8 md:py-20 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div>
              <h2 id="trust-h" className="hs-display text-3xl md:text-4xl">The AI judges. Code moves the money.</h2>
              <p className="mt-4 max-w-prose leading-relaxed text-[var(--hs-muted)]">
                Claude only answers pass, fail or unclear for each condition. It cannot capture, void or pay anyone. This rule, unit-tested line by line, is the only path from a verdict to PayPal.
              </p>
              <figure className="mt-8 overflow-hidden rounded-[var(--hs-radius)] bg-[var(--hs-ink)] text-[var(--hs-bg)]">
                <figcaption className="border-b border-white/10 px-5 py-3 text-sm text-white/70">The decision rule, in order</figcaption>
                <dl className="grid gap-3 px-5 py-4 text-sm">
                  {RULE.map(([when, then]) => (
                    <div key={when} className="grid gap-0.5 sm:grid-cols-[1fr_auto] sm:gap-4">
                      <dt className="text-white/75">{when}</dt>
                      <dd className="font-medium text-[color-mix(in_srgb,var(--hs-accent)_45%,white)]">{then}</dd>
                    </div>
                  ))}
                </dl>
              </figure>
            </div>
            <ul className="grid content-start gap-x-10 gap-y-8 sm:grid-cols-2">
              {TRUST.map(([title, body]) => (
                <li key={title} className="border-t-2 border-[var(--hs-accent)] pt-4">
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--hs-muted)]">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="sides-h" className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <h2 id="sides-h" className="hs-display text-3xl md:text-4xl">Fair to both sides</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {([["buyers-h", "For buyers", BUYERS], ["sellers-h", "For sellers", SELLERS]] as const).map(([id, title, items]) => (
              <section key={id} aria-labelledby={id} className="hs-card md:p-8">
                <h3 id={id} className="hs-display text-2xl">{title}</h3>
                <ul className="mt-5 grid gap-3.5">
                  {items.map((t) => (
                    <li key={t} className="flex gap-3 leading-relaxed"><Check />{t}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-h" className="scroll-mt-6 border-t border-[var(--hs-border)]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-8 md:py-20 lg:grid-cols-[1fr_2fr] lg:gap-16">
            <h2 id="faq-h" className="hs-display text-3xl md:text-4xl">Questions</h2>
            <div className="divide-y divide-[var(--hs-border)] border-y border-[var(--hs-border)]">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
                    {q}
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden className="h-4 w-4 shrink-0 text-[var(--hs-accent)] transition-transform group-open:rotate-45">
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                  </summary>
                  <p className="max-w-prose pb-5 leading-relaxed text-[var(--hs-muted)]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-h" className="border-t border-[var(--hs-border)] bg-[var(--hs-surface)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 md:flex-row md:items-center md:justify-between md:px-8">
            <div>
              <h2 id="cta-h" className="hs-display text-3xl">{signedIn ? "Pick up where you left off." : "Try a deal in the sandbox."}</h2>
              <p className="mt-2 text-[var(--hs-muted)]">Sign-in takes an email link and a code from your authenticator app.</p>
            </div>
            <Actions signedIn={signedIn} anchor={false} />
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-sm text-[var(--hs-muted)] md:px-8">
        <span className="font-medium text-[var(--hs-ink)]">Sandbox only. No real money.</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <a className="hs-link" href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
          <a className="hs-link" href={`${REPO}#readme`} target="_blank" rel="noreferrer">README</a>
          {!signedIn && <Link className="hs-link" href="/signin">Sign in</Link>}
        </nav>
      </footer>
    </>
  );
}
