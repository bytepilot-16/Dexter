import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Newest model first. Override from .env.local with GEMINI_MODEL=...
const MODELS = Array.from(
  new Set(
    [process.env.GEMINI_MODEL, "gemini-3.8-flash"].filter(
      (m): m is string => Boolean(m),
    ),
  ),
);

type Zone = { name: string; pressure: number };

// Deterministic protocol used when Gemini is overloaded/unreachable,
// so the demo never shows a dead panel.
function fallbackRecommendation(
  maxPressure: number,
  position: string,
  topZone?: Zone,
) {
  if (maxPressure < 70) {
    return "Pressure distribution is safe. No repositioning required.";
  }
  const next = position.startsWith("Supine")
    ? "30-degree left lateral"
    : position.startsWith("Left")
      ? "30-degree right lateral"
      : "supine (head of bed 30 degrees or lower)";
  const where = topZone ? ` at the ${topZone.name.toLowerCase()}` : "";
  return `Ischemia risk: ${Math.round(maxPressure)} mmHg${where}. Rotate patient to ${next} position now and offload the affected area with pillows or heel floats.`;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { recommendation: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || !("maxPressure" in body)) {
    return NextResponse.json(
      { recommendation: "A numeric maxPressure value is required." },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;
  const maxPressure = b.maxPressure;
  if (
    typeof maxPressure !== "number" ||
    !Number.isFinite(maxPressure) ||
    maxPressure < 0
  ) {
    return NextResponse.json(
      { recommendation: "maxPressure must be a non-negative number." },
      { status: 400 },
    );
  }

  // Optional context (sanitised)
  const position =
    typeof b.position === "string" ? b.position.slice(0, 40) : "Supine";
  const minutesInPosition =
    typeof b.minutesInPosition === "number" && Number.isFinite(b.minutesInPosition)
      ? Math.round(b.minutesInPosition)
      : null;
  const reliefScore =
    typeof b.reliefScore === "number" && Number.isFinite(b.reliefScore)
      ? Math.round(b.reliefScore)
      : null;
  const topZones: Zone[] = Array.isArray(b.topZones)
    ? b.topZones
        .slice(0, 3)
        .map((z): Zone | null => {
          if (typeof z !== "object" || z === null) return null;
          const zz = z as Record<string, unknown>;
          if (typeof zz.name !== "string" || typeof zz.pressure !== "number")
            return null;
          return { name: zz.name.slice(0, 24), pressure: Math.round(zz.pressure) };
        })
        .filter((z): z is Zone => z !== null)
    : [];

  // Optional patient profile (sanitised, synthetic data only)
  let patientLine = "";
  if (typeof b.patient === "object" && b.patient !== null) {
    const pp = b.patient as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof pp.age === "number" && Number.isFinite(pp.age)) parts.push(`${Math.round(pp.age)}-year-old`);
    if (typeof pp.sex === "string") parts.push(pp.sex.slice(0, 12).toLowerCase());
    if (typeof pp.dx === "string") parts.push(`diagnosis: ${pp.dx.slice(0, 60)}`);
    if (typeof pp.braden === "number" && Number.isFinite(pp.braden))
      parts.push(`Braden score ${Math.round(pp.braden)} of 23 (lower means higher risk)`);
    if (typeof pp.weightKg === "number" && Number.isFinite(pp.weightKg))
      parts.push(`${Math.round(pp.weightKg)} kg`);
    if (parts.length) patientLine = `Patient: ${parts.join(", ")}.`;
  }

  const fallback = () =>
    NextResponse.json({
      recommendation: fallbackRecommendation(maxPressure, position, topZones[0]),
      source: "fallback",
    });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not configured. Using offline protocol.");
    return fallback();
  }

  const prompt = `
You are an expert ICU wound-care AI monitoring a pressure-sensing mattress (synthetic patient data).
Current maximum pressure: ${maxPressure} mmHg.
Patient position: ${position}.
${patientLine}
${minutesInPosition !== null ? `Time in this position: ${minutesInPosition} minutes.` : ""}
${reliefScore !== null ? `Tissue relief score: ${reliefScore}/100.` : ""}
${topZones.length ? `Highest-pressure zones: ${topZones.map((z) => `${z.name} ${z.pressure} mmHg`).join(", ")}.` : ""}

Rules:
- If the max pressure is under 70, reply exactly: "Pressure distribution is safe. No repositioning required."
- If it is 70 or above, name the ischemia risk and the affected zone, then give a strict one-sentence command to the nurse on exactly how to reposition the patient (e.g. "Rotate patient 30 degrees left lateral").
Keep it short, clinical, and professional. Plain text only, maximum two sentences.
`;

  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of MODELS) {
    const model = genAI.getGenerativeModel(
      { model: modelName },
      { timeout: 12000 },
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (text) {
          return NextResponse.json({
            recommendation: text,
            source: "gemini",
            model: modelName,
          });
        }
        break; // empty answer: try next model
      } catch (error) {
        const msg = String(error);
        console.error(`AI Error (${modelName}, attempt ${attempt + 1}):`, msg);

        // Model retired / unknown: go straight to the next model
        if (/\[404/.test(msg)) break;

        // Temporary overload / network trouble: back off and retry
        const retryable = /\[(429|500|502|503|504)|timeout|fetch failed|abort/i.test(msg);
        if (!retryable) break;
        await sleep(700 * (attempt + 1));
      }
    }
  }

  // Everything failed: never leave the nurse without guidance
  return fallback();
}