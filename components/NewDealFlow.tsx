"use client";
// /new: four headings in sequence, forward only (08 section 6, 4.6 "First pass"). Holds the deal between steps.
import { useState } from "react";
import type { DealView } from "@/lib/deal/types";
import { errorCopy, sendJson } from "@/lib/client-upload";
import { TermsForm, type Rejected } from "@/components/TermsForm";
import { PhotoUploader } from "@/components/PhotoUploader";
import { ShareLink } from "@/components/ShareLink";

/** One chip of 08 section 6.1; T-33 reads them from public/demo/presets.json. */
export type Preset = { id: string; label: string; sentence: string };

const STEPS = ["Describe", "Review terms", "Listing photos", "Share"];
const HELP = "Include the item, the price in US dollars, and what the seller must show: photos, a tracking number, or both. Keep it to one deal.";

export function NewDealFlow({ presets = [] }: { presets?: Preset[] }) {
  const [step, setStep] = useState(1);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<DealView | null>(null);
  const [rejected, setRejected] = useState<Rejected>([]);

  async function extract() {
    setBusy(true);
    setError(null);
    try {
      const { rejected, ...view } = await sendJson<DealView & { rejected: Rejected }>("/api/deals", "POST", { text: text.trim() });
      setDeal(view);
      setRejected(rejected);
      setStep(2);
    } catch (e) {
      setError(errorCopy(e)); // the sentence stays in the textarea
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 md:p-8">
      <ol aria-label="Steps" className="mb-6 flex flex-wrap gap-x-2 text-sm text-[var(--hs-muted)]">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={step === i + 1 ? "font-semibold text-[var(--hs-ink)]" : ""}>
            {i > 0 && <span aria-hidden className="mr-2">·</span>}
            {i + 1} {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section>
          <h2 className="text-2xl font-semibold">Describe the deal in one sentence</h2>
          {presets.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--hs-muted)]">Try one:</span>
              {presets.map((p) => (
                <button key={p.id} type="button" className="hs-chip" data-testid="preset-sentence" data-preset={p.id} onClick={() => setText(p.sentence)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="sentence" className="mt-4 block text-sm font-medium">Your sentence</label>
          <textarea
            id="sentence"
            className="hs-input mt-1 w-full py-2"
            rows={4}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="sentence-help sentence-error"
            aria-invalid={error ? true : undefined}
          />
          <div className="mt-1 flex justify-between gap-4 text-sm text-[var(--hs-muted)]">
            <span id="sentence-help">{HELP}</span>
            <span className="shrink-0">{text.length} / 500</span>
          </div>
          {error && <p id="sentence-error" role="alert" className="mt-2 text-sm text-[var(--hs-status-voided)]">{error}</p>}
          <button type="button" className="hs-btn mt-4" data-testid="extract-terms" disabled={busy || text.trim() === ""} onClick={extract}>
            {busy ? "Reading your sentence…" : "Extract terms"}
          </button>
          {busy && (
            <div aria-live="polite" className="mt-4 animate-pulse rounded-lg border border-[var(--hs-border)] bg-[var(--hs-surface)] p-4 text-sm text-[var(--hs-muted)]">
              Usually a few seconds; at most 30.
            </div>
          )}
        </section>
      )}

      {step === 2 && deal && <TermsForm deal={deal} rejected={rejected} onSaved={(d) => { setDeal(d); setStep(3); }} />}
      {step === 3 && deal && <PhotoUploader deal={deal} onAccepted={(d) => { setDeal(d); setStep(4); }} />}
      {step === 4 && deal && <ShareLink deal={deal} />}
    </main>
  );
}
