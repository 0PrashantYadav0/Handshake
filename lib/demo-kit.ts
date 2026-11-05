// Demo kit (08 section 12; F5): presets.json types, the loader, preset lookup by sentence, and the canvas-composed code photo.
// Pure helpers up top are unit-tested; `loadPresets`, `fetchSample` and `composeCodePhoto` need a browser.
import { useEffect, useState } from "react";

export type Box = { x: number; y: number; w: number; h: number; angle: number };
export type CodePhoto = { base: string; box: Box };
export type SampleSet = { label: string; purpose: string; photos: string[]; skip_listing_check?: true; code_photo?: CodePhoto }; // code_photo: this set's item beside the card, when it is not the preset's
export type Preset = { id: string; label: string; sentence: string; reference: string[]; code_photo: CodePhoto; sets: Record<string, SampleSet> };
export type Extra = { id: string; label: string; sentence: string; preset: string };
export type Presets = { tracking_number: string; font: string; presets: Preset[]; extras: Extra[] };
export type Chip = { id: string; label: string; sentence: string };

export const PRESETS_URL = "/demo/presets.json";

/** The /new chips: the three presets then the two extras (08 section 6.1). */
export const chips = (kit: Presets): Chip[] => [...kit.presets, ...kit.extras].map(({ id, label, sentence }) => ({ id, label, sentence }));

/** 12.4: the preset whose sentence (or whose extra's sentence) equals the deal's source text after trimming; else the preset named in the text; else the first. */
export function findPreset(kit: Presets, sourceText: string): Preset {
  const text = sourceText.trim();
  const extra = kit.extras.find((e) => e.sentence.trim() === text);
  const exact = kit.presets.find((p) => p.id === extra?.preset || p.sentence.trim() === text);
  return exact ?? kit.presets.find((p) => text.toLowerCase().includes(p.id)) ?? kit.presets[0]; // a negotiated price changes the sentence, not the item
}

let cached: Promise<Presets> | null = null;
export const loadPresets = (): Promise<Presets> => (cached ??= fetch(PRESETS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${PRESETS_URL} ${r.status}`)))));

/** The kit once fetched, null before and when `enabled` is false. */
export function usePresets(enabled: boolean): Presets | null {
  const [kit, setKit] = useState<Presets | null>(null);
  useEffect(() => {
    if (enabled) loadPresets().then(setKit, console.error);
  }, [enabled]);
  return kit;
}

/** A public kit file as a File so it takes the same staging path as a chosen one. */
export async function fetchSample(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const blob = await res.blob();
  return new File([blob], url.split("/").pop() ?? "photo", { type: blob.type });
}

/** 12.3: the deal code drawn in the handwriting font on the preset's base photo; a 1600 px JPEG so `downscale` is a no-op. */
export async function composeCodePhoto(baseImageUrl: string, code: string, box: Box, fontUrl = "/demo/fonts/handwriting.woff2"): Promise<File> {
  let family = "cursive";
  try {
    document.fonts.add(await new FontFace("HsHand", `url(${fontUrl})`).load());
    family = "HsHand";
  } catch (e) {
    console.warn("handwriting font unavailable, using cursive", e);
  }
  const img = await createImageBitmap(await (await fetch(baseImageUrl)).blob());
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  img.close();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.rotate(box.angle);
  ctx.font = `${Math.floor(box.h * 0.55)}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1b1b1b";
  ctx.fillText(code, 0, 0, box.w * 0.9);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("encode failed");
  return new File([blob], "code.jpg", { type: "image/jpeg" });
}
