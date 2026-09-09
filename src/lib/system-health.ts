import fs from "node:fs/promises";
import { dashboardAuthConfig } from "@/lib/dashboard-auth";
import { sdrAdminConfigured } from "@/lib/sdr-admin-auth";

const CACHE_URL = String(process.env.DASHBOARD_CACHE_API_URL || "http://dashboard-cache-api:8000").replace(/\/$/, "");
const GOOGLE_TOKEN_STORE = process.env.GOOGLE_TOKEN_STORE_PATH || "/app/data/google-calendar.json";

type CacheHealth = {
  status?: string;
  version?: string;
  entries?: number;
  newestStoredAt?: number;
  usageDatabase?: string;
  acquisitionDatabase?: string;
};

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readCacheHealth() {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${CACHE_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
      headers: { Accept: "application/json" },
    });
    const body = response.ok ? await response.json() as CacheHealth : null;
    return {
      status: response.ok && body?.status === "ok" ? "ok" as const : "unavailable" as const,
      latencyMs: Date.now() - startedAt,
      version: body?.version ?? null,
      entries: body?.entries ?? null,
      newestStoredAt: body?.newestStoredAt ?? null,
      usageDatabase: body?.usageDatabase ?? "unknown",
      acquisitionDatabase: body?.acquisitionDatabase ?? "unknown",
    };
  } catch {
    return {
      status: "unavailable" as const,
      latencyMs: Date.now() - startedAt,
      version: null,
      entries: null,
      newestStoredAt: null,
      usageDatabase: "unknown",
      acquisitionDatabase: "unknown",
    };
  }
}

function configured(name: string) {
  return Boolean(String(process.env[name] || "").trim());
}

export async function getSystemHealth() {
  const [cache, googleTokenStorePresent] = await Promise.all([
    readCacheHealth(),
    fileExists(GOOGLE_TOKEN_STORE),
  ]);
  const auth = dashboardAuthConfig();
  const hubspotConfigured = configured("HUBSPOT_PRIVATE_APP_TOKEN");
  const googleConfigured = configured("GOOGLE_CLIENT_ID") && configured("GOOGLE_CLIENT_SECRET") && configured("GOOGLE_TOKEN_ENCRYPTION_KEY") && configured("GOOGLE_REDIRECT_URI");
  const coreReady = hubspotConfigured && cache.status === "ok";

  return {
    status: coreReady ? "ok" as const : "degraded" as const,
    timestamp: new Date().toISOString(),
    buildRef: String(process.env.SDR_BUILD_REF || "unknown").trim() || "unknown",
    core: {
      application: { status: "ok" as const },
      hubspot: { status: hubspotConfigured ? "configured" as const : "missing" as const },
      dashboardCache: cache,
      postgres: {
        status: cache.usageDatabase === "ok" ? "ok" as const : cache.usageDatabase === "disabled" ? "disabled" as const : "unavailable" as const,
        source: "dashboard-cache usage database check",
      },
    },
    access: {
      dashboardAuth: { status: auth.mode === "missing" ? "missing" as const : "configured" as const, mode: auth.mode },
      sdrAdmin: { status: sdrAdminConfigured() ? "configured" as const : "missing" as const },
    },
    integrations: {
      googleCalendar: { status: googleConfigured ? "configured" as const : "incomplete" as const, tokenStorePresent: googleTokenStorePresent },
      signalHire: { status: configured("SIGNALHIRE_API_KEY") ? "configured" as const : "optional" as const },
      millionVerifier: { status: configured("MILLIONVERIFIER_API_KEY") ? "configured" as const : "optional" as const },
      apollo: { status: configured("APOLLO_API_KEY") ? "configured" as const : "optional" as const },
      tavily: { status: configured("TAVILY_API_KEY") ? "configured" as const : "optional" as const },
      gemini: { status: configured("GEMINI_API_KEY") ? "configured" as const : "optional" as const },
      openRouter: { status: configured("OPENROUTER_API_KEY") ? "configured" as const : "optional" as const },
      maqsam: { status: configured("MAQSAM_ACCESS_KEY") && configured("MAQSAM_ACCESS_SECRET") ? "configured" as const : "optional" as const },
    },
  };
}

export type SystemHealth = Awaited<ReturnType<typeof getSystemHealth>>;
