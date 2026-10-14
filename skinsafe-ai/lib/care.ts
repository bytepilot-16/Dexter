/* ------------------------------------------------------------------ */
/*  Offline care engine. Deterministic, guideline-based nurse advice   */
/*  used when Gemini is unavailable (quota, network, no key).          */
/*  Draws on NPIAP/EPUAP pressure-injury prevention practice.          */
/* ------------------------------------------------------------------ */

export type CareZone = { name: string; pressure: number };
export type CareInput = {
  maxPressure: number;
  position: string;
  nextPosition?: string;
  minutesInPosition?: number | null;
  interval?: number | null;
  reliefScore?: number | null;
  topZones?: CareZone[];
  patient?: {
    age?: number;
    sex?: string;
    dx?: string;
    braden?: number;
    weightKg?: number;
    mobility?: string;
    nutrition?: string;
  };
  conditions?: string[]; // human-readable, e.g. "Right hip fracture"
  woundsLoaded?: { label: string; pressure: number }[];
  avoided?: string[]; // e.g. "Right lateral 30° (Right hip fracture)"
  noSafe?: boolean;
};

const CRIT = 70;

// small deterministic picker so the same situation reads the same,
// but different situations and minutes vary the wording
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(Math.floor(seed)) % arr.length];
}

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const POSITION_HOW: Record<string, string[]> = {
  supine: [
    "lay them supine with the head of bed at 30° or lower, a pillow under the calves so both heels float",
    "return them to supine, keep the head of bed at or below 30° to limit sacral shear, and float the heels",
  ],
  left: [
    "tilt them 30° onto the left side with a wedge behind the back and a pillow between the knees",
    "roll them to a 30° left tilt, not a full side-lie, with a pillow between the knees and ankles",
  ],
  right: [
    "tilt them 30° onto the right side with a wedge behind the back and a pillow between the knees",
    "roll them to a 30° right tilt, not a full side-lie, with a pillow between the knees and ankles",
  ],
};

const howTo = (pose: string | undefined, seed: number) => {
  const p = (pose ?? "").toLowerCase();
  const key = p.startsWith("left") ? "left" : p.startsWith("right") ? "right" : "supine";
  return pick(POSITION_HOW[key], seed);
};

const ZONE_TIPS: Record<string, string[]> = {
  sacrum: [
    "Keep the head of bed at 30° or lower and use a slide sheet, so the sacrum is not dragged on turns.",
    "Lift, do not drag, when moving them up the bed. Shear over the sacrum is as harmful as pressure.",
  ],
  heels: [
    "Float the heels completely with a pillow under the calves or heel boots. Heels should not touch the mattress.",
    "Check both heels for redness that does not fade when pressed, and keep them off the mattress.",
  ],
  occiput: [
    "Turn the head slightly at each check and use a gel head ring if the back of the head stays red.",
    "Check the back of the head under the hair, where early damage is easily missed.",
  ],
  ear: [
    "Keep the lower ear flat and free of oxygen tubing, and pad it with a foam ring if it is red.",
  ],
  scapulae: [
    "Check the shoulder blades and smooth sheet wrinkles under the upper back.",
  ],
  elbows: [
    "Rest the forearms on pillows so the elbows are off the mattress.",
  ],
  shoulder: [
    "Draw the lower shoulder slightly forward so the weight spreads over the shoulder blade, not the joint.",
  ],
  trochanter: [
    "Keep the tilt at 30°. A full 90° side-lie puts the whole weight on the hip bone.",
    "Put a wedge behind the back so they rest at 30°, which takes weight off the hip bone.",
  ],
  knee: ["Place a pillow between the knees so the bony inner surfaces do not press on each other."],
  ankle: ["Put a pillow between the ankles and float the lower ankle."],
  calves: ["Spread the calf load with a full-length pillow and check the skin behind the knee."],
  "cast edge": [
    "Check the skin at the cast edge and pad it. Report new pain, swelling or a smell, which can signal a device-related injury.",
  ],
};

const zoneTip = (zone: string | undefined, seed: number) => {
  if (!zone) return null;
  const tips = ZONE_TIPS[zone.toLowerCase()];
  return tips ? pick(tips, seed) : null;
};

function patientFactor(i: CareInput, seed: number): string | null {
  const p = i.patient ?? {};
  const conds = (i.conditions ?? []).map((c) => c.toLowerCase());
  const facts: string[] = [];

  if (i.noSafe)
    facts.push(
      "No fully safe position exists for this patient. Ask for an alternating-pressure mattress and a tissue viability review.",
    );
  const frac = conds.find((c) => c.includes("fracture"));
  if (frac) {
    const side = frac.includes("left") ? "left" : frac.includes("right") ? "right" : null;
    facts.push(
      side
        ? `Never turn them onto the ${side} side because of the ${frac.replace(/^(left|right) /, "")}. Log-roll with two staff.`
        : `Turn carefully around the ${frac}, using a log-roll with two staff.`,
    );
  }
  if (conds.some((c) => c.includes("cast")))
    facts.push("Look under the cast edges at every turn, and keep the cast padded and off hard surfaces.");
  const chest = conds.find((c) => c.includes("on chest"));
  if (chest)
    facts.push(
      `The ${chest.replace(" on chest", "").toLowerCase()} rests on the chest. Check the skin where forearm meets trunk and keep the hand off lines and tubing.`,
    );
  if (conds.some((c) => c.includes("elevated")))
    facts.push("Check the heels are still floating after each turn. Pillows and boots slip.");
  if (conds.some((c) => c.includes("amputation")))
    facts.push("Inspect the residual limb end, where skin over bone carries extra load.");
  if (/sensation|spinal|paraple|tetraple/i.test(`${p.mobility ?? ""} ${p.dx ?? ""}`))
    facts.push("They cannot feel pressure, so check all their skin at every turn instead of waiting for them to report pain.");
  if (/unresponsive|sedat|coma/i.test(p.mobility ?? ""))
    facts.push("They cannot shift their own weight, so even small 10° tilts between full turns help.");
  if (/low|poor|tube|npo/i.test(p.nutrition ?? ""))
    facts.push(
      pick(
        [
          "Poor nutrition slows skin repair. Ask the dietitian to review protein and calories.",
          "Low protein reserves make the skin fragile. Flag this to the dietitian and record intake.",
        ],
        seed,
      ),
    );
  if ((p.weightKg ?? 0) >= 100)
    facts.push("Use a bariatric-rated surface and two staff for turns to avoid dragging.");
  if ((p.braden ?? 23) <= 9)
    facts.push("A Braden score this low points to a dynamic (alternating-pressure) mattress.");
  if ((p.age ?? 0) >= 80)
    facts.push("Older skin tears easily. Use a slide sheet and moisturise dry areas.");
  if (/stroke|hemipleg|weakness/i.test(p.dx ?? ""))
    facts.push("Support the weak side with pillows, as it cannot reposition itself.");
  if (/sepsis|shock|vasopress/i.test(p.dx ?? ""))
    facts.push("Poor circulation from the recent sepsis lowers how much pressure the tissue can tolerate.");
  if (/post-op|surgery/i.test(p.dx ?? ""))
    facts.push("Long theatre time adds hidden pressure damage, so check skin closely for the next 72 hours.");

  if (!facts.length) return null;
  // safety facts first, others rotate for variety
  const safety = facts.slice(0, 1);
  return i.noSafe || frac ? safety[0] : pick(facts, seed);
}

export function careRecommendation(i: CareInput): string {
  const max = Math.round(i.maxPressure);
  const zones = [...(i.topZones ?? [])].sort((a, b) => b.pressure - a.pressure);
  const hot = zones[0];
  const m = i.minutesInPosition ?? null;
  const interval = i.interval ?? null;
  const overdue = m !== null && interval !== null ? Math.round(m - interval) : null;
  const seed = max * 7 + (m ?? 0) + (hot?.name.length ?? 0) * 13;
  const pos = lc(i.position || "the current position");
  const next = i.nextPosition;
  const out: string[] = [];

  /* 1. a loaded existing wound is the most urgent */
  const wl = (i.woundsLoaded ?? []).filter((w) => w.pressure >= 32);
  if (wl.length) {
    const w = wl[0];
    out.push(
      `They are lying on the existing ${w.label.toLowerCase()} at about ${Math.round(w.pressure)} mmHg. A wound should carry no load at all.`,
    );
    out.push(
      next && next !== i.position
        ? `Move them off it now: ${howTo(next, seed)}.`
        : "Offload it now with wedges or pillows so the wound is clear of the mattress.",
    );
    out.push("Record the wound stage and size, and compare at the next turn.");
    return out.join(" ");
  }

  /* 2. assessment */
  if (max >= CRIT) {
    out.push(
      pick(
        [
          `The ${hot ? hot.name.toLowerCase() : "worst area"} is at ${max} mmHg after ${m ?? "?"} minutes ${pos}, above the 70 mmHg level where tissue starts to lose blood flow.`,
          `Pressure has reached ${max} mmHg at the ${hot ? hot.name.toLowerCase() : "worst area"}. At this level, tissue damage can start within the hour.`,
          `${hot ? hot.name : "Peak"} load is ${max} mmHg ${pos}, critical for a patient with this risk profile.`,
        ],
        seed,
      ),
    );
    out.push(
      next && next !== i.position
        ? `Reposition now: ${howTo(next, seed + 1)}.`
        : "No other position is safe, so shift their weight within this position and pad the area that is red.",
    );
  } else if (max >= 50) {
    out.push(
      pick(
        [
          `Load at the ${hot ? hot.name.toLowerCase() : "worst area"} is building (${max} mmHg) and will keep rising the longer they stay ${pos}.`,
          `The ${hot ? hot.name.toLowerCase() : "worst area"} is at ${max} mmHg. Not critical yet, but it is the area to watch.`,
        ],
        seed,
      ),
    );
    if (overdue !== null && overdue >= 0) out.push(`The turn is ${overdue} minutes overdue: ${howTo(next, seed)}.`);
    else if (overdue !== null) out.push(`Next turn${next ? ` to ${lc(next)}` : ""} is due in ${Math.abs(overdue)} minutes.`);
  } else {
    out.push(
      pick(
        [
          `Pressure is well spread. The highest reading is ${max} mmHg${hot ? ` at the ${hot.name.toLowerCase()}` : ""}.`,
          `Load is within the safe range (peak ${max} mmHg). No repositioning needed yet.`,
          `Tissue is coping well ${pos}, with a peak of ${max} mmHg.`,
        ],
        seed,
      ),
    );
    if (overdue !== null && overdue >= 0) out.push(`The scheduled turn is still due: ${howTo(next, seed)}.`);
    else if (overdue !== null && next) out.push(`Keep to the plan: ${lc(next)} in ${Math.abs(overdue)} minutes.`);
  }

  /* 3. zone-specific tip or patient factor (one of each at most) */
  const tip = max >= 50 ? zoneTip(hot?.name, seed) : null;
  const fact = patientFactor(i, seed + 3);
  if (tip) out.push(tip);
  if (fact && out.length < 4) out.push(fact);
  if (!tip && !fact && i.reliefScore !== null && i.reliefScore !== undefined && i.reliefScore < 50)
    out.push(`Tissue relief has dropped to ${i.reliefScore} of 100, so check the skin at the next turn.`);

  return out.join(" ");
}
