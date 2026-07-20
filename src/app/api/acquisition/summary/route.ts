import { NextRequest, NextResponse } from "next/server";
import { createMockAcquisitionDashboard } from "@/lib/acquisition";
import { getAcquisitionSnapshot } from "@/lib/acquisition-snapshot";
import { buildAcquisitionSummary, parseAcquisitionFilters } from "@/lib/acquisition-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const filters = parseAcquisitionFilters(request.nextUrl.searchParams);

    if (process.env.DEMO_MODE === "true") {
      const summary = buildAcquisitionSummary(createMockAcquisitionDashboard(), filters);
      return NextResponse.json(summary, {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Acquisition-Source": "demo",
          "X-Acquisition-Refresh": "idle",
          "Server-Timing": `acquisition-summary;dur=${Date.now() - startedAt}`,
        },
      });
    }

    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const snapshot = await getAcquisitionSnapshot({ refresh });
    const summary = buildAcquisitionSummary(snapshot.data, filters);

    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Acquisition-Source": snapshot.source,
        "X-Acquisition-Age": String(snapshot.ageSeconds),
        "X-Acquisition-Refresh": snapshot.refreshState,
        ...(snapshot.lastError ? { "X-Acquisition-Refresh-Error": snapshot.lastError.slice(0, 300) } : {}),
        "Server-Timing": `acquisition-summary;dur=${Date.now() - startedAt}`,
      },
    });
  } catch (error) {
    console.error("Acquisition summary load failed", error);
    return NextResponse.json({
      error: "Unable to load Acquisition summary",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
