// ai-excited-01 — "The Dragon Gate"
// A koi leaps up a river of stars toward the full moon and turns into a dragon
// mid-leap. Rendered procedurally, pixel by pixel, with a seeded RNG only:
// no network, no assets, no Date.now — the same bytes every run.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// The program writes ONE image to $MAKEFUN_OUTPUT_DIR/entry.png (1024x1024 PNG).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — the only source of randomness in the whole program.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261116);

// ---------------------------------------------------------------------------
// Framebuffer + colour helpers
// ---------------------------------------------------------------------------
const fb = new Uint8Array(W * H * 4); // RGBA, alpha channel always 255 at the end

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Source-over blend of one pixel.
function blend(px: number, py: number, r: number, g: number, b: number, a: number): void {
  const x = px | 0, y = py | 0;
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const ia = 1 - a;
  fb[i] = r * a + fb[i] * ia;
  fb[i + 1] = g * a + fb[i + 1] * ia;
  fb[i + 2] = b * a + fb[i + 2] * ia;
}

// Additive blend (light): brightens what is already there.
function add(px: number, py: number, r: number, g: number, b: number, a: number): void {
  const x = px | 0, y = py | 0;
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  fb[i] = Math.min(255, fb[i] + r * a);
  fb[i + 1] = Math.min(255, fb[i + 1] + g * a);
  fb[i + 2] = Math.min(255, fb[i + 2] + b * a);
}

// Soft radial glow: additive, quadratic falloff.
function radialGlow(cx: number, cy: number, radius: number, r: number, g: number, b: number, peak: number): void {
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(W - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(H - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / radius;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const f = (1 - d2) * (1 - d2);
      add(x, y, r, g, b, peak * f);
    }
  }
}

// Solid disc, optionally with a soft edge (edge = fraction of radius that fades).
function disc(cx: number, cy: number, radius: number, r: number, g: number, b: number, a: number, edge = 0): void {
  const x0 = Math.max(0, Math.floor(cx - radius - 1)), x1 = Math.min(W - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1)), y1 = Math.min(H - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d >= 1) continue;
      const alpha = edge > 0 && d > 1 - edge ? a * (1 - d) / edge : a;
      blend(x, y, r, g, b, alpha);
    }
  }
}

// Ellipse drawn as a sampled polygon (optionally rotated).
function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, r: number, g: number, b: number, a: number): void {
  const pts: [number, number][] = [];
  const cos = Math.cos(rot), sin = Math.sin(rot);
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
    pts.push([cx + ex * cos - ey * sin, cy + ex * sin + ey * cos]);
  }
  fillPoly(pts, r, g, b, a);
}

// Scanline polygon fill.
function fillPoly(pts: [number, number][], r: number, g: number, b: number, a: number): void {
  if (pts.length < 3 || a <= 0) return;
  let minY = H - 1, maxY = 0;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) blend(x, y, r, g, b, a);
    }
  }
}

// Thick polyline: a chain of discs. Width in pixels.
function strokePolyline(pts: [number, number][], width: number, r: number, g: number, b: number, a: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / (width * 0.35)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(lerp(x1, x2, t), lerp(y1, y2, t), width / 2, r, g, b, a, 0.25);
    }
  }
}

// Tapered stroke: width shrinks from w0 to w1 along the path.
function taperedStroke(pts: [number, number][], w0: number, w1: number, r: number, g: number, b: number, a: number): void {
  let total = 0;
  const segLen: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segLen.push(l); total += l;
  }
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const len = segLen[i];
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const w = lerp(w0, w1, (acc + len * t) / total);
      disc(lerp(x1, x2, t), lerp(y1, y2, t), Math.max(0.6, w / 2), r, g, b, a, 0.3);
    }
    acc += len;
  }
}

// Cubic bezier sampled to a polyline.
function bezier(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

// A ribbon (tapering band) between two bezier curves: left edge and right edge.
function ribbon(left: [number, number][], right: [number, number][], r: number, g: number, b: number, a: number): void {
  const n = Math.min(left.length, right.length);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push(left[i]);
  for (let i = n - 1; i >= 0; i--) pts.push(right[i]);
  fillPoly(pts, r, g, b, a);
}

// Four-point sparkle star.
function sparkle(cx: number, cy: number, size: number, r: number, g: number, b: number, a: number): void {
  radialGlow(cx, cy, size * 2.2, r, g, b, a * 0.5);
  strokePolyline([[cx - size, cy], [cx + size, cy]], Math.max(1, size * 0.14), r, g, b, a);
  strokePolyline([[cx, cy - size], [cx, cy + size]], Math.max(1, size * 0.14), r, g, b, a);
  disc(cx, cy, size * 0.22, 255, 255, 255, a);
}

// ---------------------------------------------------------------------------
// PNG encoding (zlib + CRC32, stdlib only)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Per-row filter selection (None/Sub/Up/Average/Paeth): pick the filter whose
  // filtered bytes have the smallest sum of absolute values, the standard
  // heuristic — it matters a lot for smooth gradients.
  const stride = w * 4;
  const raw = new Uint8Array(h * (1 + stride));
  const prev = new Uint8Array(stride);
  const cand = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    let bestF = 0, bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const left = x >= 4 ? row[x - 4] : 0;
        const up = prev[x];
        const upLeft = x >= 4 ? prev[x - 4] : 0;
        let pred = 0;
        if (f === 1) pred = left;
        else if (f === 2) pred = up;
        else if (f === 3) pred = (left + up) >> 1;
        else if (f === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        const v = (row[x] - pred) & 255;
        cand[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestF = f; }
    }
    // Rebuild the winning filtered row (cheap: recompute once for bestF).
    const out = raw.subarray(y * (1 + stride) + 1, (y + 1) * (1 + stride));
    raw[y * (1 + stride)] = bestF;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = prev[x];
      const upLeft = x >= 4 ? prev[x - 4] : 0;
      let pred = 0;
      if (bestF === 1) pred = left;
      else if (bestF === 2) pred = up;
      else if (bestF === 3) pred = (left + up) >> 1;
      else if (bestF === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[x] = (row[x] - pred) & 255;
    }
    prev.set(row);
  }
  const idat = deflateSync(raw, { level: 9 });
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ---------------------------------------------------------------------------
// The scene: "The Dragon Gate"
// ---------------------------------------------------------------------------
function paintSky(): void {
  // Vertical gradient: deep indigo at the top, violet, then teal near the horizon.
  const stops: [number, string][] = [
    [0.0, '#05051c'], [0.35, '#12124a'], [0.62, '#1d2a5e'], [0.82, '#274b6e'], [1.0, '#2e6f8e'],
  ];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i + 1 < stops.length; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
    const ca = hexRgb(a[1]), cb = hexRgb(b[1]);
    const r = lerp(ca[0], cb[0], f), g = lerp(ca[1], cb[1], f), bl = lerp(ca[2], cb[2], f);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      fb[i] = r; fb[i + 1] = g; fb[i + 2] = bl; fb[i + 3] = 255;
    }
  }
}

function paintStars(): void {
  // Background starfield, denser and brighter near the top.
  for (let i = 0; i < 520; i++) {
    const x = rng() * W;
    const y = Math.pow(rng(), 1.4) * H * 0.85;
    const s = 0.5 + rng() * 1.6;
    const warm = rng() < 0.25;
    const a = 0.25 + rng() * 0.65;
    if (s > 1.7 && rng() < 0.5) {
      sparkle(x, y, s * 2.2, warm ? 255 : 210, warm ? 230 : 225, warm ? 200 : 255, a);
    } else {
      disc(x, y, s, warm ? 255 : 220, warm ? 235 : 230, warm ? 205 : 255, a);
    }
  }
}

function paintMoon(): void {
  const mx = 772, my = 238, mr = 148;
  // Halo and sky glow around the moon.
  radialGlow(mx, my, 430, 255, 205, 110, 0.30);
  radialGlow(mx, my, 240, 255, 225, 160, 0.45);
  // Disc with a soft radial shading (brighter upper-left).
  for (let y = Math.floor(my - mr); y <= Math.ceil(my + mr); y++) {
    for (let x = Math.floor(mx - mr); x <= Math.ceil(mx + mr); x++) {
      const d = Math.hypot(x - mx, y - my) / mr;
      if (d >= 1) continue;
      const shade = 1 - 0.16 * smoothstep(0.2, 1, d) - 0.10 * smoothstep(-0.6, 0.9, (x - mx) / mr * 0.6 + (y - my) / mr * 0.6);
      const edge = d > 0.94 ? (1 - d) / 0.06 : 1;
      blend(x, y, 255 * shade, 248 * shade, 214 * shade, edge);
    }
  }
  // Craters: soft darker patches, seeded.
  const craters: [number, number, number, number][] = [
    [-58, -42, 26, 0.10], [34, -68, 18, 0.09], [72, 18, 30, 0.08], [-20, 52, 22, 0.10],
    [8, -8, 12, 0.09], [-88, 30, 14, 0.08], [52, 74, 16, 0.09], [-40, -92, 12, 0.07],
    [96, -48, 12, 0.08], [-6, 96, 14, 0.07], [18, 38, 9, 0.08], [-70, -12, 9, 0.07],
  ];
  for (const [dx, dy, r, a] of craters) {
    disc(mx + dx, my + dy, r, 214, 186, 130, a, 0.5);
    disc(mx + dx - r * 0.25, my + dy - r * 0.25, r * 0.7, 226, 198, 142, a * 0.6, 0.5);
  }
}

function paintClouds(): void {
  // A few dark violet clouds drifting low, built from soft overlapping discs.
  const clouds: [number, number, number, number][] = [
    [180, 300, 150, 0.16], [330, 330, 110, 0.13], [880, 560, 170, 0.15],
    [700, 620, 120, 0.12], [120, 640, 130, 0.12], [950, 180, 110, 0.10],
  ];
  for (const [cx, cy, r, a] of clouds) {
    for (let i = 0; i < 9; i++) {
      const ox = (rng() - 0.5) * r * 1.6;
      const oy = (rng() - 0.5) * r * 0.5;
      const rr = r * (0.35 + rng() * 0.45);
      const [cr, cg, cb] = hexRgb('#3a2a5e');
      disc(cx + ox, cy + oy, rr, cr, cg, cb, a, 0.6);
    }
  }
}

function paintStarRiver(): void {
  // A glowing river of stars cascading from the moon down to the lower-left:
  // the path the koi is climbing. Wide soft band first, then dense star dots.
  const path = bezier([820, 300], [700, 520], [420, 700], [170, 905], 60);
  // Soft band: layered strokes, wide and faint to narrow and bright.
  for (const [w, a] of [[120, 0.05], [80, 0.07], [46, 0.10], [24, 0.14]] as [number, number][]) {
    const [r, g, b] = hexRgb('#4fc3e8');
    strokePolyline(path, w, r, g, b, a);
  }
  // Dense stars along the band, brighter near the moon.
  for (let i = 0; i < 420; i++) {
    const t = Math.pow(rng(), 0.8);
    const idx = Math.floor(t * (path.length - 1));
    const [bx, by] = path[idx];
    const spread = 26 + (1 - t) * 60;
    const x = bx + (rng() - 0.5) * spread * 2;
    const y = by + (rng() - 0.5) * spread * 2;
    const s = 0.6 + rng() * 2.0;
    const a = 0.35 + rng() * 0.6;
    if (s > 2.1) sparkle(x, y, s * 2.4, 190, 235, 255, a);
    else disc(x, y, s, 200, 240, 255, a);
  }
  // A few big glowing orbs drifting in the river.
  for (let i = 0; i < 14; i++) {
    const t = rng();
    const idx = Math.floor(t * (path.length - 1));
    const [bx, by] = path[idx];
    radialGlow(bx + (rng() - 0.5) * 40, by + (rng() - 0.5) * 40, 14 + rng() * 22, 140, 210, 255, 0.35);
  }
}

function paintMountains(): void {
  // Far ridge: many small undulations rather than a few big triangles.
  const far: [number, number][] = [[0, 1024], [0, 930]];
  const farPts: [number, number][] = [];
  for (let x = 0; x <= 1024; x += 42) {
    const base = 890 + 28 * Math.sin(x * 0.011 + 1.7) + 14 * Math.sin(x * 0.027 + 0.4);
    farPts.push([x, base + (rng() - 0.5) * 16]);
  }
  for (const p of farPts) far.push(p);
  far.push([1024, 940], [1024, 1024]);
  fillPoly(far, 22, 35, 63, 1);
  // Mist band.
  for (let y = 900; y < 960; y++) {
    const a = 0.10 * (1 - Math.abs(y - 930) / 30);
    for (let x = 0; x < W; x++) blend(x, y, 160, 195, 225, a);
  }
  // Near ridge, darker, lower, also undulating.
  const near: [number, number][] = [[0, 1024], [0, 985]];
  for (let x = 0; x <= 1024; x += 48) {
    const base = 965 + 16 * Math.sin(x * 0.014 + 3.1) + 8 * Math.sin(x * 0.033 + 1.2);
    near.push([x, base + (rng() - 0.5) * 10]);
  }
  near.push([1024, 1024]);
  fillPoly(near, 10, 17, 32, 1);
}

// ---------------------------------------------------------------------------
// The koi-dragon
// ---------------------------------------------------------------------------
function koiSpine(): { pts: [number, number][]; widths: number[] } {
  const spine = bezier([220, 790], [360, 690], [500, 540], [640, 420], 80);
  const widths: number[] = [];
  for (let i = 0; i < spine.length; i++) {
    const t = i / (spine.length - 1);
    // Tail narrow -> mid-body wide and deep -> head base medium.
    const w = 18 + 70 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.10 + t * 0.95)), 0.8);
    widths.push(w);
  }
  return { pts: spine, widths };
}

function paintKoi(): void {
  const { pts, widths } = koiSpine();
  // Soft golden glow behind the whole fish.
  for (let i = 0; i < pts.length; i += 4) {
    radialGlow(pts[i][0], pts[i][1], widths[i] * 2.2, 255, 140, 40, 0.10);
  }
  // Body outline: build the left/right edge polygon from spine + normals.
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i];
    left.push([x - dy * w, y + dx * w]);
    right.push([x + dy * w, y - dx * w]);
  }
  const bodyPoly: [number, number][] = [...left, ...right.reverse()];
  // Dark outline (drawn slightly larger first).
  const outlinePoly: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i] + 5;
    outlinePoly.push([x - dy * w, y + dx * w]);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y] = pts[i];
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i] + 5;
    outlinePoly.push([x + dy * w, y - dx * w]);
  }
  fillPoly(outlinePoly, 92, 31, 8, 1);
  // Round off the flat cut at the tail base so the body does not end in a
  // straight edge: a dark cap, then a body-coloured cap.
  disc(pts[0][0], pts[0][1], widths[0] + 5, 92, 31, 8, 1);
  disc(pts[0][0], pts[0][1], widths[0], 232, 88, 20, 1);
  // Body base: warm orange.
  fillPoly(bodyPoly, 232, 88, 20, 1);
  // Belly: pale stripe along the lower (outer) edge of the curve.
  const belly: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i];
    belly.push([x + dy * w * 0.55, y - dx * w * 0.55]);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y] = pts[i];
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i];
    belly.push([x + dy * w * 0.95, y - dx * w * 0.95]);
  }
  fillPoly(belly, 255, 214, 150, 0.9);
  // Dorsal stripe: darker red-orange along the upper edge.
  const dorsal: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i];
    dorsal.push([x - dy * w * 0.98, y + dx * w * 0.98]);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y] = pts[i];
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i];
    dorsal.push([x - dy * w * 0.45, y + dx * w * 0.45]);
  }
  fillPoly(dorsal, 178, 52, 12, 0.85);

  // Scales: soft arcs along the body.
  for (let i = 6; i < pts.length - 8; i += 5) {
    const [x, y] = pts[i];
    const row = (i / 5) % 2;
    const off = (row - 0.5) * widths[i] * 0.7;
    const [nx, ny] = i + 1 < pts.length ? pts[i + 1] : pts[i - 1];
    const [px, py] = i > 0 ? pts[i - 1] : pts[i];
    let dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    disc(x - dy * off, y + dx * off, 8, 200, 70, 16, 0.38, 0.6);
    disc(x - dy * off, y + dx * off, 4.5, 255, 150, 70, 0.3, 0.6);
  }

  // Dorsal fin: a sail that sticks OUT above the body's upper edge, so its
  // silhouette reads against the sky instead of hugging the body.
  const finL = bezier([415, 618], [420, 520], [470, 445], [545, 408], 24);
  const finR = bezier([415, 618], [445, 575], [495, 520], [540, 478], 24);
  const finPoly: [number, number][] = [];
  for (const p of finL) finPoly.push(p);
  for (let i = finR.length - 1; i >= 0; i--) finPoly.push(finR[i]);
  fillPoly(finPoly, 255, 140, 66, 0.9);
  strokePolyline(finL, 4, 160, 50, 12, 0.9);

  // Pectoral fin: a flowing ribbon that sticks OUT below the belly edge.
  const pecL = bezier([495, 600], [455, 670], [405, 725], [340, 765], 20);
  const pecR = bezier([495, 600], [480, 680], [440, 740], [395, 775], 20);
  const pecPoly: [number, number][] = [];
  for (const p of pecL) pecPoly.push(p);
  for (let i = pecR.length - 1; i >= 0; i--) pecPoly.push(pecR[i]);
  fillPoly(pecPoly, 255, 170, 90, 0.85);
  strokePolyline(pecL, 3, 200, 80, 20, 0.8);

  // Tail: two big flowing ribbons fanning out behind the tail base, kept
  // inside the canvas so they read as fins, not as strokes cut by the edge.
  const tb = pts[0];
  const tail1L = bezier(tb, [tb[0] - 60, tb[1] + 10], [tb[0] - 140, tb[1] - 25], [tb[0] - 195, tb[1] - 75], 24);
  const tail1R = bezier(tb, [tb[0] - 45, tb[1] + 45], [tb[0] - 110, tb[1] + 40], [tb[0] - 170, tb[1] - 5], 24);
  ribbon(tail1L, tail1R, 255, 150, 70, 0.9);
  const tail2L = bezier(tb, [tb[0] - 50, tb[1] + 70], [tb[0] - 100, tb[1] + 140], [tb[0] - 100, tb[1] + 180], 24);
  const tail2R = bezier(tb, [tb[0] - 20, tb[1] + 60], [tb[0] - 40, tb[1] + 130], [tb[0] - 60, tb[1] + 170], 24);
  ribbon(tail2L, tail2R, 255, 190, 110, 0.85);
  // Tail veins.
  strokePolyline(tail1L, 3, 200, 70, 16, 0.7);
  strokePolyline(tail2L, 3, 200, 70, 16, 0.7);

  paintHead(pts);
}

function paintHead(spine: [number, number][]): void {
  // Head sits at the end of the spine, pointing up-right toward the moon.
  const tip = spine[spine.length - 1];
  const prev = spine[spine.length - 6];
  let dx = tip[0] - prev[0], dy = tip[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const ang = Math.atan2(dy, dx);
  const hx = tip[0] + dx * 34, hy = tip[1] + dy * 34;

  // Golden glow around the head.
  radialGlow(hx, hy, 120, 255, 180, 60, 0.35);

  // Head shape: ellipse along the tangent, then a snout. Bigger than the
  // body base so the head reads as a head, not as a continuation of the tube.
  ellipse(hx, hy, 68, 50, ang, 92, 31, 8, 1); // outline
  ellipse(hx, hy, 61, 44, ang, 240, 110, 30, 1); // base
  ellipse(hx + dx * 12, hy + dy * 12, 40, 30, ang, 255, 190, 110, 0.9); // face light
  // Snout.
  const snout: [number, number][] = [
    [hx + dx * 50 - dy * 24, hy + dy * 50 + dx * 24],
    [hx + dx * 88 - dy * 10, hy + dy * 88 + dx * 10],
    [hx + dx * 88 + dy * 10, hy + dy * 88 - dx * 10],
    [hx + dx * 50 + dy * 24, hy + dy * 50 - dx * 24],
  ];
  fillPoly(snout, 250, 140, 50, 1);
  // Mouth: a dark open crescent under the snout, big enough to read.
  const mouth = bezier(
    [hx + dx * 56 - dy * 18, hy + dy * 56 + dx * 18],
    [hx + dx * 68 - dy * 6, hy + dy * 68 + dx * 6],
    [hx + dx * 78 + dy * 4, hy + dy * 78 - dx * 4],
    [hx + dx * 84 + dy * 14, hy + dy * 84 - dx * 14], 10);
  strokePolyline(mouth, 8, 90, 25, 8, 1);
  disc(hx + dx * 72 - dy * 2, hy + dy * 72 + dx * 2, 5, 90, 25, 8, 1);

  // Gill plate: a curved dark line separating head from body.
  const gill = bezier(
    [hx - dx * 30 - dy * 40, hy - dy * 30 + dx * 40],
    [hx - dx * 38 - dy * 18, hy - dy * 38 + dx * 18],
    [hx - dx * 36 + dy * 12, hy - dy * 36 - dx * 12],
    [hx - dx * 28 + dy * 38, hy - dy * 28 - dx * 38], 12);
  strokePolyline(gill, 5, 150, 45, 10, 0.85);

  // Eye: fierce golden dragon eye, bigger and brighter.
  const ex = hx - dy * 18 + dx * 8, ey = hy + dx * 18 + dy * 8;
  disc(ex, ey, 18, 255, 244, 214, 1);
  disc(ex, ey, 13, 255, 190, 60, 1);
  disc(ex + dx * 2, ey + dy * 2, 6.5, 20, 8, 4, 1);
  disc(ex - 4, ey - 5, 3.5, 255, 255, 255, 0.95);
  // Brow ridge.
  const brow = bezier(
    [ex - dx * 22 - dy * 12, ey - dy * 22 + dx * 12],
    [ex - dx * 7 - dy * 17, ey - dy * 7 + dx * 17],
    [ex + dx * 10 - dy * 15, ey + dy * 10 - dx * 15],
    [ex + dx * 22 - dy * 8, ey + dy * 22 - dx * 8], 10);
  strokePolyline(brow, 7, 120, 40, 10, 1);

  // Golden horns: two bold antlers sweeping up-left from the top of the
  // head, against the dark sky — explicit coordinates so they cannot hide.
  // Head centre is near (665, 398); the horns rise from its top edge.
  const horn1 = bezier([640, 352], [595, 285], [545, 235], [505, 195], 16);
  taperedStroke(horn1, 15, 3, 255, 205, 70, 1);
  const horn2 = bezier([662, 340], [625, 265], [595, 205], [575, 150], 16);
  taperedStroke(horn2, 14, 3, 255, 215, 90, 1);
  // Horn tines: short branches that make the antlers read as antlers.
  strokePolyline([[565, 255], [525, 215]], 6, 255, 205, 70, 1);
  strokePolyline([[605, 235], [575, 195]], 6, 255, 215, 90, 1);
  // Gold glints on the horns.
  radialGlow(520, 210, 26, 255, 220, 120, 0.5);
  radialGlow(585, 170, 22, 255, 220, 120, 0.5);

  // Long flowing whiskers from the snout, trailing BEHIND the head (the
  // fish is moving up-right, so whiskers stream down-left) in wide S-curves.
  // Control points are bowed sideways off the straight line so the whiskers
  // curve instead of reading as straight scratches.
  const w1 = bezier([730, 340], [652, 392], [592, 472], [575, 565], 20);
  taperedStroke(w1, 7, 1.5, 255, 220, 130, 0.95);
  const w2 = bezier([724, 355], [659, 419], [619, 489], [625, 575], 20);
  taperedStroke(w2, 7, 1.5, 255, 220, 130, 0.95);

  // Water droplets + embers bursting around the head.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const d = 60 + rng() * 150;
    const x = hx + Math.cos(a) * d, y = hy + Math.sin(a) * d * 0.8;
    const s = 1.5 + rng() * 3.5;
    if (rng() < 0.5) {
      disc(x, y, s, 190, 230, 255, 0.85);
      disc(x - s * 0.3, y - s * 0.3, s * 0.4, 255, 255, 255, 0.9);
    } else {
      radialGlow(x, y, s * 3, 255, 170, 60, 0.6);
      disc(x, y, s * 0.7, 255, 200, 90, 0.9);
    }
  }
}

function paintDrift(): void {
  // Cherry-blossom petals and embers drifting through the air.
  for (let i = 0; i < 26; i++) {
    const x = rng() * W, y = rng() * H * 0.9;
    const rot = rng() * Math.PI;
    const s = 5 + rng() * 7;
    ellipse(x, y, s, s * 0.55, rot, 255, 143, 171, 0.55 + rng() * 0.3);
    disc(x, y, 1.6, 255, 220, 230, 0.8);
  }
  for (let i = 0; i < 34; i++) {
    const x = rng() * W, y = rng() * H;
    const s = 1 + rng() * 2.4;
    radialGlow(x, y, s * 4, 255, 160, 60, 0.35 + rng() * 0.3);
    disc(x, y, s * 0.6, 255, 190, 90, 0.85);
  }
  // Trailing droplets behind the tail.
  const tail = [220, 790] as [number, number];
  for (let i = 0; i < 22; i++) {
    const x = tail[0] - rng() * 160 - 10;
    const y = tail[1] + (rng() - 0.5) * 150;
    const s = 1.5 + rng() * 3.5;
    disc(x, y, s, 180, 225, 255, 0.8);
    disc(x - s * 0.3, y - s * 0.3, s * 0.4, 255, 255, 255, 0.9);
  }
}

function paintVignette(): void {
  // Darken the corners a touch for drama.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const v = smoothstep(1.05, 1.45, d) * 0.22;
      if (v <= 0) continue;
      const i = (y * W + x) * 4;
      fb[i] *= 1 - v; fb[i + 1] *= 1 - v; fb[i + 2] *= 1 - v;
    }
  }
  // Fine grain so flat areas do not band (kept tiny: grain is what bloats a PNG).
  for (let i = 0; i < W * H * 4; i += 4) {
    const n = (rng() - 0.5) * 2;
    fb[i] = clamp(fb[i] + n, 0, 255);
    fb[i + 1] = clamp(fb[i + 1] + n, 0, 255);
    fb[i + 2] = clamp(fb[i + 2] + n, 0, 255);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  paintSky();
  paintStars();
  paintMoon();
  paintClouds();
  paintStarRiver();
  paintMountains();
  paintKoi();
  paintDrift();
  paintVignette();
  for (let i = 3; i < fb.length; i += 4) fb[i] = 255;
  const png = encodePng(fb, W, H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
