"use client";
// /new: four steps on one page (08 section 6). The stepper announces the current step; done steps go back (step 1 starts a new deal, 6 intro).
import { useState } from "react";
import type { DealView } from "@/lib/deal/types";
import { errorCopy, sendJson } from "@/lib/client-upload";
import { chips, type Presets } from "@/lib/demo-kit";
import { TermsForm, type Rejected } from "@/components/TermsForm";
import { PhotoUploader } from "@/components/PhotoUploader";
import { ShareLink } from "@/components/ShareLink";

const STEPS = ["Describe", "Review terms", "Listing photos", "Share"];
const HELP = "Include the item, the price in US dollars, and what the seller must show: photos, a tracking number, or both. Keep it to one deal.";

/** `kit` is public/demo/presets.json (08 section 12.2) when DEMO_LOGIN is on: it gives the 6.1 chips and the 6.3 sample listing photos. */
export function NewDealFlow({ kit = null }: { kit?: Presets | null }) {
  const presets = kit ? chips(kit) : [];
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

  // Back to 1 starts a new deal (the draft stays in the ledger); back to 2 re-opens the terms. Nothing goes back once shared (step 4) except a new deal.
  function back(n: number) {
    if (n === 1) {
      setDeal(null);
      setRejected([]);
    }
    setStep(n);
  }

  return (
    <main className="mx-auto max-w-2xl p-4 md:p-8">
      <nav aria-label="Steps">
        <ol className="hs-steps mb-8">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const state = n < step ? "done" : n === step ? "current" : "todo";
            const clickable = n < step && (n === 1 || step < 4);
            const num = <span className="hs-step-n" aria-hidden>{state === "done" ? "✓" : n}</span>;
            return (
              <li key={s} data-state={state} aria-current={n === step ? "step" : undefined}>
                {clickable ? (
                  <button type="button" onClick={() => back(n)} data-testid={`step-${n}`} title={n === 1 ? "Start a new deal" : undefined}>
                    {num}{s}<span className="sr-only"> (done, go back)</span>
                  </button>
                ) : (
                  <span>{num}{s}{state === "done" && <span className="sr-only"> (done)</span>}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <p className="sr-only" aria-live="polite">Step {step} of {STEPS.length}: {STEPS[step - 1]}</p>

      {step === 1 && (
        <section>
          <h1 className="text-3xl md:text-4xl">Describe the deal in one sentence</h1>
          {presets.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--hs-muted)]">Try one:</span>
              {presets.map((p) => (
                <button key={p.id} type="button" className="hs-chip" data-testid="preset-sentence" data-preset={p.id} onClick={() => setText(p.sentence)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="sentence" className="hs-label mt-6">Your sentence</label>
          <textarea
            id="sentence"
            className="hs-input w-full py-2"
            rows={4}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="sentence-help sentence-error"
            aria-invalid={error ? true : undefined}
          />
          <div className="mt-1 flex justify-between gap-4 text-sm text-[var(--hs-muted)]">
            <span id="sentence-help">{HELP}</span>
            <span className="shrink-0 tabular-nums">{text.length} / 500</span>
          </div>
          {error && <p id="sentence-error" role="alert" className="mt-2 text-sm text-[var(--hs-status-voided)]">{error}</p>}
          <button type="button" className="hs-btn mt-5" data-testid="extract-terms" disabled={busy || text.trim() === ""} onClick={extract}>
            {busy ? "Reading your sentence…" : "Extract terms"}
          </button>
          {busy && (
            <div aria-live="polite" className="hs-card mt-4 text-sm text-[var(--hs-muted)] motion-safe:animate-pulse">
              Usually a few seconds; at most 30.
            </div>
          )}
        </section>
      )}

      {step === 2 && deal && <TermsForm deal={deal} rejected={rejected} onSaved={(d) => { setDeal(d); setStep(3); }} />}
      {step === 3 && deal && <PhotoUploader deal={deal} kit={kit} onAccepted={(d) => { setDeal(d); setStep(4); }} />}
      {step === 4 && deal && <ShareLink deal={deal} />}
    </main>
  );
}
