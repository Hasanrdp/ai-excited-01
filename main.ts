// The Dragon Gate — ai-excited-01 entry v3 (rebuilt from scratch).
// A koi leaps up a river of stars toward the full moon, turning into a dragon mid-leap.
// Procedural 1024x1024 PNG, fully deterministic (seeded PRNG), Node 22 stdlib only.
// Writes entry.png to MAKEFUN_OUTPUT_DIR (or /output).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const SEED = 20261116;

// ---------------------------------------------------------------- seeded PRNG
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const rand = (lo: number, hi: number): number => lo + rnd() * (hi - lo);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------- CRC32 (PNG)
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w: number, h: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- framebuffer
const fb = Buffer.alloc(W * H * 3); // RGB, 8 bit

function blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H || a <= 0) return;
  const i = (yi * W + xi) * 3;
  if (a >= 1) {
    fb[i] = r;
    fb[i + 1] = g;
    fb[i + 2] = b;
    return;
  }
  const ia = 1 - a;
  fb[i] = Math.round(fb[i] * ia + r * a);
  fb[i + 1] = Math.round(fb[i + 1] * ia + g * a);
  fb[i + 2] = Math.round(fb[i + 2] * ia + b * a);
}

function hspan(x0: number, x1: number, y: number, r: number, g: number, b: number, a: number): void {
  if (y < 0 || y >= H || a <= 0) return;
  const xa = Math.max(0, Math.ceil(x0));
  const xb = Math.min(W - 1, Math.floor(x1));
  if (xa > xb) return;
  let i = (y * W + xa) * 3;
  if (a >= 1) {
    for (let x = xa; x <= xb; x++, i += 3) {
      fb[i] = r;
      fb[i + 1] = g;
      fb[i + 2] = b;
    }
  } else {
    const ia = 1 - a;
    for (let x = xa; x <= xb; x++, i += 3) {
      fb[i] = Math.round(fb[i] * ia + r * a);
      fb[i + 1] = Math.round(fb[i + 1] * ia + g * a);
      fb[i + 2] = Math.round(fb[i + 2] * ia + b * a);
    }
  }
}

function circle(cx: number, cy: number, rad: number, r: number, g: number, b: number, a: number): void {
  if (rad <= 0) return;
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  const rr = rad * rad;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const dx = Math.sqrt(Math.max(0, rr - dy * dy));
    hspan(cx - dx, cx + dx, y, r, g, b, a);
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, a: number): void {
  if (rx <= 0 || ry <= 0) return;
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    const dx = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    hspan(cx - dx, cx + dx, y, r, g, b, a);
  }
}

// Scanline-filled polygon.
function poly(pts: Array<[number, number]>, r: number, g: number, b: number, a: number): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yC = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      if ((p0[1] <= yC && p1[1] > yC) || (p1[1] <= yC && p0[1] > yC)) {
        const t = (yC - p0[1]) / (p1[1] - p0[1]);
        xs.push(p0[0] + t * (p1[0] - p0[0]));
      }
    }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) hspan(xs[i], xs[i + 1], y, r, g, b, a);
  }
}

// Tapering stroke along a polyline (overlapping circles).
function stroke(pts: Array<[number, number]>, radii: number[], r: number, g: number, b: number, a: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i][0];
    const y0 = pts[i][1];
    const x1 = pts[i + 1][0];
    const y1 = pts[i + 1][1];
    const rad0 = radii[i];
    const rad1 = radii[i + 1];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, Math.min(rad0, rad1) * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const rad = rad0 + (rad1 - rad0) * t;
      if (rad > 0.4) circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rad, r, g, b, a);
    }
  }
}

// Thin arc stroke (1px dots along the arc).
function arcStroke(cx: number, cy: number, rad: number, a0: number, a1: number, r: number, g: number, b: number, a: number): void {
  const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) * rad));
  for (let s = 0; s <= steps; s++) {
    const ang = a0 + ((a1 - a0) * s) / steps;
    blend(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, r, g, b, a);
  }
}

// Soft radial glow (additive-ish light falloff).
function glow(cx: number, cy: number, rad: number, r: number, g: number, b: number, peak: number): void {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d);
      blend(x, y, r, g, b, peak * f);
    }
  }
}

// Cubic Bezier point / tangent.
type Pt = [number, number];
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
  ];
}
function cubicTan(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const dx =
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy =
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

// Piecewise-linear key lookup.
function keyAt(keys: Array<[number, number]>, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return keys[keys.length - 1][1];
}
function colorAt(stops: Array<[number, [number, number, number]]>, t: number): [number, number, number] {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(lerp(c0[0], c1[0], f)),
        Math.round(lerp(c0[1], c1[1], f)),
        Math.round(lerp(c0[2], c1[2], f)),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// Four-point sparkle.
function sparkle(x: number, y: number, s: number, r: number, g: number, b: number, a: number): void {
  for (let i = -s; i <= s; i++) {
    const f = 1 - Math.abs(i) / (s + 1);
    blend(x + i, y, r, g, b, a * f);
    blend(x, y + i, r, g, b, a * f);
  }
  circle(x, y, Math.max(1, s * 0.22), r, g, b, a);
}

// ---------------------------------------------------------------- scene
const MOON: Pt = [775, 205];
const MOON_R = 105;
const RIVER_A: Pt = [70, 975];
const RIVER_B: Pt = [775, 205];
const WATER_Y = 885;
// The hero's spine: tail in the splash, head reaching for the moon.
const SP0: Pt = [285, 900];
const SP1: Pt = [150, 600];
const SP2: Pt = [560, 700];
const SP3: Pt = [715, 320];

const BODY_R: Array<[number, number]> = [
  [0, 9],
  [0.1, 26],
  [0.25, 48],
  [0.45, 58],
  [0.65, 52],
  [0.85, 40],
  [1, 30],
];
const BODY_C: Array<[number, [number, number, number]]> = [
  [0, [228, 108, 38]],
  [0.35, [232, 112, 42]],
  [0.55, [214, 88, 44]],
  [0.75, [198, 58, 46]],
  [1, [186, 48, 52]],
];

function drawSky(): void {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [9, 13, 42]],
    [0.35, [22, 26, 72]],
    [0.7, [44, 34, 86]],
    [0.86, [58, 40, 96]],
    [1, [20, 30, 62]],
  ];
  for (let y = 0; y < H; y++) {
    const c = colorAt(stops, y / H);
    hspan(0, W - 1, y, c[0], c[1], c[2], 1);
  }
  // Wispy clouds, very subtle.
  const clouds: Array<[number, number, number, number, number]> = [
    [200, 160, 130, 26, 0.08],
    [880, 430, 110, 22, 0.07],
    [120, 430, 90, 18, 0.06],
    [520, 120, 100, 20, 0.07],
  ];
  for (const [cx, cy, rx, ry, a] of clouds) {
    ellipse(cx, cy, rx, ry, 182, 172, 224, a);
    ellipse(cx + rx * 0.4, cy + 6, rx * 0.6, ry * 0.7, 182, 172, 224, a);
    ellipse(cx - rx * 0.4, cy + 5, rx * 0.55, ry * 0.65, 182, 172, 224, a);
  }
}

function drawStars(): void {
  // Background field.
  const cols: Array<[number, number, number]> = [
    [255, 255, 255],
    [255, 255, 255],
    [190, 205, 255],
    [255, 232, 185],
  ];
  for (let i = 0; i < 480; i++) {
    const x = rand(0, W - 1);
    const y = rand(0, 870);
    if (Math.hypot(x - MOON[0], y - MOON[1]) < MOON_R + 26) continue;
    const c = cols[Math.floor(rnd() * cols.length)];
    const a = rand(0.35, 1);
    const s = rnd() < 0.85 ? 1 : 2;
    if (s === 1) blend(x, y, c[0], c[1], c[2], a);
    else circle(x, y, 1.4, c[0], c[1], c[2], a);
  }
  // The river of stars: a diffuse band, then dense stars along it.
  const dx = RIVER_B[0] - RIVER_A[0];
  const dy = RIVER_B[1] - RIVER_A[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    const bx = RIVER_A[0] + dx * t;
    const by = RIVER_A[1] + dy * t;
    glow(bx, by, 96 - 42 * t, 148, 164, 255, 0.1);
  }
  // A soft luminous core along the river's spine.
  {
    const core: Pt[] = [];
    const coreR: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      core.push([RIVER_A[0] + dx * t, RIVER_A[1] + dy * t]);
      coreR.push(30 - 16 * t);
    }
    stroke(core, coreR, 158, 172, 255, 0.1);
  }
  for (let i = 0; i < 950; i++) {
    const t = rnd();
    const bx = RIVER_A[0] + dx * t;
    const by = RIVER_A[1] + dy * t;
    const halfW = (170 - 120 * t) / 2;
    const off = (rnd() + rnd() + rnd() - 1.5) * halfW;
    const x = bx + nx * off;
    const y = by + ny * off;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    if (Math.hypot(x - MOON[0], y - MOON[1]) < MOON_R + 10) continue;
    const c = cols[Math.floor(rnd() * cols.length)];
    const a = rand(0.5, 1);
    if (rnd() < 0.72) blend(x, y, c[0], c[1], c[2], a);
    else if (rnd() < 0.8) circle(x, y, 1.6, c[0], c[1], c[2], a);
    else {
      glow(x, y, 6, c[0], c[1], c[2], 0.35);
      blend(x, y, c[0], c[1], c[2], a);
    }
  }
}

function drawMoon(): void {
  glow(MOON[0], MOON[1], 300, 255, 238, 198, 0.5);
  glow(MOON[0], MOON[1], 170, 255, 244, 214, 0.55);
  circle(MOON[0], MOON[1], MOON_R, 252, 244, 214, 1);
  // Soft maria (darker patches).
  const maria: Array<[number, number, number, number]> = [
    [-38, -18, 30, 0.1],
    [28, 24, 24, 0.09],
    [42, -34, 18, 0.08],
    [-8, 44, 20, 0.08],
    [8, -52, 14, 0.07],
  ];
  for (const [ox, oy, rr, a] of maria) {
    circle(MOON[0] + ox, MOON[1] + oy, rr, 214, 200, 170, a);
  }
  // Bright rim, upper-left.
  arcStroke(MOON[0], MOON[1], MOON_R - 2, Math.PI * 0.75, Math.PI * 1.45, 255, 250, 230, 0.9);
}

function drawWater(): void {
  // Dark water band.
  for (let y = WATER_Y; y < H; y++) {
    const f = (y - WATER_Y) / (H - WATER_Y);
    const c = colorAt(
      [
        [0, [26, 42, 78]],
        [0.5, [16, 30, 58]],
        [1, [10, 20, 44]],
      ],
      f,
    );
    hspan(0, W - 1, y, c[0], c[1], c[2], 1);
  }
  // Moon reflection column.
  for (let i = 0; i < 34; i++) {
    const y = WATER_Y + 8 + i * 4 + rand(-2, 2);
    const wdt = rand(24, 92) * (1 - i / 48);
    const x = MOON[0] + rand(-26, 26);
    hspan(x - wdt / 2, x + wdt / 2, y, 250, 226, 170, rand(0.18, 0.45));
  }
  // Shimmer streaks.
  for (let i = 0; i < 42; i++) {
    const y = rand(WATER_Y + 4, H - 6);
    const x = rand(0, W - 120);
    const wdt = rand(30, 150);
    hspan(x, x + wdt, y, 96, 136, 188, rand(0.08, 0.22));
  }
  // Surface line.
  hspan(0, W - 1, WATER_Y, 120, 150, 205, 0.5);
  hspan(0, W - 1, WATER_Y + 1, 90, 120, 175, 0.35);
}

function drawSplash(): void {
  const cx = 290;
  const cy = WATER_Y;
  // Foam at the surface.
  ellipse(cx, cy + 3, 74, 13, 205, 228, 255, 0.85);
  ellipse(cx - 52, cy + 5, 30, 9, 190, 218, 250, 0.7);
  ellipse(cx + 56, cy + 5, 28, 9, 190, 218, 250, 0.7);
  // Rising crown arcs.
  for (let k = 0; k < 4; k++) {
    const rr = 30 + k * 14;
    arcStroke(cx, cy + 6, rr, Math.PI * 1.08, Math.PI * 1.92, 200, 225, 252, 0.65 - k * 0.1);
  }
  // Droplets fanning up and out.
  for (let i = 0; i < 95; i++) {
    const ang = Math.PI + rand(-0.9, 0.9) + (rnd() < 0.5 ? 0 : 0);
    const dist = rand(12, 118) * (1 - Math.abs(ang - Math.PI * 1.5) / 2.2);
    const x = cx + Math.cos(ang - Math.PI / 2) * dist * 1.15;
    const y = cy - Math.abs(Math.sin(ang)) * dist * 0.9 - rand(0, 26);
    const s = rand(0.8, 4.2);
    circle(x, y, s, 205, 228, 252, rand(0.5, 0.95));
  }
}

// Sample the spine into N points with position, tangent and radius.
function spineSamples(n: number): Array<{ p: Pt; tan: Pt; r: number }> {
  const out: Array<{ p: Pt; tan: Pt; r: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ p: cubic(SP0, SP1, SP2, SP3, t), tan: cubicTan(SP0, SP1, SP2, SP3, t), r: keyAt(BODY_R, t) });
  }
  return out;
}

function drawDragon(): void {
  const S = spineSamples(120);
  const at = (t: number): { p: Pt; tan: Pt; r: number } => {
    const f = clamp(t, 0, 1) * 120;
    const i = Math.min(119, Math.floor(f));
    const fr = f - i;
    const a = S[i];
    const b = S[i + 1];
    return {
      p: [lerp(a.p[0], b.p[0], fr), lerp(a.p[1], b.p[1], fr)],
      tan: [lerp(a.tan[0], b.tan[0], fr), lerp(a.tan[1], b.tan[1], fr)],
      r: lerp(a.r, b.r, fr),
    };
  };
  // Underside normal (points down, toward the water).
  const downNormal = (tan: Pt): Pt => {
    const n: Pt = [-tan[1], tan[0]];
    return n[1] < 0 ? [-n[0], -n[1]] : n;
  };

  // Tail fin: two flowing lobes trailing from the tail tip (curved edges).
  const tail = S[0].p;
  const lobe1: Pt[] = [];
  for (let i = 0; i <= 16; i++) lobe1.push(cubic([tail[0] - 6, tail[1] - 18], [238, 950], [196, 1000], [212, 1014], i / 16));
  for (let i = 16; i >= 0; i--) lobe1.push(cubic([212, 1014], [258, 992], [288, 950], [306, 928], i / 16));
  poly(lobe1, 255, 172, 104, 0.55);
  const lobe2: Pt[] = [];
  for (let i = 0; i <= 16; i++) lobe2.push(cubic([tail[0] + 8, tail[1] - 10], [330, 952], [366, 1002], [352, 1018], i / 16));
  for (let i = 16; i >= 0; i--) lobe2.push(cubic([352, 1018], [318, 988], [300, 946], [296, 922], i / 16));
  poly(lobe2, 250, 234, 200, 0.45);
  stroke(
    [
      [tail[0], tail[1]],
      [238, 960],
      [208, 1000],
    ],
    [3, 2, 1],
    210, 120, 60, 0.5,
  );
  stroke(
    [
      [tail[0], tail[1]],
      [322, 962],
      [352, 1004],
    ],
    [3, 2, 1],
    210, 120, 60, 0.5,
  );

  // Dorsal fin along the top edge (koi half).
  const topPts: Pt[] = [];
  const outPts: Pt[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = 0.12 + (0.62 - 0.12) * (i / 60);
    const s = at(t);
    const n = downNormal(s.tan);
    const up: Pt = [-n[0], -n[1]];
    topPts.push([s.p[0] + up[0] * s.r * 0.82, s.p[1] + up[1] * s.r * 0.82]);
    const wave = 16 + 14 * Math.sin(i * 0.55);
    outPts.push([s.p[0] + up[0] * (s.r * 0.82 + wave), s.p[1] + up[1] * (s.r * 0.82 + wave)]);
  }
  poly([...topPts, ...outPts.reverse()], 222, 92, 52, 0.55);

  // Main body: overlapping circles along the spine.
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const s = S[i];
    const c = colorAt(BODY_C, t);
    circle(s.p[0], s.p[1], s.r, c[0], c[1], c[2], 1);
  }
  // Cream belly on the underside.
  for (let i = 4; i <= 106; i++) {
    const t = i / 120;
    const s = S[i];
    const n = downNormal(s.tan);
    circle(s.p[0] + n[0] * s.r * 0.42, s.p[1] + n[1] * s.r * 0.42, s.r * 0.58, 248, 236, 208, 0.92);
  }
  // White koi patches on the lower half.
  for (const t of [0.16, 0.3, 0.42]) {
    const s = at(t);
    circle(s.p[0], s.p[1], s.r * 0.78, 250, 240, 214, 0.95);
  }
  // Dragon scales on the upper half: staggered arcs.
  for (let row = 0; row < 9; row++) {
    const t = 0.52 + row * 0.05;
    const s = at(t);
    const n = downNormal(s.tan);
    const up: Pt = [-n[0], -n[1]];
    for (let k = -2; k <= 2; k++) {
      const off = k * 13 + (row % 2 ? 6 : -6);
      const cx = s.p[0] + n[0] * off * 0.8 + up[0] * 4;
      const cy = s.p[1] + n[1] * off * 0.8 + up[1] * 4;
      arcStroke(cx, cy, 10, Math.PI * 0.15, Math.PI * 0.85, 122, 30, 30, 0.5);
    }
  }
  // Flowing mane along the top of the neck.
  const maneTop: Pt[] = [];
  const maneOut: Pt[] = [];
  for (let i = 0; i <= 30; i++) {
    const t = 0.8 + 0.2 * (i / 30);
    const s = at(t);
    const n = downNormal(s.tan);
    const up: Pt = [-n[0], -n[1]];
    maneTop.push([s.p[0] + up[0] * s.r * 0.8, s.p[1] + up[1] * s.r * 0.8]);
    const flame = 12 + 16 * Math.abs(Math.sin(i * 0.9));
    maneOut.push([s.p[0] + up[0] * (s.r * 0.8 + flame), s.p[1] + up[1] * (s.r * 0.8 + flame)]);
  }
  poly([...maneTop, ...maneOut.reverse()], 214, 64, 44, 0.8);
  // Claws on the belly side.
  for (const t of [0.55, 0.72]) {
    const s = at(t);
    const n = downNormal(s.tan);
    const bx = s.p[0] + n[0] * s.r * 0.9;
    const by = s.p[1] + n[1] * s.r * 0.9;
    for (let k = -1; k <= 1; k++) {
      const ang = Math.atan2(n[1], n[0]) + k * 0.45;
      const ex = bx + Math.cos(ang) * 22;
      const ey = by + Math.sin(ang) * 22;
      stroke(
        [
          [bx, by],
          [ex, ey],
        ],
        [3.5, 1],
        240, 190, 90, 0.95,
      );
      circle(ex, ey, 2.2, 60, 30, 20, 0.95);
    }
  }
  // Pectoral fin sweeping back (curved, translucent).
  const pf = at(0.78);
  const pn = downNormal(pf.tan);
  const pec: Pt[] = [];
  const pecBase: Pt = [pf.p[0] + pn[0] * pf.r * 0.7, pf.p[1] + pn[1] * pf.r * 0.7];
  for (let i = 0; i <= 12; i++) pec.push(cubic(pecBase, [pecBase[0] + pn[0] * 52, pecBase[1] + pn[1] * 52 + 8], [pecBase[0] + pn[0] * 58, pecBase[1] + pn[1] * 58 + 34], [pecBase[0] + pn[0] * 40, pecBase[1] + pn[1] * 40 + 56], i / 12));
  for (let i = 12; i >= 0; i--) pec.push(cubic([pecBase[0] + pn[0] * 40, pecBase[1] + pn[1] * 40 + 56], [pecBase[0] + pn[0] * 22, pecBase[1] + pn[1] * 22 + 44], [pecBase[0] + pn[0] * 8, pecBase[1] + pn[1] * 8 + 22], pecBase, i / 12));
  poly(pec, 255, 182, 112, 0.55);

  // ---- Dragon head (faces the moon, up-right) ----
  const hx = 715;
  const hy = 320;
  // Cranium + snout.
  circle(hx - 8, hy + 4, 34, 192, 52, 48, 1);
  poly(
    [
      [hx - 2, hy - 22],
      [hx + 52, hy - 58],
      [hx + 58, hy - 36],
      [hx + 16, hy + 6],
    ],
    200, 58, 48, 1,
  );
  // Open mouth: dark interior, teeth, forked tongue.
  poly(
    [
      [hx + 10, hy - 8],
      [hx + 54, hy - 40],
      [hx + 50, hy - 26],
      [hx + 12, hy + 4],
    ],
    58, 10, 14, 1,
  );
  poly(
    [
      [hx + 14, hy + 2],
      [hx + 48, hy - 28],
      [hx + 40, hy - 18],
      [hx + 10, hy + 10],
    ],
    150, 44, 40, 1,
  );
  for (let k = 0; k < 3; k++) {
    const fx = hx + 18 + k * 12;
    const fy = hy - 4 - k * 10;
    poly(
      [
        [fx, fy],
        [fx + 5, fy - 2],
        [fx + 2, fy + 7],
      ],
      250, 244, 226, 1,
    );
  }
  stroke(
    [
      [hx + 20, hy - 2],
      [hx + 34, hy + 6],
      [hx + 44, hy + 2],
    ],
    [2.5, 1.2, 1],
    224, 60, 60, 1,
  );
  stroke(
    [
      [hx + 20, hy - 2],
      [hx + 34, hy + 10],
      [hx + 46, hy + 10],
    ],
    [2.5, 1.2, 1],
    224, 60, 60, 1,
  );
  // Nostril.
  circle(hx + 50, hy - 48, 2.6, 70, 16, 18, 1);
  // Fierce eye: gold almond, dark slit pupil, highlight, heavy brow.
  ellipse(hx + 12, hy - 14, 11, 6.5, 255, 208, 90, 1);
  ellipse(hx + 12, hy - 14, 3, 6, 30, 12, 10, 1);
  circle(hx + 15, hy - 17, 2, 255, 255, 255, 0.95);
  arcStroke(hx + 12, hy - 16, 13, Math.PI * 1.15, Math.PI * 1.85, 120, 28, 28, 0.9);
  // Horns sweeping back (gold, darker tips).
  stroke(
    [
      [hx - 26, hy - 22],
      [hx - 52, hy - 52],
      [hx - 62, hy - 92],
      [hx - 52, hy - 118],
    ],
    [9, 7, 4.5, 2],
    240, 190, 90, 1,
  );
  stroke(
    [
      [hx - 14, hy - 28],
      [hx - 30, hy - 62],
      [hx - 28, hy - 96],
      [hx - 14, hy - 118],
    ],
    [8, 6, 4, 2],
    238, 186, 86, 1,
  );
  stroke(
    [
      [hx - 48, hy - 66],
      [hx - 66, hy - 74],
      [hx - 76, hy - 88],
    ],
    [3, 2, 1],
    226, 170, 78, 1,
  );
  stroke(
    [
      [hx - 26, hy - 74],
      [hx - 40, hy - 86],
      [hx - 44, hy - 100],
    ],
    [3, 2, 1],
    226, 170, 78, 1,
  );
  // Long whiskers flowing back from the snout.
  stroke(
    [
      [hx + 52, hy - 40],
      [hx + 30, hy - 6],
      [hx - 6, hy + 14],
      [hx - 48, hy + 22],
    ],
    [2.5, 1.8, 1.2, 0.8],
    246, 205, 120, 0.9,
  );
  stroke(
    [
      [hx + 46, hy - 28],
      [hx + 28, hy + 2],
      [hx - 4, hy + 26],
      [hx - 38, hy + 40],
    ],
    [2.2, 1.6, 1.1, 0.8],
    246, 205, 120, 0.9,
  );
  // Head frill.
  poly(
    [
      [hx - 30, hy - 6],
      [hx - 62, hy - 2],
      [hx - 52, hy + 18],
      [hx - 28, hy + 16],
    ],
    214, 64, 44, 0.85,
  );
}

function drawSparkles(): void {
  for (let i = 0; i < 22; i++) {
    // Biased along the star river.
    const t = rnd();
    const bx = RIVER_A[0] + (RIVER_B[0] - RIVER_A[0]) * t + rand(-90, 90);
    const by = RIVER_A[1] + (RIVER_B[1] - RIVER_A[1]) * t + rand(-90, 90);
    if (bx < 8 || bx >= W - 8 || by < 8 || by >= H - 8) continue;
    sparkle(bx, by, rand(6, 13), 255, 244, 214, rand(0.6, 0.95));
  }
  // A few bright ones near the dragon and the moon.
  sparkle(640, 420, 12, 255, 240, 200, 0.9);
  sparkle(880, 330, 10, 255, 244, 214, 0.85);
  sparkle(420, 520, 11, 255, 240, 200, 0.9);
}

function drawVignette(): void {
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= 560) continue;
      const a = Math.pow((d - 560) / 190, 2) * 0.26;
      const i = (y * W + x) * 3;
      const ia = 1 - Math.min(0.26, a);
      fb[i] = Math.round(fb[i] * ia);
      fb[i + 1] = Math.round(fb[i + 1] * ia);
      fb[i + 2] = Math.round(fb[i + 2] * ia);
    }
  }
}

function drawScene(): void {
  drawSky();
  drawStars();
  drawMoon();
  drawWater();
  drawSplash();
  drawDragon();
  drawSparkles();
  drawVignette();
}

function main(): void {
  const t0 = Date.now();
  drawScene();
  const png = encodePNG(W, H, fb);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
  const ms = Date.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`wrote ${join(outDir, 'entry.png')} (${png.length} bytes) in ${ms} ms`);
}

main();
