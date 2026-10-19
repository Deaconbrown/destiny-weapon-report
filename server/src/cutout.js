// Cuts a weapon out of Bungie's studio backdrop so the page can show it on its own
// background. Bungie only publishes the screenshot with the backdrop baked in.
//
// 1. Fit a smooth surface (2D cubic per colour channel) to the backdrop, refitting on
//    background-only pixels a few times so the gun doesn't skew it.
// 2. Pixels that differ clearly from that surface are the gun; close small gaps.
// 3. Flood-fill the backdrop in from the image border; anything it can't reach is enclosed by
//    the gun. Then drop: faint blobs touching the edge (the backdrop's corner vignette), small
//    faint blobs, and enclosed areas that still look like backdrop (between prongs, bow arms).
// 4. Soft alpha on the edge band, see-through glow, backdrop colour removed from edge pixels.
// 5. Glow check: energy glow carries on past the cut-out's edge. If too much of the ring
//    around the gun still differs from the backdrop, the cut-out is not used (the page shows
//    the original picture instead).
// The result is trimmed to the gun's outline and cached as WebP.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUTOUT_DIR = path.join(__dirname, "..", "cache", "cutouts");

const HI = 26; // clearly different from the backdrop
const LO = 9; // edge band starts fading in here
const GLOW_LIMIT = 25; // % of the ring around the gun still off-backdrop -> use the original
const TRIM_MARGIN = 12;
const RIM_DIFF = 55; // the backdrop rim differs from the model by less than this
const BORDER = 140; // px strip along the picture's edges where the backdrop's rim lives

// Bump whenever the cut-out method changes: it goes into the picture link (?v=), so browsers
// fetch the new image instead of a cached old one.
export const CUTOUT_VERSION = 3;

const inFlight = new Map();

// Weapons the cut-out can't do well (parts the same grey as Bungie's backdrop get lost);
// these always show the original picture instead. Add hashes as they're spotted.
const FORCE_ORIGINAL = new Set([
  4062069077, // Conspiracy Honed (S29): grey stock blends into the backdrop
]);

function terms(x, y) {
  return [1, x, y, x * x, x * y, y * y, x * x * x, x * x * y, x * y * y, y * y * y];
}

function solve(a, b) {
  const n = b.length;
  const m = a.map((row) => [...row]);
  const v = [...b];
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    [v[i], v[p]] = [v[p], v[i]];
    const d = m[i][i] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = m[r][i] / d;
      if (f === 0) continue;
      for (let c = i; c < n; c++) m[r][c] -= f * m[i][c];
      v[r] -= f * v[i];
    }
  }
  return v.map((val, i) => val / (m[i][i] || 1e-12));
}

// Separable square dilate/erode on a 0/1 mask.
function morph(mask, w, h, r, dilate) {
  const want = dilate ? 1 : 0;
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - want;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && mask[y * w + xx] === want) { v = want; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - want;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && tmp[yy * w + x] === want) { v = want; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

// Visits each 4-connected component of pixels where include(i) is true.
function forEachComponent(w, h, include, visit) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !include(start)) continue;
    const members = [];
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
      for (const j of neighbours) {
        if (j >= 0 && !seen[j] && include(j)) { seen[j] = 1; stack[top++] = j; }
      }
    }
    visit(members);
  }
}

export function cutOutWeapon(px, w, h) {
  const n = w * h;
  const nx = (x) => (x / (w - 1)) * 2 - 1;
  const ny = (y) => (y / (h - 1)) * 2 - 1;

  // 1. backdrop model, fitted on a sparse grid
  const step = 6;
  const isBg = new Uint8Array(n).fill(1);
  let coef = [[], [], []];
  for (let round = 0; round < 4; round++) {
    for (let ch = 0; ch < 3; ch++) {
      const ata = Array.from({ length: 10 }, () => new Array(10).fill(0));
      const atb = new Array(10).fill(0);
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          if (!isBg[y * w + x]) continue;
          const t = terms(nx(x), ny(y));
          const val = px[(y * w + x) * 4 + ch];
          for (let i = 0; i < 10; i++) {
            atb[i] += t[i] * val;
            for (let j = 0; j < 10; j++) ata[i][j] += t[i] * t[j];
          }
        }
      }
      coef[ch] = solve(ata, atb);
    }
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const t = terms(nx(x), ny(y));
        let d = 0;
        for (let ch = 0; ch < 3; ch++) {
          let bg = 0;
          for (let k = 0; k < 10; k++) bg += coef[ch][k] * t[k];
          d = Math.max(d, Math.abs(px[(y * w + x) * 4 + ch] - bg));
        }
        isBg[y * w + x] = d < 16 ? 1 : 0;
      }
    }
  }

  // 2. per-pixel difference from the backdrop
  const bgCol = new Float32Array(n * 3);
  const diff = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = terms(nx(x), ny(y));
      const i = y * w + x;
      let d2 = 0;
      for (let ch = 0; ch < 3; ch++) {
        let bg = 0;
        for (let k = 0; k < 10; k++) bg += coef[ch][k] * t[k];
        bgCol[i * 3 + ch] = bg;
        const dd = px[i * 4 + ch] - bg;
        d2 += dd * dd;
      }
      diff[i] = Math.sqrt(d2);
    }
  }

  let fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = diff[i] > HI ? 1 : 0;
  fg = morph(morph(fg, w, h, 4, true), w, h, 4, false);

  // 3. flood the backdrop in from the border; whatever it can't reach is gun
  const reached = new Uint8Array(n);
  const stack = new Int32Array(n * 2 + 8);
  let top = 0;
  for (let x = 0; x < w; x++) { stack[top++] = x; stack[top++] = (h - 1) * w + x; }
  for (let y = 0; y < h; y++) { stack[top++] = y * w; stack[top++] = y * w + w - 1; }
  while (top > 0) {
    const i = stack[--top];
    if (reached[i] || fg[i]) continue;
    reached[i] = 1;
    const x = i % w;
    if (x > 0 && !reached[i - 1]) stack[top++] = i - 1;
    if (x < w - 1 && !reached[i + 1]) stack[top++] = i + 1;
    if (i >= w && !reached[i - w]) stack[top++] = i - w;
    if (i < w * (h - 1) && !reached[i + w]) stack[top++] = i + w;
  }
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = reached[i] ? 0 : 1;
  // the rim along the picture's edge is low-contrast; drop it inside the border strip so it
  // can't stay joined to a gun that runs off the edge (bows, long barrels)
  for (let i = 0; i < n; i++) {
    if (!solid[i] || diff[i] >= RIM_DIFF) continue;
    const x = i % w, y = (i - x) / w;
    if (x < BORDER || x >= w - BORDER || y < BORDER || y >= h - BORDER) solid[i] = 0;
  }

  // 3b. corner vignette blobs, small faint blobs
  forEachComponent(w, h, (i) => solid[i] === 1, (members) => {
    let sum = 0;
    let touches = false;
    let inBorder = 0;
    for (const i of members) {
      sum += diff[i];
      const x = i % w, y = (i - x) / w;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) touches = true;
      if (x < BORDER || x >= w - BORDER || y < BORDER || y >= h - BORDER) inBorder++;
    }
    const mean = sum / members.length;
    const faintBlob = mean < 32 && members.length < 30000;
    // the backdrop's lighter rim: hugs the picture's edge (mostly inside the border strip)
    const rim = touches && inBorder / members.length > 0.6;
    if ((touches && mean < 48) || rim || members.length < 400 || faintBlob) for (const i of members) solid[i] = 0;
  });

  // 3c. backdrop trapped inside the outline
  forEachComponent(w, h, (i) => solid[i] === 1 && fg[i] === 0, (members) => {
    let sum = 0;
    for (const i of members) sum += diff[i];
    if (members.length > 150 && sum / members.length < 20) for (const i of members) solid[i] = 0;
  });

  // 5 (measured before alpha). glow left in the ring around the gun
  const ringOuter = morph(solid, w, h, 18, true);
  const ringInner = morph(solid, w, h, 3, true);
  let ringPx = 0;
  let ringHigh = 0;
  const EDGE = 60; // the backdrop's vignette near the picture's edges isn't glow
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i - x) / w;
    if (x < EDGE || x >= w - EDGE || y < EDGE || y >= h - EDGE) continue;
    if (ringOuter[i] && !ringInner[i]) { ringPx++; if (diff[i] > 14) ringHigh++; }
  }
  const glowScore = ringPx ? (ringHigh * 100) / ringPx : 0;

  // 4. alpha + colour (straight, not premultiplied: that's what sharp expects)
  const core = morph(solid, w, h, 2, false);
  const halo = morph(solid, w, h, 2, true);
  const out = Buffer.alloc(n * 4);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    let a = core[i] ? 1 : halo[i] ? Math.min(1, Math.max(0, (diff[i] - LO) / (HI - LO))) : 0;
    if (a > 0) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      if (sat > 0.35 && diff[i] < 110) a = Math.min(a, Math.max(0.05, (diff[i] - LO) / (110 - LO)));
    }
    for (let ch = 0; ch < 3; ch++) {
      const p = px[i * 4 + ch];
      const c = a >= 1 ? p : a > 0 ? Math.min(255, Math.max(0, (p - (1 - a) * bgCol[i * 3 + ch]) / a)) : 0;
      out[i * 4 + ch] = Math.round(c);
    }
    out[i * 4 + 3] = Math.round(a * 255);
    if (out[i * 4 + 3] > 12) {
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }

  const box = x1 < 0 ? null : {
    left: Math.max(0, x0 - TRIM_MARGIN),
    top: Math.max(0, y0 - TRIM_MARGIN),
    width: Math.min(w - 1, x1 + TRIM_MARGIN) - Math.max(0, x0 - TRIM_MARGIN) + 1,
    height: Math.min(h - 1, y1 + TRIM_MARGIN) - Math.max(0, y0 - TRIM_MARGIN) + 1,
  };
  return { rgba: out, box, glowScore };
}

// Bungie's own picture, cropped to the gun with some room around it, darkened and with its
// edges faded out, so it sits on the dark page like a cut-out does.
async function croppedOriginal(source, info, box) {
  const padX = Math.round(box.width * 0.12), padY = Math.round(box.height * 0.12);
  const left = Math.max(0, box.left - padX), top = Math.max(0, box.top - padY);
  const width = Math.min(info.width, box.left + box.width + padX) - left;
  const height = Math.min(info.height, box.top + box.height + padY) - top;
  const fade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="#fff"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/></svg>`
  );
  // contrast x1.35 around mid-grey, then 72% brightness: out = 0.972 * in - 32
  return sharp(source)
    .extract({ left, top, width, height })
    .linear(0.972, -32)
    .ensureAlpha()
    .composite([{ input: fade, blend: "dest-in" }])
    .webp({ quality: 85, alphaQuality: 90 })
    .toBuffer();
}

async function buildCutout(hash, screenshotUrl, { forceOriginal = false } = {}) {
  const res = await fetch(screenshotUrl);
  if (!res.ok) throw new Error(`Screenshot fetch failed: ${res.status}`);
  const source = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const { rgba, box, glowScore } = cutOutWeapon(data, info.width, info.height);
  const useOriginal = forceOriginal || !box || glowScore > GLOW_LIMIT;
  const meta = { hash, useOriginal, forceOriginal, glowScore: Math.round(glowScore * 10) / 10, box, version: CUTOUT_VERSION, createdAt: new Date().toISOString() };

  let webp;
  if (!useOriginal) {
    webp = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract(box)
      .webp({ quality: 88, alphaQuality: 90 })
      .toBuffer();
  } else if (box) {
    webp = await croppedOriginal(source, info, box);
  }
  await fs.mkdir(CUTOUT_DIR, { recursive: true });
  if (webp) await fs.writeFile(path.join(CUTOUT_DIR, `${hash}.webp`), webp);
  meta.hasImage = Boolean(webp);
  await fs.writeFile(path.join(CUTOUT_DIR, `${hash}.json`), JSON.stringify(meta));
  return meta;
}

// Returns { file, kind } (kind "cutout" or "original"), or { file: null } when there's no
// image (the page then shows Bungie's full picture). Made once per weapon, then cached.
export async function getCutout(hash, screenshotUrl) {
  const metaPath = path.join(CUTOUT_DIR, `${hash}.json`);
  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    if (meta.version !== CUTOUT_VERSION) meta = null;
  } catch {
    meta = null;
  }
  if (!meta) {
    const forceOriginal = FORCE_ORIGINAL.has(hash);
    if (!inFlight.has(hash)) inFlight.set(hash, buildCutout(hash, screenshotUrl, { forceOriginal }).finally(() => inFlight.delete(hash)));
    meta = await inFlight.get(hash);
  }
  return meta.hasImage
    ? { file: path.join(CUTOUT_DIR, `${hash}.webp`), kind: meta.useOriginal ? "original" : "cutout", glowScore: meta.glowScore }
    : { file: null, glowScore: meta.glowScore };
}
