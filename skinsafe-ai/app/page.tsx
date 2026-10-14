"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  CONFIG                                                             */
/* ------------------------------------------------------------------ */
const COLS = 128;
const ROWS = 72;
const TICK_MS = 100;
const SIM_MIN_PER_TICK = 0.2; // 2 simulated minutes per real second
const CRIT = 70; // mmHg
const MAX_V = 120;
const HIST = 90;
const NB = 14; // colour buckets for pressure-tinted grid segments
const MIN_PANEL = 380;

const FONT_CSS = `@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
.font-display{font-family:'Instrument Serif',Georgia,serif;font-weight:400;letter-spacing:-0.01em}
.font-ui{font-family:'Instrument Sans',system-ui,-apple-system,sans-serif}
.tnum{font-variant-numeric:tabular-nums}`;

/* ------------------------------------------------------------------ */
/*  SYNTHETIC PATIENTS                                                 */
/* ------------------------------------------------------------------ */
type Patient = {
  id: string;
  name: string;
  age: number;
  sex: string;
  bed: string;
  dx: string;
  weightKg: number;
  braden: number; // 6 (highest risk) to 23 (lowest)
  mobility: string;
  nutrition: string;
  interval: number; // minutes between turns
  sens: number; // tissue sensitivity multiplier
  startMin: number; // minutes already spent in the current position
  startPose: number;
};

const PATIENTS: Patient[] = [
  {
    id: "PT-0427",
    name: "Meera Nair",
    age: 72,
    sex: "Female",
    bed: "12B",
    dx: "Hip fracture, post-op day 2",
    weightKg: 52,
    braden: 11,
    mobility: "Bed-bound",
    nutrition: "Low albumin",
    interval: 90,
    sens: 1.15,
    startMin: 40,
    startPose: 0,
  },
  {
    id: "PT-0312",
    name: "Arjun Rao",
    age: 58,
    sex: "Male",
    bed: "07A",
    dx: "Ischemic stroke, left weakness",
    weightKg: 82,
    braden: 13,
    mobility: "Needs full assist",
    nutrition: "Adequate",
    interval: 120,
    sens: 1.0,
    startMin: 20,
    startPose: 0,
  },
  {
    id: "PT-0551",
    name: "Lakshmi Iyer",
    age: 81,
    sex: "Female",
    bed: "03C",
    dx: "Recovering from sepsis",
    weightKg: 45,
    braden: 9,
    mobility: "Unresponsive to position",
    nutrition: "Tube feeding",
    interval: 90,
    sens: 1.3,
    startMin: 55,
    startPose: 1,
  },
  {
    id: "PT-0198",
    name: "Karthik Subramanian",
    age: 34,
    sex: "Male",
    bed: "09B",
    dx: "Spinal cord injury at T10",
    weightKg: 70,
    braden: 12,
    mobility: "No sensation below T10",
    nutrition: "Adequate",
    interval: 120,
    sens: 1.1,
    startMin: 10,
    startPose: 0,
  },
  {
    id: "PT-0634",
    name: "Fatima Sheikh",
    age: 46,
    sex: "Female",
    bed: "15A",
    dx: "Bariatric surgery, post-op day 1",
    weightKg: 104,
    braden: 17,
    mobility: "Moves with help",
    nutrition: "Adequate",
    interval: 150,
    sens: 0.9,
    startMin: 0,
    startPose: 2,
  },
];

const riskOf = (braden: number) =>
  braden <= 9
    ? { label: "Very high risk", color: "#b42318" }
    : braden <= 12
      ? { label: "High risk", color: "#c2410c" }
      : braden <= 14
        ? { label: "Moderate risk", color: "#a16207" }
        : braden <= 18
          ? { label: "Mild risk", color: "#3f7d4a" }
          : { label: "Low risk", color: "#2f6f4f" };

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

/* ------------------------------------------------------------------ */
/*  COLOUR LUT: blue, teal, green, gold, orange, red, crimson          */
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
/*  BODY MODEL (body units: x offset, y 0..1 head to heel)             */
/* ------------------------------------------------------------------ */
type Blob = { x: number; y: number; s: number; p: number };
type Cap = { ax: number; ay: number; bx: number; by: number; r: number };
type ZoneDef = { name: string; x: number; y: number };
type Pose = { name: string; caps: Cap[]; blobs: Blob[]; zones: ZoneDef[] };

const SUPINE: Pose = {
  name: "Supine",
  caps: [
    { ax: 0, ay: 0.07, bx: 0, by: 0.085, r: 0.042 },
    { ax: 0, ay: 0.19, bx: 0, by: 0.52, r: 0.105 },
    { ax: -0.145, ay: 0.2, bx: -0.16, by: 0.42, r: 0.032 },
    { ax: 0.145, ay: 0.2, bx: 0.16, by: 0.42, r: 0.032 },
    { ax: -0.04, ay: 0.56, bx: -0.045, by: 0.96, r: 0.04 },
    { ax: 0.04, ay: 0.56, bx: 0.045, by: 0.96, r: 0.04 },
  ],
  blobs: [
    { x: 0, y: 0.07, s: 0.03, p: 46 },
    { x: -0.05, y: 0.22, s: 0.035, p: 62 },
    { x: 0.05, y: 0.22, s: 0.035, p: 62 },
    { x: 0, y: 0.47, s: 0.05, p: 100 },
    { x: -0.045, y: 0.51, s: 0.04, p: 68 },
    { x: 0.045, y: 0.51, s: 0.04, p: 68 },
    { x: -0.15, y: 0.41, s: 0.022, p: 58 },
    { x: 0.15, y: 0.41, s: 0.022, p: 58 },
    { x: -0.04, y: 0.74, s: 0.04, p: 44 },
    { x: 0.04, y: 0.74, s: 0.04, p: 44 },
    { x: -0.04, y: 0.955, s: 0.02, p: 90 },
    { x: 0.04, y: 0.955, s: 0.02, p: 90 },
  ],
  zones: [
    { name: "Occiput", x: 0, y: 0.07 },
    { name: "Scapulae", x: 0.05, y: 0.22 },
    { name: "Elbows", x: 0.15, y: 0.41 },
    { name: "Sacrum", x: 0, y: 0.47 },
    { name: "Calves", x: 0.04, y: 0.74 },
    { name: "Heels", x: 0.04, y: 0.955 },
  ],
};

const LEFT: Pose = {
  name: "Left lateral 30°",
  caps: [
    { ax: 0, ay: 0.07, bx: 0, by: 0.085, r: 0.04 },
    { ax: 0, ay: 0.19, bx: 0, by: 0.52, r: 0.062 },
    { ax: 0.05, ay: 0.25, bx: 0.05, by: 0.4, r: 0.025 },
    { ax: 0, ay: 0.56, bx: 0, by: 0.96, r: 0.05 },
    { ax: 0.025, ay: 0.56, bx: 0.025, by: 0.95, r: 0.04 },
  ],
  blobs: [
    { x: 0, y: 0.07, s: 0.028, p: 52 },
    { x: 0, y: 0.2, s: 0.04, p: 86 },
    { x: 0, y: 0.32, s: 0.04, p: 40 },
    { x: 0, y: 0.5, s: 0.05, p: 98 },
    { x: 0, y: 0.74, s: 0.03, p: 62 },
    { x: 0, y: 0.94, s: 0.025, p: 74 },
  ],
  zones: [
    { name: "Ear", x: 0, y: 0.07 },
    { name: "Shoulder", x: 0, y: 0.2 },
    { name: "Trochanter", x: 0, y: 0.5 },
    { name: "Knee", x: 0, y: 0.74 },
    { name: "Ankle", x: 0, y: 0.94 },
  ],
};

const mirror = (p: Pose, name: string): Pose => ({
  name,
  caps: p.caps.map((c) => ({ ...c, ax: -c.ax, bx: -c.bx })),
  blobs: p.blobs.map((b) => ({ ...b, x: -b.x })),
  zones: p.zones.map((z) => ({ ...z, x: -z.x })),
});

const POSES: Pose[] = [SUPINE, LEFT, mirror(LEFT, "Right lateral 30°")];

function segDist(px: number, py: number, c: Cap) {
  const vx = c.bx - c.ax;
  const vy = c.by - c.ay;
  const wx = px - c.ax;
  const wy = py - c.ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 === 0 ? 0 : (wx * vx + wy * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (c.ax + t * vx), py - (c.ay + t * vy));
}

/* ------------------------------------------------------------------ */
/*  SIMULATION (synthetic data only)                                   */
/* ------------------------------------------------------------------ */
type ZoneReading = { name: string; v: number; x: number; y: number };
type Sim = {
  display: Float32Array;
  target: Float32Array;
  dose: Float32Array;
  patient: Patient | null;
  minInPos: number;
  pose: number;
  turns: number;
  history: number[];
  zones: ZoneReading[];
  tickCount: number;
  maxP: number;
  score: number;
  exposure: number;
  // viewport + animation state shared with the renderer
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
  minInPos: 0,
  pose: 0,
  turns: 0,
  history: [],
  zones: [],
  tickCount: 0,
  maxP: 0,
  score: 100,
  exposure: 0,
  w: 1920,
  h: 1080,
  panelW: 640,
  diveStart: null,
  reduced: false,
  pointer: { x: -1000, y: -1000, e: 0 },
});

function step(sim: Sim) {
  const w = sim.w;
  const h = sim.h;
  const cw = w / COLS;
  const ch = h / ROWS;
  const p = sim.patient;
  const t = sim.target;
  t.fill(0);

  const bodyH = h * 0.82;
  const top = h * 0.09;
  const cx = (w - sim.panelW) / 2;

  if (p) {
    sim.minInPos += SIM_MIN_PER_TICK;
    sim.tickCount++;
    const pose = POSES[sim.pose];
    const pf = p.sens * Math.sqrt(p.weightKg / 70);
    const load = (0.5 + 0.6 * Math.min(sim.minInPos / p.interval, 1.4)) * pf;

    // baseline body contact
    const x0 = Math.max(0, Math.floor((cx - 0.3 * bodyH) / cw));
    const x1 = Math.min(COLS - 1, Math.ceil((cx + 0.3 * bodyH) / cw));
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

    // bony pressure points (gaussian, pixel space)
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

  // ease display toward target, accumulate tissue dose
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

  if (!p) {
    sim.zones = [];
    return;
  }

  const pose = POSES[sim.pose];
  sim.zones = pose.zones.map((z) => {
    const zx = cx + z.x * bodyH;
    const zy = top + z.y * bodyH;
    const gx = Math.round(zx / cw - 0.5);
    const gy = Math.round(zy / ch - 0.5);
    let v = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = gx + dx;
        const yy = gy + dy;
        if (xx >= 0 && xx < COLS && yy >= 0 && yy < ROWS) v = Math.max(v, sim.display[yy * COLS + xx]);
      }
    }
    return { name: z.name, v, x: zx, y: zy };
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

function resetSim(sim: Sim) {
  sim.display.fill(0);
  sim.target.fill(0);
  sim.dose.fill(0);
  sim.minInPos = 0;
  sim.pose = 0;
  sim.turns = 0;
  sim.history = [];
  sim.zones = [];
  sim.tickCount = 0;
  sim.maxP = 0;
  sim.score = 100;
  sim.exposure = 0;
}

type UI = {
  patientIdx: number;
  interval: number;
  minInPos: number;
  pose: number;
  maxP: number;
  score: number;
  exposure: number;
  turns: number;
  zones: ZoneReading[];
  history: number[];
};
const snapshot = (sim: Sim): UI => ({
  patientIdx: sim.patient ? PATIENTS.findIndex((p) => p.id === sim.patient!.id) : -1,
  interval: sim.patient?.interval ?? 120,
  minInPos: sim.minInPos,
  pose: sim.pose,
  maxP: sim.maxP,
  score: sim.score,
  exposure: sim.exposure,
  turns: sim.turns,
  zones: [...sim.zones],
  history: [...sim.history],
});

/* ------------------------------------------------------------------ */
/*  RENDERER                                                           */
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

// Moves one grid vertex: dive funnel, water flow, pointer ripple, pressure wells.
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

type AiState = { text: string; source: string | null };
const AI_IDLE = "Monitoring pressure. A written assessment appears here when a zone goes critical, or when you ask for one.";

const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1610]";

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sim] = useState(makeSim);
  const [ui, setUi] = useState<UI>(() => snapshot(makeSim()));
  const [drawer, setDrawer] = useState(false);
  const [ai, setAi] = useState<AiState>({ text: AI_IDLE, source: null });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzingRef = useRef(false);
  const autoFired = useRef(false);

  // simulation clock
  useEffect(() => {
    const id = setInterval(() => {
      step(sim);
      if (sim.tickCount % 3 === 0 || !sim.patient) setUi(snapshot(sim));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [sim]);

  // render loop
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

  // escape closes the patient drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const analyze = useCallback(async () => {
    const p = sim.patient;
    if (!p || analyzingRef.current) return;
    analyzingRef.current = true;
    setIsAnalyzing(true);
    setAi({ text: "Sending the pressure map to Gemini...", source: null });

    const topZones = [...sim.zones]
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((z) => ({ name: z.name, pressure: Math.round(z.v) }));

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxPressure: Math.round(sim.maxP),
          position: POSES[sim.pose].name,
          minutesInPosition: Math.round(sim.minInPos),
          reliefScore: Math.round(sim.score),
          topZones,
          patient: { age: p.age, sex: p.sex, dx: p.dx, braden: p.braden, weightKg: p.weightKg },
        }),
      });
      const data = await res.json();
      setAi({ text: data.recommendation ?? "No recommendation returned.", source: data.source ?? null });
    } catch {
      setAi({ text: "Could not reach the server. Check your connection and the dev server log.", source: "error" });
    }
    analyzingRef.current = false;
    setIsAnalyzing(false);
  }, [sim]);

  // analyse once per pressure breach
  useEffect(() => {
    if (ui.patientIdx < 0) return;
    if (ui.maxP >= CRIT && !autoFired.current) {
      autoFired.current = true;
      analyze();
    }
    if (ui.maxP < CRIT - 8) autoFired.current = false;
  }, [ui.maxP, ui.patientIdx, analyze]);

  const selectPatient = (idx: number) => {
    const p = PATIENTS[idx];
    resetSim(sim);
    sim.patient = p;
    sim.pose = p.startPose;
    sim.minInPos = p.startMin;
    sim.diveStart = performance.now();
    autoFired.current = false;
    setAi({ text: AI_IDLE, source: null });
    setDrawer(false);
    setUi(snapshot(sim));
  };
  const turnPatient = () => {
    sim.pose = (sim.pose + 1) % POSES.length;
    sim.minInPos = 0;
    sim.turns++;
    autoFired.current = false;
    setUi(snapshot(sim));
  };
  const fastForward = () => {
    sim.minInPos += 30;
    setUi(snapshot(sim));
  };
  const resetMonitoring = () => {
    const p = sim.patient;
    resetSim(sim);
    if (p) {
      sim.patient = p;
      sim.pose = p.startPose;
      sim.minInPos = p.startMin;
    }
    autoFired.current = false;
    setAi({ text: AI_IDLE, source: null });
    setUi(snapshot(sim));
  };

  /* ---- derived ---- */
  const patient = ui.patientIdx >= 0 ? PATIENTS[ui.patientIdx] : null;
  const risk = patient ? riskOf(patient.braden) : null;
  const maxP = Math.round(ui.maxP);
  const remaining = Math.max(0, ui.interval - ui.minInPos);
  const overdue = ui.minInPos >= ui.interval;
  const frac = Math.min(1, ui.minInPos / ui.interval);
  const nextPose = POSES[(ui.pose + 1) % POSES.length].name;
  const hotZone = [...ui.zones].sort((a, b) => b.v - a.v)[0];
  const firstName = patient ? patient.name.split(" ")[0] : "";

  const status =
    maxP >= CRIT
      ? { text: "Critical", cls: "text-[#a1241a] bg-[#b42318]/15 border-[#b42318]/50 animate-pulse" }
      : maxP >= 50
        ? { text: "Elevated", cls: "text-[#8a5a06] bg-[#c2760a]/15 border-[#c2760a]/40" }
        : { text: "Normal", cls: "text-[#1f6b43] bg-[#2f7d4f]/15 border-[#2f7d4f]/40" };

  const ringColor = overdue ? "#b42318" : remaining <= 20 ? "#c2760a" : "#2f7d4f";

  const prompts: { level: "critical" | "warn" | "info"; text: string }[] = [];
  if (patient) {
    if (overdue) {
      prompts.push({
        level: "critical",
        text: `${firstName} is ${Math.round(ui.minInPos - ui.interval)} minutes overdue for a turn. Move to ${nextPose} now.`,
      });
    } else if (remaining <= 20) {
      prompts.push({
        level: "warn",
        text: `Turn due in ${Math.ceil(remaining)} minutes. Get pillows and a second nurse ready for ${nextPose}.`,
      });
    }
    if (maxP >= CRIT && hotZone) {
      prompts.push({
        level: "critical",
        text: `Pressure at the ${hotZone.name.toLowerCase()} is ${Math.round(hotZone.v)} mmHg. Offload the area now.`,
      });
    }
    if (prompts.length === 0) {
      prompts.push({ level: "info", text: `On schedule. Next turn to ${nextPose} in ${fmtHM(remaining)}.` });
    }
  }
  const promptBar = { critical: "#b42318", warn: "#c2760a", info: "#2f7d4f" };

  const chartPts = ui.history.map(
    (p, i) => [(i / (HIST - 1)) * 300, 80 - (Math.min(p, MAX_V) / MAX_V) * 80] as const,
  );
  const line = chartPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = chartPts.length > 1 ? `0,80 ${line} ${chartPts[chartPts.length - 1][0].toFixed(1)},80` : "";
  const thrY = 80 - (CRIT / MAX_V) * 80;

  const scoreColor = ui.score >= 70 ? "#1f6b43" : ui.score >= 40 ? "#8a5a06" : "#a1241a";

  const leftW = "calc(100vw - max(380px, 33.333vw))";

  return (
    <main className="font-ui relative h-screen w-screen overflow-hidden bg-[#e3cd8e] text-[#1b1610]">
      <style>{FONT_CSS}</style>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* hero, shown until a patient is chosen */}
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
            Watch pressure build under a patient, and know when to turn them before skin breaks down.
          </p>
          <button
            onClick={() => setDrawer(true)}
            className={`pointer-events-auto mt-8 rounded-full bg-[#1b1610] px-7 py-3.5 text-base font-semibold text-[#f6e9bf] shadow-[0_12px_30px_-10px_rgba(27,22,16,0.6)] transition hover:bg-[#3a2e1d] ${ring}`}
          >
            Select patient
          </button>
        </div>
      </section>

      {/* patient tab */}
      {patient && (
        <button
          onClick={() => setDrawer((d) => !d)}
          aria-expanded={drawer}
          className={`absolute left-6 top-6 z-30 flex items-center gap-3 rounded-full border border-[#1b1610]/25 bg-[#f7ecc8]/70 py-2 pl-2 pr-4 backdrop-blur-md transition hover:bg-[#f7ecc8]/90 ${ring}`}
        >
          <span
            className="font-display flex h-9 w-9 items-center justify-center rounded-full border-2 text-base"
            style={{ borderColor: risk?.color }}
          >
            {initials(patient.name)}
          </span>
          <span className="text-left leading-tight">
            <span className="font-display block text-xl">{patient.name}</span>
            <span className="block text-xs text-[#1b1610]/60">Change patient</span>
          </span>
          <svg
            viewBox="0 0 12 12"
            className={`h-3 w-3 transition-transform ${drawer ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M2 4.5l4 4 4-4" />
          </svg>
        </button>
      )}

      {/* brand and legend */}
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
            70 is critical
          </span>
        </div>
      </div>

      {/* patient drawer */}
      {drawer && <div className="absolute inset-0 z-30" onClick={() => setDrawer(false)} aria-hidden />}
      <aside
        className={`absolute bottom-0 left-0 top-0 z-40 flex w-[380px] max-w-[92vw] flex-col border-r border-[#1b1610]/15 bg-[#f6e9bf]/80 shadow-[30px_0_80px_-40px_rgba(70,45,10,0.6)] backdrop-blur-2xl transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
          drawer ? "translate-x-0" : "-translate-x-[105%]"
        }`}
        aria-hidden={!drawer}
        inert={!drawer}
      >
        <div className="px-7 pb-4 pt-8">
          <h2 className="font-display text-4xl">Select patient</h2>
          <p className="mt-2 text-sm leading-snug text-[#1b1610]/65">
            Five synthetic patients with different risk profiles. Picking one loads their pressure pattern.
          </p>
        </div>
        <ul className="flex-1 overflow-y-auto border-t border-[#1b1610]/12 [scrollbar-width:thin]">
          {PATIENTS.map((p, i) => {
            const r = riskOf(p.braden);
            const active = ui.patientIdx === i;
            return (
              <li key={p.id} className="border-b border-[#1b1610]/12">
                <button
                  onClick={() => selectPatient(i)}
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
                  <span className="min-w-0 flex-1">
                    <span className="font-display block truncate text-2xl leading-tight">{p.name}</span>
                    <span className="block text-xs text-[#1b1610]/65">
                      {p.age}, {p.sex.toLowerCase()}, bed {p.bed}
                    </span>
                    <span className="block truncate text-xs text-[#1b1610]/80">{p.dx}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-display tnum block text-3xl leading-none">{p.braden}</span>
                    <span className="mt-1 block text-[11px] font-semibold" style={{ color: r.color }}>
                      {r.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-7 py-4 text-xs text-[#1b1610]/55">The number is the Braden score. Lower means higher risk.</p>
      </aside>

      {/* info panel, one third of the page */}
      <div className="absolute bottom-0 right-0 top-0 z-20 w-[max(380px,33.333vw)] p-3.5">
        <div className="flex h-full flex-col overflow-y-auto rounded-[28px] border border-[#1b1610]/12 bg-[#f7ecc8]/55 px-6 py-6 shadow-[0_30px_80px_-30px_rgba(80,55,10,0.55)] backdrop-blur-xl [scrollbar-width:thin]">
          {!patient ? (
            <div className="my-auto">
              <h2 className="font-display text-4xl leading-tight">No patient selected</h2>
              <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-[#1b1610]/70">
                Choose a patient to see their pressure map, turn schedule and nurse prompts here.
              </p>
              <button
                onClick={() => setDrawer(true)}
                className={`mt-6 rounded-full border border-[#1b1610] px-6 py-2.5 text-sm font-semibold transition hover:bg-[#1b1610] hover:text-[#f6e9bf] ${ring}`}
              >
                Select patient
              </button>
              <p className="mt-10 text-xs text-[#1b1610]/55">
                IEEE CS Hackathon, MT-07 Connected MedTech. All patient data is synthetic.
              </p>
            </div>
          ) : (
            <>
              {/* patient */}
              <header>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[40px] leading-none">{patient.name}</h2>
                    <p className="mt-2 text-sm text-[#1b1610]/70">
                      {patient.age}, {patient.sex.toLowerCase()}, bed {patient.bed}. {patient.dx}.
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${status.cls}`}>
                    {status.text}
                  </span>
                </div>
                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-[#1b1610]/65">Braden score</span>
                    <span className="font-semibold" style={{ color: risk?.color }}>
                      {patient.braden} of 23, {risk?.label.toLowerCase()}
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
                    <dt className="text-[#1b1610]/55">Weight</dt>
                    <dd className="mt-0.5 font-semibold">{patient.weightKg} kg</dd>
                  </div>
                  <div>
                    <dt className="text-[#1b1610]/55">Mobility</dt>
                    <dd className="mt-0.5 font-semibold leading-tight">{patient.mobility}</dd>
                  </div>
                  <div>
                    <dt className="text-[#1b1610]/55">Nutrition</dt>
                    <dd className="mt-0.5 font-semibold leading-tight">{patient.nutrition}</dd>
                  </div>
                </dl>
              </header>

              {/* turn schedule */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <h3 className="font-display text-2xl">Turn schedule</h3>
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
                    <dd className="font-semibold">{POSES[ui.pose].name}</dd>
                    <dt className="mt-2 text-xs text-[#1b1610]/55">Next position</dt>
                    <dd className="font-semibold">{nextPose}</dd>
                    <dt className="mt-2 text-xs text-[#1b1610]/55">Turns done, every {ui.interval} min</dt>
                    <dd className="font-semibold">{ui.turns}</dd>
                  </dl>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <button
                    onClick={turnPatient}
                    className={`flex-1 rounded-full bg-[#1b1610] px-4 py-2.5 text-sm font-semibold text-[#f6e9bf] transition hover:bg-[#3a2e1d] ${ring}`}
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

              {/* nurse prompts */}
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

              {/* readings */}
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
                    {Math.round(ui.score)}
                  </p>
                  <p className="text-xs text-[#1b1610]/55">out of 100</p>
                </div>
                <div className="border-l border-[#1b1610]/12 pl-4">
                  <p className="text-xs text-[#1b1610]/60">Exposure</p>
                  <p className="font-display tnum text-[44px] leading-none">{ui.exposure.toFixed(1)}</p>
                  <p className="text-xs text-[#1b1610]/55">mmHg hours above 32</p>
                </div>
              </section>

              {/* history */}
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

              {/* zones */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <h3 className="font-display text-2xl">Load by zone</h3>
                <div className="mt-3 flex flex-col gap-2.5">
                  {ui.zones.map((z) => (
                    <div key={z.name} className="flex items-center gap-3 text-xs">
                      <span className="w-20 text-[#1b1610]/70">{z.name}</span>
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

              {/* AI */}
              <section className="mt-5 border-t border-[#1b1610]/12 pt-5">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-2xl">Gemini assessment</h3>
                  {ai.source && (
                    <span className="text-xs text-[#1b1610]/55">
                      {ai.source === "gemini" ? "From Gemini" : ai.source === "fallback" ? "Offline protocol" : "Error"}
                    </span>
                  )}
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
                  className={`mt-3 rounded-full border border-[#1b1610] px-5 py-2 text-sm font-semibold transition hover:bg-[#1b1610] hover:text-[#f6e9bf] disabled:cursor-not-allowed disabled:opacity-40 ${ring}`}
                >
                  {isAnalyzing ? "Analyzing" : "Analyze risk"}
                </button>
              </section>

              <footer className="mt-6 flex items-center justify-between border-t border-[#1b1610]/12 pt-4 text-xs text-[#1b1610]/55">
                <span>IEEE CS Hackathon, MT-07. Synthetic data only.</span>
                <button
                  onClick={resetMonitoring}
                  className={`underline decoration-[#1b1610]/30 underline-offset-4 transition hover:text-[#1b1610] ${ring}`}
                >
                  Reset monitoring
                </button>
              </footer>
            </>
          )}
        </div>
      </div>
    </main>
  );
}