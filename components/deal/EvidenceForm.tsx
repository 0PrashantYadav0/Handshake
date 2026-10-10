"use client";
// Seller evidence form (08 section 7.7) for `held`; while the files upload and the verdict runs it becomes the wait screen (7.8).
// Rendered as the body of the "What happens next" card, which carries the 7.4 heading.
import { useState } from "react";
import type { DealView, FileRef } from "@/lib/deal/types";
import { api, ApiError } from "@/lib/client-api";
import { downscale, errorCopy as uploadErrorCopy, formatBytes, UNDECODABLE_COPY, uploadFile } from "@/lib/client-upload";
import { carrierStatus } from "@/lib/carrier";
import { carrierLabel } from "@/lib/deal-copy";
import { composeCodePhoto, fetchSample, findPreset, usePresets } from "@/lib/demo-kit";
import { Thumb, useLightbox } from "@/components/Lightbox";
import { VerdictIcon } from "./VerdictList";
import { WaitScreen } from "./WaitScreen";

const MAX = 6;
const WAIT_MS = 45_000; // B5: the UI waits 45 s before calling the connection lost
const LOST = Symbol("lost");
type Item = { key: number; blob: Blob; preview: string; ref?: FileRef; error?: string; listing?: boolean };
let seq = 0;

/** Browser-side hash of the staged bytes; null where SubtleCrypto is unavailable (plain http off localhost). */
async function sha256(blob: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Props = {
  deal: DealView;
  demo: boolean;
  onChecking: (checking: boolean) => void;
  onDone: (d: DealView) => void;
  onPaypalError: (e: ApiError) => void;
  fail: (e: unknown) => void;
};

export function EvidenceForm({ deal, demo, onChecking, onDone, onPaypalError, fail }: Props) {
  const prev = deal.submissions.at(-1);
  const fix = deal.fix_attempts_used === 1;
  const [items, setItems] = useState<Item[]>([]);
  const [tracking, setTracking] = useState(prev?.tracking_number ?? "");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<"edit" | "uploading" | "checking" | "lost">("edit");
  const [progress, setProgress] = useState<string | null>(null);
  const kit = usePresets(demo);
  const preset = kit && findPreset(kit, deal.source_text);
  const photos = items.map((it, i) => ({ src: it.ref?.url ?? it.preview, alt: `Proof photo ${i + 1}`, label: `e${i + 1}` }));
  const lb = useLightbox(photos);

  const needPhoto = deal.conditions.some((c) => c.evidence_type === "photo");
  const trackingCond = deal.conditions.find((c) => c.evidence_type === "tracking");
  const hasCode = deal.conditions.some((c) => c.system);
  const failed = new Map(prev?.verdicts.filter((v) => v.result === "fail").map((v) => [v.condition_id, v.reason]));
  const refHashes = new Set(deal.reference_files.map((f) => f.sha256));
  const ready = (!needPhoto || items.length > 0) && (!trackingCond || tracking.trim() !== "") && !items.some((i) => i.listing);

  /** Stages downscaled files after the current ones, or instead of them with `replace`; `skipListingCheck` lets the D8 sample through (7.7). */
  async function add(files: FileList | File[] | null, { replace = false, skipListingCheck = false } = {}) {
    if (!files) return;
    const next: Item[] = [];
    const msgs: string[] = [];
    for (const f of Array.from(files)) {
      if ((replace ? 0 : items.length) + next.length >= MAX) {
        msgs.push("Up to 6 photos.");
        break;
      }
      try {
        const blob = await downscale(f);
        const hash = skipListingCheck ? null : await sha256(blob);
        next.push({ key: ++seq, blob, preview: URL.createObjectURL(blob), listing: !!hash && refHashes.has(hash) });
      } catch (e) {
        msgs.push(`${f.name}: ${e instanceof Error ? e.message : UNDECODABLE_COPY}`);
      }
    }
    if (replace) items.forEach((it) => URL.revokeObjectURL(it.preview));
    setItems((cur) => (replace ? next : [...cur, ...next]));
    setNotice(msgs.length ? msgs.join(" ") : null);
  }

  /** 08 section 12.4: the set's photos plus the code photo composed for this deal, and the demo tracking number. */
  async function stageSample(setId: string) {
    if (!kit || !preset) return;
    const set = preset.sets[setId];
    try {
      const { base, box } = preset.code_photo;
      const files = await Promise.all([...set.photos.map(fetchSample), composeCodePhoto(base, deal.code, box, kit.font)]);
      await add(files, { replace: true, skipListingCheck: !!set.skip_listing_check });
      setTracking(kit.tracking_number);
    } catch (e) {
      fail(e);
    }
  }

  const remove = (key: number) => setItems((cur) => cur.filter((it) => (it.key === key ? (URL.revokeObjectURL(it.preview), false) : true)));

  const edit = () => {
    setPhase("edit");
    setProgress(null);
    onChecking(false);
  };

  async function submit() {
    setPhase("uploading");
    onChecking(true);
    const list = [...items];
    for (let i = 0; i < list.length; i++) {
      if (list[i].ref) continue; // already sent by a previous attempt that failed later
      setProgress(`Uploading ${i + 1} of ${list.length}`);
      try {
        list[i] = { ...list[i], ref: await uploadFile(deal.code, "evidence", list[i].blob), error: undefined };
      } catch (e) {
        list[i] = { ...list[i], error: uploadErrorCopy(e) };
        setItems([...list]);
        edit(); // stop before the evidence POST; staged files stay
        return;
      }
      setItems([...list]);
    }
    setPhase("checking");
    const body = { file_ids: list.map((it) => it.ref!.id), ...(tracking.trim() && { tracking_number: tracking.trim() }), ...(note.trim() && { note: note.trim() }) };
    try {
      const timer = new Promise<never>((_, reject) => setTimeout(() => reject(LOST), WAIT_MS));
      onDone(await Promise.race([api<DealView>(`/api/deals/${deal.code}/evidence`, { json: body }), timer]));
    } catch (e) {
      if (e === LOST || (e instanceof ApiError && e.code === "internal_error" && e.message === "network")) setPhase("lost");
      else if (e instanceof ApiError && e.code === "paypal_error") onPaypalError(e);
      else {
        edit();
        fail(e);
      }
    }
  }

  if (phase !== "edit") return <WaitScreen conditions={deal.conditions} uploaded={phase !== "uploading"} progress={progress} lost={phase === "lost"} />;

  const status = tracking.trim() ? carrierLabel(carrierStatus(tracking)) : null;
  return (
    <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
      <div>
        <h3 className="text-sm font-semibold">What your photos must show</h3>
        <ol className="mt-2 grid gap-2 text-sm">
          {deal.conditions.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span className="w-5 shrink-0 text-right text-[var(--hs-muted)]">{c.position}.</span>
              <span className="flex-1">
                {c.text}
                {failed.has(c.id) && (
                  <span className="mt-1 flex items-center gap-2 text-[var(--hs-status-voided)]"><VerdictIcon result="fail" /> Failed last time: {failed.get(c.id)}</span>
                )}
              </span>
              <span className="hs-badge shrink-0 self-start">{c.evidence_type === "photo" ? "Photo" : "Tracking"}</span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <p className="hs-label">Photos (up to {MAX})</p>
        <p id="photos-help" className="hs-help">
          Clear and well lit, the whole item in frame.{hasCode && ` One photo must show the deal code ${deal.code} written by hand next to the item.`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* no `capture` attribute: the OS sheet offers camera or gallery (08 section 7.7) */}
          <label className={`hs-btn-secondary cursor-pointer ${items.length >= MAX ? "pointer-events-none opacity-50" : ""}`}>
            Add photos
            <input type="file" accept="image/*" multiple className="sr-only" aria-describedby="photos-help" disabled={items.length >= MAX} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </label>
          <span className="text-sm text-[var(--hs-muted)]">{items.length} of {MAX}</span>
        </div>
        {notice && <p role="alert" className="mt-2 text-sm text-[var(--hs-status-voided)]">{notice}</p>}
        {items.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {items.map((it, i) => (
              <li key={it.key} className="text-xs">
                <Thumb photo={photos[i]} onClick={() => lb.open(i)} />
                <span className="mt-1 flex items-center justify-between text-[var(--hs-muted)]">
                  <span>{formatBytes(it.blob.size)}</span>
                  <button type="button" className="hs-link font-medium" onClick={() => remove(it.key)}>Remove</button>
                </span>
                {it.listing && <span className="mt-1 flex items-center gap-1 text-[var(--hs-status-voided)]"><VerdictIcon result="fail" /> This is one of the listing photos; remove it</span>}
                {it.error && <span className="mt-1 block text-[var(--hs-status-voided)]">{it.error}</span>}
              </li>
            ))}
          </ul>
        )}
        {lb.lightbox}
      </div>

      <div>
        <label htmlFor="tracking" className="hs-label">Tracking number {demo && <span className="hs-badge ml-1">Demo carrier (mock)</span>}</label>
        <input id="tracking" data-testid="tracking-input" className="hs-input w-full font-mono" autoCapitalize="characters" value={tracking} onChange={(e) => setTracking(e.target.value)} aria-describedby="tracking-help" aria-invalid={!!trackingCond && !tracking.trim()} />
        <p id="tracking-help" className="hs-help mt-1">
          {trackingCond && <>Required for: {trackingCond.text}. </>}
          {demo && "Sandbox carrier: a number ending in an even digit shows as delivered, an odd digit as in transit. "}
          {status && <span className="text-[var(--hs-ink)]">Carrier status: {status}.</span>}
        </p>
      </div>

      <div>
        <label htmlFor="note" className="hs-label">Note to the buyer (optional)</label>
        <textarea id="note" className="hs-input w-full py-2" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="note-help" />
        <p id="note-help" className="hs-help mt-1 flex justify-between gap-3">
          <span>Anything the buyer should know. Claude reads it as information, never as instructions.</span>
          <span>{note.length}/1000</span>
        </p>
      </div>

      {preset && (
        <div>
          <p className="hs-label">Use sample evidence</p>
          {/* T-33: one button per set of the deal's preset (12.4); each clears the staged photos, stages the set plus the canvas code photo (12.3) and fills TRK-DEMO-0000 */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(preset.sets).map(([id, s]) => (
              <button key={id} type="button" className="hs-btn-secondary" data-testid={`use-sample-evidence-${id}`} onClick={() => void stageSample(id)}>{s.label}</button>
            ))}
          </div>
          <p className="hs-help mt-1">{Object.values(preset.sets).map((s) => `${s.label}: ${s.purpose}`).join(" ")}</p>
        </div>
      )}

      <div>
        <button type="submit" data-testid="submit-evidence" data-primary-action className="hs-btn w-full sm:w-auto" disabled={!ready}>Submit proof for checking</button>
        <p className="hs-help mt-2">{fix ? "This is your last attempt." : "Submitting is final for this attempt. If a condition fails, you get one fix."}</p>
      </div>
    </form>
  );
}
