import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const CACHE_API_URL = (process.env.DASHBOARD_CACHE_API_URL || "").replace(/\/$/, "");
const READ_TIMEOUT_MS = Number(process.env.DASHBOARD_CACHE_READ_TIMEOUT_MS || 2_500);
const WRITE_TIMEOUT_MS = Number(process.env.DASHBOARD_CACHE_WRITE_TIMEOUT_MS || 5_000);

export type PersistedDashboardSnapshot = {
  data: DashboardData;
  refreshedAt: number;
  ageSeconds: number;
};

function canonicalFilters(filters: DashboardFilters) {
  return {
    schemaVersion: 12,
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
      data?: DashboardData | { format: "gzip-v1"; body: string };
      refreshedAt?: number;
      ageSeconds?: number;
    };
    if (!payload.data || !Number.isFinite(payload.refreshedAt)) return null;
    const data = "format" in payload.data && payload.data.format === "gzip-v1"
      ? JSON.parse((await gunzipAsync(Buffer.from(payload.data.body, "base64"), { maxOutputLength: 64 * 1024 * 1024 })).toString("utf8")) as DashboardData
      : payload.data as DashboardData;
    if (!data.meta?.generatedAt || !Array.isArray(data.priorityContacts) || !Array.isArray(data.recentActivities)) return null;
    return {
      data,
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
      body: JSON.stringify({ key, refreshedAt, data: { format: "gzip-v1", body: (await gzipAsync(Buffer.from(JSON.stringify(data)), { level: 6 })).toString("base64") } }),
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
