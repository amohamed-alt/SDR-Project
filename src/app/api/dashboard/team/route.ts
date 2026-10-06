import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/dashboard-query";
import { SDR_OWNERS, SDR_COMPARISON_KEYS } from "@/lib/sdr-owners";
import { summarizeSdr } from "@/lib/sdr-comparison";
import { getDashboardSnapshot } from "@/lib/dashboard-snapshot";
import { createMockDashboard } from "@/lib/mock-data";
import { compressedJsonResponse } from "@/lib/compressed-json";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = parseDashboardFilters(params, SDR_OWNERS.marita.ownerId);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid reporting period" }, { status: 400 });
  const results = await Promise.all(SDR_COMPARISON_KEYS.map(async key => {
    const owner = SDR_OWNERS[key];
    try {
      const filters = { ...parsed.data, ownerId: owner.ownerId };
      const result = process.env.DEMO_MODE === "true"
        ? { data: createMockDashboard(filters.from, filters.to, filters.ownerId), refreshing: false, ageSeconds: 0 }
        : await getDashboardSnapshot(filters, params.get("refresh") === "1");
      return { key: owner.key, data: summarizeSdr(result.data), refreshing: result.refreshing, ageSeconds: result.ageSeconds, error: null };
    } catch {
      return { key: owner.key, data: null, refreshing: false, ageSeconds: null, error: `Unable to load ${owner.shortName}'s HubSpot data` };
    }
  }));
  return compressedJsonResponse(request, { results }, { "Cache-Control": "private, no-store" });
}
