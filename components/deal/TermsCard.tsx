"use client";
// Terms card and the listing-photos grid (08 section 7.2 items 4 and 5); each listing thumbnail opens the lightbox.
import type { Condition, DealPreview, DealView } from "@/lib/deal/types";
import { Thumb, useLightbox } from "@/components/Lightbox";
import { listingPhotos } from "./VerdictList";

export function ConditionList({ conditions }: { conditions: Condition[] }) {
  return (
    <ol className="mt-3 grid gap-2">
      {conditions.map((c) => (
        <li key={c.id} className="flex gap-3 text-sm">
          <span className="w-5 shrink-0 text-right tabular-nums text-[var(--hs-muted)]">{c.position}.</span>
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
  const photos = view ? listingPhotos(view) : [];
  const lb = useLightbox(photos);
  return (
    <>
      <section className="hs-card" aria-labelledby="terms-h">
        <h2 id="terms-h" className="font-semibold">Terms{view && ` · version ${view.terms_version}`}</h2>
        <ConditionList conditions={deal.conditions} />
        {view && <p className="hs-help mt-3">Buyer accepted {v(view.buyer_accepted_version)} · Seller accepted {v(view.seller_accepted_version)}</p>}
      </section>
      {view && photos.length > 0 && (
        <section className="hs-card" aria-labelledby="listing-h">
          <h2 id="listing-h" className="font-semibold">Listing photos</h2>
          {/* onError: one refetch for fresh signed URLs (08 section 4.2) */}
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p, i) => <li key={view.reference_files[i].id}><Thumb photo={p} onClick={() => lb.open(i)} onError={onImgError} /></li>)}
          </ul>
          {lb.lightbox}
        </section>
      )}
    </>
  );
}
