"use client";
// Payment card (08 section 7.2 item 7): the hold lines, the latest payout, "Retry payout" exactly when 04 section 9.4 allows it, earlier attempts.
import { useState } from "react";
import type { DealView, PayoutStatus } from "@/lib/deal/types";
import { api } from "@/lib/client-api";
import { canRetryPayout } from "@/lib/deal-copy";
import { when } from "@/lib/ledger-columns";

const PAYOUT_LABEL: Record<PayoutStatus, string> = { pending: "pending", success: "paid", failed: "failed" };

type Props = { deal: DealView; onDone: (d: DealView) => void; fail: (e: unknown) => void };

export function PayoutCard({ deal, onDone, fail }: Props) {
  const [busy, setBusy] = useState(false);
  const p = deal.payment;
  if (!p) return null;
  const latest = deal.payouts.at(-1);
  const earlier = deal.payouts.slice(0, -1);
  const to = deal.role === "seller" ? (deal.seller?.paypal_email ?? "your PayPal email") : "seller";
  const retry = async () => {
    setBusy(true);
    try {
      onDone(await api<DealView>(`/api/deals/${deal.code}/payout/retry`, { method: "POST" }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="hs-card grid gap-2 text-sm">
      <h2 className="font-semibold">Payment</h2>
      {p.authorized_at && <p title={p.authorized_at}>Hold placed {when(p.authorized_at)}</p>}
      {p.auth_expires_at && <p title={p.auth_expires_at}>PayPal can capture until {when(p.auth_expires_at)}<span className="hs-help block">PayPal honors the funds for the first 3 days.</span></p>}
      <p>Order <span className="font-mono">{p.paypal_order_id}</span></p>
      {p.authorization_id && <p>Authorization <span className="font-mono">{p.authorization_id}</span></p>}
      {p.capture_id && <p>Capture <span className="font-mono">{p.capture_id}</span></p>}
      {latest && (
        <>
          <p>
            Payout to {to}: {PAYOUT_LABEL[latest.status]}
            {latest.status === "failed" && latest.failure_reason && <> (<span className="font-mono">{latest.failure_reason}</span>)</>}
          </p>
          {latest.paypal_batch_id && <p>Payout batch <span className="font-mono">{latest.paypal_batch_id}</span></p>}
          {deal.role === "seller" && deal.status === "captured" && canRetryPayout(deal.payouts) && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="hs-btn" disabled={busy} onClick={retry}>{busy ? "Retrying…" : "Retry payout"}</button>
              <a className="hs-link" href="/me">Edit profile</a>
            </div>
          )}
          {earlier.length > 0 && (
            <details>
              <summary className="hs-help cursor-pointer">Previous attempts</summary>
              <ul className="mt-1 grid gap-1">
                {earlier.map((a) => <li key={a.attempt}>Attempt {a.attempt}: {PAYOUT_LABEL[a.status]} {a.failure_reason ?? ""}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
