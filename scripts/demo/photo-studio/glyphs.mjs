// Renders the deal-code alphabet in the handwriting font to transparent PNGs, for lib/agents/samples.ts (no canvas on the server).
// Run once: node scripts/demo/photo-studio/glyphs.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "public/demo/glyphs");
mkdirSync(out, { recursive: true });
const CHARS = "HS-23456789ABCDEFGJKLMNPQRTUVWXYZ".split("");
const font = readFileSync(join(root, "public/demo/fonts/handwriting.woff2")).toString("base64");
const PAD = 40; // transparent margin each side, GLYPH_PAD in lib/agents/samples.ts: this font's ink runs past its advance width (F by 38 px, J left of its origin by 8)
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<canvas id=c></canvas><style>@font-face{font-family:H;src:url(data:font/woff2;base64,${font})}</style><span style="font-family:H">x</span>`);
for (const ch of CHARS) {
  const png = await page.evaluate(async ({ ch, PAD }) => {
    await document.fonts.load("200px H");
    const c = document.getElementById("c");
    const g = c.getContext("2d");
    g.font = "200px H";
    c.width = Math.ceil(g.measureText(ch).width) + 2 * PAD;
    c.height = 260;
    g.font = "200px H";
    g.textBaseline = "middle";
    g.fillStyle = "#1b1b1b";
    g.fillText(ch, PAD, 130);
    return c.toDataURL("image/png").split(",")[1];
  }, { ch, PAD });
  writeFileSync(join(out, `${ch === "-" ? "dash" : ch}.png`), Buffer.from(png, "base64"));
}
await browser.close();
console.log(`${CHARS.length} glyphs in ${out}`);
