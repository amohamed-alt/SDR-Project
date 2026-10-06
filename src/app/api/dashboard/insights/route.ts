import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/dashboard-query";
import { DEFAULT_SDR_OWNER_ID } from "@/lib/config";
import { getDashboardSnapshot } from "@/lib/dashboard-snapshot";
import { createMockDashboard } from "@/lib/mock-data";
import { projectDashboardSummary } from "@/lib/dashboard-payload";
import { buildDecisionInsights } from "@/lib/decision-insights";
import { compressedJsonResponse } from "@/lib/compressed-json";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const parsed = parseDashboardFilters(request.nextUrl.searchParams, DEFAULT_SDR_OWNER_ID);
  if (!parsed.success) return NextResponse.json({ error: "Invalid reporting filters" }, { status: 400 });
  try {
    const filters = parsed.data;
    const snapshot = process.env.DEMO_MODE === "true"
      ? { data: createMockDashboard(filters.from, filters.to, filters.ownerId), refreshing: false }
      : await getDashboardSnapshot(filters, request.nextUrl.searchParams.get("refresh") === "1");
    return compressedJsonResponse(request, {
      dashboard: projectDashboardSummary(snapshot.data), insights: buildDecisionInsights(snapshot.data), refreshing: snapshot.refreshing,
    }, { "Cache-Control": "private, max-age=15", "Vary": "Accept-Encoding" });
  } catch {
    return NextResponse.json({ error: "Analytics are unavailable. Try again shortly." }, { status: 503 });
  }
}
