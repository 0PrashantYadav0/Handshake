"use client";
// Buyer review (08 section 7.10): the latest proof at large size, the listing photos, verdicts unclear first, Release / Reject with the 4.5 sentences.
// The seller sees the same proof and verdicts with no buttons. ponytail: window.confirm carries the sentence; the dialog is post-SB-1 (4.6).
import { useState } from "react";
import type { DealView } from "@/lib/deal/types";
import { api } from "@/lib/client-api";
import { partyName } from "@/lib/deal-copy";
import { money, when } from "@/lib/ledger-columns";
import { ProofCard } from "./ProofCard";
import { Thumb } from "./VerdictList";

type Props = { deal: DealView; demo: boolean; onDone: (d: DealView) => void; fail: (e: unknown) => void };

export function ReviewPanel({ deal, demo, onDone, fail }: Props) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const sub = deal.submissions.at(-1);
  if (!sub) return null;
  const amount = money(deal.amount_minor);
  const seller = partyName(deal.seller, "the seller");

  const decide = async (decision: "approve" | "reject", question: string) => {
    if (!window.confirm(question)) return;
    setBusy(decision);
    try {
      onDone(await api<DealView>(`/api/deals/${deal.code}/review`, { json: { decision } }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5">
      <ProofCard sub={sub} deal={deal} demo={demo} large unclearFirst bare title="Look at the proof" />
      {deal.reference_files.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Compare with the listing photos</h3>
          <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {deal.reference_files.map((f, i) => <li key={f.id}><Thumb file={f} label={`r${i + 1}`} alt={`Listing photo ${i + 1}`} /></li>)}
          </ul>
        </div>
      )}
      {deal.role === "buyer" && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="review-approve"
              className="hs-btn"
              disabled={!!busy}
              onClick={() => decide("approve", `Release ${amount} to ${seller}?\n\nPayPal charges your account and pays the seller. This can't be undone.`)}
            >
              {busy === "approve" ? "Releasing…" : "Release payment"}
            </button>
            <button
              type="button"
              data-testid="review-reject"
              className="hs-btn-danger"
              disabled={!!busy}
              onClick={() => decide("reject", `Reject the proof?\n\nThe hold of ${amount} is released and the seller is not paid. This can't be undone.`)}
            >
              {busy === "reject" ? "Rejecting…" : "Reject proof"}
            </button>
          </div>
          <p className="hs-help">If you do nothing, the hold is released automatically on {when(deal.deadline_at)}.</p>
        </div>
      )}
    </div>
  );
}
