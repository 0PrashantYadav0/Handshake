// The demo kit on the server (docs/agents.md): photos read from public/demo and the deal code written on the card, for agents with
// no browser. Only reachable while DEMO_LOGIN=true. Same font and box as the browser's composeCodePhoto in lib/demo-kit.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Box, Presets, Preset } from "@/lib/demo-kit";
import { DealError } from "@/lib/deal/errors";

const PUBLIC = join(process.cwd(), "public");
const read = (url: string) => readFileSync(join(PUBLIC, url));
const GLYPH_PX = 200; // scripts/demo/photo-studio/glyphs.mjs renders every glyph at this font size
const GLYPH_PAD = 40; // and with this transparent margin each side, because the ink runs past the advance width

export const kit = (): Presets => JSON.parse(read("/demo/presets.json").toString("utf8")) as Presets;
export const presetOf = (text: string): Preset => {
  const k = kit();
  return k.presets.find((p) => text.toLowerCase().includes(p.id)) ?? k.presets[0]!;
};

/** The deal code on the card of a base photo, as JPEG bytes. */
export async function composeCode(baseUrl: string, code: string, box: Box): Promise<Uint8Array> {
  const target = Math.floor(box.h * 0.55);
  const glyphs = await Promise.all(
    [...code].map(async (ch) => {
      const name = ch === "-" ? "dash" : ch;
      const buf = read(`/demo/glyphs/${name}.png`);
      const { width, height } = await sharp(buf).metadata();
      return { buf, width: width!, height: height! };
    }),
  );
  const advance = (g: { width: number }) => g.width - 2 * GLYPH_PAD;
  const natural = glyphs.reduce((sum, g) => sum + advance(g), 0);
  const scale = Math.min(target / GLYPH_PX, (box.w * 0.9) / natural);
  let x = 0;
  let width = 0;
  const parts = [];
  for (const g of glyphs) {
    const w = Math.max(1, Math.round(g.width * scale));
    parts.push({ input: await sharp(g.buf).resize(w, Math.max(1, Math.round(g.height * scale))).png().toBuffer(), left: x, top: 0 });
    width = Math.max(width, x + w);
    x += Math.round(advance(g) * scale);
  }
  const height = Math.max(1, Math.round(glyphs[0]!.height * scale));
  const line = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts).png().toBuffer();
  const rotated = await sharp(line).rotate((box.angle * 180) / Math.PI, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const m = await sharp(rotated).metadata();
  const left = Math.round(box.x + box.w / 2 - m.width! / 2);
  const top = Math.round(box.y + box.h / 2 - m.height! / 2);
  return new Uint8Array(await sharp(read(baseUrl)).composite([{ input: rotated, left, top }]).jpeg({ quality: 85 }).toBuffer());
}

/** The listing photos for the item a deal is about. */
export function listingPhotos(sourceText: string): Uint8Array[] {
  return presetOf(sourceText).reference.map((u) => new Uint8Array(read(u)));
}

/** The photos of one sample set plus its composed code photo. */
export async function samplePhotos(sourceText: string, code: string, setId: string): Promise<Uint8Array[]> {
  const preset = presetOf(sourceText);
  const set = Object.hasOwn(preset.sets, setId) ? preset.sets[setId] : undefined; // an agent's string: not "constructor" off the prototype
  if (!set) throw new DealError("invalid_input", `This item has these sample sets: ${Object.keys(preset.sets).join(", ")}.`);
  const { base, box } = set.code_photo ?? preset.code_photo;
  return [...set.photos.map((u) => new Uint8Array(read(u))), await composeCode(base, code, box)];
}
