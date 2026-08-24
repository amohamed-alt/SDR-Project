import { NextRequest, NextResponse } from "next/server";
import { getCareerAtsBackfillStatus, runCareerAtsBackfillBatch } from "@/lib/career-ats-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeBatch: Promise<Awaited<ReturnType<typeof runCareerAtsBackfillBatch>>> | null = null;

export async function GET() {
  try {
    const status = await getCareerAtsBackfillStatus();
    return NextResponse.json(
      { ...status, activeInProcess: Boolean(activeBatch) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Career + ATS backfill status failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  if (activeBatch) {
    return NextResponse.json(
      { error: "A Career + ATS backfill batch is already running." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      limit?: number;
      forceRefresh?: boolean;
    };
    const limit = Math.max(1, Math.min(100, Number(body.limit || process.env.CAREER_BACKFILL_BATCH_LIMIT || 50)));
    activeBatch = runCareerAtsBackfillBatch({ limit, forceRefresh: body.forceRefresh !== false });
    const payload = await activeBatch;
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Career + ATS backfill batch failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    activeBatch = null;
  }
}
