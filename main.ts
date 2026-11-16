// The Dragon Gate — ai-excited-01 entry (v4)
// A koi leaps up a river of stars toward the full moon, turning into a dragon.
// Hand-written rasterizer + hand-written PNG encoder. Node 22 stdlib only.
// Deterministic: mulberry32 seed 20261116; no clock, no network, no Math.random.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------- seeded PRNG ----------
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
const rnd = mulberry32(20261116);

// ---------- canvas ----------
const px = new Uint8Array(W * H * 3);

type RGB = [number, number, number];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function setPx(x: number, y: number, c: RGB): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  if (a <= 0) return;
  if (a >= 1) {
    setPx(xi, yi, c);
    return;
  }
  const i = (yi * W + xi) * 3;
  px[i] = clamp255(px[i] * (1 - a) + c[0] * a);
  px[i + 1] = clamp255(px[i + 1] * (1 - a) + c[1] * a);
  px[i + 2] = clamp255(px[i + 2] * (1 - a) + c[2] * a);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpC(c1: RGB, c2: RGB, t: number): RGB {
  return [clamp255(lerp(c1[0], c2[0], t)), clamp255(lerp(c1[1], c2[1], t)), clamp255(lerp(c1[2], c2[2], t))];
}

function disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  if (r <= 0) return;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) blendPx(x, y, c, a);
    }
  }
}

function glowDisc(cx: number, cy: number, r: number, c: RGB, peak: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      const a = peak * (1 - d) * (1 - d);
      blendPx(x, y, c, a);
    }
  }
}

function line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, c, a);
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, c: RGB, a = 1): void {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rad = Math.max(rx, ry);
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if ((u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1) blendPx(x, y, c, a);
    }
  }
}

function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (d === 0) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) blendPx(x, y, c, a);
    }
  }
}

// Quadratic bezier stroke with tapering width.
function quadStroke(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
  w0: number, w1: number, c: RGB, a = 1,
): void {
  const steps = 24;
  let px0 = x0;
  let py0 = y0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * x1 + t * t * x2;
    const y = u * u * y0 + 2 * u * t * y1 + t * t * y2;
    line(px0, py0, x, y, lerp(w0, w1, t), c, a);
    px0 = x;
    py0 = y;
  }
}

// ---------- sky ----------
function drawSky(): void {
  const top: RGB = [10, 14, 42];
  const bottom: RGB = [26, 32, 74];
  for (let y = 0; y < 850; y++) {
    const c = lerpC(top, bottom, y / 850);
    const i = y * W * 3;
    for (let x = 0; x < W; x++) {
      px[i + x * 3] = c[0];
      px[i + x * 3 + 1] = c[1];
      px[i + x * 3 + 2] = c[2];
    }
  }
}

// ---------- star river (diagonal band, bottom-left -> top-right) ----------
function drawRiverGlow(): void {
  for (let i = 0; i < 40; i++) {
    const s = i / 39;
    const x = lerp(30, 1010, s);
    const y = lerp(1010, 30, s);
    glowDisc(x, y, 55, [90, 120, 200], 0.05);
  }
}

function drawBackgroundStars(): void {
  for (let i = 0; i < 350; i++) {
    const x = rnd() * W;
    const y = rnd() * 840;
    if (Math.hypot(x - 770, y - 215) < 145) continue; // keep the moon clear
    const b = 120 + Math.floor(rnd() * 135);
    const tint = rnd();
    const c: RGB = tint < 0.6 ? [b, b, b] : tint < 0.8 ? [Math.floor(b * 0.75), Math.floor(b * 0.85), b] : [b, Math.floor(b * 0.9), Math.floor(b * 0.7)];
    if (rnd() < 0.15) {
      glowDisc(x, y, 3, c, 0.5);
      setPx(x, y, c);
    } else {
      setPx(x, y, c);
    }
  }
}

function drawRiverStars(): void {
  for (let i = 0; i < 950; i++) {
    const s = rnd();
    const x = lerp(30, 1010, s);
    const y = lerp(1010, 30, s);
    // perpendicular jitter (approx normal distribution)
    const off = ((rnd() + rnd() + rnd()) - 1.5) / 1.5 * 85;
    const nx = 0.7071;
    const ny = 0.7071;
    const sx = x + nx * off;
    const sy = y + ny * off;
    if (sy > 860) continue; // river stays in the sky
    if (Math.hypot(sx - 770, sy - 215) < 125) continue; // keep the moon clear
    const b = 200 + Math.floor(rnd() * 55);
    const tint = rnd();
    const c: RGB = tint < 0.55 ? [b, b, b] : tint < 0.8 ? [Math.floor(b * 0.72), Math.floor(b * 0.84), b] : [b, Math.floor(b * 0.9), Math.floor(b * 0.68)];
    const r = rnd();
    if (r < 0.72) {
      setPx(sx, sy, c);
    } else if (r < 0.95) {
      disc(sx, sy, 1.4, c, 0.95);
    } else {
      glowDisc(sx, sy, 5, c, 0.7);
      disc(sx, sy, 2, c, 1);
    }
  }
}

// ---------- moon ----------
function drawMoon(): void {
  const mx = 770;
  const my = 215;
  const mr = 105;
  glowDisc(mx, my, 235, [255, 240, 190], 0.32);
  glowDisc(mx, my, 150, [255, 245, 210], 0.5);
  disc(mx, my, mr, [248, 243, 214]);
  // lit side (upper-left) and shaded side (lower-right)
  disc(mx - 18, my - 16, mr * 0.92, [255, 250, 228], 0.5);
  disc(mx + 22, my + 20, mr * 0.9, [225, 218, 185], 0.22);
  // craters: soft darker blobs
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * mr * 0.72;
    const cx = mx + Math.cos(a) * d;
    const cy = my + Math.sin(a) * d;
    const cr = 8 + rnd() * 14;
    disc(cx, cy, cr, [205, 198, 165], 0.12 + rnd() * 0.08);
  }
}

// ---------- water, reflection, splash ----------
function drawWater(): void {
  const top: RGB = [16, 28, 62];
  const bottom: RGB = [6, 12, 34];
  for (let y = 850; y < H; y++) {
    const c = lerpC(top, bottom, (y - 850) / (H - 850));
    const i = y * W * 3;
    for (let x = 0; x < W; x++) {
      px[i + x * 3] = c[0];
      px[i + x * 3 + 1] = c[1];
      px[i + x * 3 + 2] = c[2];
    }
  }
  // ripples
  for (let i = 0; i < 25; i++) {
    const y = 860 + rnd() * 155;
    const x = rnd() * W;
    const len = 40 + rnd() * 160;
    line(x, y, x + len, y + (rnd() - 0.5) * 3, 1.5, [90, 120, 180], 0.12);
  }
}

function drawMoonReflection(): void {
  for (let y = 855; y < 1015; y += 7) {
    const f = (y - 855) / 160;
    const wdt = 70 * (1 - f) + 10;
    const jx = (rnd() - 0.5) * 30;
    const a = 0.5 * (1 - f);
    line(770 - wdt / 2 + jx, y, 770 + wdt / 2 + jx, y, 3, [255, 240, 180], a);
  }
}

function drawSplash(): void {
  // foam at the waterline near the tail
  for (let i = 0; i < 30; i++) {
    const x = 60 + rnd() * 140;
    const y = 852 + rnd() * 22;
    disc(x, y, 2 + rnd() * 3.5, [220, 230, 245], 0.5 + rnd() * 0.4);
  }
  // droplets arcing up from the water
  for (let i = 0; i < 45; i++) {
    const x = 40 + rnd() * 190;
    const y = 800 + rnd() * 70;
    const r = 1.5 + rnd() * 3.5;
    const c: RGB = rnd() < 0.5 ? [235, 242, 255] : [180, 205, 240];
    disc(x, y, r, c, 0.55 + rnd() * 0.4);
  }
  // spray arcs
  quadStroke(150, 890, 110, 830, 60, 800, 4, 1.5, [235, 242, 255], 0.7);
  quadStroke(165, 895, 150, 820, 120, 780, 3.5, 1.5, [220, 232, 250], 0.6);
  quadStroke(140, 900, 90, 850, 45, 830, 3, 1.5, [210, 225, 245], 0.55);
}

// ---------- koi turning into a dragon ----------
const SP = { x0: 150, y0: 905, x1: 285, y1: 725, x2: 470, y2: 525, x3: 692, y3: 348 };

function cubic(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function spinePoint(t: number): { x: number; y: number; tx: number; ty: number } {
  const x = cubic(t, SP.x0, SP.x1, SP.x2, SP.x3);
  const y = cubic(t, SP.y0, SP.y1, SP.y2, SP.y3);
  const u = 1 - t;
  const dx = 3 * u * u * (SP.x1 - SP.x0) + 6 * u * t * (SP.x2 - SP.x1) + 3 * t * t * (SP.x3 - SP.x2);
  const dy = 3 * u * u * (SP.y1 - SP.y0) + 6 * u * t * (SP.y2 - SP.y1) + 3 * t * t * (SP.y3 - SP.y2);
  const len = Math.hypot(dx, dy) || 1;
  return { x, y, tx: dx / len, ty: dy / len };
}

function bodyRadius(t: number): number {
  return 9 + 52 * Math.sin(Math.PI * Math.pow(t, 0.8));
}

// side: -1 belly (lower-right), 0 mid, +1 back (upper-left)
function bodyColor(t: number, side: number): RGB {
  let base: RGB;
  if (t < 0.3) base = [232, 122, 42]; // koi orange
  else if (t < 0.55) base = lerpC([232, 122, 42], [196, 42, 32], (t - 0.3) / 0.25);
  else base = lerpC([196, 42, 32], [216, 150, 52], (t - 0.55) / 0.45); // crimson -> gold
  if (side < 0) base = lerpC(base, [245, 220, 180], 0.45);
  if (side > 0) base = lerpC(base, [120, 20, 20], 0.35);
  return base;
}

function drawTailFins(): void {
  // flowing fins trailing behind the koi tail (bottom-left)
  ellipse(120, 930, 55, 22, -0.6, [235, 130, 45], 0.95);
  ellipse(105, 945, 45, 18, -0.9, [245, 235, 220], 0.9);
  ellipse(135, 915, 40, 16, -0.3, [220, 100, 35], 0.9);
  // small dorsal fin on the koi part
  const p = spinePoint(0.18);
  const nx = -p.ty;
  const ny = p.tx;
  ellipse(p.x - nx * bodyRadius(0.18) * 0.8, p.y - ny * bodyRadius(0.18) * 0.8, 26, 10, Math.atan2(p.ty, p.tx) - 0.5, [240, 140, 50], 0.9);
}

function drawBody(): void {
  const STEPS = 160;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p = spinePoint(t);
    const r = bodyRadius(t);
    const nx = -p.ty; // belly normal (down-right)
    const ny = p.tx;
    disc(p.x, p.y, r, bodyColor(t, 0));
    disc(p.x + nx * r * 0.38, p.y + ny * r * 0.38, r * 0.55, bodyColor(t, -1), 0.55);
    disc(p.x - nx * r * 0.38, p.y - ny * r * 0.38, r * 0.5, bodyColor(t, 1), 0.5);
  }
  // white koi patches on the lower body
  const patchT = [0.06, 0.14, 0.22, 0.28];
  for (const t of patchT) {
    const p = spinePoint(t);
    const r = bodyRadius(t);
    const nx = -p.ty;
    const ny = p.tx;
    const off = (rnd() - 0.5) * r * 0.7;
    disc(p.x + nx * off, p.y + ny * off, r * 0.5, [248, 240, 225], 0.85);
  }
}

function drawScales(): void {
  for (let t = 0.5; t <= 0.95; t += 0.035) {
    const p = spinePoint(t);
    const r = bodyRadius(t);
    const nx = -p.ty;
    const ny = p.tx;
    const row = Math.round(t / 0.035) % 2 === 0;
    const offsets = row ? [-0.5, 0, 0.5] : [-0.25, 0.25];
    for (const off of offsets) {
      const sx = p.x + nx * off * r;
      const sy = p.y + ny * off * r;
      disc(sx, sy, 5.5, [140, 30, 20], 0.65);
      disc(sx, sy, 3.2, bodyColor(t, 0), 0.9);
    }
  }
}

function drawDorsalRidge(): void {
  for (let t = 0.48; t <= 0.95; t += 0.032) {
    const p = spinePoint(t);
    const r = bodyRadius(t);
    const nx = -p.ty;
    const ny = p.tx;
    const bx = p.x - nx * r * 0.92;
    const by = p.y - ny * r * 0.92;
    const tipX = bx - nx * r * 0.55;
    const tipY = by - ny * r * 0.55;
    const ax = bx + p.tx * r * 0.28;
    const ay = by + p.ty * r * 0.28;
    const cx = bx - p.tx * r * 0.28;
    const cy = by - p.ty * r * 0.28;
    triangle(ax, ay, cx, cy, tipX, tipY, [170, 40, 25], 0.95);
  }
}

function drawClaw(t: number): void {
  const p = spinePoint(t);
  const r = bodyRadius(t);
  const nx = -p.ty;
  const ny = p.tx;
  const bx = p.x + nx * r * 0.9;
  const by = p.y + ny * r * 0.9;
  const lx = bx + nx * 18;
  const ly = by + ny * 18;
  line(bx, by, lx, ly, 7, [215, 160, 60], 1);
  for (let k = -1; k <= 1; k++) {
    const ang = Math.atan2(ny, nx) + k * 0.35;
    line(lx, ly, lx + Math.cos(ang) * 14, ly + Math.sin(ang) * 14, 3.5, [240, 200, 90], 1);
  }
}

function drawMane(): void {
  for (let s = 0; s < 6; s++) {
    const t0 = 0.88 + s * 0.02;
    const p0 = spinePoint(t0);
    const nx = -p0.ty;
    const ny = p0.tx;
    const sx = p0.x - nx * bodyRadius(t0) * 0.7;
    const sy = p0.y - ny * bodyRadius(t0) * 0.7;
    const col: RGB = s % 3 === 0 ? [230, 60, 30] : s % 3 === 1 ? [240, 150, 40] : [200, 40, 30];
    const len = 70 + rnd() * 60;
    const steps = 14;
    let prevX = sx;
    let prevY = sy;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const bx = sx - p0.tx * len * f + Math.sin(f * 5 + s) * 12 * f;
      const by = sy - p0.ty * len * f + 30 * f * f;
      line(prevX, prevY, bx, by, 7 * (1 - f * 0.6), col, 0.9);
      prevX = bx;
      prevY = by;
    }
  }
}

function drawHead(): void {
  const p = spinePoint(1);
  const tx = p.tx;
  const ty = p.ty;
  const nx = -ty; // belly normal
  const ny = tx;
  const hx = p.x + tx * 30;
  const hy = p.y + ty * 30;
  const ang = Math.atan2(ty, tx);
  // skull
  ellipse(hx, hy, 52, 38, ang, [210, 90, 45]);
  // snout
  const sx = hx + tx * 38;
  const sy = hy + ty * 38;
  ellipse(sx, sy, 30, 21, ang, [225, 120, 55]);
  // open mouth: dark ellipse between snout and jaw
  const mx = hx + tx * 28 + nx * 12;
  const my = hy + ty * 28 + ny * 12;
  ellipse(mx, my, 26, 12, ang, [70, 12, 12]);
  // teeth along the mouth edges
  for (let i = 0; i < 4; i++) {
    const f = -0.6 + i * 0.4;
    const txx = mx + tx * f * 22 - nx * 8;
    const tyy = my + ty * f * 22 - ny * 8;
    triangle(txx - 3, tyy - 2, txx + 3, tyy + 2, txx + nx * 7, tyy + ny * 7, [250, 245, 230], 1);
  }
  for (let i = 0; i < 3; i++) {
    const f = -0.5 + i * 0.5;
    const txx = mx + tx * f * 22 + nx * 8;
    const tyy = my + ty * f * 22 + ny * 8;
    triangle(txx - 3, tyy - 2, txx + 3, tyy + 2, txx - nx * 7, tyy - ny * 7, [250, 245, 230], 1);
  }
  // forked tongue reaching toward the moon
  const tx0 = mx + tx * 10;
  const ty0 = my + ty * 10;
  const fx = tx0 + tx * 28;
  const fy = ty0 + ty * 28;
  line(tx0, ty0, fx, fy, 4, [220, 40, 40], 1);
  line(fx, fy, fx + tx * 14 - nx * 8, fy + ty * 14 - ny * 8, 3, [220, 40, 40], 1);
  line(fx, fy, fx + tx * 14 + nx * 8, fy + ty * 14 + ny * 8, 3, [220, 40, 40], 1);
  // fierce eye (upper side of the head)
  const ex = hx + tx * 10 - nx * 18;
  const ey = hy + ty * 10 - ny * 18;
  disc(ex, ey, 10, [250, 245, 235]);
  disc(ex + tx * 2, ey + ty * 2, 6.5, [200, 30, 25]);
  disc(ex + tx * 2, ey + ty * 2, 3.5, [10, 8, 8]);
  // angry brow over the eye
  line(ex - tx * 12 - nx * 12, ey - ty * 12 - ny * 12, ex + tx * 10 - nx * 4, ey + ty * 10 - ny * 4, 5, [120, 25, 18], 1);
  // gold horns sweeping back
  quadStroke(hx - nx * 30, hy - ny * 30, hx - nx * 55 - tx * 20, hy - ny * 55 - ty * 20, hx - nx * 80 - tx * 55, hy - ny * 80 - ty * 55, 10, 2, [235, 195, 95], 1);
  quadStroke(hx - nx * 22 + tx * 8, hy - ny * 22 + ty * 8, hx - nx * 45 - tx * 5, hy - ny * 45 - ty * 5, hx - nx * 65 - tx * 35, hy - ny * 65 - ty * 35, 8, 2, [225, 185, 85], 1);
  // whiskers flowing back from the snout
  quadStroke(sx, sy + 6, sx - tx * 30 + nx * 30, sy - ty * 30 + ny * 30, sx - tx * 70 + nx * 55, sy - ty * 70 + ny * 55, 2.5, 1.5, [240, 210, 140], 0.9);
  quadStroke(sx, sy + 10, sx - tx * 25 + nx * 40, sy - ty * 25 + ny * 40, sx - tx * 60 + nx * 75, sy - ty * 60 + ny * 75, 2.5, 1.5, [240, 210, 140], 0.9);
  // nostril
  disc(sx + tx * 12 - nx * 4, sy + ty * 12 - ny * 4, 2.5, [60, 15, 12]);
}

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
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

function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------- compose + write ----------
function draw(): void {
  drawSky();
  drawRiverGlow();
  drawBackgroundStars();
  drawRiverStars();
  drawMoon();
  drawWater();
  drawMoonReflection();
  drawSplash();
  drawTailFins();
  drawBody();
  drawScales();
  drawDorsalRidge();
  drawClaw(0.55);
  drawClaw(0.78);
  drawMane();
  drawHead();
}

function main(): void {
  draw();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || 'out';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'entry.png'), encodePNG());
}

main();
