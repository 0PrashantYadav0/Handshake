"use client";
// Small deal-page controls (08 sections 7.5, 7.13, 6.4): Join, Accept terms (+ the payout email card), Cancel deal, the share row.
// data-primary-action marks the button the mobile sticky bar (Deal.tsx) forwards to.
import { useState, useSyncExternalStore } from "react";
import type { DealView } from "@/lib/deal/types";
import { api } from "@/lib/client-api";
import { money } from "@/lib/ledger-columns";
import { confirm } from "@/components/ConfirmDialog";
import { CopyButton, ShareButton } from "@/components/ShareLink";
import { PayoutEmailForm } from "@/components/PayoutEmailForm";
import { SignContract } from "./SignContract";

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

/** trust spec §6, §8: a seller without a verified payout address confirms it first; then either party signs. */
export function AcceptTerms({ deal, demo = false, onDone }: { deal: DealView; demo?: boolean; onDone: Done; fail?: Fail }) {
  const [needEmail, setNeedEmail] = useState(deal.role === "seller" && !deal.seller?.payout_email_verified);
  if (needEmail) return <PayoutEmailForm current={deal.seller?.paypal_email ?? null} verified={false} onVerified={() => setNeedEmail(false)} />;
  return <SignContract deal={deal} demo={demo} onDone={onDone} />;
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
