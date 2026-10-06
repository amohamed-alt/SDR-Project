import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/dashboard-query";
import { createHash } from "node:crypto";
import { DEFAULT_SDR_OWNER_ID } from "@/lib/config";
import { getDashboardSnapshot } from "@/lib/dashboard-snapshot";
import { createMockDashboard } from "@/lib/mock-data";
import { compressedJsonResponse } from "@/lib/compressed-json";
import { projectDashboardPayload, projectDashboardSummary } from "@/lib/dashboard-payload";
import type { DashboardFilters } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const started = performance.now();
  const params = request.nextUrl.searchParams;
  const parsed = parseDashboardFilters(params, DEFAULT_SDR_OWNER_ID);
  if (!parsed.success) return NextResponse.json({ error: "Invalid dashboard filters", details: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.from > parsed.data.to) return NextResponse.json({ error: "The start date must be before the end date" }, { status: 400 });

  try {
    const filters: DashboardFilters = parsed.data;
    const isDemo = process.env.DEMO_MODE === "true";
    const snapshot = isDemo
      ? {
          data: createMockDashboard(filters.from, filters.to, filters.ownerId),
          refreshing: false,
          ageSeconds: 0,
          cacheStatus: "memory" as const,
        }
      : await getDashboardSnapshot(filters, params.get("refresh") === "1");

    const snapshotMs = performance.now() - started;
    const profile = params.get("profile") === "summary" ? "summary-v1" : "instant-v2.1";
    const payload = profile === "summary-v1" ? projectDashboardSummary(snapshot.data) : projectDashboardPayload(snapshot.data);
    const etagSeed = JSON.stringify({
      filters,
      generatedAt: payload.meta.generatedAt,
      warnings: payload.meta.warnings,
      payloadProfile: profile,
    });
    const etag = `W/"${createHash("sha256").update(etagSeed).digest("hex").slice(0, 32)}"`;
    const headers = {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
      "X-Dashboard-Cache-Version": "v9-complete-records",
      "X-Dashboard-Cache": snapshot.cacheStatus,
      "X-Dashboard-Snapshot-Age": String(snapshot.ageSeconds),
      "X-Dashboard-Refreshing": snapshot.refreshing ? "1" : "0",
      "X-Dashboard-Payload": profile,
      "Server-Timing": `snapshot;dur=${snapshotMs.toFixed(1)}, projection;dur=${(performance.now() - started - snapshotMs).toFixed(1)}`,
      "X-Dashboard-Contacts-Sent": String(payload.priorityContacts.length),
      "X-Dashboard-Activities-Sent": String(payload.recentActivities.length),
      "X-Dashboard-Companies-Sent": String(payload.companies.length),
      "ETag": etag,
      "Vary": "Accept-Encoding",
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return compressedJsonResponse(request, payload, headers);
  } catch (error) {
    console.error("Dashboard load failed", error);
    return NextResponse.json({
      error: "Unable to load HubSpot dashboard data",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
