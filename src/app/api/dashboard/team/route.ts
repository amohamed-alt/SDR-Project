import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SDR_OWNERS } from "@/lib/sdr-owners";
import { summarizeSdr } from "@/lib/sdr-comparison";
import { getDashboardSnapshot } from "@/lib/dashboard-snapshot";
import { createMockDashboard } from "@/lib/mock-data";
import { compressedJsonResponse } from "@/lib/compressed-json";

export const runtime = "nodejs";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const parsed = z.object({ from: date, to: date }).safeParse({ from: params.get("from") || today.slice(0, 7) + "-01", to: params.get("to") || today });
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Choose a valid reporting period" }, { status: 400 });
  const results = await Promise.all(Object.values(SDR_OWNERS).map(async owner => {
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
