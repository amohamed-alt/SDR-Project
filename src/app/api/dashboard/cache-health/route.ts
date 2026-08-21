import { NextResponse } from "next/server";
import { dashboardCacheConfigured } from "@/lib/dashboard-cache-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_API_URL = (process.env.DASHBOARD_CACHE_API_URL || "").replace(/\/$/, "");

async function fetchCacheJson(path: string) {
  const response = await fetch(`${CACHE_API_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`FastAPI cache returned HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function GET() {
  if (!dashboardCacheConfigured()) {
    return NextResponse.json({
      status: "disabled",
      configured: false,
      note: "DASHBOARD_CACHE_API_URL is not configured; the dashboard will use the Next.js fallback cache.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const [health, stats] = await Promise.all([
      fetchCacheJson("/health"),
      fetchCacheJson("/v1/stats"),
    ]);
    return NextResponse.json({
      status: "ok",
      configured: true,
      health,
      stats,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      status: "degraded",
      configured: true,
      error: error instanceof Error ? error.message : "Dashboard cache unavailable",
      fallback: "Next.js memory/cache remains available.",
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
