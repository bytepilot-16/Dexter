import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not configured.");
    return NextResponse.json(
      { recommendation: "AI diagnostics are not configured." },
      { status: 503 },
    );
  }

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

  const maxPressure = body.maxPressure;
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

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      You are an expert ICU wound-care AI. 
      The patient's smart bed sensor shows a maximum pressure reading of ${maxPressure} mmHg.
      If the pressure is under 70, say: "Pressure distribution is safe. No repositioning required."
      If the pressure is 70 or above, identify the risk of ischemia and give a strict 1-sentence command to the nurse on exactly how to reposition the patient (e.g., "Rotate patient 30 degrees left lateral").
      Keep the response short, clinical, and professional.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    return NextResponse.json({ recommendation: responseText });
    
  } catch (error) {
    console.error("AI Error:", error);
    return NextResponse.json(
      { recommendation: "Error connecting to AI diagnostic system." },
      { status: 502 },
    );
  }
}