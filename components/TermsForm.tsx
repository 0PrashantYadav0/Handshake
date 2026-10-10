"use client";
// /new step 2 (08 section 6.2; D6): edit title, price, days and conditions; use or dismiss rejected parts; PATCH only when something changed.
import { useEffect, useRef, useState } from "react";
import type { DealView, EvidenceType } from "@/lib/deal/types";
import { errorCopy, sendJson } from "@/lib/client-upload";
import { CopyButton } from "@/components/ShareLink";

export type Rejected = { text: string; suggestion: string }[];
type Row = { text: string; evidence_type: EvidenceType };

const MAX_ROWS = 4;
const warn = "border-[var(--hs-status-in_review)]";
const err = "mt-1 text-sm text-[var(--hs-status-voided)]";

export function TermsForm({ deal, rejected: initialRejected, onSaved }: { deal: DealView; rejected: Rejected; onSaved: (d: DealView) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const own: Row[] = deal.conditions.filter((c) => !c.system).map(({ text, evidence_type }) => ({ text, evidence_type }));
  const system = deal.conditions.find((c) => c.system);
  const [title, setTitle] = useState(deal.item_title);
  const [price, setPrice] = useState(deal.amount_minor === null ? "" : (deal.amount_minor / 100).toFixed(2));
  const [days, setDays] = useState(deal.deadline_days === null ? "" : String(deal.deadline_days));
  const [rows, setRows] = useState<Row[]>(own);
  const [rejected, setRejected] = useState(initialRejected);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinor = Math.round(Number(price) * 100);
  const daysNum = Number(days);
  const titleOk = title.trim().length >= 1 && title.trim().length <= 80;
  const priceOk = price !== "" && amountMinor >= 1 && amountMinor <= 1_000_000;
  const daysOk = days !== "" && Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 21;
  const rowsOk = rows.length >= 1 && rows.every((r) => r.text.trim() !== "");
  const bad = (ok: boolean) => (tried && !ok ? true : undefined);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const takeSuggestion = (i: number) => {
    setRows((rs) => (rs.length < MAX_ROWS ? [...rs, { text: rejected[i].suggestion, evidence_type: "photo" }] : rs));
    setRejected((rj) => rj.filter((_, k) => k !== i));
  };

  async function save() {
    setTried(true);
    if (!titleOk || !priceOk || !daysOk || !rowsOk) return;
    const body = { item_title: title.trim(), amount_minor: amountMinor, deadline_days: daysNum, conditions: rows.map((r) => ({ ...r, text: r.text.trim() })) };
    const unchanged =
      body.item_title === deal.item_title && body.amount_minor === deal.amount_minor && body.deadline_days === deal.deadline_days &&
      JSON.stringify(body.conditions) === JSON.stringify(own);
    if (unchanged) return onSaved(deal);
    setBusy(true);
    setError(null);
    try {
      onSaved(await sendJson<DealView>(`/api/deals/${deal.code}/terms`, "PATCH", body));
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">Check what Claude understood</h2>
      <p className="mt-1 text-sm text-[var(--hs-muted)]">You can edit anything. The seller sees exactly this.</p>
      <p className="mt-4 flex items-center gap-2 text-sm">
        Deal code <span data-testid="deal-code" className="font-mono font-semibold">{deal.code}</span>
        <CopyButton text={deal.code} className="hs-chip" />
      </p>

      <label htmlFor="item" className="mt-4 block text-sm font-medium">Item</label>
      <input id="item" className="hs-input mt-1 w-full" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={bad(titleOk)} />
      {bad(titleOk) && <p className={err}>Give the item a name, at most 80 characters.</p>}

      <label htmlFor="price" className="mt-4 block text-sm font-medium">Price (USD)</label>
      <input
        id="price"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0.01"
        max="10000"
        required
        className={`hs-input mt-1 w-full ${deal.amount_minor === null && price === "" ? warn : ""}`}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        aria-describedby="price-help"
        aria-invalid={bad(priceOk)}
      />
      {deal.amount_minor === null && price === "" && <p id="price-help" className="mt-1 text-sm text-[var(--hs-status-in_review)]">What&apos;s the price? Your sentence didn&apos;t say.</p>}
      {bad(priceOk) && <p className={err}>Enter a price from $0.01 to $10,000.00.</p>}

      <label htmlFor="days" className="mt-4 block text-sm font-medium">Seller has … days to deliver proof</label>
      <input
        id="days"
        type="number"
        inputMode="numeric"
        min={1}
        max={21}
        required
        className={`hs-input mt-1 w-full ${deal.deadline_days === null && days === "" ? warn : ""}`}
        value={days}
        onChange={(e) => setDays(e.target.value)}
        aria-describedby="days-help days-prompt"
        aria-invalid={bad(daysOk)}
      />
      {deal.deadline_days === null && days === "" && <p id="days-prompt" className="mt-1 text-sm text-[var(--hs-status-in_review)]">How many days? Most deals use 14.</p>}
      <p id="days-help" className="mt-1 text-sm text-[var(--hs-muted)]">Counted from the moment the hold is placed, at most 21 days.</p>
      {bad(daysOk) && <p className={err}>Enter 1 to 21 days.</p>}

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Conditions</legend>
        <ul className="mt-1 space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-2">
              <input
                aria-label={`Condition ${i + 1}`}
                className="hs-input w-full"
                maxLength={200}
                required
                value={r.text}
                onChange={(e) => setRow(i, { text: e.target.value })}
                aria-invalid={bad(r.text.trim() !== "")}
              />
              <select aria-label={`Evidence for condition ${i + 1}`} className="hs-input" value={r.evidence_type} onChange={(e) => setRow(i, { evidence_type: e.target.value as EvidenceType })}>
                <option value="photo">Photo</option>
                <option value="tracking">Tracking</option>
              </select>
              <button type="button" className="hs-btn-secondary" aria-label={`Remove condition ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                ✕
              </button>
            </li>
          ))}
          {system && (
            <li className="flex items-start gap-2 text-sm text-[var(--hs-muted)]">
              <span aria-hidden>🔒</span>
              <div>
                <span className="text-[var(--hs-ink)]">{system.text}</span>
                <p>Added automatically whenever a photo condition exists. It proves the photos were taken for this deal.</p>
              </div>
            </li>
          )}
        </ul>
        {bad(rowsOk) && <p className={err}>Add at least one condition and give each some text.</p>}
        {rows.length < MAX_ROWS && (
          <button type="button" className="hs-chip mt-2" onClick={() => setRows((rs) => [...rs, { text: "", evidence_type: "photo" }])}>
            Add condition
          </button>
        )}
      </fieldset>

      {rejected.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--hs-border)] bg-[var(--hs-surface)] p-4">
          <h3 className="text-sm font-medium">Left out: a photo or tracking number can&apos;t prove these</h3>
          <ul className="mt-2 space-y-3 text-sm">
            {rejected.map((r, i) => (
              <li key={r.text}>
                <p>&ldquo;{r.text}&rdquo;</p>
                <p className="text-[var(--hs-muted)]">Suggested instead: {r.suggestion}</p>
                <div className="mt-1 flex gap-2">
                  <button type="button" className="hs-chip" disabled={rows.length >= MAX_ROWS} onClick={() => takeSuggestion(i)}>Use suggestion</button>
                  <button type="button" className="hs-chip" onClick={() => setRejected((rj) => rj.filter((_, k) => k !== i))}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p role="alert" className={`${err} mt-4`}>{error}</p>}
      <button type="button" className="hs-btn mt-6" data-testid="save-terms" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save terms"}
      </button>
    </section>
  );
}
