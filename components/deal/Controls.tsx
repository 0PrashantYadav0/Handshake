"use client";
// Small deal-page controls (08 sections 7.5, 7.13, 6.4): Join, Accept terms (+ PayPal email form), Cancel deal, Copy.
import { useState, useSyncExternalStore } from "react";
import type { DealView } from "@/lib/deal/types";
import { api, ApiError } from "@/lib/client-api";
import { money } from "@/lib/ledger-columns";

type Done = (d: DealView) => void;
type Fail = (e: unknown) => void;

function useBusy(fail: Fail) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, onError: Fail = fail) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

export function Join({ code, onDone, fail }: { code: string; onDone: Done; fail: Fail }) {
  const [busy, run] = useBusy(fail);
  return (
    <button type="button" data-testid="join" className="hs-btn" disabled={busy} onClick={() => run(async () => onDone(await api(`/api/deals/${code}/join`, { method: "POST" })))}>
      {busy ? "Joining…" : "Join as seller"}
    </button>
  );
}

export function AcceptTerms({ deal, onDone, fail }: { deal: DealView; onDone: Done; fail: Fail }) {
  const [busy, run] = useBusy(fail);
  const [needEmail, setNeedEmail] = useState(deal.role === "seller" && !deal.seller?.has_paypal_email);
  const [email, setEmail] = useState("");
  const accept = () =>
    run(
      async () => onDone(await api(`/api/deals/${deal.code}/accept`, { json: { terms_version: deal.terms_version } })),
      (e) => (e instanceof ApiError && e.code === "paypal_email_required" ? setNeedEmail(true) : fail(e)),
    );
  if (!needEmail) {
    return (
      <button type="button" data-testid="accept-terms" className="hs-btn" disabled={busy} onClick={accept}>
        {busy ? "Accepting…" : "Accept terms"}
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        void run(async () => {
          await api("/api/me", { method: "PATCH", json: { paypal_email: email } });
          await accept();
        });
      }}
    >
      <label htmlFor="paypal_email" className="hs-label">PayPal email</label>
      <input id="paypal_email" type="email" required className="hs-input" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="paypal_email-help" />
      <p id="paypal_email-help" className="hs-help">Where you&apos;re paid when the proof passes. In the sandbox use the seller test account&apos;s email from the README. You can change it later on your profile.</p>
      <button type="submit" data-testid="accept-terms" className="hs-btn self-start" disabled={busy}>{busy ? "Accepting…" : "Save and accept"}</button>
    </form>
  );
}

// ponytail: window.confirm carries the 08 section 4.5 sentence; the focus-trapping dialog is post-SB-1 (4.6).
export function CancelDeal({ deal, onDone, fail }: { deal: DealView; onDone: Done; fail: Fail }) {
  const [busy, run] = useBusy(fail);
  const sentence = deal.status === "held"
    ? `The hold of ${money(deal.amount_minor)} on the buyer's PayPal is released. This can't be undone.`
    : "No money is held. The deal is closed for both of you. This can't be undone.";
  return (
    <button
      type="button"
      className="hs-btn-danger"
      disabled={busy}
      onClick={() => window.confirm(`Cancel this deal?\n\n${sentence}`) && run(async () => onDone(await api(`/api/deals/${deal.code}/cancel`, { method: "POST" })))}
    >
      {busy ? "Cancelling…" : "Cancel deal"}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", className = "hs-link text-sm" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

const noop = () => () => {};
export function ShareLink({ code }: { code: string }) {
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const url = `${origin}/deal/${code}`;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input readOnly value={url} aria-label="Share link" className="hs-input min-w-0 flex-1 font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
      <CopyButton text={url} label="Copy link" className="hs-btn-secondary justify-center" />
    </div>
  );
}
