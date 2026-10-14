/* ------------------------------------------------------------------ */
/*  Ward state: one Track per patient, advanced on a shared clock      */
/* ------------------------------------------------------------------ */
import {
  CRIT,
  HIST,
  WOUND_LIMIT,
  estimateZones,
  loadOf,
  nextPoseIdx,
  pressureAt,
  type Patient,
  type PoseSet,
} from "./model";

export type Track = {
  pose: number;
  minInPos: number;
  turns: number;
  dose: number; // mmHg-minutes above 32 at the hottest zone
  score: number;
  exposure: number; // mmHg-hours
  peak: number;
  zones: { name: string; v: number }[];
  hist: number[];
  histAcc: number;
  wounds: { label: string; v: number; loaded: boolean }[];
  lastTurnAt: number | null; // Date.now() of the last confirmed turn
};

export function newTrack(p: Patient, ps: PoseSet): Track {
  const t: Track = {
    pose: Math.max(0, Math.min(2, p.startPose)),
    minInPos: p.startMin,
    turns: 0,
    dose: 0,
    score: 100,
    exposure: 0,
    peak: 0,
    zones: [],
    hist: [],
    histAcc: 0,
    wounds: [],
    lastTurnAt: null,
  };
  // back-fill the history for the time already spent in this position at admission
  const pose = ps.poses[t.pose];
  const from = Math.max(0, p.startMin - 45);
  for (let m = from; m < p.startMin; m++) {
    const z = estimateZones(pose, loadOf(p, m));
    const peak = z.reduce((a, b) => Math.max(a, b.v), 0);
    t.hist.push(peak);
    if (peak > 32) t.dose += peak - 32;
  }
  refresh(p, t, ps);
  return t;
}

/** Recompute zones, peak and wound load from the analytic model. */
export function refresh(p: Patient, t: Track, ps: PoseSet) {
  const pose = ps.poses[t.pose];
  const load = loadOf(p, t.minInPos);
  t.zones = estimateZones(pose, load);
  t.peak = t.zones.reduce((a, b) => Math.max(a, b.v), 0);
  t.wounds = ps.wounds.map((w) => {
    const s = w.spots[t.pose];
    return { label: w.label, loaded: s.loaded, v: s.loaded ? pressureAt(pose, s.x, s.y, load) : 0 };
  });
}

/** Accumulate tissue dose and history after time moves forward. */
export function accrue(t: Track, dtMin: number) {
  const hot = t.peak;
  if (hot > 32) t.dose += (hot - 32) * dtMin;
  else t.dose = Math.max(0, t.dose - 40 * dtMin);
  t.exposure = t.dose / 60;
  t.score = Math.max(0, 100 * (1 - t.dose / 9000));
  t.histAcc += dtMin;
  let n = 0;
  while (t.histAcc >= 1 && n < HIST) {
    t.hist.push(t.peak);
    t.histAcc -= 1;
    n++;
  }
  if (t.histAcc >= 1) t.histAcc = t.histAcc % 1;
  if (t.hist.length > HIST) t.hist.splice(0, t.hist.length - HIST);
}

export function turn(t: Track, ps: PoseSet) {
  t.pose = nextPoseIdx(t.pose, ps.allowed);
  t.minInPos = 0;
  t.turns++;
  t.lastTurnAt = Date.now();
  // tissue recovers once the load moves; give back part of the dose
  t.dose *= 0.6;
}

/* ---------------- alerts shared by panel + dashboard ---------------- */
export type Alert = { level: "critical" | "warn" | "info"; text: string };

export function alertsFor(p: Patient, t: Track, ps: PoseSet, peakOverride?: number): Alert[] {
  const out: Alert[] = [];
  const first = p.name.split(" ")[0];
  const peak = Math.round(peakOverride ?? t.peak);
  const nextIdx = nextPoseIdx(t.pose, ps.allowed);
  const next = ps.poses[nextIdx].name;
  const remaining = p.interval - t.minInPos;
  const hot = [...t.zones].sort((a, b) => b.v - a.v)[0];

  const loadedWound = t.wounds.find((w) => w.loaded && w.v >= WOUND_LIMIT);
  if (loadedWound) {
    out.push({
      level: "critical",
      text: `${first} is lying on the ${loadedWound.label.toLowerCase()} (${Math.round(loadedWound.v)} mmHg). Move them to ${next} now.`,
    });
  }
  if (!ps.allowed[t.pose] && !loadedWound) {
    out.push({
      level: "critical",
      text: `${ps.poses[t.pose].name} should be avoided (${ps.why[t.pose]}). Move them to ${next}.`,
    });
  }
  if (remaining <= 0) {
    out.push({
      level: "critical",
      text: `${first} is ${Math.round(-remaining)} min overdue for a turn. Move them to ${next} now.`,
    });
  } else if (remaining <= 20) {
    out.push({
      level: "warn",
      text: `Turn due in ${Math.ceil(remaining)} min. Have pillows and a second nurse ready for ${next}.`,
    });
  }
  if (peak >= CRIT && hot) {
    out.push({
      level: "critical",
      text: `${hot.name} is at ${peak} mmHg. Offload it now.`,
    });
  }
  if (ps.noSafe) {
    out.push({
      level: "warn",
      text: "No fully safe position. Request an alternating-pressure mattress.",
    });
  }
  if (p.conditions.some((c) => c.kind === "cast") && remaining <= 20) {
    out.push({ level: "info", text: "Check the skin under the cast edge at this turn." });
  }
  if (!out.length) {
    out.push({ level: "info", text: `On schedule. Next turn to ${next} in ${Math.ceil(remaining)} min.` });
  }
  return out;
}

export function urgency(p: Patient, t: Track, ps: PoseSet) {
  const remaining = p.interval - t.minInPos;
  let u = t.peak;
  if (remaining <= 0) u += 1000 + -remaining;
  if (t.wounds.some((w) => w.loaded && w.v >= WOUND_LIMIT)) u += 800;
  if (!ps.allowed[t.pose]) u += 600;
  if (t.peak >= CRIT) u += 500;
  if (remaining <= 20) u += 200;
  return u;
}
