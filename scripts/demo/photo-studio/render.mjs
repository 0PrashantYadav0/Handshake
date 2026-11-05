// Renders the shots of a JSON manifest with studio.js in headless Chromium. See README.md.
// node scripts/demo/photo-studio/render.mjs <manifest.json> [--only <substring>] [--samples <n>]
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const deps = process.env.STUDIO_DEPS ?? "/tmp/hs-studio/node_modules";
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const manifest = JSON.parse(readFileSync(args[0], "utf8"));
const only = flag("--only");
const samples = flag("--samples");
const force = args.includes("--force");

const PAGE = `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:HsHand;src:url(/font.woff2)}body{margin:0;background:#000}</style>
<script type="importmap">{"imports":{"three":"/deps/three/build/three.module.js","three/addons/":"/deps/three/examples/jsm/","three/":"/deps/three/","three-mesh-bvh":"/deps/three-mesh-bvh/build/index.module.js","xatlas-web":"/deps/xatlas-web/dist/xatlas.js","three-gpu-pathtracer":"/deps/three-gpu-pathtracer/build/index.module.js"}}</script>
<span style="font-family:HsHand;position:absolute;opacity:0">x</span><script type="module" src="/studio.js"></script>`;
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  const file = url === "/studio.js" ? join(here, "studio.js") : url === "/font.woff2" ? join(root, "public/demo/fonts/handwriting.woff2") : url.startsWith("/deps/") ? join(deps, url.slice(6)) : null;
  if (!file || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
}).listen(0);
await new Promise((ok) => server.once("listening", ok));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("console", m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction("window.studioReady === true", null, { timeout: 60_000 });
const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log("gpu", gpu);

const boxes = {};
for (const shot of manifest.shots) {
  if (only && !shot.out.includes(only)) continue;
  const out = resolve(root, shot.out);
  if (!force && existsSync(out)) continue;
  mkdirSync(dirname(out), { recursive: true });
  const spec = { ...manifest.defaults, ...shot, samples: samples ? Number(samples) : (shot.samples ?? manifest.defaults?.samples) };
  const r = await page.evaluate((s) => window.renderShot(s), spec);
  writeFileSync(out, Buffer.from(r.jpeg, "base64"));
  if (r.box) boxes[shot.out] = r.box;
  console.log(`${shot.out} ${r.ms}ms${r.box ? ` box=${JSON.stringify(r.box)}` : ""}`);
}
if (Object.keys(boxes).length) {
  const p = `${args[0]}.boxes.json`;
  const old = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  writeFileSync(p, JSON.stringify({ ...old, ...boxes }, null, 1));
}
await browser.close();
server.close();
