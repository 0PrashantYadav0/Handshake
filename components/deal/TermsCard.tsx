"use client";
// Terms card and the listing-photos grid (08 section 7.2 items 4 and 5; 4.6 first pass: plain links, no lightbox).
import type { Condition, DealPreview, DealView } from "@/lib/deal/types";

export function ConditionList({ conditions }: { conditions: Condition[] }) {
  return (
    <ol className="mt-3 grid gap-2">
      {conditions.map((c) => (
        <li key={c.id} className="flex gap-3 text-sm">
          <span className="w-5 shrink-0 text-right text-[var(--hs-muted)]">{c.position}.</span>
          <span className="flex-1">{c.text}</span>
          <span className="flex shrink-0 gap-1">
            <span className="hs-badge">{c.evidence_type === "photo" ? "Photo" : "Tracking"}</span>
            {c.system && <span className="hs-badge" title="Added by Handshake to every deal">System</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const v = (n: number | null) => (n === null ? "not yet" : `v${n}`);

export function TermsCard({ deal, onImgError }: { deal: DealView | DealPreview; onImgError: () => void }) {
  const view = deal.role === "preview" ? null : deal;
  return (
    <>
      <section className="hs-card">
        <h2 className="font-semibold">Terms{view && ` · version ${view.terms_version}`}</h2>
        <ConditionList conditions={deal.conditions} />
        {view && <p className="hs-help mt-3">Buyer accepted {v(view.buyer_accepted_version)} · Seller accepted {v(view.seller_accepted_version)}</p>}
      </section>
      {view && view.reference_files.length > 0 && (
        <section className="hs-card">
          <h2 className="font-semibold">Listing photos</h2>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {view.reference_files.map((f, i) => (
              <li key={f.id} className="relative">
                <a href={f.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-[var(--hs-border)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed relative URL, 10-minute expiry */}
                  <img src={f.url} alt={`Listing photo ${i + 1}`} className="aspect-square w-full object-cover" onError={onImgError} />
                </a>
                <span className="absolute left-1 top-1 rounded bg-white/90 px-1 font-mono text-xs">r{i + 1}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
