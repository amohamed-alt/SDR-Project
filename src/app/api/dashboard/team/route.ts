import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compressedJsonResponse } from "@/lib/compressed-json";
import { getDashboardSnapshot } from "@/lib/dashboard-snapshot";
import { createMockDashboard } from "@/lib/mock-data";
import type { DashboardFilters } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MARITA_OWNER_ID = "31644369";
const DANIEL_OWNER_ID = "37624223";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE_PATTERN),
  to: z.string().regex(DATE_PATTERN),
});

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
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid team dashboard filters", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.from > parsed.data.to) {
    return NextResponse.json({ error: "The start date must be before the end date" }, { status: 400 });
  }

  const forceRefresh = params.get("refresh") === "1";
  const isDemo = process.env.DEMO_MODE === "true";
  const baseFilters = { from: parsed.data.from, to: parsed.data.to };

  try {
    const loadOwner = async (ownerId: string) => {
      const filters: DashboardFilters = { ...baseFilters, ownerId };
      if (isDemo) {
        return {
          data: createMockDashboard(filters.from, filters.to, ownerId),
          refreshing: false,
          ageSeconds: 0,
          cacheStatus: "memory" as const,
        };
      }
      return getDashboardSnapshot(filters, forceRefresh);
    };

    const [marita, daniel] = await Promise.all([
      loadOwner(MARITA_OWNER_ID),
      loadOwner(DANIEL_OWNER_ID),
    ]);

    const oldestAge = Math.max(marita.ageSeconds, daniel.ageSeconds);
    const refreshing = marita.refreshing || daniel.refreshing;

    return compressedJsonResponse(request, {
      marita: marita.data,
      daniel: daniel.data,
      meta: {
        from: parsed.data.from,
        to: parsed.data.to,
        generatedAt: new Date().toISOString(),
        refreshing,
        oldestSnapshotAgeSeconds: oldestAge,
        cache: {
          marita: marita.cacheStatus,
          daniel: daniel.cacheStatus,
        },
      },
    }, {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=180",
      "X-Dashboard-Cache-Version": "v8-dual-sdr-prewarmed",
      "X-Dashboard-Refreshing": refreshing ? "1" : "0",
      "X-Dashboard-Snapshot-Age": String(oldestAge),
    });
  } catch (error) {
    console.error("Team dashboard load failed", error);
    return NextResponse.json({
      error: "Unable to load SDR team data",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
