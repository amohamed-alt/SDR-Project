import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALIDATION_MARKER = process.env.CAREER_VALIDATION_MARKER_PATH || "/app/data/career-validation-v1.done";

async function markerExists() {
  try {
    await fs.access(VALIDATION_MARKER);
    return true;
  } catch {
    return false;
  }
}

async function careerEngineHealthy() {
  try {
    const configured = process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/career-detect";
    const url = new URL(configured);
    url.pathname = "/health";
    url.search = "";
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; capabilities?: string[] };
    return payload.ok === true && Array.isArray(payload.capabilities) && payload.capabilities.includes("career-detect");
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const deep = request.nextUrl.searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json({ status: "ok", service: "sdr-project", timestamp });
  }

  const [careerEngine, careerValidationComplete] = await Promise.all([
    careerEngineHealthy(),
    markerExists(),
  ]);
  const ready = careerEngine && careerValidationComplete;

  return NextResponse.json(
    {
      status: ready ? "ok" : "warming",
      service: "sdr-project",
      ready,
      careerEngine,
      careerValidationComplete,
      timestamp,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
