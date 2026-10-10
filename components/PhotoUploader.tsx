"use client";
// /new step 3 (08 section 6.3; T-25): stage up to 4 downscaled photos, then upload each and accept as the buyer.
// Thumbnails switch to the signed FileRef.url once uploaded; a failed upload keeps the staged files and the ones already sent.
import { useState } from "react";
import type { DealView, FileRef } from "@/lib/deal/types";
import { downscale, errorCopy, formatBytes, sendJson, UNDECODABLE_COPY, uploadFile } from "@/lib/client-upload";
import { fetchSample, findPreset, type Presets } from "@/lib/demo-kit";

const MAX = 4;
type Item = { key: number; blob: Blob; preview: string; ref?: FileRef; error?: string };
let seq = 0;

export function PhotoUploader({ deal, kit = null, onAccepted }: { deal: DealView; kit?: Presets | null; onAccepted: (d: DealView) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Stages downscaled files after the current ones, or instead of them with `replace` (the sample button). */
  async function add(files: FileList | File[] | null, replace = false) {
    if (!files) return;
    const next: Item[] = [];
    const msgs: string[] = [];
    for (const f of Array.from(files)) {
      if ((replace ? 0 : items.length) + next.length >= MAX) {
        msgs.push("Up to 4 listing photos.");
        break;
      }
      try {
        const blob = await downscale(f);
        next.push({ key: ++seq, blob, preview: URL.createObjectURL(blob) });
      } catch (e) {
        msgs.push(`${f.name}: ${e instanceof Error ? e.message : UNDECODABLE_COPY}`);
      }
    }
    if (replace) items.forEach((it) => URL.revokeObjectURL(it.preview));
    setItems((cur) => (replace ? next : [...cur, ...next]));
    setNotice(msgs.length ? msgs.join(" ") : null);
  }

  async function stageSample() {
    if (!kit) return;
    setBusy(true);
    try {
      await add(await Promise.all(findPreset(kit, deal.source_text).reference.map(fetchSample)), true);
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  }

  function remove(key: number) {
    setItems((cur) => cur.filter((it) => (it.key === key ? (URL.revokeObjectURL(it.preview), false) : true)));
  }

  async function accept(withUploads: boolean) {
    setBusy(true);
    setError(null);
    const list = [...items];
    try {
      if (withUploads) {
        for (let i = 0; i < list.length; i++) {
          if (list[i].ref) continue;
          setProgress(`Uploading ${i + 1} of ${list.length}`);
          try {
            list[i] = { ...list[i], ref: await uploadFile(deal.code, "reference", list[i].blob), error: undefined };
          } catch (e) {
            list[i] = { ...list[i], error: errorCopy(e) };
            return; // stop the sequence; staged files stay
          } finally {
            setItems([...list]);
          }
        }
      }
      onAccepted(await sendJson<DealView>(`/api/deals/${deal.code}/accept`, "POST", { terms_version: deal.terms_version }));
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-2xl font-semibold">Add listing photos (optional)</h2>
      <p className="mt-1 text-sm text-[var(--hs-muted)]">Up to 4. Claude compares the seller&apos;s proof photos with these. Skip this if your conditions are tracking-only.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* no `capture` attribute: the OS sheet offers camera or gallery (08 section 6.3) */}
        <label className={`hs-btn-secondary cursor-pointer ${items.length >= MAX || busy ? "pointer-events-none opacity-50" : ""}`}>
          Choose photos
          <input type="file" accept="image/*" multiple className="sr-only" disabled={items.length >= MAX || busy} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        </label>
        {/* T-33: stages the preset's reference[] whose sentence equals deal.source_text, else preset 1 (08 section 12.4) */}
        {kit && (
          <button type="button" className="hs-btn-secondary" data-testid="use-sample-reference" disabled={busy} onClick={() => void stageSample()}>Use sample listing photos</button>
        )}
        <span className="text-sm text-[var(--hs-muted)]">{items.length} of {MAX}</span>
      </div>
      {notice && <p role="alert" className="mt-2 text-sm text-[var(--hs-status-voided)]">{notice}</p>}

      {items.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {items.map((it, i) => (
            <li key={it.key} className="text-sm">
              <a href={it.ref?.url ?? it.preview} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-[var(--hs-border)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- blob: and signed URLs */}
                <img src={it.ref?.url ?? it.preview} alt={`Listing photo ${i + 1}`} className="h-full w-full object-cover" />
              </a>
              <div className="mt-1 flex items-center justify-between text-[var(--hs-muted)]">
                <span>{formatBytes(it.blob.size)}</span>
                {it.ref ? (
                  <span>Uploaded</span>
                ) : (
                  <button type="button" className="font-medium text-[var(--hs-accent)]" disabled={busy} onClick={() => remove(it.key)}>Remove</button>
                )}
              </div>
              {it.error && <p className="mt-1 text-[var(--hs-status-voided)]">{it.error}</p>}
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-[var(--hs-muted)]">{progress}</p>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--hs-status-voided)]">{error}</p>}

      <div className="mt-4 flex items-center gap-4">
        <button type="button" className="hs-btn" data-testid="accept-and-share" disabled={busy} onClick={() => accept(true)}>
          Accept terms and get link
        </button>
        <button type="button" className="text-sm font-medium text-[var(--hs-accent)]" disabled={busy} onClick={() => accept(false)}>
          Skip photos
        </button>
      </div>
    </section>
  );
}
