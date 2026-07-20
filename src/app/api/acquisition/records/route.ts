import { NextRequest, NextResponse } from "next/server";
import { createMockAcquisitionDashboard } from "@/lib/acquisition";
import { getAcquisitionSnapshot } from "@/lib/acquisition-snapshot";
import {
  acquisitionRecordRows,
  parseAcquisitionFilters,
  type AcquisitionRecordKind,
} from "@/lib/acquisition-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const rawKind = request.nextUrl.searchParams.get("kind");
    const kind: AcquisitionRecordKind = rawKind === "activities" || rawKind === "deals" ? rawKind : "contacts";
    const view = request.nextUrl.searchParams.get("view")?.trim() || "all";
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "500");
    const limit = Math.max(1, Math.min(1_000, Number.isFinite(requestedLimit) ? requestedLimit : 500));
    const requestedOffset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    const offset = Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0);
    const filters = parseAcquisitionFilters(request.nextUrl.searchParams);

    const data = process.env.DEMO_MODE === "true"
      ? createMockAcquisitionDashboard()
      : (await getAcquisitionSnapshot()).data;
    const allRows = acquisitionRecordRows(data, filters, kind, view);
    const rows = allRows.slice(offset, offset + limit);

    return NextResponse.json({
      kind,
      view,
      total: allRows.length,
      offset,
      limit,
      nextOffset: offset + rows.length < allRows.length ? offset + rows.length : null,
      rows,
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Server-Timing": `acquisition-records;dur=${Date.now() - startedAt}`,
      },
    });
  } catch (error) {
    console.error("Acquisition records load failed", error);
    return NextResponse.json({
      error: "Unable to load Acquisition records",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
