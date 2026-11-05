// Procedural photo studio (browser module): builds a table-top scene from a shot spec and path-traces it to a JPEG.
// All geometry and textures are generated here, so the images are ours and carry no third-party marks. Driven by render.mjs.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PhysicalCamera, WebGLPathTracer } from "three-gpu-pathtracer";

const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---- Surfaces --------------------------------------------------------------------------------------------------------------
const wood = (base, dark, seed) =>
  canvasTexture(2048, 2048, (g, w, h) => {
    const r = rnd(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const y = r() * h;
      g.strokeStyle = dark;
      g.globalAlpha = 0.03 + r() * 0.12;
      g.lineWidth = 0.6 + r() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 128) g.lineTo(x, y + Math.sin(x / 300 + y / 90) * 7 + (r() - 0.5) * 3);
      g.stroke();
    }
    g.globalAlpha = 1;
  });

const SURFACES = {
  oak: () => ({ map: wood("#b98f5e", "#6d4a26", 11), roughness: 0.55, repeat: 1.2 }),
  walnut: () => ({ map: wood("#5c3d29", "#2a1a10", 23), roughness: 0.42, repeat: 1.2 }),
  linen: () => ({
    map: canvasTexture(1024, 1024, (g, w, h) => {
      const r = rnd(5);
      g.fillStyle = "#d9d2c3";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 3) {
        g.fillStyle = `rgba(90,80,60,${0.04 + r() * 0.07})`;
        g.fillRect(i, 0, 1, h);
        g.fillRect(0, i, w, 1);
      }
    }),
    roughness: 0.95,
    repeat: 4,
  }),
  concrete: () => ({
    map: canvasTexture(1024, 1024, (g, w, h) => {
      const r = rnd(9);
      g.fillStyle = "#9c9a94";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `rgba(${r() > 0.5 ? "255,255,255" : "40,40,40"},${r() * 0.05})`;
        g.beginPath();
        g.arc(r() * w, r() * h, r() * 14, 0, 7);
        g.fill();
      }
    }),
    roughness: 0.85,
    repeat: 2,
  }),
  white: () => ({ color: "#ece9e2", roughness: 0.32, repeat: 1 }),
};

function surface(name) {
  const s = SURFACES[name]();
  if (s.map) s.map.repeat.set(s.repeat, s.repeat);
  return new THREE.MeshStandardMaterial({ map: s.map ?? null, color: s.color ?? "#ffffff", roughness: s.roughness });
}

// ---- Light: a window, a soft fill and a dim room, as a floating point equirect ------------------------------------------------
function environment({ az = 0.25, el = 0.32, size = 0.2, power = 26, warm = 0.0, ambient = 0.75 }) {
  const W = 1024;
  const H = 512;
  const d = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 1 = zenith in three's equirect
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const sky = 0.55 + 0.45 * v;
      let [rr, gg, bb] = [ambient * sky * (1 + warm), ambient * sky, ambient * sky * (1 - warm)];
      const du = Math.min(Math.abs(u - az), 1 - Math.abs(u - az));
      const dv = Math.abs(v - (0.5 + el / 2));
      const edge = Math.max(du / size, dv / (size * 1.4));
      if (edge < 1) {
        const f = power * Math.min(1, (1 - edge) * 6);
        rr += f * (1 + warm * 0.4);
        gg += f;
        bb += f * (1 - warm * 0.4);
      }
      const i = (y * W + x) * 4;
      d.set([rr, gg, bb, 1], i);
    }
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---- Items -------------------------------------------------------------------------------------------------------------------
const lathe = (pts, material, seg = 128) => {
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), material);
  return m;
};
const smooth = (pts, n = 200) => new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(n).map((p) => [Math.max(0, p.x), p.y]);
const tube = (pts, radius, material) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 120, radius, 32), material);
const std = (o) => new THREE.MeshStandardMaterial(o);
const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};
function group(...children) {
  const g = new THREE.Group();
  children.forEach((c) => g.add(c));
  return g;
}

function roundedBox(w, h, d, r, mat) {
  const s = new THREE.Shape();
  const [x, y] = [-w / 2, -d / 2];
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: h - 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 4, curveSegments: 16 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.1, 0);
  return new THREE.Mesh(geo, mat);
}

const glaze = (hex, band, dots) =>
  canvasTexture(1024, 512, (g, w, h) => {
    const r = rnd(31);
    g.fillStyle = hex;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      g.fillStyle = `rgba(${r() > 0.6 ? "255,255,255" : "0,0,20"},${r() * 0.1})`;
      g.beginPath();
      g.arc(r() * w, r() * h, r() * 1.8, 0, 7);
      g.fill();
    }
    g.fillStyle = band;
    g.fillRect(0, h * 0.075, w, h * 0.028);
    if (dots) {
      g.fillStyle = band;
      for (const [u, v] of [[0.885, 0.5], [0.93, 0.5], [0.975, 0.5]]) {
        g.beginPath();
        g.ellipse(u * w, v * h, 10, 20, 0, 0, 7);
        g.fill();
      }
    }
  });

/** Lathe UVs follow the profile length; re-map v to height so a band or motif lands where it is painted. */
function heightUV(m, height) {
  const { position, uv } = m.geometry.attributes;
  for (let i = 0; i < uv.count; i++) uv.setY(i, position.getY(i) / height);
}

function mug({ color = "#1d4f9e", band = "#eef2f7" } = {}) {
  const map = glaze(color, band, true);
  map.wrapT = THREE.ClampToEdgeWrapping;
  const body = lathe(smooth([[0, 0], [3.3, 0], [3.75, 0.06], [4.08, 0.55], [4.2, 1.4], [4.2, 5], [4.2, 8.9], [4.14, 9.4], [4.0, 9.5], [3.86, 9.42], [3.8, 8.9]]), std({ map, roughness: 0.16, metalness: 0 }));
  heightUV(body, 9.5);
  const inner = std({ color: "#f4f1ea", roughness: 0.2 });
  const inside = lathe(smooth([[0, 0.56], [3.25, 0.66], [3.72, 1.35], [3.77, 9.0]]), inner);
  const handle = tube([[3.95, 7.7, 0], [5.9, 7.7, 0], [7.3, 6.5, 0], [7.2, 4.2, 0], [5.8, 2.9, 0], [3.95, 2.5, 0]], 0.62, std({ color, roughness: 0.16 }));
  const g = group(body, inside, handle);
  g.userData.height = 9.5;
  return g;
}

const lampShade = (color) => std({ color, roughness: 0.95, side: THREE.DoubleSide });
function woodLamp() {
  const w = wood("#b07d4a", "#5d3a1c", 41);
  const woodM = std({ map: w, roughness: 0.48 });
  const brass = std({ color: "#b48b45", metalness: 1, roughness: 0.32 });
  const base = lathe(smooth([[0, 0], [8.2, 0], [8.5, 0.5], [8.2, 2.2], [7.8, 2.5], [0, 2.5]]), woodM);
  const stem = tube([[0, 2.2, 0], [0.2, 16, 0], [0.5, 30, 0]], 0.95, woodM);
  const joint = mesh(new THREE.SphereGeometry(1.35, 32, 24), brass, 0.5, 30, 0);
  const arm = tube([[0.5, 30, 0], [7, 33.5, 0], [12.5, 34, 0]], 0.75, woodM);
  const shade = lathe(smooth([[9.5, 0], [7.2, 3.4], [4.1, 7.8]], 60), lampShade("#e6dcc4"));
  shade.position.set(13, 25.5, 0);
  const collar = mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.8, 32), brass, 13, 33.8, 0);
  const cord = tube([[-1, 1, -7], [-5, 0.15, -11], [-20, 0.15, -14]], 0.2, std({ color: "#3a2a20", roughness: 0.7 }));
  const g = group(base, stem, joint, arm, shade, collar, cord);
  g.userData.height = 36;
  return g;
}

function metalLamp() {
  const black = std({ color: "#17181a", metalness: 0.75, roughness: 0.32 });
  const base = roundedBox(16, 1.1, 11, 1.5, black);
  const a1 = tube([[-4, 1, 0], [-7, 13, 0], [-9, 24, 0]], 0.42, black);
  const a2 = tube([[-9, 24, 0], [0, 30, 0], [10, 32, 0]], 0.42, black);
  const knob = mesh(new THREE.SphereGeometry(1, 24, 16), std({ color: "#b02a22", roughness: 0.3 }), -9, 24, 0);
  const dome = lathe(smooth([[0, 7], [3, 6.6], [6.4, 3.6], [8.2, 0]], 60), std({ color: "#1f5a43", metalness: 0.2, roughness: 0.32, side: THREE.DoubleSide }));
  dome.position.set(11, 23.6, 0);
  const g = group(base, a1, a2, knob, dome);
  g.userData.height = 33;
  return g;
}

function bottle({ steel = "#c8c9c8", cap = "#16171a" } = {}) {
  const m = std({ color: steel, metalness: 1, roughness: 0.3 });
  const body = lathe(smooth([[0, 0], [3.8, 0], [4.45, 0.5], [4.5, 1.2], [4.5, 18.5], [4.3, 21], [3, 23.3], [2.75, 25]]), m);
  const ring = lathe(smooth([[4.53, 2.5], [4.56, 2.6], [4.56, 3.2], [4.53, 3.3]], 8), std({ color: "#3a3b3d", metalness: 0.6, roughness: 0.4 }));
  const capM = std({ color: cap, roughness: 0.42 });
  const lid = lathe(smooth([[2.9, 24.8], [3.05, 25], [3.05, 28], [2.7, 28.5], [0, 28.6]]), capM);
  const loop = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.36, 20, 48, Math.PI), capM);
  loop.position.set(0, 28.4, 0);
  const g = group(body, ring, lid, loop);
  g.userData.height = 30.3;
  return g;
}

function book({ color = "#7a1f2e", title = "THE QUIET HARBOUR", author = "M. ALDERTON" } = {}) {
  const cover = canvasTexture(1000, 1400, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e8d9a8";
    g.lineWidth = 8;
    g.strokeRect(60, 60, w - 120, h - 120);
    g.fillStyle = "#e8d9a8";
    g.textAlign = "center";
    g.font = "bold 76px Georgia, serif";
    title.split(" ").reduce((y, word) => (g.fillText(word, w / 2, y), y + 110), 380);
    g.font = "44px Georgia, serif";
    g.fillText(author, w / 2, 1190);
    g.beginPath();
    g.arc(w / 2, 900, 110, 0, 7);
    g.stroke();
  });
  const coverM = std({ map: cover, roughness: 0.55 });
  const pages = mesh(new THREE.BoxGeometry(14.7, 2.8, 21.6), std({ color: "#eae3d0", roughness: 0.9 }), 0.1, 1.5, 0);
  const plain = std({ color, roughness: 0.55 });
  const bottom = mesh(new THREE.BoxGeometry(15, 0.2, 22), plain, 0, 0.1, 0);
  const topBoard = mesh(new THREE.BoxGeometry(15, 0.2, 22), plain, 0, 2.9, 0);
  const spine = mesh(new THREE.BoxGeometry(0.3, 3, 22), plain, -7.5, 1.5, 0);
  const front = mesh(new THREE.PlaneGeometry(15, 22), coverM, 0, 3.01, 0);
  front.rotation.x = -Math.PI / 2;
  const g = group(pages, bottom, topBoard, spine, front);
  g.userData.height = 3;
  return g;
}

function keyboard({ keycap = "#e7e1d3", accent = "#d9622b", frame = "#3b3e44" } = {}) {
  const base = roundedBox(36, 2, 13, 0.8, std({ color: frame, roughness: 0.45, metalness: 0.2 }));
  const legend = "QWERTYUIOPASDFGHJKLZXCVBNM1234567890";
  const CELL = 64;
  const atlas = canvasTexture(CELL * 8, CELL * 8, (c) => {
    c.font = "26px Arial";
    for (let i = 0; i < 64; i++) {
      const [x, y] = [(i % 8) * CELL, Math.floor(i / 8) * CELL];
      c.fillStyle = i === 63 ? accent : keycap;
      c.fillRect(x, y, CELL, CELL);
      if (i < legend.length) {
        c.fillStyle = keycap < "#8" ? "#d5d5d5" : "#3a3a3a";
        c.fillText(legend[i], x + 14, y + 30);
      }
    }
  });
  const uvOf = (i) => [(i % 8) / 8, 1 - (Math.floor(i / 8) + 1) / 8];
  const keys = [];
  let n = 0;
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 15; col++) {
      const cell = row === 0 && col === 0 ? 63 : n++ % legend.length;
      const geo = new THREE.BoxGeometry(2.05, 0.9, 2.05);
      const [u0, v0] = uvOf(cell);
      const [ub, vb] = uvOf(cell === 63 ? 63 : 62); // sides use a plain cell
      const { uv } = geo.attributes;
      for (let i = 0; i < uv.count; i++) {
        const top = i >= 8 && i < 12; // BoxGeometry +y face
        uv.setXY(i, top ? u0 + uv.getX(i) / 8 : ub + 0.06, top ? v0 + uv.getY(i) / 8 : vb + 0.06);
      }
      geo.translate(-16.1 + col * 2.3, 2.3, -4.6 + row * 2.3);
      keys.push(geo);
    }
  const g = group(base, new THREE.Mesh(mergeGeometries(keys), std({ map: atlas, roughness: 0.5 })));
  g.userData.height = 2.8;
  return g;
}

function headphones({ body = "#1b1c1f", pad = "#a4764a", onEar = false } = {}) {
  const m = std({ color: body, roughness: 0.4, metalness: 0.25 });
  const padM = std({ color: pad, roughness: 0.75 });
  const radius = onEar ? 7.2 : 8.6;
  const band = new THREE.Mesh(new THREE.TorusGeometry(radius, onEar ? 0.5 : 0.85, 24, 96, Math.PI), m);
  band.position.y = onEar ? 8 : 10;
  const cup = (side) => {
    const shell = mesh(new THREE.SphereGeometry(onEar ? 3 : 4.4, 40, 28), m);
    shell.scale.set(0.55, 1.08, 1);
    const cushion = new THREE.Mesh(new THREE.TorusGeometry(onEar ? 2.1 : 3, onEar ? 0.8 : 1.15, 20, 48), padM);
    cushion.rotation.y = Math.PI / 2;
    cushion.position.x = -side * 1.5;
    return group(shell, cushion);
  };
  const y = onEar ? 6.6 : 8.2;
  const l = cup(-1);
  l.position.set(-radius, y, 0);
  const r = cup(1);
  r.position.set(radius, y, 0);
  const g = group(band, l, r);
  g.userData.height = (onEar ? 8 : 10) + radius;
  return g;
}

function clock({ color = "#b3392f" } = {}) {
  const face = canvasTexture(512, 512, (g, w) => {
    g.fillStyle = "#f6f2e6";
    g.fillRect(0, 0, w, w);
    g.fillStyle = "#222";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 46px Georgia";
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(String(i), w / 2 + Math.cos(a) * 195, w / 2 + Math.sin(a) * 195);
    }
    g.strokeStyle = "#111";
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(w / 2, w / 2);
    g.lineTo(w / 2 + 92, w / 2 - 74);
    g.moveTo(w / 2, w / 2);
    g.lineTo(w / 2 - 40, w / 2 - 158);
    g.stroke();
  });
  const m = std({ color, roughness: 0.25, metalness: 0.15 });
  const metal = std({ color: "#c5c6c8", metalness: 1, roughness: 0.25 });
  const body = mesh(new THREE.CylinderGeometry(6, 6, 3.8, 72), m, 0, 8, 0);
  body.rotation.x = Math.PI / 2;
  const dial = mesh(new THREE.CircleGeometry(5.4, 72), std({ map: face, roughness: 0.25 }), 0, 8, 1.92);
  const bell = (x) => {
    const s = mesh(new THREE.SphereGeometry(2.3, 32, 20, 0, 7, 0, Math.PI / 2), metal, x, 13.8, 0);
    s.rotation.z = -x / 14;
    return s;
  };
  const legs = [-3.8, 3.8].map((x) => tube([[x * 0.7, 3.6, 0], [x, 0.2, 0.4]], 0.4, metal));
  const g = group(body, dial, bell(-3), bell(3), ...legs);
  g.userData.height = 16;
  return g;
}

function planter({ pot = "#b9633a" } = {}) {
  const m = std({ color: pot, roughness: 0.82 });
  const body = lathe(smooth([[0, 0], [4.2, 0], [4.6, 0.4], [6.2, 10.2], [6.8, 10.4], [6.8, 11.8], [6.1, 11.9], [6, 10.8], [0, 10.6]]), m);
  const soil = mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.3, 48), std({ color: "#2a1d13", roughness: 1 }), 0, 11, 0);
  const g = group(body, soil);
  const leaf = std({ color: "#3f7a48", roughness: 0.45 });
  const r = rnd(77);
  for (let i = 0; i < 26; i++) {
    const a = r() * 7;
    const tilt = 0.2 + r() * 0.75;
    const l = mesh(new THREE.SphereGeometry(1, 20, 14), leaf);
    l.scale.set(1.15, 5.4 + r() * 2, 0.42);
    l.position.set(Math.cos(a) * tilt * 2.7, 14.4 + r() * 1.5, Math.sin(a) * tilt * 2.7);
    l.rotation.order = "YXZ";
    l.rotation.y = -a + Math.PI / 2;
    l.rotation.x = tilt * 0.9;
    g.add(l);
  }
  g.userData.height = 22;
  return g;
}

const ITEMS = {
  mug,
  "mug-red": () => mug({ color: "#a52a22", band: "#f4efe4" }),
  lamp: woodLamp,
  "lamp-other": metalLamp,
  bottle,
  "bottle-green": () => bottle({ steel: "#245c43", cap: "#c9c9c7" }),
  book,
  "book-other": () => book({ color: "#23506b", title: "NORTHERN LIGHTS ATLAS", author: "E. VANTER" }),
  keyboard,
  "keyboard-other": () => keyboard({ keycap: "#20242b", accent: "#2f86c9", frame: "#10121a" }),
  headphones,
  "headphones-other": () => headphones({ body: "#e6e6e4", pad: "#d8d8d4", onEar: true }),
  clock,
  "clock-blue": () => clock({ color: "#2a5c9a" }),
  planter,
  "planter-other": () => planter({ pot: "#e9e4d8" }),
};

// ---- Paper: a blank card, or a card with handwriting, a printed sheet or a phone showing text ------------------------------------
const CARD = { w: 11, h: 7 };
function paperTexture(lines, { font = "HsHand", ink = "#1b1b1b", size = 150, jitter = true } = {}) {
  return canvasTexture(1100, 700, (g, w, h) => {
    const r = rnd(101);
    g.fillStyle = "#faf8f1";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(120,110,90,${r() * 0.03})`;
      g.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
    if (!lines.length) return;
    g.fillStyle = ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `${size}px ${font}`;
    const step = size * 1.08;
    lines.forEach((line, i) => {
      g.save();
      g.translate(w / 2, h / 2 + (i - (lines.length - 1) / 2) * step);
      if (jitter) g.rotate(-0.035 + i * 0.01);
      g.fillText(line, 0, 0, w * 0.92);
      g.restore();
    });
  });
}

/** A card propped towards the camera; returns the mesh so render.mjs can read its projected box. */
function card({ text, printed, scale = 1 }) {
  const lines = text ? (Array.isArray(text) ? text : [text]) : [];
  const tex = paperTexture(lines, printed ? { font: "bold 86px Arial".replace("bold 86px ", ""), size: lines.length > 2 ? 66 : 96, jitter: false } : { size: lines.length > 2 ? 78 : 170 });
  const paper = std({ map: tex, roughness: 0.92 });
  const edge = std({ color: "#f3efe4", roughness: 0.9 });
  const [w, h] = [CARD.w * scale, CARD.h * scale];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), edge);
  m.position.y = h / 2;
  const front = mesh(new THREE.PlaneGeometry(w, h), paper, 0, h / 2, 0.035);
  const g = group(m, front);
  g.userData.face = m;
  return g;
}

function phone({ text }) {
  const body = roundedBox(7.6, 0.8, 15.6, 1, std({ color: "#101114", roughness: 0.3, metalness: 0.5 }));
  const screen = canvasTexture(760, 1560, (g, w, h) => {
    g.fillStyle = "#101b2c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.font = "bold 124px Arial";
    g.fillText(text, w / 2, h / 2);
    g.font = "40px Arial";
    g.fillText("Notes", w / 2, 120);
  });
  const glass = mesh(new THREE.PlaneGeometry(7.1, 15), new THREE.MeshStandardMaterial({ map: screen, emissiveMap: screen, emissive: "#ffffff", emissiveIntensity: 1.1, roughness: 0.08 }), 0, 0.84, 0);
  glass.rotation.x = -Math.PI / 2;
  const g = group(body, glass);
  g.rotation.x = 1.25;
  g.position.y = 7.4;
  return g;
}

// ---- The shot ----------------------------------------------------------------------------------------------------------------
const VIEW_DEFAULT = { az: 0, el: 16, dist: 44, fov: 38, target: 5 };

function buildScene(spec) {
  const scene = new THREE.Scene();
  const table = mesh(new THREE.PlaneGeometry(400, 400), surface(spec.surface ?? "oak"));
  table.rotation.x = -Math.PI / 2;
  scene.add(table);
  const wall = mesh(new THREE.PlaneGeometry(500, 300), std({ color: spec.wall ?? "#d8d3c9", roughness: 0.95 }), 0, 150, -(spec.wallDist ?? 60));
  scene.add(wall);

  const placed = {};
  for (const it of spec.items ?? []) {
    const obj = ITEMS[it.item](it.options);
    obj.position.set(it.x ?? 0, it.y ?? 0, it.z ?? 0);
    obj.rotation.y = it.rotY ?? 0;
    if (it.rotX) obj.rotation.x = it.rotX;
    if (it.rotZ) obj.rotation.z = it.rotZ;
    if (it.scale) obj.scale.setScalar(it.scale);
    scene.add(obj);
    placed[it.item] = obj;
  }
  if (spec.card) {
    const c = card(spec.card);
    c.position.set(spec.card.x ?? 8, spec.card.y ?? 0, spec.card.z ?? 6);
    c.rotation.y = spec.card.rotY ?? 0;
    c.rotation.x = spec.card.lean ?? -0.16;
    c.rotation.order = "YXZ";
    scene.add(c);
    placed.card = c.userData.face;
  }
  if (spec.phone) {
    const p = phone(spec.phone);
    p.position.x = spec.phone.x ?? 9;
    p.position.z = spec.phone.z ?? 6;
    scene.add(p);
  }
  return { scene, placed };
}

function makeCamera(spec, w, h) {
  const v = { ...VIEW_DEFAULT, ...spec.view };
  const cam = new PhysicalCamera(v.fov, w / h, 0.5, 2000);
  const az = THREE.MathUtils.degToRad(v.az);
  const el = THREE.MathUtils.degToRad(v.el);
  const t = new THREE.Vector3(v.tx ?? 0, v.target, v.tz ?? 0);
  cam.position.set(t.x + Math.sin(az) * Math.cos(el) * v.dist, t.y + Math.sin(el) * v.dist, t.z + Math.cos(az) * Math.cos(el) * v.dist);
  cam.lookAt(t);
  if (v.roll) cam.rotateZ(THREE.MathUtils.degToRad(v.roll));
  cam.updateMatrixWorld();
  cam.fStop = v.fStop ?? 5.6;
  cam.focusDistance = v.focus ?? cam.position.distanceTo(t);
  cam.apertureBlades = 6;
  return cam;
}

function projectedBox(face, cam, w, h) {
  const geo = face.geometry.parameters;
  const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const p = new THREE.Vector3((sx * geo.width) / 2, (sy * geo.height) / 2, geo.depth / 2 + 0.01);
    face.localToWorld(p);
    p.project(cam);
    return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h];
  });
  const cx = corners.reduce((a, c) => a + c[0], 0) / 4;
  const cy = corners.reduce((a, c) => a + c[1], 0) / 4;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const bw = (dist(corners[0], corners[1]) + dist(corners[3], corners[2])) / 2;
  const bh = (dist(corners[0], corners[3]) + dist(corners[1], corners[2])) / 2;
  const angle = Math.atan2(corners[1][1] - corners[0][1], corners[1][0] - corners[0][0]);
  return { x: Math.round(cx - bw * 0.46), y: Math.round(cy - bh * 0.42), w: Math.round(bw * 0.92), h: Math.round(bh * 0.84), angle: +angle.toFixed(3) };
}

// Film look applied after tracing: gentle vignette, sensor noise, optional blur or darkening for the "bad photo" cases.
function develop(src, spec) {
  const { width: w, height: h } = src;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const post = spec.post ?? {};
  if (post.motionBlur) {
    const n = 26;
    g.globalAlpha = 1;
    g.drawImage(src, 0, 0);
    for (let i = 1; i <= n; i++) {
      g.globalAlpha = 1 / (i + 1);
      g.drawImage(src, (i - n / 2) * post.motionBlur, (i - n / 2) * post.motionBlur * 0.35);
    }
    g.globalAlpha = 1;
  } else if (post.blur) {
    g.filter = `blur(${post.blur}px)`;
    g.drawImage(src, 0, 0);
    g.filter = "none";
  } else {
    g.drawImage(src, 0, 0);
  }
  if (post.exposure) {
    g.fillStyle = `rgba(0,0,0,${1 - post.exposure})`;
    g.fillRect(0, 0, w, h);
  }
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 1.05);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.22)");
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const r = rnd(spec.seed ?? 7);
  const amount = post.noise ?? 3.2;
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount * 2;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

let renderer;
window.renderShot = async function renderShot(spec) {
  await document.fonts.load("120px HsHand");
  const [w, h] = spec.size ?? [1600, 1200];
  renderer ??= new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = spec.exposure ?? 0.62;
  document.body.replaceChildren(renderer.domElement);

  const { scene, placed } = buildScene(spec);
  scene.environment = environment(spec.light ?? {});
  scene.background = new THREE.Color("#000");
  const cam = makeCamera(spec, w, h);
  scene.updateMatrixWorld(true);

  const tracer = new WebGLPathTracer(renderer);
  tracer.tiles.set(2, 2);
  tracer.bounces = 6;
  tracer.filterGlossyFactor = 0.4;
  tracer.minSamples = 1;
  tracer.renderScale = 1;
  tracer.setScene(scene, cam);
  const samples = spec.samples ?? 220;
  const started = performance.now();
  while (tracer.samples < samples) {
    tracer.renderSample();
    if (Math.floor(tracer.samples) % 4 === 0) await new Promise(requestAnimationFrame);
  }
  const box = placed.card ? projectedBox(placed.card, cam, w, h) : null;
  const dev = develop(renderer.domElement, spec);
  const out = dev.toDataURL("image/jpeg", spec.quality ?? 0.86);
  tracer.dispose?.();
  return { jpeg: out.slice(out.indexOf(",") + 1), box, ms: Math.round(performance.now() - started) };
};
window.studioReady = true;
