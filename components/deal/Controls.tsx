"use client";
// Small deal-page controls (08 sections 7.5, 7.13, 6.4): Join, Accept terms (+ PayPal email form), Cancel deal, the share row.
// data-primary-action marks the button the mobile sticky bar (Deal.tsx) forwards to.
import { useState, useSyncExternalStore } from "react";
import type { DealView } from "@/lib/deal/types";
import { api, ApiError } from "@/lib/client-api";
import { money } from "@/lib/ledger-columns";
import { confirm } from "@/components/ConfirmDialog";
import { CopyButton, ShareButton } from "@/components/ShareLink";

export { CopyButton };

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
    <button type="button" data-testid="join" data-primary-action className="hs-btn" disabled={busy} onClick={() => run(async () => onDone(await api(`/api/deals/${code}/join`, { method: "POST" })))}>
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
      <button type="button" data-testid="accept-terms" data-primary-action className="hs-btn" disabled={busy} onClick={accept}>
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
      <button type="submit" data-testid="accept-terms" data-primary-action className="hs-btn self-start" disabled={busy}>{busy ? "Accepting…" : "Save and accept"}</button>
    </form>
  );
}

export function CancelDeal({ deal, onDone, fail }: { deal: DealView; onDone: Done; fail: Fail }) {
  const [busy, run] = useBusy(fail);
  const sentence = deal.status === "held"
    ? `The hold of ${money(deal.amount_minor)} on the buyer's PayPal is released. This can't be undone.`
    : "No money is held. The deal is closed for both of you. This can't be undone.";
  const cancel = async () => {
    if (!(await confirm({ title: "Cancel this deal?", sentence, action: "Cancel deal", tone: "danger" }))) return;
    await run(async () => onDone(await api(`/api/deals/${deal.code}/cancel`, { method: "POST" })));
  };
  return (
    <button type="button" className="hs-btn-danger" data-testid="cancel-deal" disabled={busy} onClick={() => void cancel()}>
      {busy ? "Cancelling…" : "Cancel deal"}
    </button>
  );
}

const noop = () => () => {};
export function ShareLink({ code, title }: { code: string; title: string }) {
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const url = `${origin}/deal/${code}`;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input readOnly value={url} aria-label="Share link" className="hs-input min-w-0 flex-1 font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
      <CopyButton text={url} label="Copy link" className="hs-btn-secondary" />
      <ShareButton url={url} title={`Handshake deal ${code}: ${title}`} />
    </div>
  );
}
