"use client";
// Verdict table (08 section 7.9): one row per condition with icon + word, confidence bar, reason and evidence chips; then the decision line.
import type { DealView, FileRef, Submission, VerdictResult } from "@/lib/deal/types";
import { decisionLine, evidenceChip, modelLine, VERDICT_ICON, VERDICT_LABEL } from "@/lib/deal-copy";
import { pct } from "@/lib/ledger-columns";

export function VerdictIcon({ result }: { result: VerdictResult }) {
  return <span className="hs-verdict" data-result={result} aria-hidden>{VERDICT_ICON[result]}</span>;
}

/** A labelled thumbnail link (r1.., e1..); the full-size photo opens in a new tab (lightbox after SB-1, 4.6). */
export function Thumb({ file, label, alt, className = "" }: { file: FileRef; label: string; alt: string; className?: string }) {
  return (
    <a href={file.url} target="_blank" rel="noreferrer" className={`relative block overflow-hidden rounded-lg border border-[var(--hs-border)] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed relative URL, 10-minute expiry */}
      <img src={file.url} alt={alt} className="aspect-square w-full object-cover" />
      <span className="absolute left-1 top-1 rounded bg-white/90 px-1 font-mono text-xs">{label}</span>
    </a>
  );
}

const OUTCOME: Record<string, VerdictResult> = { capture: "pass", request_fix: "fail", void: "fail", buyer_review: "unclear" };

type Props = { sub: Submission; deal: Pick<DealView, "conditions" | "reference_files" | "role">; unclearFirst?: boolean };

export function VerdictList({ sub, deal, unclearFirst }: Props) {
  if (sub.verdicts.length === 0) return <p className="hs-help">Not judged yet.</p>;
  const byId = new Map(sub.verdicts.map((v) => [v.condition_id, v]));
  const rows = deal.conditions.flatMap((c) => (byId.has(c.id) ? [{ c, v: byId.get(c.id)! }] : []));
  if (unclearFirst) rows.sort((a, b) => Number(b.v.result === "unclear") - Number(a.v.result === "unclear"));
  const line = decisionLine(sub, deal.role);

  const chip = (label: string, i: number) => {
    const c = evidenceChip(label);
    if (c && "index" in c) {
      const file = (c.kind === "evidence" ? sub.files : deal.reference_files)[c.index];
      if (file) return <Thumb key={i} file={file} label={label} alt={`${c.kind === "evidence" ? "Proof" : "Listing"} photo ${c.index + 1}`} className="h-10 w-10" />;
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
              <div className="mt-2 flex flex-wrap items-center gap-1">{v.evidence_used.length ? v.evidence_used.map(chip) : <span className="hs-help">—</span>}</div>
            </div>
            <div aria-label={`Confidence ${Math.round(v.confidence * 100)} percent`}>
              <span>{pct(v.confidence)}</span>
              <div className="hs-bar"><div style={{ width: `${Math.round(v.confidence * 100)}%` }} /></div>
            </div>
          </li>
        ))}
      </ul>
      {line && sub.decision && (
        <p data-decision-line tabIndex={-1} className="flex items-start gap-2 text-sm font-medium"><VerdictIcon result={OUTCOME[sub.decision]} /> <span>{line}</span></p>
      )}
      <p className="hs-help">{modelLine(sub)}</p>
    </div>
  );
}
