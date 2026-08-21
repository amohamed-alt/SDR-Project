import { createHash } from "node:crypto";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const CACHE_API_URL = (process.env.DASHBOARD_CACHE_API_URL || "").replace(/\/$/, "");
const READ_TIMEOUT_MS = Number(process.env.DASHBOARD_CACHE_READ_TIMEOUT_MS || 700);
const WRITE_TIMEOUT_MS = Number(process.env.DASHBOARD_CACHE_WRITE_TIMEOUT_MS || 2_000);

export type PersistedDashboardSnapshot = {
  data: DashboardData;
  refreshedAt: number;
  ageSeconds: number;
};

function canonicalFilters(filters: DashboardFilters) {
  return {
    from: filters.from,
    to: filters.to,
    ownerId: filters.ownerId,
    country: filters.country ?? "",
    originalSource: filters.originalSource ?? "",
    latestSource: filters.latestSource ?? "",
    tier: filters.tier ?? "",
    persona: filters.persona ?? "",
  };
}

export function dashboardCacheKey(filters: DashboardFilters) {
  return createHash("sha256").update(JSON.stringify(canonicalFilters(filters))).digest("hex");
}

export function dashboardCacheConfigured() {
  return Boolean(CACHE_API_URL);
}

export async function readPersistedDashboardSnapshot(filters: DashboardFilters): Promise<PersistedDashboardSnapshot | null> {
  if (!CACHE_API_URL) return null;
  const key = dashboardCacheKey(filters);

  try {
    const response = await fetch(`${CACHE_API_URL}/v1/dashboard/${key}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`FastAPI cache returned HTTP ${response.status}`);
    const payload = await response.json() as {
      data?: DashboardData;
      refreshedAt?: number;
      ageSeconds?: number;
    };
    if (!payload.data || !Number.isFinite(payload.refreshedAt)) return null;
    return {
      data: payload.data,
      refreshedAt: Number(payload.refreshedAt),
      ageSeconds: Math.max(0, Number(payload.ageSeconds || 0)),
    };
  } catch (error) {
    console.warn("FastAPI dashboard cache read failed", error);
    return null;
  }
}

export async function writePersistedDashboardSnapshot(filters: DashboardFilters, data: DashboardData, refreshedAt: number) {
  if (!CACHE_API_URL) return false;
  const key = dashboardCacheKey(filters);

  try {
    const response = await fetch(`${CACHE_API_URL}/v1/dashboard/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, refreshedAt, data }),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`FastAPI cache returned HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.warn("FastAPI dashboard cache write failed", error);
    return false;
  }
}
