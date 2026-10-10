"use client";
// One Proof card per submission (08 section 7.2 item 6): photos e1.., tracking with carrier status, the note, then the verdicts (7.9).
import type { DealView, Submission } from "@/lib/deal/types";
import { carrierLabel } from "@/lib/deal-copy";
import { when } from "@/lib/ledger-columns";
import { Thumb, VerdictList } from "./VerdictList";

type Props = { sub: Submission; deal: DealView; demo: boolean; large?: boolean; unclearFirst?: boolean; title?: string; bare?: boolean };

export function ProofCard({ sub, deal, demo, large, unclearFirst, title, bare }: Props) {
  return (
    <section className={bare ? "grid gap-4" : "hs-card grid gap-4"}>
      <h3 className="font-semibold">{title ?? `Proof · attempt ${sub.submission_no} · ${when(sub.submitted_at)}`}</h3>
      {sub.files.length > 0 && (
        <ul className={`grid gap-2 ${large ? "grid-cols-2 md:grid-cols-3" : "grid-cols-3 sm:grid-cols-4"}`}>
          {sub.files.map((f, i) => (
            <li key={f.id}><Thumb file={f} label={`e${i + 1}`} alt={`Proof photo ${i + 1}, attempt ${sub.submission_no}`} /></li>
          ))}
        </ul>
      )}
      {sub.tracking_number && (
        <p className="text-sm">
          Tracking <span className="font-mono">{sub.tracking_number}</span> · {carrierLabel(sub.carrier_status)}
          {demo && <> <span className="hs-badge">sandbox carrier</span></>}
        </p>
      )}
      {sub.note && <blockquote className="border-l-2 border-[var(--hs-border)] pl-3 text-sm italic">{sub.note}</blockquote>}
      <VerdictList sub={sub} deal={deal} unclearFirst={unclearFirst} />
    </section>
  );
}
