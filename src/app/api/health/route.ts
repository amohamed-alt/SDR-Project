import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { dashboardAuthConfig } from "@/lib/dashboard-auth";
import { sdrAdminConfigured } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_TOKEN_STORE = process.env.GOOGLE_TOKEN_STORE_PATH || "/app/data/google-calendar.json";
const NO_CACHE_HEADERS = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runtimeConfigState() {
  const auth = dashboardAuthConfig();
  const checks = {
    hubspot: Boolean(process.env.HUBSPOT_PRIVATE_APP_TOKEN),
    googleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    googleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    googleEncryptionKey: Boolean(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    googleRedirectUri: Boolean(process.env.GOOGLE_REDIRECT_URI),
    dashboardAuth: auth.mode !== "missing",
    sdrAdmin: sdrAdminConfigured(),
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    authMode: auth.mode,
    demoMode: process.env.DEMO_MODE === "true",
  };
}

export async function GET(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const buildRef = String(process.env.SDR_BUILD_REF || "unknown").trim() || "unknown";
  const deep = request.nextUrl.searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json(
      { status: "ok", service: "sdr-project", buildRef, timestamp },
      { headers: NO_CACHE_HEADERS },
    );
  }

  const [runtimeConfig, googleTokenStorePresent] = await Promise.all([
    Promise.resolve(runtimeConfigState()),
    fileExists(GOOGLE_TOKEN_STORE),
  ]);
  const ready = runtimeConfig.ready;

  return NextResponse.json(
    {
      status: ready ? "ok" : "warming",
      service: "sdr-project",
      buildRef,
      ready,
      runtimeConfig,
      googleTokenStorePresent,
      timestamp,
    },
    {
      status: ready ? 200 : 503,
      headers: NO_CACHE_HEADERS,
    },
  );
}
