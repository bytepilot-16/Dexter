/* ------------------------------------------------------------------ */
/*  SkinSafe AI: shared clinical model (no React, safe on server too)  */
/* ------------------------------------------------------------------ */

export const CRIT = 70; // mmHg, sustained load above this is critical
export const WOUND_LIMIT = 32; // capillary closing pressure; an existing wound should carry less than this
export const MAX_V = 120;
export const HIST = 90; // minutes of history kept per patient

/* ---------------- types ---------------- */
export type Part = "head" | "torso" | "larm" | "rarm" | "lleg" | "rleg" | "lhip" | "rhip";
export type Cap = { ax: number; ay: number; bx: number; by: number; r: number; part: Part };
export type Blob = { x: number; y: number; s: number; p: number; part: Part; tag: string };
export type ZonePt = { x: number; y: number; part: Part };
export type ZoneDef = { name: string; pts: ZonePt[] };
export type Pose = { name: string; caps: Cap[]; blobs: Blob[]; zones: ZoneDef[] };

export type CondKind = "fracture" | "cast" | "chest" | "elevated" | "amputation" | "wound";
export type Region =
  | "larm"
  | "rarm"
  | "lleg"
  | "rleg"
  | "lhip"
  | "rhip"
  | "sacrum"
  | "lheel"
  | "rheel"
  | "occiput";
export type Condition = { id: string; kind: CondKind; region: Region; note?: string };

export type Patient = {
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
  startMin: number; // minutes already spent in the current position at admission
  startPose: number;
  conditions: Condition[];
};

export type ZoneReading = { name: string; v: number; x: number; y: number };

/* ---------------- condition metadata ---------------- */
export const REGION_LABEL: Record<Region, string> = {
  larm: "Left arm",
  rarm: "Right arm",
  lleg: "Left leg",
  rleg: "Right leg",
  lhip: "Left hip",
  rhip: "Right hip",
  sacrum: "Sacrum",
  lheel: "Left heel",
  rheel: "Right heel",
  occiput: "Back of head",
};

export const COND_META: Record<
  CondKind,
  { label: string; regions: Region[]; hint: string; color: string }
> = {
  fracture: {
    label: "Fracture",
    regions: ["larm", "rarm", "lleg", "rleg", "lhip", "rhip"],
    hint: "Patient is never turned onto the fractured side.",
    color: "#b42318",
  },
  cast: {
    label: "Cast or splint",
    regions: ["larm", "rarm", "lleg", "rleg"],
    hint: "Cast edge is monitored as a device-pressure zone. Side excluded from turns.",
    color: "#6b4fa0",
  },
  chest: {
    label: "Arm resting on chest",
    regions: ["larm", "rarm"],
    hint: "Arm is lifted off the mattress, so the elbow stops loading.",
    color: "#2f6f8f",
  },
  elevated: {
    label: "Leg elevated, heel floated",
    regions: ["lleg", "rleg"],
    hint: "Heel is offloaded. The calf takes the weight on a pillow.",
    color: "#2f7d4f",
  },
  amputation: {
    label: "Amputation",
    regions: ["larm", "rarm", "lleg", "rleg"],
    hint: "Limb below the knee or elbow is removed from the map.",
    color: "#5b5348",
  },
  wound: {
    label: "Existing pressure injury",
    regions: ["sacrum", "lheel", "rheel", "lhip", "rhip", "occiput"],
    hint: "Positions that load the wound are skipped in the turn plan.",
    color: "#c2410c",
  },
};

export const condText = (c: Condition) => {
  const r = REGION_LABEL[c.region];
  switch (c.kind) {
    case "fracture":
      return `${r} fracture`;
    case "cast":
      return `${r} in cast`;
    case "chest":
      return `${r} on chest`;
    case "elevated":
      return `${r} elevated`;
    case "amputation":
      return `${r} amputation`;
    case "wound":
      return `${r} pressure injury`;
  }
};

const sideOf = (r: Region): "l" | "r" | null =>
  r === "larm" || r === "lleg" || r === "lhip" || r === "lheel"
    ? "l"
    : r === "rarm" || r === "rleg" || r === "rhip" || r === "rheel"
      ? "r"
      : null;

/* ---------------- risk helpers ---------------- */
export const riskOf = (braden: number) =>
  braden <= 9
    ? { label: "Very high risk", color: "#b42318" }
    : braden <= 12
      ? { label: "High risk", color: "#c2410c" }
      : braden <= 14
        ? { label: "Moderate risk", color: "#a16207" }
        : braden <= 18
          ? { label: "Mild risk", color: "#3f7d4a" }
          : { label: "Low risk", color: "#2f6f4f" };

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Turn interval suggested from the Braden score (minutes). */
export const suggestInterval = (braden: number) =>
  braden <= 9 ? 90 : braden <= 12 ? 90 : braden <= 14 ? 120 : braden <= 18 ? 150 : 180;

/** Tissue sensitivity derived from Braden, age and nutrition. */
export const deriveSens = (braden: number, age: number, nutrition: string) => {
  let s = 1.3 - (braden - 9) * 0.05;
  if (age >= 75) s += 0.05;
  if (/low|poor|tube|npo/i.test(nutrition)) s += 0.05;
  return Math.round(Math.max(0.8, Math.min(1.45, s)) * 100) / 100;
};

export const uid = () => `PT-${Math.floor(1000 + Math.random() * 9000)}`;
export const cid = () => `c${Math.random().toString(36).slice(2, 9)}`;

/* ---------------- seed ward (synthetic) ---------------- */
export const SEED_PATIENTS: Patient[] = [
  {
    id: "PT-0427",
    name: "Meera Nair",
    age: 72,
    sex: "Female",
    bed: "12B",
    dx: "Right hip fracture, post-op day 2",
    weightKg: 52,
    braden: 11,
    mobility: "Bed-bound",
    nutrition: "Low albumin",
    interval: 90,
    sens: 1.15,
    startMin: 40,
    startPose: 0,
    conditions: [{ id: "c-meera-1", kind: "fracture", region: "rhip", note: "Post-op day 2" }],
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
    conditions: [{ id: "c-arjun-1", kind: "chest", region: "larm", note: "Flaccid arm supported across chest" }],
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
    conditions: [
      { id: "c-lak-1", kind: "elevated", region: "lleg", note: "Heel boot" },
      { id: "c-lak-2", kind: "elevated", region: "rleg", note: "Heel boot" },
    ],
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
    conditions: [{ id: "c-kar-1", kind: "wound", region: "sacrum", note: "Stage 2" }],
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
    conditions: [],
  },
  {
    id: "PT-0745",
    name: "Rohan Das",
    age: 29,
    sex: "Male",
    bed: "11A",
    dx: "Road accident, left tibia fracture",
    weightKg: 76,
    braden: 15,
    mobility: "Bed rest, leg immobilised",
    nutrition: "Adequate",
    interval: 120,
    sens: 0.95,
    startMin: 30,
    startPose: 0,
    conditions: [
      { id: "c-roh-1", kind: "fracture", region: "lleg", note: "Tibial shaft" },
      { id: "c-roh-2", kind: "cast", region: "lleg", note: "Below-knee cast" },
    ],
  },
];

/* ---------------- body model (x: body units, + is patient's left; y: 0 head to 1 heel) ---------------- */
const SUPINE: Pose = {
  name: "Supine",
  caps: [
    { ax: 0, ay: 0.07, bx: 0, by: 0.085, r: 0.042, part: "head" },
    { ax: 0, ay: 0.19, bx: 0, by: 0.52, r: 0.105, part: "torso" },
    { ax: -0.145, ay: 0.2, bx: -0.16, by: 0.42, r: 0.032, part: "rarm" },
    { ax: 0.145, ay: 0.2, bx: 0.16, by: 0.42, r: 0.032, part: "larm" },
    { ax: -0.04, ay: 0.56, bx: -0.045, by: 0.96, r: 0.04, part: "rleg" },
    { ax: 0.04, ay: 0.56, bx: 0.045, by: 0.96, r: 0.04, part: "lleg" },
  ],
  blobs: [
    { x: 0, y: 0.07, s: 0.03, p: 46, part: "head", tag: "occiput" },
    { x: -0.05, y: 0.22, s: 0.035, p: 62, part: "torso", tag: "scap" },
    { x: 0.05, y: 0.22, s: 0.035, p: 62, part: "torso", tag: "scap" },
    { x: 0, y: 0.47, s: 0.05, p: 100, part: "torso", tag: "sacrum" },
    { x: -0.045, y: 0.51, s: 0.04, p: 68, part: "torso", tag: "glute" },
    { x: 0.045, y: 0.51, s: 0.04, p: 68, part: "torso", tag: "glute" },
    { x: -0.15, y: 0.41, s: 0.022, p: 58, part: "rarm", tag: "elbow" },
    { x: 0.15, y: 0.41, s: 0.022, p: 58, part: "larm", tag: "elbow" },
    { x: -0.04, y: 0.74, s: 0.04, p: 44, part: "rleg", tag: "calf" },
    { x: 0.04, y: 0.74, s: 0.04, p: 44, part: "lleg", tag: "calf" },
    { x: -0.04, y: 0.955, s: 0.02, p: 90, part: "rleg", tag: "heel" },
    { x: 0.04, y: 0.955, s: 0.02, p: 90, part: "lleg", tag: "heel" },
  ],
  zones: [
    { name: "Occiput", pts: [{ x: 0, y: 0.07, part: "head" }] },
    { name: "Scapulae", pts: [{ x: 0.05, y: 0.22, part: "torso" }, { x: -0.05, y: 0.22, part: "torso" }] },
    { name: "Elbows", pts: [{ x: 0.15, y: 0.41, part: "larm" }, { x: -0.15, y: 0.41, part: "rarm" }] },
    { name: "Sacrum", pts: [{ x: 0, y: 0.47, part: "torso" }] },
    { name: "Calves", pts: [{ x: 0.04, y: 0.74, part: "lleg" }, { x: -0.04, y: 0.74, part: "rleg" }] },
    { name: "Heels", pts: [{ x: 0.04, y: 0.955, part: "lleg" }, { x: -0.04, y: 0.955, part: "rleg" }] },
  ],
};

// lying on the LEFT side: left arm, left hip and left leg are underneath
const LEFT: Pose = {
  name: "Left lateral 30°",
  caps: [
    { ax: 0, ay: 0.07, bx: 0, by: 0.085, r: 0.04, part: "head" },
    { ax: 0, ay: 0.19, bx: 0, by: 0.52, r: 0.062, part: "torso" },
    { ax: 0.05, ay: 0.25, bx: 0.05, by: 0.4, r: 0.025, part: "larm" },
    { ax: 0, ay: 0.56, bx: 0, by: 0.96, r: 0.05, part: "lleg" },
    { ax: 0.025, ay: 0.56, bx: 0.025, by: 0.95, r: 0.04, part: "rleg" },
  ],
  blobs: [
    { x: 0, y: 0.07, s: 0.028, p: 52, part: "head", tag: "ear" },
    { x: 0, y: 0.2, s: 0.04, p: 86, part: "larm", tag: "shoulder" },
    { x: 0, y: 0.32, s: 0.04, p: 40, part: "torso", tag: "ribs" },
    { x: 0, y: 0.5, s: 0.05, p: 98, part: "lhip", tag: "troch" },
    { x: 0, y: 0.74, s: 0.03, p: 62, part: "lleg", tag: "knee" },
    { x: 0, y: 0.94, s: 0.025, p: 74, part: "lleg", tag: "ankle" },
  ],
  zones: [
    { name: "Ear", pts: [{ x: 0, y: 0.07, part: "head" }] },
    { name: "Shoulder", pts: [{ x: 0, y: 0.2, part: "larm" }] },
    { name: "Trochanter", pts: [{ x: 0, y: 0.5, part: "lhip" }] },
    { name: "Knee", pts: [{ x: 0, y: 0.74, part: "lleg" }] },
    { name: "Ankle", pts: [{ x: 0, y: 0.94, part: "lleg" }] },
  ],
};

const SWAP: Record<Part, Part> = {
  head: "head",
  torso: "torso",
  larm: "rarm",
  rarm: "larm",
  lleg: "rleg",
  rleg: "lleg",
  lhip: "rhip",
  rhip: "lhip",
};

const mirror = (p: Pose, name: string): Pose => ({
  name,
  caps: p.caps.map((c) => ({ ...c, ax: -c.ax, bx: -c.bx, part: SWAP[c.part] })),
  blobs: p.blobs.map((b) => ({ ...b, x: -b.x, part: SWAP[b.part] })),
  zones: p.zones.map((z) => ({ ...z, pts: z.pts.map((q) => ({ ...q, x: -q.x, part: SWAP[q.part] })) })),
});

export const BASE_POSES: Pose[] = [SUPINE, LEFT, mirror(LEFT, "Right lateral 30°")];
export const POSE_NAMES = BASE_POSES.map((p) => p.name);

export function segDist(px: number, py: number, c: { ax: number; ay: number; bx: number; by: number }) {
  const vx = c.bx - c.ax;
  const vy = c.by - c.ay;
  const wx = px - c.ax;
  const wy = py - c.ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 === 0 ? 0 : (wx * vx + wy * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (c.ax + t * vx), py - (c.ay + t * vy));
}

/* ---------------- conditions -> poses ---------------- */
export type Overlay = {
  kind: CondKind;
  x: number;
  y: number;
  label: string;
  color: string;
  pts?: [number, number][];
  cap?: { ax: number; ay: number; bx: number; by: number; r: number };
  loaded?: boolean;
};

export type PoseSet = {
  poses: Pose[];
  allowed: boolean[];
  why: (string | null)[];
  noSafe: boolean;
  overlays: Overlay[][];
  wounds: { region: Region; label: string; spots: { x: number; y: number; loaded: boolean }[] }[];
};

const isLeg = (r: Region) => r === "lleg" || r === "rleg";
const isArm = (r: Region) => r === "larm" || r === "rarm";

// where a wound sits in each pose, and whether that pose presses on it
function woundSpots(region: Region): { x: number; y: number; loaded: boolean }[] {
  switch (region) {
    case "sacrum":
      return [
        { x: 0, y: 0.47, loaded: true },
        { x: 0.035, y: 0.47, loaded: false },
        { x: -0.035, y: 0.47, loaded: false },
      ];
    case "occiput":
      return [
        { x: 0, y: 0.065, loaded: true },
        { x: 0.025, y: 0.06, loaded: false },
        { x: -0.025, y: 0.06, loaded: false },
      ];
    case "lheel":
      return [
        { x: 0.04, y: 0.955, loaded: true },
        { x: 0, y: 0.95, loaded: true },
        { x: -0.025, y: 0.95, loaded: false },
      ];
    case "rheel":
      return [
        { x: -0.04, y: 0.955, loaded: true },
        { x: 0.025, y: 0.95, loaded: false },
        { x: 0, y: 0.95, loaded: true },
      ];
    case "lhip":
      return [
        { x: 0.085, y: 0.5, loaded: false },
        { x: 0, y: 0.5, loaded: true },
        { x: -0.04, y: 0.5, loaded: false },
      ];
    case "rhip":
      return [
        { x: -0.085, y: 0.5, loaded: false },
        { x: 0.04, y: 0.5, loaded: false },
        { x: 0, y: 0.5, loaded: true },
      ];
    default:
      return [
        { x: 0, y: 0.5, loaded: false },
        { x: 0, y: 0.5, loaded: false },
        { x: 0, y: 0.5, loaded: false },
      ];
  }
}

const capOf = (pose: Pose, part: Part) => pose.caps.find((c) => c.part === part);
const xOnCap = (c: Cap, y: number) => {
  const t = c.by === c.ay ? 0 : Math.max(0, Math.min(1, (y - c.ay) / (c.by - c.ay)));
  return c.ax + (c.bx - c.ax) * t;
};

export function buildPoses(p: Pick<Patient, "conditions">): PoseSet {
  const conds = p.conditions ?? [];
  const hard = [true, true, true];
  const soft = [true, true, true];
  const why: (string | null)[] = [null, null, null];
  const overlays: Overlay[][] = [[], [], []];

  const poses = BASE_POSES.map((base, pi) => {
    const pose: Pose = {
      name: base.name,
      caps: base.caps.map((c) => ({ ...c })),
      blobs: base.blobs.map((b) => ({ ...b })),
      zones: base.zones.map((z) => ({ ...z, pts: z.pts.map((q) => ({ ...q })) })),
    };
    const sgn = pi === 2 ? -1 : 1;
    const fallback = (r: Region): [number, number] =>
      isArm(r) ? [0.07 * sgn, 0.3] : isLeg(r) ? [0.03 * sgn, 0.78] : [0.02 * sgn, 0.5];

    // removals first so later effects see the final geometry
    const ordered = [...conds].sort((a, b) => {
      const w = (k: CondKind) => (k === "amputation" ? 0 : k === "chest" ? 1 : 2);
      return w(a.kind) - w(b.kind);
    });

    for (const c of ordered) {
      const meta = COND_META[c.kind];
      const part = c.region as Part;
      const label = condText(c);
      const baseCap = capOf(base, part);

      if (c.kind === "amputation" && (isArm(c.region) || isLeg(c.region))) {
        const cutY = isLeg(c.region) ? 0.72 : 0.36;
        pose.caps = pose.caps
          .filter((k) => !(k.part === part && k.ay >= cutY))
          .map((k) => (k.part === part && k.by > cutY ? { ...k, by: cutY, bx: xOnCap(k, cutY) } : k));
        pose.blobs = pose.blobs.filter((b) => !(b.part === part && b.y > cutY - 0.005));
        pose.zones.forEach((z) => (z.pts = z.pts.filter((q) => !(q.part === part && q.y > cutY - 0.005))));
        const [fx] = fallback(c.region);
        overlays[pi].push({
          kind: c.kind,
          x: baseCap ? xOnCap(baseCap, cutY) : fx,
          y: cutY,
          label,
          color: meta.color,
        });
      }

      if (c.kind === "chest" && isArm(c.region)) {
        pose.caps = pose.caps.filter((k) => k.part !== part);
        pose.blobs = pose.blobs.filter((b) => !(b.part === part && b.tag === "elbow"));
        pose.blobs.forEach((b) => {
          if (b.part === "torso") b.p *= 1.04; // arm weight now rests on the trunk
        });
        pose.zones.forEach((z) => (z.pts = z.pts.filter((q) => !(q.part === part && q.y > 0.3))));
        const s = c.region === "larm" ? 1 : -1;
        const pts: [number, number][] =
          pi === 0
            ? [
                [0.125 * s, 0.205],
                [0.13 * s, 0.335],
                [-0.035 * s, 0.29],
              ]
            : [
                [0.02 * sgn, 0.21],
                [0.085 * sgn, 0.3],
                [0.03 * sgn, 0.37],
              ];
        overlays[pi].push({ kind: c.kind, x: pts[1][0], y: pts[1][1], label, color: meta.color, pts });
      }

      if (c.kind === "elevated" && isLeg(c.region)) {
        const had = pose.blobs.some((b) => b.part === part);
        pose.blobs = pose.blobs.filter((b) => !(b.part === part && (b.tag === "heel" || b.tag === "ankle")));
        pose.blobs.forEach((b) => {
          if (b.part === part && b.tag === "calf") b.p *= 1.25;
        });
        pose.zones.forEach((z) => (z.pts = z.pts.filter((q) => !(q.part === part && q.y > 0.9))));
        const cap = capOf(pose, part);
        if (cap && (had || pi === 0)) {
          overlays[pi].push({ kind: c.kind, x: xOnCap(cap, 0.8), y: 0.8, label, color: meta.color });
        }
      }

      if (c.kind === "cast" && (isArm(c.region) || isLeg(c.region))) {
        const leg = isLeg(c.region);
        const edgeY = leg ? 0.62 : 0.3;
        const cap = capOf(pose, part);
        const loaded = pose.blobs.some((b) => b.part === part);
        pose.blobs.forEach((b) => {
          if (b.part !== part) return;
          if (b.tag === "heel" || b.tag === "elbow") b.p *= 1.3; // cast weight on the distal point
          if (b.tag === "ankle") b.p *= 1.2;
        });
        if (cap && loaded && cap.by > edgeY) {
          const ex = xOnCap(cap, edgeY);
          pose.blobs.push({ x: ex, y: edgeY, s: 0.016, p: 46, part, tag: "castEdge" });
          pose.zones.push({ name: "Cast edge", pts: [{ x: ex, y: edgeY, part }] });
        }
        if (cap && cap.by > edgeY) {
          overlays[pi].push({
            kind: c.kind,
            x: xOnCap(cap, (edgeY + cap.by) / 2),
            y: (edgeY + cap.by) / 2,
            label,
            color: meta.color,
            cap: { ax: xOnCap(cap, edgeY), ay: edgeY, bx: cap.bx, by: cap.by, r: cap.r * 1.15 },
          });
        }
        const side = sideOf(c.region);
        if (side) {
          const idx = side === "l" ? 1 : 2;
          hard[idx] = false;
          why[idx] = why[idx] ?? `${label}`;
        }
      }

      if (c.kind === "fracture") {
        const side = sideOf(c.region);
        if (side) {
          const idx = side === "l" ? 1 : 2;
          hard[idx] = false;
          why[idx] = why[idx] ?? `${label}`;
        }
        let x: number;
        let y: number;
        const cap = capOf(pose, part) ?? baseCap;
        if (c.region === "lhip" || c.region === "rhip") {
          const s = c.region === "lhip" ? 1 : -1;
          const down = (pi === 1 && s === 1) || (pi === 2 && s === -1);
          x = pi === 0 ? 0.085 * s : down ? 0 : 0.035 * sgn;
          y = 0.5;
        } else if (cap) {
          y = isLeg(c.region) ? 0.78 : 0.33;
          x = xOnCap(cap, y);
        } else {
          [x, y] = fallback(c.region);
        }
        overlays[pi].push({ kind: c.kind, x, y, label, color: meta.color });
      }

      if (c.kind === "wound") {
        const spot = woundSpots(c.region)[pi];
        if (spot.loaded) {
          soft[pi] = false;
          why[pi] = why[pi] ?? `loads ${REGION_LABEL[c.region].toLowerCase()} wound`;
        }
        overlays[pi].push({
          kind: c.kind,
          x: spot.x,
          y: spot.y,
          label: `${label}${c.note ? `, ${c.note.toLowerCase()}` : ""}`,
          color: meta.color,
          loaded: spot.loaded,
        });
      }
    }

    pose.zones = pose.zones.filter((z) => z.pts.length > 0);
    return pose;
  });

  let allowed = hard.map((h, i) => h && soft[i]);
  let noSafe = false;
  if (!allowed.some(Boolean)) {
    allowed = [...hard];
    if (!allowed.some(Boolean)) {
      allowed = [true, true, true];
    }
    noSafe = true;
  }

  const wounds = conds
    .filter((c) => c.kind === "wound")
    .map((c) => ({ region: c.region, label: condText(c), spots: woundSpots(c.region) }));

  return { poses, allowed, why, noSafe, overlays, wounds };
}

/** Next pose in the rotation that is allowed for this patient. */
export function nextPoseIdx(cur: number, allowed: boolean[]) {
  for (let i = 1; i <= 3; i++) {
    const j = (cur + i) % 3;
    if (allowed[j] && j !== cur) return j;
  }
  return cur;
}

/* ---------------- analytic pressure (used for every bed on the ward) ---------------- */
export const loadOf = (p: Patient, minInPos: number) =>
  (0.5 + 0.6 * Math.min(minInPos / Math.max(15, p.interval), 1.4)) * p.sens * Math.sqrt(p.weightKg / 70);

export function pressureAt(pose: Pose, x: number, y: number, load: number) {
  let m = 0;
  for (const c of pose.caps) m = Math.max(m, 1 - segDist(x, y, c) / c.r);
  let v = m > 0 ? 18 * Math.min(1, m * 2.5) * (0.7 + 0.6 * load) : 0;
  for (const b of pose.blobs) {
    const dx = x - b.x;
    const dy = y - b.y;
    v += b.p * load * Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s));
  }
  return v;
}

export function estimateZones(pose: Pose, load: number): { name: string; v: number }[] {
  return pose.zones.map((z) => {
    let v = 0;
    for (const q of z.pts) v = Math.max(v, pressureAt(pose, q.x, q.y, load));
    return { name: z.name, v };
  });
}
