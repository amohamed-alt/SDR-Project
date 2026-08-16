import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIR = process.env.CAREER_DATA_DIR || "/app/data";
const VALIDATION_MARKER = process.env.CAREER_VALIDATION_MARKER_PATH || `${DATA_DIR}/career-validation-v1.done`;
const VALIDATION_STATE = process.env.CAREER_VALIDATION_STATE_PATH || `${DATA_DIR}/career-validation-v1.state`;
const CAREER_STORE = process.env.CAREER_INTELLIGENCE_STORE_PATH || `${DATA_DIR}/career-intelligence.json`;
const GOOGLE_TOKEN_STORE = process.env.GOOGLE_TOKEN_STORE_PATH || `${DATA_DIR}/google-calendar.json`;

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readValidationState() {
  try {
    return (await fs.readFile(VALIDATION_STATE, "utf8")).trim().slice(0, 120);
  } catch {
    return "not_started";
  }
}

async function readValidationProgress() {
  try {
    const parsed = JSON.parse(await fs.readFile(CAREER_STORE, "utf8")) as {
      records?: Record<string, { status?: string; lastCheckedAt?: string }>;
    };
    const records = Object.values(parsed.records || {});
    const checked = records.filter((record) => Boolean(record.lastCheckedAt)).length;
    const processing = records.filter((record) => record.status === "processing").length;
    const terminal = records.filter((record) => [
      "found_verified",
      "no_public_career_page",
      "website_domain_invalid",
      "insufficient_company_data",
      "needs_manual_review",
    ].includes(String(record.status || ""))).length;
    return { stored: records.length, checked, processing, terminal };
  } catch {
    return { stored: 0, checked: 0, processing: 0, terminal: 0 };
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

function runtimeConfigState() {
  const checks = {
    hubspot: Boolean(process.env.HUBSPOT_PRIVATE_APP_TOKEN),
    googleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    googleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    googleEncryptionKey: Boolean(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    googleRedirectUri: Boolean(process.env.GOOGLE_REDIRECT_URI),
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    authMode: "open",
    demoMode: process.env.DEMO_MODE === "true",
  };
}

export async function GET(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const deep = request.nextUrl.searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json({ status: "ok", service: "sdr-project", timestamp });
  }

  const runtimeConfig = runtimeConfigState();
  const [careerEngine, careerValidationComplete, careerValidationState, careerValidationProgress, googleTokenStorePresent] = await Promise.all([
    careerEngineHealthy(),
    fileExists(VALIDATION_MARKER),
    readValidationState(),
    readValidationProgress(),
    fileExists(GOOGLE_TOKEN_STORE),
  ]);
  const ready = runtimeConfig.ready && careerEngine && careerValidationComplete;

  return NextResponse.json(
    {
      status: ready ? "ok" : "warming",
      service: "sdr-project",
      ready,
      runtimeConfig,
      googleTokenStorePresent,
      careerEngine,
      careerValidationComplete,
      careerValidationState,
      careerValidationProgress,
      timestamp,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
