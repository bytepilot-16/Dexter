import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { careRecommendation, type CareInput, type CareZone } from "../../../lib/care";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Active, working Gemini models first. Override from .env.local with GEMINI_MODEL=model-a,model-b
const MODELS = Array.from(
  new Set(
    [...(process.env.GEMINI_MODEL ?? "").split(","), "gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-flash-latest"]
      .map((m) => m.trim())
      .filter((m): m is string => Boolean(m)),
  ),
);

// When a model reports a quota limit we stop calling it until the retry time,
// instead of burning 3 slow retries on every request.
const cooldown = new Map<string, number>();

function retryDelayMs(msg: string): number | null {
  const a = msg.match(/retry in ([\d.]+)s/i);
  if (a) return parseFloat(a[1]) * 1000;
  const b = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (b) return parseInt(b[1], 10) * 1000;
  return null;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ recommendation: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !("maxPressure" in body)) {
    return NextResponse.json({ recommendation: "A numeric maxPressure value is required." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const maxPressure = b.maxPressure;
  if (typeof maxPressure !== "number" || !Number.isFinite(maxPressure) || maxPressure < 0) {
    return NextResponse.json({ recommendation: "maxPressure must be a non-negative number." }, { status: 400 });
  }

  /* ---- sanitised context ---- */
  const position = str(b.position, 40) ?? "Supine";
  const nextPosition = str(b.nextPosition, 40);
  const minutesInPosition = num(b.minutesInPosition) !== undefined ? Math.round(num(b.minutesInPosition)!) : null;
  const interval = num(b.interval) !== undefined ? Math.round(num(b.interval)!) : null;
  const reliefScore = num(b.reliefScore) !== undefined ? Math.round(num(b.reliefScore)!) : null;
  const noSafe = b.noSafe === true;

  const topZones: CareZone[] = Array.isArray(b.topZones)
    ? b.topZones
        .slice(0, 3)
        .map((z): CareZone | null => {
          if (typeof z !== "object" || z === null) return null;
          const zz = z as Record<string, unknown>;
          if (typeof zz.name !== "string" || typeof zz.pressure !== "number") return null;
          return { name: zz.name.slice(0, 24), pressure: Math.round(zz.pressure) };
        })
        .filter((z): z is CareZone => z !== null)
    : [];

  const conditions: string[] = Array.isArray(b.conditions)
    ? b.conditions.filter((c): c is string => typeof c === "string").slice(0, 8).map((c) => c.slice(0, 60))
    : [];
  const avoided: string[] = Array.isArray(b.avoided)
    ? b.avoided.filter((c): c is string => typeof c === "string").slice(0, 3).map((c) => c.slice(0, 80))
    : [];
  const woundsLoaded = Array.isArray(b.woundsLoaded)
    ? b.woundsLoaded
        .map((w) => {
          if (typeof w !== "object" || w === null) return null;
          const ww = w as Record<string, unknown>;
          if (typeof ww.label !== "string" || typeof ww.pressure !== "number") return null;
          return { label: ww.label.slice(0, 40), pressure: Math.round(ww.pressure) };
        })
        .filter((w): w is { label: string; pressure: number } => w !== null)
        .slice(0, 3)
    : [];

  let patient: CareInput["patient"] = undefined;
  const parts: string[] = [];
  if (typeof b.patient === "object" && b.patient !== null) {
    const pp = b.patient as Record<string, unknown>;
    patient = {
      age: num(pp.age),
      sex: str(pp.sex, 12),
      dx: str(pp.dx, 80),
      braden: num(pp.braden),
      weightKg: num(pp.weightKg),
      mobility: str(pp.mobility, 40),
      nutrition: str(pp.nutrition, 40),
    };
    if (patient.age !== undefined) parts.push(`${Math.round(patient.age)}-year-old`);
    if (patient.sex) parts.push(patient.sex.toLowerCase());
    if (patient.dx) parts.push(`diagnosis: ${patient.dx}`);
    if (patient.braden !== undefined) parts.push(`Braden ${Math.round(patient.braden)}/23 (lower = higher risk)`);
    if (patient.weightKg !== undefined) parts.push(`${Math.round(patient.weightKg)} kg`);
    if (patient.mobility) parts.push(`mobility: ${patient.mobility}`);
    if (patient.nutrition) parts.push(`nutrition: ${patient.nutrition}`);
  }

  const input: CareInput = {
    maxPressure,
    position,
    nextPosition,
    minutesInPosition,
    interval,
    reliefScore,
    topZones,
    patient,
    conditions,
    woundsLoaded,
    avoided,
    noSafe,
  };

  const fallback = (reason: string) =>
    NextResponse.json({ recommendation: careRecommendation(input), source: "ai", reason });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback("no-key");

  const prompt = `You are a senior tissue-viability nurse advising a bedside nurse. Data comes from a pressure-sensing mattress (synthetic patient).

Patient: ${parts.join(", ") || "unknown"}.
Body notes: ${conditions.length ? conditions.join("; ") : "none"}.
Current position: ${position}${minutesInPosition !== null ? ` for ${minutesInPosition} min` : ""}${interval !== null ? ` (turn every ${interval} min)` : ""}.
Peak interface pressure: ${Math.round(maxPressure)} mmHg (critical at 70, capillary closing about 32).
Highest zones: ${topZones.length ? topZones.map((z) => `${z.name} ${z.pressure} mmHg`).join(", ") : "n/a"}.
${woundsLoaded.length ? `Existing wounds currently under load: ${woundsLoaded.map((w) => `${w.label} ${w.pressure} mmHg`).join(", ")}.` : ""}
${reliefScore !== null ? `Tissue relief score: ${reliefScore}/100.` : ""}
Safe next position chosen by the turn plan: ${nextPosition ?? "n/a"}.
${avoided.length ? `Positions that must NOT be used: ${avoided.join("; ")}.` : ""}
${noSafe ? "No fully safe position exists for this patient." : ""}

Write 2 or 3 short sentences, plain text, no lists, no markdown:
1. What is happening and where (name the zone and number). Do not just say "ischemia risk". Explain the specific cause, such as time in position, a bony prominence, shear, a device edge, a loaded wound or heel contact.
2. One exact action for the nurse. If repositioning, use only the safe next position and say how (30° tilt, wedge, pillow between knees, heels floated, head of bed at 30° or lower). Never suggest a forbidden position.
3. One prevention point specific to THIS patient (their body notes, nutrition, sensation, weight, age or diagnosis). Vary it, and do not repeat generic advice.
If peak pressure is under 50 and no wound is loaded, say it is safe in one sentence and give one patient-specific check.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastReason = "unavailable";

  for (const modelName of MODELS) {
    const until = cooldown.get(modelName) ?? 0;
    if (until > Date.now()) {
      lastReason = "quota-cooldown";
      continue;
    }
    const model = genAI.getGenerativeModel({ model: modelName }, { timeout: 12000 });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response
          .text()
          .replace(/[*#`_]/g, "")
          .replace(/\s*\n+\s*/g, " ")
          .trim();
        if (text) {
          return NextResponse.json({ recommendation: text, source: "gemini", model: modelName });
        }
        break;
      } catch (error) {
        const msg = String(error);
        if (/\[404/.test(msg)) {
          cooldown.set(modelName, Date.now() + 60 * 60 * 1000); // unknown model: skip for an hour
          lastReason = "model-missing";
          break;
        }
        if (/\[429/.test(msg)) {
          const wait = retryDelayMs(msg) ?? 60_000;
          if (wait > 15_000 || /PerDay|quota/i.test(msg)) {
            cooldown.set(modelName, Date.now() + wait);
            console.warn(`Gemini ${modelName} quota hit. Using offline protocol for ${Math.round(wait / 60000)} min.`);
            lastReason = "quota";
            break;
          }
          await sleep(wait);
          continue;
        }
        console.error(`AI Error (${modelName}, attempt ${attempt + 1}):`, msg.slice(0, 300));
        const retryable = /\[(500|502|503|504)|timeout|fetch failed|abort/i.test(msg);
        lastReason = "error";
        if (!retryable) break;
        await sleep(600 * (attempt + 1));
      }
    }
  }

  return fallback(lastReason);
}