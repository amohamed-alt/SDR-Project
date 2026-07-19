import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_SDR_OWNER_ID } from "@/lib/config";
import { buildDashboard } from "@/lib/analytics";
import { createMockDashboard } from "@/lib/mock-data";
import type { DashboardFilters } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(datePattern),
  to: z.string().regex(datePattern),
  ownerId: z.string().regex(/^\d+$/),
  country: z.string().max(120).optional(),
  originalSource: z.string().max(120).optional(),
  latestSource: z.string().max(120).optional(),
  tier: z.string().max(120).optional(),
  persona: z.string().max(120).optional(),
});

const cachedDashboard = unstable_cache(
  async (serializedFilters: string) => buildDashboard(JSON.parse(serializedFilters) as DashboardFilters),
  ["sdr-dashboard-live-v1"],
  { revalidate: 900, tags: ["sdr-dashboard"] },
);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const current = new Date();
  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    from: params.get("from") ?? process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? monthStart(),
    to: params.get("to") ?? today(),
    ownerId: params.get("ownerId") ?? DEFAULT_SDR_OWNER_ID,
    country: params.get("country") || undefined,
    originalSource: params.get("originalSource") || undefined,
    latestSource: params.get("latestSource") || undefined,
    tier: params.get("tier") || undefined,
    persona: params.get("persona") || undefined,
  });

  if (!parsed.success) return NextResponse.json({ error: "Invalid dashboard filters", details: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.from > parsed.data.to) return NextResponse.json({ error: "The start date must be before the end date" }, { status: 400 });

  try {
    const data = process.env.DEMO_MODE === "true"
      ? createMockDashboard(parsed.data.from, parsed.data.to, parsed.data.ownerId)
      : params.get("refresh") === "1"
        ? await buildDashboard(parsed.data)
        : await cachedDashboard(JSON.stringify(parsed.data));
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("Dashboard load failed", error);
    return NextResponse.json({ error: "Unable to load HubSpot dashboard data", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
