// Placeholder demo photos (T-33) until the real ones land (T-23): a gradient, a label, and for code-base a white note card at the
// presets.json box. Pure Node, no dependencies: PNG = zlib deflate + crc32. Run `npm run demo:placeholders`; see public/demo/README.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const W = 1600;
const H = 1200;
const OUT = join(process.cwd(), "public/demo");
type Rgb = [number, number, number];
type Box = { x: number; y: number; w: number; h: number };

// 5x7 glyphs, one row per 5-bit group, top row first. Uppercase, digits, space, dash.
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e], C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e], E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f], M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f], "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00], " ": [0, 0, 0, 0, 0, 0, 0],
};

function png(rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1); // filter byte 0 per row
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function render(from: Rgb, to: Rgb, label: string, card?: Box): Buffer {
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (x + y) / (W + H);
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(from[c] + (to[c] - from[c]) * t);
    }
  }
  const fill = (x0: number, y0: number, w: number, h: number, c: Rgb) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) px.set(c, (y * W + x) * 3);
  };
  if (card) fill(card.x, card.y, card.w, card.h, [250, 248, 240]);
  const s = Math.min(16, Math.floor(W / (label.length * 6 + 2))); // glyph pixel size
  let cx = Math.floor((W - label.length * 6 * s) / 2);
  const cy = card ? 80 : Math.floor((H - 7 * s) / 2);
  for (const ch of label) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    g.forEach((row, r) => { for (let b = 0; b < 5; b++) if (row & (0x10 >> b)) fill(cx + b * s, cy + r * s, s, s, [255, 255, 255]); });
    cx += 6 * s;
  }
  return png(px);
}

const PLAN: [string, Rgb, Rgb, string, Box?][] = [
  ["reference/mug/ref-1.png", [30, 80, 170], [90, 150, 230], "MUG REF 1"],
  ["reference/mug/ref-2.png", [40, 100, 190], [120, 170, 240], "MUG REF 2"],
  ["reference/mug/code-base.png", [50, 90, 160], [130, 160, 210], "MUG CODE BASE", { x: 880, y: 620, w: 560, h: 220 }],
  ["reference/lamp/ref-1.png", [120, 80, 30], [200, 150, 80], "LAMP REF 1"],
  ["reference/lamp/ref-2.png", [140, 95, 40], [220, 170, 100], "LAMP REF 2"],
  ["reference/lamp/code-base.png", [110, 85, 50], [190, 160, 110], "LAMP CODE BASE", { x: 860, y: 640, w: 560, h: 220 }],
  ["reference/bottle/ref-1.png", [90, 100, 110], [170, 180, 190], "BOTTLE REF 1"],
  ["reference/bottle/ref-2.png", [100, 110, 120], [190, 200, 210], "BOTTLE REF 2"],
  ["reference/bottle/code-base.png", [80, 95, 105], [160, 175, 185], "BOTTLE CODE BASE", { x: 900, y: 600, w: 540, h: 220 }],
  ["evidence/good/photo-1.png", [20, 120, 90], [80, 200, 150], "GOOD MUG 1"],
  ["evidence/good/photo-2.png", [30, 130, 100], [100, 210, 170], "GOOD MUG 2"],
  ["evidence/wrong-item/photo-1.png", [150, 40, 60], [230, 110, 130], "WRONG ITEM 1"],
  ["evidence/wrong-item/photo-2.png", [160, 50, 70], [240, 130, 150], "WRONG ITEM 2"],
  ["evidence/blurry/photo-1.png", [120, 120, 120], [160, 160, 160], "BLURRY 1"],
];

for (const [rel, from, to, label, card] of PLAN) {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(from, to, label, card));
  console.log(rel);
}
