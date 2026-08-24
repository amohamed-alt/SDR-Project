import { NextRequest, NextResponse } from "next/server";
import { runCareerAtsBackfillBatch } from "@/lib/career-ats-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeBatch: Promise<Awaited<ReturnType<typeof runCareerAtsBackfillBatch>>> | null = null;

export async function POST(request: NextRequest) {
  if (activeBatch) {
    return NextResponse.json(
      { error: "A Career + ATS Search Status batch is already running." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      limit?: number;
      forceRefresh?: boolean;
    };
    const limit = Math.max(1, Math.min(100, Number(body.limit || process.env.CAREER_BACKFILL_BATCH_LIMIT || process.env.CAREER_SCAN_LIMIT || 50)));
    activeBatch = runCareerAtsBackfillBatch({ limit, forceRefresh: body.forceRefresh !== false });
    const payload = await activeBatch;

    return NextResponse.json(
      {
        ...payload,
        remainingEligible: payload.summary.remainingEligible,
        autoPushEnabled: true,
        mode: "career-ats-search-status-backfill",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Career + ATS Search Status batch failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    activeBatch = null;
  }
}
