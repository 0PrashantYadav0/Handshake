"use client";
// Verdict table (08 section 7.9): one row per condition with icon + word, confidence bar, reason and evidence chips; then the decision line.
// Thumbnail chips open the lightbox over this attempt's proof photos followed by the listing photos.
import type { DealView, Submission, VerdictResult } from "@/lib/deal/types";
import { decisionLine, evidenceChip, modelLine, VERDICT_ICON, VERDICT_LABEL } from "@/lib/deal-copy";
import { pct } from "@/lib/ledger-columns";
import { Thumb, useLightbox, type Photo } from "@/components/Lightbox";

export function VerdictIcon({ result }: { result: VerdictResult }) {
  return <span className="hs-verdict" data-result={result} aria-hidden>{VERDICT_ICON[result]}</span>;
}

/** e1..e6 then r1..r4 (08 section 7.1 labels), as lightbox photos. */
export function proofPhotos(sub: Pick<Submission, "files" | "submission_no">): Photo[] {
  return sub.files.map((f, i) => ({ src: f.url, alt: `Proof photo ${i + 1}, attempt ${sub.submission_no}`, label: `e${i + 1}` }));
}
export function listingPhotos(deal: Pick<DealView, "reference_files">): Photo[] {
  return deal.reference_files.map((f, i) => ({ src: f.url, alt: `Listing photo ${i + 1}`, label: `r${i + 1}` }));
}

const OUTCOME: Record<string, VerdictResult> = { capture: "pass", request_fix: "fail", void: "fail", buyer_review: "unclear" };

type Props = { sub: Submission; deal: Pick<DealView, "conditions" | "reference_files" | "role">; unclearFirst?: boolean };

export function VerdictList({ sub, deal, unclearFirst }: Props) {
  const photos = [...proofPhotos(sub), ...listingPhotos(deal)];
  const lb = useLightbox(photos);
  if (sub.verdicts.length === 0) return <p className="hs-help">Not judged yet.</p>;
  const byId = new Map(sub.verdicts.map((v) => [v.condition_id, v]));
  const rows = deal.conditions.flatMap((c) => (byId.has(c.id) ? [{ c, v: byId.get(c.id)! }] : []));
  if (unclearFirst) rows.sort((a, b) => Number(b.v.result === "unclear") - Number(a.v.result === "unclear"));
  const line = decisionLine(sub, deal.role);

  const chip = (label: string, i: number) => {
    const c = evidenceChip(label);
    if (c && "index" in c) {
      const at = c.kind === "evidence" ? c.index : sub.files.length + c.index;
      const photo = c.kind === "evidence" ? (sub.files[c.index] && photos[at]) : (deal.reference_files[c.index] && photos[at]);
      if (photo) return <span key={i} className="h-10 w-10"><Thumb photo={photo} onClick={() => lb.open(at)} /></span>;
    }
    return <span key={i} className="hs-badge">{c?.kind === "tracking" ? "Tracking" : c?.kind === "note" ? "Note" : label}</span>;
  };

  return (
    <div className="grid gap-3">
      <h4 className="text-sm font-semibold">Verdict</h4>
      <ul className="grid gap-2">
        {rows.map(({ c, v }) => (
          <li key={c.id} data-testid="verdict-row" className="grid gap-2 rounded-lg border border-[var(--hs-border)] p-3 text-sm md:grid-cols-[6.5rem_1fr_5.5rem] md:gap-4">
            <span className="hs-verdict-word" data-result={v.result}><VerdictIcon result={v.result} /> {VERDICT_LABEL[v.result]}</span>
            <div>
              <p>{c.text}</p>
              <p className="hs-help mt-1">{v.reason}</p>
              {v.evidence_used.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1">{v.evidence_used.map(chip)}</div>}
            </div>
            <div aria-label={`Confidence ${Math.round(v.confidence * 100)} percent`}>
              <span className="tabular-nums">{pct(v.confidence)} sure</span>
              <div className="hs-bar" data-result={v.result}><div style={{ width: `${Math.round(v.confidence * 100)}%` }} /></div>
            </div>
          </li>
        ))}
      </ul>
      {line && sub.decision && (
        <p data-decision-line tabIndex={-1} className="flex items-start gap-2 text-sm font-medium"><VerdictIcon result={OUTCOME[sub.decision]} /> <span>{line}</span></p>
      )}
      <p className="hs-help">{modelLine(sub)}</p>
      {lb.lightbox}
    </div>
  );
}
