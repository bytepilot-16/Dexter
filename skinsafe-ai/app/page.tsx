"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PatientForm from "../components/PatientForm";
import WardDashboard from "../components/WardDashboard";
import { careRecommendation } from "../lib/care";
import {
  CRIT,
  HIST,
  MAX_V,
  SEED_PATIENTS,
  WOUND_LIMIT,
  buildPoses,
  condText,
  initials,
  nextPoseIdx,
  riskOf,
  segDist,
  type Patient,
  type Pose,
  type PoseSet,
  type ZoneReading,
} from "../lib/model";
import { accrue, alertsFor, newTrack, refresh, turn, type Track } from "../lib/ward";

/* ------------------------------------------------------------------ */
/*  CONFIG & CONSTANTS                                                 */
/* ------------------------------------------------------------------ */
const COLS = 128;
const ROWS = 72;
const TICK_MS = 100;
// Natural time pace: 1 real second = 1 real second of simulation time (0.1s tick = 0.1/60 simulated minutes).
// User has "Skip 30 min" button whenever demo acceleration is needed.
const SIM_MIN_PER_TICK = 0.1 / 60;
const NB = 14;
const MIN_PANEL = 390;

const FONT_CSS = `@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
.font-display{font-family:'Instrument Serif',Georgia,serif;font-weight:400;letter-spacing:-0.01em}
.font-ui{font-family:'Instrument Sans',system-ui,-apple-system,sans-serif}
.tnum{font-variant-numeric:tabular-nums}`;

/* ------------------------------------------------------------------ */
/*  COLOUR LUT                                                         */
/* ------------------------------------------------------------------ */
const STOPS: [number, [number, number, number]][] = [
  [0, [70, 110, 200]],
  [18, [58, 112, 214]],
  [32, [38, 156, 160]],
  [45, [63, 168, 98]],
  [58, [214, 178, 40]],
  [72, [236, 128, 36]],
  [88, [206, 48, 40]],
  [105, [150, 20, 48]],
  [120, [92, 10, 40]],
];
const LUT: [number, number, number][] = Array.from({ length: MAX_V + 1 }, (_, v) => {
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [v0, c0] = STOPS[i - 1];
      const [v1, c1] = STOPS[i];
      const t = (v - v0) / (v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ] as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
});
const lutRGB = (v: number) => LUT[Math.max(0, Math.min(MAX_V, Math.round(v)))];
const lutCss = (v: number) => {
  const [r, g, b] = lutRGB(v);
  return `rgb(${r},${g},${b})`;
};
const LEGEND_GRADIENT = `linear-gradient(90deg, ${STOPS.map(
  ([v, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${(v / MAX_V) * 100}%`,
).join(",")})`;

/* ------------------------------------------------------------------ */
/*  SIMULATION GRID                                                    */
/* ------------------------------------------------------------------ */
type Sim = {
  display: Float32Array;
  target: Float32Array;
  dose: Float32Array;
  patient: Patient | null;
  poseSet: PoseSet | null;
  poseIdx: number;
  minInPos: number;
  maxP: number;
  score: number;
  exposure: number;
  zones: ZoneReading[];
  history: number[];
  tickCount: number;
  w: number;
  h: number;
  panelW: number;
  diveStart: number | null;
  reduced: boolean;
  pointer: { x: number; y: number; e: number };
};

const makeSim = (): Sim => ({
  display: new Float32Array(COLS * ROWS),
  target: new Float32Array(COLS * ROWS),
  dose: new Float32Array(COLS * ROWS),
  patient: null,
  poseSet: null,
  poseIdx: 0,
  minInPos: 0,
  maxP: 0,
  score: 100,
  exposure: 0,
  zones: [],
  history: [],
  tickCount: 0,
  w: 1920,
  h: 1080,
  panelW: 640,
  diveStart: null,
  reduced: false,
  pointer: { x: -1000, y: -1000, e: 0 },
});

function stepSim(sim: Sim) {
  const w = sim.w;
  const h = sim.h;
  const cw = w / COLS;
  const ch = h / ROWS;
  const p = sim.patient;
  const ps = sim.poseSet;
  const t = sim.target;
  t.fill(0);

  const bodyH = h * 0.82;
  const top = h * 0.09;
  const cx = (w - sim.panelW) / 2;

  if (p && ps) {
    sim.minInPos += SIM_MIN_PER_TICK;
    sim.tickCount++;
    const pose = ps.poses[sim.poseIdx];
    const pf = p.sens * Math.sqrt(p.weightKg / 70);
    const load = (0.5 + 0.6 * Math.min(sim.minInPos / Math.max(15, p.interval), 1.4)) * pf;

    // Contact capsules (limbs present in this pose)
    const x0 = Math.max(0, Math.floor((cx - 0.32 * bodyH) / cw));
    const x1 = Math.min(COLS - 1, Math.ceil((cx + 0.32 * bodyH) / cw));
    for (let gy = 0; gy < ROWS; gy++) {
      const ny = ((gy + 0.5) * ch - top) / bodyH;
      if (ny < -0.1 || ny > 1.1) continue;
      for (let gx = x0; gx <= x1; gx++) {
        const nx = ((gx + 0.5) * cw - cx) / bodyH;
        let m = 0;
        for (const c of pose.caps) m = Math.max(m, 1 - segDist(nx, ny, c) / c.r);
        if (m > 0) t[gy * COLS + gx] = 18 * Math.min(1, m * 2.5) * (0.7 + 0.6 * load);
      }
    }

    // Bony pressure points (blobs)
    for (const b of pose.blobs) {
      const bx = cx + b.x * bodyH;
      const by = top + b.y * bodyH;
      const sg = b.s * bodyH;
      const rad = sg * 3;
      const gy0 = Math.max(0, Math.floor((by - rad) / ch));
      const gy1 = Math.min(ROWS - 1, Math.ceil((by + rad) / ch));
      const gx0 = Math.max(0, Math.floor((bx - rad) / cw));
      const gx1 = Math.min(COLS - 1, Math.ceil((bx + rad) / cw));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const dx = (gx + 0.5) * cw - bx;
          const dy = (gy + 0.5) * ch - by;
          t[gy * COLS + gx] += b.p * load * Math.exp(-(dx * dx + dy * dy) / (2 * sg * sg));
        }
      }
    }
  }

  // Ease display toward target
  let maxP = 0;
  for (let i = 0; i < t.length; i++) {
    const base = t[i];
    let d = sim.display[i];
    d += (base - d) * 0.14;
    if (base > 1) d += (Math.random() - 0.5) * 0.8;
    if (base === 0 && d < 0.5) d = 0;
    if (d < 0) d = 0;
    if (d > 140) d = 140;
    sim.display[i] = d;
    if (d > maxP) maxP = d;
    if (p) {
      if (d > 32) sim.dose[i] += (d - 32) * SIM_MIN_PER_TICK;
      else sim.dose[i] = Math.max(0, sim.dose[i] - 40 * SIM_MIN_PER_TICK);
    }
  }
  sim.maxP = maxP;

  if (!p || !ps) {
    sim.zones = [];
    return;
  }

  const pose = ps.poses[sim.poseIdx];
  sim.zones = pose.zones.map((z) => {
    let v = 0;
    let avgX = 0;
    let avgY = 0;
    for (const q of z.pts) {
      const zx = cx + q.x * bodyH;
      const zy = top + q.y * bodyH;
      avgX += zx;
      avgY += zy;
      const gx = Math.round(zx / cw - 0.5);
      const gy = Math.round(zy / ch - 0.5);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = gx + dx;
          const yy = gy + dy;
          if (xx >= 0 && xx < COLS && yy >= 0 && yy < ROWS) {
            v = Math.max(v, sim.display[yy * COLS + xx]);
          }
        }
      }
    }
    return { name: z.name, v, x: avgX / z.pts.length, y: avgY / z.pts.length };
  });

  if (sim.tickCount % 5 === 0) {
    sim.history.push(maxP);
    if (sim.history.length > HIST) sim.history.shift();
    const top12 = Array.from(sim.dose).sort((a, b) => b - a).slice(0, 12);
    const mean = top12.reduce((a, b) => a + b, 0) / top12.length;
    sim.exposure = mean / 60;
    sim.score = Math.max(0, 100 * (1 - mean / 9000));
  }
}

/* ------------------------------------------------------------------ */
/*  WARP & CANVAS RENDERER                                             */
/* ------------------------------------------------------------------ */
type Scene = {
  w: number;
  h: number;
  cw: number;
  ch: number;
  fx: number;
  fy: number;
  dive: number;
  diveT: number;
  reveal: number;
  flow: number;
  t: number;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

function samp(d: Float32Array, x: number, y: number, cw: number, ch: number) {
  let fx = x / cw - 0.5;
  let fy = y / ch - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > COLS - 1.001) fx = COLS - 1.001;
  if (fy < 0) fy = 0;
  else if (fy > ROWS - 1.001) fy = ROWS - 1.001;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * COLS + x0;
  return (
    d[i] * (1 - tx) * (1 - ty) +
    d[i + 1] * tx * (1 - ty) +
    d[i + COLS] * (1 - tx) * ty +
    d[i + COLS + 1] * tx * ty
  );
}

const out = new Float64Array(3);

function warp(x: number, y: number, sim: Sim, sc: Scene) {
  let X = x;
  let Y = y;
  const t = sc.t;

  if (sc.dive > 0) {
    const dx = X - sc.fx;
    const dy = Y - sc.fy;
    const r = Math.hypot(dx, dy);
    const sig = sc.h * 0.38;
    const pull = 0.5 * sc.dive * Math.exp(-(r * r) / (2 * sig * sig));
    X = sc.fx + dx * (1 - pull);
    Y = sc.fy + dy * (1 - pull);
    if (r > 1) {
      const wave = Math.sin(r * 0.03 - sc.diveT * 14) * 14 * sc.dive * Math.exp(-r / (sc.h * 0.9));
      X += (dx / r) * wave;
      Y += (dy / r) * wave;
    }
  }

  const A = 11 * sc.flow;
  X += A * Math.sin(y * 0.0055 + t * 0.55 + Math.sin(x * 0.0035 + t * 0.27) * 1.6) + 5 * sc.flow * Math.sin((x + y) * 0.0032 - t * 0.4);
  Y += A * Math.cos(x * 0.0048 - t * 0.48 + Math.sin(y * 0.0041 + t * 0.22) * 1.6) + 5 * sc.flow * Math.cos((x - y) * 0.0029 + t * 0.33);

  const pe = sim.pointer.e;
  if (pe > 0.02) {
    const mx = X - sim.pointer.x;
    const my = Y - sim.pointer.y;
    const r = Math.hypot(mx, my);
    if (r > 1 && r < 420) {
      const amp = 10 * pe * sc.flow * Math.exp(-r / 150) * Math.sin(r * 0.05 - t * 6);
      X += (mx / r) * amp;
      Y += (my / r) * amp;
    }
  }

  const d = sim.display;
  const p0 = samp(d, x, y, sc.cw, sc.ch);
  let gx = (samp(d, x + 10, y, sc.cw, sc.ch) - samp(d, x - 10, y, sc.cw, sc.ch)) * 0.65 * sc.reveal;
  let gy = (samp(d, x, y + 10, sc.cw, sc.ch) - samp(d, x, y - 10, sc.cw, sc.ch)) * 0.65 * sc.reveal;
  const gm = Math.hypot(gx, gy);
  if (gm > 22) {
    gx *= 22 / gm;
    gy *= 22 / gm;
  }
  out[0] = X + gx;
  out[1] = Y + gy;
  out[2] = p0;
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#EEDDAA");
  g.addColorStop(0.5, "#E3CD8E");
  g.addColorStop(1, "#D3B873");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const m = Math.max(w, h);
  const blobs = [
    { x: 0.2, y: 0.25, r: 0.55, c: "255,246,214", a: 0.55, sp: 0.07, ph: 0 },
    { x: 0.72, y: 0.18, r: 0.5, c: "255,240,196", a: 0.4, sp: 0.055, ph: 1.7 },
    { x: 0.5, y: 0.88, r: 0.6, c: "168,128,58", a: 0.38, sp: 0.045, ph: 3.1 },
    { x: 0.92, y: 0.7, r: 0.45, c: "190,150,70", a: 0.3, sp: 0.06, ph: 4.4 },
    { x: 0.08, y: 0.9, r: 0.5, c: "255,244,205", a: 0.35, sp: 0.05, ph: 5.2 },
  ];
  for (const b of blobs) {
    const cx = (b.x + 0.09 * Math.sin(t * b.sp * 2 + b.ph)) * w;
    const cy = (b.y + 0.08 * Math.cos(t * b.sp * 1.7 + b.ph)) * h;
    const rad = b.r * m;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    rg.addColorStop(0, `rgba(${b.c},${b.a})`);
    rg.addColorStop(1, `rgba(${b.c},0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawHeat(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  sc: Scene,
  off: HTMLCanvasElement,
  octx: CanvasRenderingContext2D,
  img: ImageData,
) {
  const d = img.data;
  for (let i = 0; i < COLS * ROWS; i++) {
    const v = sim.display[i];
    const a = clamp01((v - 3) / 22) * 0.88 * sc.reveal;
    if (a < 0.01) {
      d[i * 4 + 3] = 0;
      continue;
    }
    const [r, g, b] = lutRGB(v);
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = a * 255;
  }
  octx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const canFilter = typeof ctx.filter === "string";

  if (canFilter) {
    ctx.save();
    ctx.filter = "brightness(0) blur(16px)";
    ctx.globalAlpha = 0.22;
    ctx.drawImage(off, 8, 14, sc.w, sc.h);
    ctx.restore();
  }
  ctx.save();
  if (canFilter) ctx.filter = "blur(7px)";
  ctx.drawImage(off, 0, 0, sc.w, sc.h);
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, sim: Sim, sc: Scene) {
  const G = 40;
  const STEP = 16;
  const ink = [new Path2D(), new Path2D(), new Path2D()];
  const buckets = Array.from({ length: NB }, () => new Path2D());
  const used = new Array<boolean>(NB).fill(false);
  let li = 0;

  const run = (vertical: boolean) => {
    const maxA = vertical ? sc.w : sc.h;
    const maxB = vertical ? sc.h : sc.w;
    for (let a = -G; a <= maxA + G; a += G, li++) {
      const path = ink[li % 3];
      let px = 0;
      let py = 0;
      let pp = 0;
      let k = 0;
      for (let b = -STEP * 2; b <= maxB + STEP * 2; b += STEP, k++) {
        const x = vertical ? a : b;
        const y = vertical ? b : a;
        warp(x, y, sim, sc);
        const X = out[0];
        const Y = out[1];
        const P = out[2];
        if (k === 0) path.moveTo(X, Y);
        else {
          path.lineTo(X, Y);
          const ap = (P + pp) / 2;
          if (ap >= 14) {
            const bi = Math.min(NB - 1, Math.floor(ap / (MAX_V / NB)));
            buckets[bi].moveTo(px, py);
            buckets[bi].lineTo(X, Y);
            used[bi] = true;
          }
        }
        px = X;
        py = Y;
        pp = P;
      }
    }
  };
  run(true);
  run(false);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // soft ink bleed
  ctx.save();
  ctx.translate(0.8, 0.9);
  ctx.strokeStyle = "rgba(20,15,9,0.13)";
  ctx.lineWidth = 1.6;
  ctx.stroke(ink[1]);
  ctx.restore();

  const alphas = [0.5, 0.62, 0.74];
  const widths = [0.8, 1.0, 1.25];
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = `rgba(20,15,9,${alphas[i]})`;
    ctx.lineWidth = widths[i];
    ctx.stroke(ink[i]);
  }

  // pressure-tinted segments
  for (let i = 0; i < NB; i++) {
    if (!used[i]) continue;
    const col = lutCss((i + 0.5) * (MAX_V / NB));
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.14 * sc.reveal;
    ctx.lineWidth = 7;
    ctx.stroke(buckets[i]);
    ctx.globalAlpha = 0.92 * sc.reveal;
    ctx.lineWidth = 2.3;
    ctx.stroke(buckets[i]);
  }
  ctx.globalAlpha = 1;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

function drawCallouts(ctx: CanvasRenderingContext2D, sim: Sim, sc: Scene) {
  if (sim.zones.length === 0) return;
  const bodyH = sc.h * 0.82;
  const cx = (sc.w - sim.panelW) / 2;
  const lx = cx + 0.19 * bodyH + 36;
  const a = smooth((sc.reveal - 0.5) / 0.5);
  if (a <= 0) return;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = "600 12px 'Instrument Sans', system-ui, sans-serif";
  ctx.textAlign = "left";
  for (const z of sim.zones) {
    const color = lutCss(z.v);
    ctx.strokeStyle = "rgba(27,22,16,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(z.x, z.y);
    ctx.lineTo(lx, z.y);
    ctx.stroke();

    if (z.v >= CRIT) {
      ctx.strokeStyle = `rgba(180,35,24,${0.45 + 0.35 * Math.sin(sc.t * 5)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, 16 + 5 * Math.sin(sc.t * 5), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = "#1b1610";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(z.x, z.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const label = `${z.name}  ${Math.round(z.v)} mmHg`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(249,240,208,0.94)";
    rr(ctx, lx, z.y - 12, tw + 30, 24, 12);
    ctx.strokeStyle = "rgba(27,22,16,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx + 12, z.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b1610";
    ctx.fillText(label, lx + 22, z.y + 4);
  }
  ctx.restore();
}

function drawConditionBadges(ctx: CanvasRenderingContext2D, sim: Sim, sc: Scene) {
  if (!sim.patient || !sim.poseSet) return;
  const overlays = sim.poseSet.overlays[sim.poseIdx];
  if (!overlays || overlays.length === 0) return;
  const bodyH = sc.h * 0.82;
  const top = sc.h * 0.09;
  const cx = (sc.w - sim.panelW) / 2;

  ctx.save();
  ctx.font = "600 11px 'Instrument Sans', system-ui, sans-serif";

  for (const o of overlays) {
    const ox = cx + o.x * bodyH;
    const oy = top + o.y * bodyH;

    // outline of limb on chest / cast
    if (o.pts && o.pts.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 3.5;
      ctx.setLineDash([4, 4]);
      for (let i = 0; i < o.pts.length; i++) {
        const px = cx + o.pts[i][0] * bodyH;
        const py = top + o.pts[i][1] * bodyH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // badge pill
    const tw = ctx.measureText(o.label).width;
    const bx = ox - tw / 2 - 12;
    const by = oy - 24;
    ctx.fillStyle = "rgba(255,250,240,0.96)";
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 1.4;
    rr(ctx, bx, by, tw + 24, 20, 10);
    ctx.stroke();

    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.arc(bx + 9, by + 10, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#1b1610";
    ctx.textAlign = "left";
    ctx.fillText(o.label, bx + 16, by + 14);
  }
  ctx.restore();
}

function makeGrain() {
  const c = document.createElement("canvas");
  c.width = 180;
  c.height = 180;
  const g = c.getContext("2d");
  if (!g) return null;
  const im = g.createImageData(180, 180);
  for (let i = 0; i < 180 * 180; i++) {
    const v = Math.random() * 255;
    im.data[i * 4] = v < 128 ? 40 : 255;
    im.data[i * 4 + 1] = v < 128 ? 28 : 244;
    im.data[i * 4 + 2] = v < 128 ? 10 : 210;
    im.data[i * 4 + 3] = Math.random() * 26;
  }
  g.putImageData(im, 0, 0);
  return c;
}

function render(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  now: number,
  off: HTMLCanvasElement,
  octx: CanvasRenderingContext2D,
  img: ImageData,
  grain: HTMLCanvasElement | null,
) {
  const w = sim.w;
  const h = sim.h;
  const t = now / 1000;
  sim.pointer.e *= 0.965;

  let dive = 0;
  let reveal = 1;
  let diveT = 0;
  if (sim.diveStart !== null) {
    const e = (now - sim.diveStart) / 2200;
    if (e >= 1) sim.diveStart = null;
    else {
      dive = Math.pow(Math.sin(Math.PI * e), 1.3) * (sim.reduced ? 0.3 : 1);
      reveal = smooth((e - 0.25) / 0.6);
      diveT = e * 2.2;
    }
  }

  const sc: Scene = {
    w,
    h,
    cw: w / COLS,
    ch: h / ROWS,
    fx: (w - sim.panelW) / 2,
    fy: h * 0.5,
    dive,
    diveT,
    reveal,
    flow: sim.reduced ? 0.25 : 1,
    t,
  };

  drawBackground(ctx, w, h, t);

  ctx.save();
  const z = 1 + 0.05 * dive;
  ctx.translate(sc.fx, sc.fy);
  ctx.scale(z, z);
  ctx.translate(-sc.fx, -sc.fy);
  drawHeat(ctx, sim, sc, off, octx, img);
  drawGrid(ctx, sim, sc);
  drawCallouts(ctx, sim, sc);
  drawConditionBadges(ctx, sim, sc);
  ctx.restore();

  // grain and vignette
  if (grain) {
    const pat = ctx.createPattern(grain, "repeat");
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
    }
  }
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.78);
  vg.addColorStop(0, "rgba(70,45,10,0)");
  vg.addColorStop(1, "rgba(70,45,10,0.24)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */
const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const fmtHM = (min: number) => `${pad(min / 60)}:${pad(min % 60)}`;
const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1610]";
const AI_IDLE = "Monitoring pressure. A written clinical assessment appears here when a zone breaches 70 mmHg, or on demand.";

/* ------------------------------------------------------------------ */
/*  MAIN PAGE                                                          */
/* ------------------------------------------------------------------ */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sim] = useState(makeSim);

  // Ward roster state
  const [roster, setRoster] = useState<Patient[]>(SEED_PATIENTS);
  const [focusId, setFocusId] = useState<string | null>("PT-0427");
  // Default first screen to Ward Overview dashboard as requested
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null | undefined>(undefined); // undefined: closed; null: create; Patient: edit

  // Precomputed poses for all patients
  const poseSets = useMemo(() => {
    const map: Record<string, PoseSet> = {};
    for (const p of roster) map[p.id] = buildPoses(p);
    return map;
  }, [roster]);

  // Parallel ward tracks for all patients
  const tracksRef = useRef<Record<string, Track>>({});
  const [, setTrackVersion] = useState(0);

  // Initialise tracks
  useEffect(() => {
    const cur = tracksRef.current;
    for (const p of roster) {
      if (!cur[p.id]) {
        cur[p.id] = newTrack(p, poseSets[p.id]);
      }
    }
    setTrackVersion((v) => v + 1);
  }, [roster, poseSets]);

  // AI assessment state
  const [ai, setAi] = useState<{ text: string; source: string | null }>({ text: AI_IDLE, source: null });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzingRef = useRef(false);
  const autoFired = useRef(false);

  // Sync sim when active patient or pose changes
  useEffect(() => {
    const p = roster.find((x) => x.id === focusId) ?? null;
    sim.patient = p;
    sim.poseSet = p ? poseSets[p.id] : null;
    if (p && tracksRef.current[p.id]) {
      const t = tracksRef.current[p.id];
      sim.poseIdx = t.pose;
      sim.minInPos = t.minInPos;
    }
    sim.diveStart = performance.now();
    autoFired.current = false;
    setAi({ text: AI_IDLE, source: null });
  }, [focusId, roster, poseSets, sim]);

  // MASTER WARD CLOCK (1 real second = 1 second of simulation time)
  useEffect(() => {
    const id = setInterval(() => {
      // 1. Advance sim grid
      stepSim(sim);

      // 2. Advance ward tracks for all other patients on the ward
      const cur = tracksRef.current;
      for (const p of roster) {
        const t = cur[p.id];
        const ps = poseSets[p.id];
        if (!t || !ps) continue;
        if (p.id === sim.patient?.id) {
          // Active patient syncs from sim
          t.minInPos = sim.minInPos;
          t.pose = sim.poseIdx;
          t.peak = sim.maxP;
          t.score = sim.score;
          t.exposure = sim.exposure;
          t.zones = sim.zones.map((z) => ({ name: z.name, v: z.v }));
          t.hist = [...sim.history];
        } else {
          // Off-screen beds advance analytically
          t.minInPos += SIM_MIN_PER_TICK;
          refresh(p, t, ps);
          accrue(t, SIM_MIN_PER_TICK);
        }
      }

      setTrackVersion((v) => v + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [roster, poseSets, sim]);

  // Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const off = document.createElement("canvas");
    off.width = COLS;
    off.height = ROWS;
    const octx = off.getContext("2d");
    if (!octx) return;
    const img = octx.createImageData(COLS, ROWS);
    const grain = makeGrain();
    sim.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onMove = (e: PointerEvent) => {
      sim.pointer.x = e.clientX;
      sim.pointer.y = e.clientY;
      sim.pointer.e = 1;
    };
    window.addEventListener("pointermove", onMove);

    let raf = 0;
    const loop = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      sim.w = w;
      sim.h = h;
      sim.panelW = Math.max(MIN_PANEL, w / 3);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, sim, now, off, octx, img, grain);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [sim]);

  // Escape closes drawers / modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingPatient !== undefined) setEditingPatient(undefined);
        else if (dashboardOpen) setDashboardOpen(false);
        else if (drawerOpen) setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dashboardOpen, drawerOpen, editingPatient]);

  // Clinical AI analysis call
  const analyze = useCallback(async () => {
    const p = sim.patient;
    const ps = sim.poseSet;
    if (!p || !ps || analyzingRef.current) return;
    analyzingRef.current = true;
    setIsAnalyzing(true);
    setAi({ text: "Checking tissue state against prevention guidelines...", source: null });

    const poseName = ps.poses[sim.poseIdx].name;
    const nextIdx = nextPoseIdx(sim.poseIdx, ps.allowed);
    const nextPoseName = ps.poses[nextIdx].name;
    const topZones = [...sim.zones]
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((z) => ({ name: z.name, pressure: Math.round(z.v) }));

    const avoided = ps.allowed
      .map((ok, i) => (!ok ? `${ps.poses[i].name} (${ps.why[i]})` : null))
      .filter((s): s is string => s !== null);

    const woundsLoaded = ps.wounds
      .filter((w) => w.spots[sim.poseIdx].loaded)
      .map((w) => ({ label: w.label, pressure: Math.round(sim.maxP) }));

    const payload = {
      maxPressure: Math.round(sim.maxP),
      position: poseName,
      nextPosition: nextPoseName,
      minutesInPosition: Math.round(sim.minInPos),
      interval: p.interval,
      reliefScore: Math.round(sim.score),
      topZones,
      patient: {
        age: p.age,
        sex: p.sex,
        dx: p.dx,
        braden: p.braden,
        weightKg: p.weightKg,
        mobility: p.mobility,
        nutrition: p.nutrition,
      },
      conditions: p.conditions.map(condText),
      woundsLoaded,
      avoided,
      noSafe: ps.noSafe,
    };

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setAi({
        text: data.recommendation ?? careRecommendation(payload),
        source: data.source ?? "fallback",
      });
    } catch {
      setAi({ text: careRecommendation(payload), source: "fallback" });
    }
    analyzingRef.current = false;
    setIsAnalyzing(false);
  }, [sim]);

  // Auto-analyze once on critical breach
  useEffect(() => {
    if (!sim.patient) return;
    if (sim.maxP >= CRIT && !autoFired.current) {
      autoFired.current = true;
      analyze();
    }
    if (sim.maxP < CRIT - 8) autoFired.current = false;
  }, [sim.maxP, sim.patient, analyze]);

  /* ---- patient management handlers ---- */
  const focusPatient = (id: string) => {
    setFocusId(id);
    setDrawerOpen(false);
    setDashboardOpen(false);
  };

  const turnCurrent = () => {
    const p = sim.patient;
    const ps = sim.poseSet;
    if (!p || !ps) return;
    const n = nextPoseIdx(sim.poseIdx, ps.allowed);
    sim.poseIdx = n;
    sim.minInPos = 0;
    autoFired.current = false;
    if (tracksRef.current[p.id]) {
      turn(tracksRef.current[p.id], ps);
    }
  };

  const turnWardPatient = (id: string) => {
    const p = roster.find((x) => x.id === id);
    const ps = poseSets[id];
    const t = tracksRef.current[id];
    if (!p || !ps || !t) return;
    turn(t, ps);
    if (sim.patient?.id === id) {
      sim.poseIdx = t.pose;
      sim.minInPos = 0;
    }
    setTrackVersion((v) => v + 1);
  };

  const fastForward = () => {
    sim.minInPos += 30;
    if (sim.patient && tracksRef.current[sim.patient.id]) {
      tracksRef.current[sim.patient.id].minInPos = sim.minInPos;
    }
  };

  const handleSavePatient = (saved: Patient) => {
    const idx = roster.findIndex((p) => p.id === saved.id);
    if (idx >= 0) {
      const next = [...roster];
      next[idx] = saved;
      setRoster(next);
    } else {
      setRoster((prev) => [...prev, saved]);
      setFocusId(saved.id);
    }
    setEditingPatient(undefined);
  };

  const handleDeletePatient = (id: string) => {
    setRoster((prev) => prev.filter((p) => p.id !== id));
    delete tracksRef.current[id];
    if (focusId === id) {
      const remaining = roster.filter((p) => p.id !== id);
      setFocusId(remaining.length > 0 ? remaining[0].id : null);
    }
    setEditingPatient(undefined);
  };

  /* ---- active patient derived data ---- */
  const patient = roster.find((p) => p.id === focusId) ?? null;
  const pSet = patient ? poseSets[patient.id] : null;
  const track = patient ? tracksRef.current[patient.id] : null;
  const risk = patient ? riskOf(patient.braden) : null;
  const maxP = Math.round(sim.maxP);
  const remaining = patient ? Math.max(0, patient.interval - sim.minInPos) : 0;
  const overdue = patient ? sim.minInPos >= patient.interval : false;
  const frac = patient ? Math.min(1, sim.minInPos / patient.interval) : 0;
  const nextPose = pSet ? pSet.poses[nextPoseIdx(sim.poseIdx, pSet.allowed)].name : "";
  const hotZone = [...sim.zones].sort((a, b) => b.v - a.v)[0];

  const status =
    maxP >= CRIT
      ? { text: "Critical", cls: "text-[#a1241a] bg-[#b42318]/15 border-[#b42318]/50 animate-pulse" }
      : maxP >= 50
        ? { text: "Elevated", cls: "text-[#8a5a06] bg-[#c2760a]/15 border-[#c2760a]/40" }
        : { text: "Normal", cls: "text-[#1f6b43] bg-[#2f7d4f]/15 border-[#2f7d4f]/40" };

  const ringColor = overdue ? "#b42318" : remaining <= 20 ? "#c2760a" : "#2f7d4f";
  const prompts = patient && track && pSet ? alertsFor(patient, track, pSet, sim.maxP) : [];
  const promptBar = { critical: "#b42318", warn: "#c2760a", info: "#2f7d4f" };

  const chartPts = sim.history.map(
    (p, i) => [(i / (HIST - 1)) * 300, 80 - (Math.min(p, MAX_V) / MAX_V) * 80] as const,
  );
  const line = chartPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = chartPts.length > 1 ? `0,80 ${line} ${chartPts[chartPts.length - 1][0].toFixed(1)},80` : "";
  const thrY = 80 - (CRIT / MAX_V) * 80;
  const scoreColor = sim.score >= 70 ? "#1f6b43" : sim.score >= 40 ? "#8a5a06" : "#a1241a";

  const leftW = "calc(100vw - max(390px, 33.333vw))";

  return (
    <main className="font-ui relative h-screen w-screen overflow-hidden bg-[#e3cd8e] text-[#1b1610]">
      <style>{FONT_CSS}</style>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Top navigation bar */}
      <header className="absolute left-6 top-6 z-30 flex items-center gap-3">
        {patient && (
          <button
            onClick={() => setDrawerOpen((d) => !d)}
            aria-expanded={drawerOpen}
            className={`nav-pill flex items-center gap-3 rounded-full py-2 pl-2 pr-4 transition hover:bg-[#fffdf7] ${ring}`}
            title="Switch bed"
          >
            <span
              className="font-display flex h-9 w-9 items-center justify-center rounded-full border-2 text-base font-semibold"
              style={{ borderColor: risk?.color }}
            >
              {initials(patient.name)}
            </span>
            <span className="text-left leading-tight">
              <span className="font-display block text-xl">{patient.name}</span>
              <span className="block text-xs text-[#1b1610]/60">Bed {patient.bed} · Change</span>
            </span>
            <svg
              viewBox="0 0 12 12"
              className={`h-3 w-3 transition-transform ${drawerOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M2 4.5l4 4 4-4" />
            </svg>
          </button>
        )}

        <button
          id="btn-ward-dashboard"
          onClick={() => setDashboardOpen(true)}
          className={`nav-pill flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold transition hover:bg-[#fffdf7] ${ring}`}
        >
          <span className="dot-live h-2 w-2 rounded-full bg-[#1f6b43]" />
          Ward overview ({roster.length})
        </button>

        <button
          onClick={() => setEditingPatient(null)}
          className={`nav-pill rounded-full px-4 py-2.5 text-xs font-semibold transition hover:bg-[#fffdf7] ${ring}`}
        >
          + Admit patient
        </button>
      </header>

      {/* Hero shown when no patient is active */}
      <section
        className={`pointer-events-none absolute left-0 top-0 flex h-full items-center justify-center px-10 transition-opacity duration-700 ${
          patient ? "opacity-0" : "opacity-100"
        }`}
        style={{ width: leftW }}
        aria-hidden={!!patient}
      >
        <div className="max-w-xl text-center">
          <h1 className="font-display text-[clamp(64px,9vw,148px)] leading-[0.9] text-[#1b1610]">SkinSafe AI</h1>
          <p className="mx-auto mt-5 max-w-md text-lg leading-snug text-[#1b1610]/70">
            Real-time interface pressure sensing mattress, smart turn scheduling, and AI wound-injury prevention.
          </p>
          <button
            onClick={() => setDrawerOpen(true)}
            className={`pointer-events-auto btn-ink mt-8 rounded-full px-7 py-3.5 text-base font-semibold ${ring}`}
          >
            Select patient
          </button>
        </div>
      </section>

      {/* Brand & legend (bottom-left) */}
      <div
        className={`pointer-events-none absolute bottom-7 left-8 w-72 transition-opacity duration-700 ${
          patient ? "opacity-100" : "opacity-0"
        }`}
      >
        <p className="font-display mb-3 text-3xl">SkinSafe AI</p>
        <div className="mb-1.5 flex justify-between text-xs text-[#1b1610]/65">
          <span>0</span>
          <span>Pressure in mmHg</span>
          <span>120</span>
        </div>
        <div className="h-2.5 rounded-full ring-1 ring-[#1b1610]/30" style={{ background: LEGEND_GRADIENT }} />
        <div className="relative mt-1 h-4 text-xs text-[#1b1610]/65">
          <span className="absolute -translate-x-1/2" style={{ left: `${(CRIT / MAX_V) * 100}%` }}>
            70 critical threshold
          </span>
        </div>
      </div>

      {/* Patient Drawer */}
      {drawerOpen && <div className="absolute inset-0 z-40 bg-[#3a2a10]/30 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} aria-hidden />}
      <aside
        className={`sheet-panel absolute bottom-0 left-0 top-0 z-50 flex w-[410px] max-w-[92vw] flex-col transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
          drawerOpen ? "translate-x-0" : "-translate-x-[105%]"
        }`}
        aria-hidden={!drawerOpen}
      >
        <div className="flex items-start justify-between px-7 pb-4 pt-8">
          <div>
            <h2 className="font-display text-4xl">Ward roster</h2>
            <p className="mt-1 text-xs text-[#1b1610]/65">
              Select a bed to open its live mattress pressure feed and clinical turn plan.
            </p>
          </div>
          <button onClick={() => setDrawerOpen(false)} className={`btn-ghost h-9 w-9 rounded-full ${ring}`} aria-label="Close">
            ×
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto border-t border-[#1b1610]/12 [scrollbar-width:thin]">
          {roster.map((p) => {
            const r = riskOf(p.braden);
            const active = focusId === p.id;
            const t = tracksRef.current[p.id];
            return (
              <li key={p.id} className="border-b border-[#1b1610]/12">
                <button
                  onClick={() => focusPatient(p.id)}
                  className={`flex w-full items-center gap-4 px-7 py-4 text-left transition hover:bg-[#c9a24a]/25 ${
                    active ? "bg-[#c9a24a]/30" : ""
                  } ${ring}`}
                >
                  <span
                    className="font-display flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-xl"
                    style={{ borderColor: r.color }}
                  >
                    {initials(p.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-display block truncate text-2xl leading-tight">{p.name}</span>
                    <span className="block text-xs text-[#1b1610]/65">
                      Bed {p.bed} · {p.age}y · {p.sex}
                    </span>
                    <span className="block truncate text-xs text-[#1b1610]/80">{p.dx}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-display tnum block text-3xl leading-none">{t ? Math.round(t.peak) : "--"}</span>
                    <span className="mt-1 block text-[11px] font-semibold" style={{ color: r.color }}>
                      mmHg
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-[#1b1610]/12 p-4">
          <button
            onClick={() => {
              setDrawerOpen(false);
              setEditingPatient(null);
            }}
            className={`btn-ink rounded-full px-4 py-2 text-xs font-semibold ${ring}`}
          >
            + Admit new patient
          </button>
          <span className="text-xs text-[#1b1610]/55">{roster.length} beds occupied</span>
        </div>
      </aside>

      {/* Main clinical info panel (right 1/3) - 100% OPAQUE SHEET SO TEXT IS CRISP */}
      <aside className="absolute bottom-0 right-0 top-0 z-20 w-[max(390px,33.333vw)] p-3.5">
        <div className="sheet-panel flex h-full flex-col overflow-y-auto rounded-[28px] px-6 py-6 [scrollbar-width:thin]">
          {!patient || !pSet ? (
            <div className="my-auto text-center">
              <h2 className="font-display text-4xl leading-tight">No bed selected</h2>
              <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-[#1b1610]/70">
                Choose a patient to see their live pressure map, condition notes, and turn schedule.
              </p>
              <button onClick={() => setDrawerOpen(true)} className={`btn-ink mt-6 rounded-full px-6 py-2.5 text-sm font-semibold ${ring}`}>
                Select patient
              </button>
            </div>
          ) : (
            <>
              {/* Patient header */}
              <header>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-[40px] leading-none">{patient.name}</h2>
                      <button
                        onClick={() => setEditingPatient(patient)}
                        className={`btn-ghost h-7 w-7 rounded-full text-xs font-semibold ${ring}`}
                        title="Edit details"
                        aria-label="Edit patient"
                      >
                        ✎
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-[#1b1610]/70 font-medium">
                      Bed {patient.bed} · {patient.age}y {patient.sex.toLowerCase()} · {patient.dx}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${status.cls}`}>
                    {status.text}
                  </span>
                </div>

                {/* Braden score */}
                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-[#1b1610]/65 font-medium">Braden score</span>
                    <span className="font-semibold" style={{ color: risk?.color }}>
                      {patient.braden} of 23 · {risk?.label.toLowerCase()}
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-2 rounded-full" style={{ background: "linear-gradient(90deg,#b42318,#d97706,#3f7d4a)" }}>
                    <span
                      className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1b1610] bg-[#f7ecc8]"
                      style={{ left: `${((patient.braden - 6) / 17) * 100}%` }}
                    />
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <dt className="text-[#1b1610]/60 font-medium">Weight</dt>
                    <dd className="mt-0.5 font-bold">{patient.weightKg} kg</dd>
                  </div>
                  <div>
                    <dt className="text-[#1b1610]/60 font-medium">Mobility</dt>
                    <dd className="mt-0.5 font-bold leading-tight">{patient.mobility}</dd>
                  </div>
                  <div>
                    <dt className="text-[#1b1610]/60 font-medium">Nutrition</dt>
                    <dd className="mt-0.5 font-bold leading-tight">{patient.nutrition}</dd>
                  </div>
                </dl>

                {/* Body notes (fractures, casts, arm on chest, elevated leg, etc.) */}
                {patient.conditions.length > 0 && (
                  <div className="mt-4 rounded-xl border border-[#1b1610]/14 bg-[#fbf5e2] p-3 shadow-sm">
                    <p className="eyebrow mb-1.5">Body conditions & mattress notes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {patient.conditions.map((c) => (
                        <span key={c.id} className="tag text-xs font-semibold">
                          {condText(c)}
                          {c.note ? ` (${c.note})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </header>

              {/* Turn schedule */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-2xl">Turn schedule</h3>
                  <span className="text-xs text-[#1b1610]/60">Every {patient.interval} min</span>
                </div>
                <div className="mt-3 flex items-center gap-5">
                  <div className="relative h-[116px] w-[116px] shrink-0">
                    <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
                      <circle cx="70" cy="70" r="60" fill="none" stroke="rgba(27,22,16,0.12)" strokeWidth="9" />
                      <circle
                        cx="70"
                        cy="70"
                        r="60"
                        fill="none"
                        stroke={ringColor}
                        strokeWidth="9"
                        strokeLinecap="round"
                        strokeDasharray={`${frac * 377} 377`}
                        style={{ transition: "stroke-dasharray 0.3s, stroke 0.4s" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <p className={`font-display tnum text-3xl leading-none ${overdue ? "animate-pulse text-[#a1241a]" : ""}`}>
                        {overdue ? "Late" : fmtHM(remaining)}
                      </p>
                      <p className="mt-1 text-[11px] text-[#1b1610]/55">{overdue ? "turn now" : "hours:min left"}</p>
                    </div>
                  </div>
                  <dl className="flex-1 text-sm">
                    <dt className="text-xs text-[#1b1610]/55">Position now</dt>
                    <dd className="font-semibold">{pSet.poses[sim.poseIdx].name}</dd>
                    <dt className="mt-2 text-xs text-[#1b1610]/55">Next position</dt>
                    <dd className="font-semibold text-[#1f6b43]">{nextPose}</dd>
                    <dt className="mt-2 text-xs text-[#1b1610]/55">Time in position</dt>
                    <dd className="font-semibold">{Math.round(sim.minInPos)} min</dd>
                  </dl>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <button
                    onClick={turnCurrent}
                    className={`btn-ink flex-1 rounded-full px-4 py-2.5 text-sm font-semibold ${ring}`}
                  >
                    Confirm turn done
                  </button>
                  <button
                    onClick={fastForward}
                    className={`text-xs text-[#1b1610]/65 underline decoration-[#1b1610]/30 underline-offset-4 transition hover:text-[#1b1610] ${ring}`}
                    title="Demo only: skips ahead 30 simulated minutes"
                  >
                    Skip ahead 30 min
                  </button>
                </div>
              </section>

              {/* Nurse prompts */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <h3 className="font-display text-2xl">Nurse prompts</h3>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {prompts.map((p, i) => (
                    <li
                      key={i}
                      className="border-l-[3px] py-0.5 pl-3 text-sm leading-snug"
                      style={{ borderColor: promptBar[p.level] }}
                    >
                      {p.text}
                    </li>
                  ))}
                </ul>
              </section>

              {/* Pressure readings */}
              <section className="mt-5 grid grid-cols-3 border-t border-[#1b1610]/12 pt-5">
                <div>
                  <p className="text-xs text-[#1b1610]/60">Max pressure</p>
                  <p className="font-display tnum text-[44px] leading-none" style={{ color: lutCss(maxP) }}>
                    {maxP}
                  </p>
                  <p className="text-xs text-[#1b1610]/55">mmHg</p>
                </div>
                <div className="border-l border-[#1b1610]/12 pl-4">
                  <p className="text-xs text-[#1b1610]/60">Tissue relief</p>
                  <p className="font-display tnum text-[44px] leading-none" style={{ color: scoreColor }}>
                    {Math.round(sim.score)}
                  </p>
                  <p className="text-xs text-[#1b1610]/55">out of 100</p>
                </div>
                <div className="border-l border-[#1b1610]/12 pl-4">
                  <p className="text-xs text-[#1b1610]/60">Exposure</p>
                  <p className="font-display tnum text-[44px] leading-none">{sim.exposure.toFixed(1)}</p>
                  <p className="text-xs text-[#1b1610]/55">mmHg hrs &gt;32</p>
                </div>
              </section>

              {/* Pressure history */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <h3 className="font-display text-2xl">Pressure history</h3>
                <p className="text-xs text-[#1b1610]/55">Highest reading each minute, last {HIST} minutes. Dashed line marks 70.</p>
                <svg viewBox="0 0 300 80" className="mt-3 h-20 w-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="hist" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d9532b" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#d9532b" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line x1="0" x2="300" y1={thrY} y2={thrY} stroke="#b42318" strokeDasharray="4 4" strokeOpacity="0.7" />
                  {area && <polygon points={area} fill="url(#hist)" />}
                  {line && (
                    <polyline points={line} fill="none" stroke="#1b1610" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                  )}
                </svg>
              </section>

              {/* Load by zone */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <h3 className="font-display text-2xl">Load by zone</h3>
                <div className="mt-3 flex flex-col gap-2.5">
                  {sim.zones.map((z) => (
                    <div key={z.name} className="flex items-center gap-3 text-xs">
                      <span className="w-24 text-[#1b1610]/70">{z.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#1b1610]/10">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (z.v / MAX_V) * 100)}%`, background: lutCss(z.v) }}
                        />
                      </div>
                      <span className="tnum w-8 text-right font-semibold">{Math.round(z.v)}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Clinical AI Assessment */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-2xl">Clinical AI assessment</h3>
                  <span className="text-xs font-semibold text-[#1f6b43] flex items-center gap-1.5">
                    <span className="dot-live h-1.5 w-1.5 rounded-full bg-[#1f6b43]" />
                    AI assessment
                  </span>
                </div>
                <p
                  className={`mt-2 min-h-[72px] text-[15px] leading-relaxed ${
                    maxP >= CRIT && !isAnalyzing ? "font-semibold text-[#a1241a]" : "text-[#1b1610]/85"
                  }`}
                  aria-live="polite"
                >
                  {ai.text}
                </p>
                <button
                  onClick={analyze}
                  disabled={isAnalyzing}
                  className={`btn-ghost mt-3 rounded-full px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${ring}`}
                >
                  {isAnalyzing ? "Analyzing..." : "Analyze risk"}
                </button>
              </section>

              <footer className="mt-6 flex items-center justify-between border-t border-[#1b1610]/12 pt-4 text-xs text-[#1b1610]/55">
                <span>IEEE CS Hackathon, MT-07</span>
                <button
                  onClick={() => {
                    sim.minInPos = 0;
                    sim.display.fill(0);
                    autoFired.current = false;
                  }}
                  className={`underline decoration-[#1b1610]/30 underline-offset-4 transition hover:text-[#1b1610] ${ring}`}
                >
                  Reset monitoring
                </button>
              </footer>
            </>
          )}
        </div>
      </aside>

      {/* Ward Dashboard modal */}
      {dashboardOpen && (
        <WardDashboard
          roster={roster}
          tracks={tracksRef.current}
          poseSets={poseSets}
          focusId={focusId}
          colorOf={lutCss}
          onOpen={focusPatient}
          onTurn={turnWardPatient}
          onAdd={() => setEditingPatient(null)}
          onEdit={(id) => {
            const p = roster.find((x) => x.id === id);
            if (p) setEditingPatient(p);
          }}
          onClose={() => setDashboardOpen(false)}
        />
      )}

      {/* Add / Edit Patient modal */}
      {editingPatient !== undefined && (
        <PatientForm
          initial={editingPatient ?? undefined}
          takenBeds={roster.map((p) => p.bed)}
          onSave={handleSavePatient}
          onDelete={handleDeletePatient}
          onClose={() => setEditingPatient(undefined)}
        />
      )}
    </main>
  );
}