import { NextRequest, NextResponse } from "next/server";
import { runCareerAtsBackfillBatch } from "@/lib/career-ats-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeBatch: Promise<Awaited<ReturnType<typeof runCareerAtsBackfillBatch>>> | null = null;

function writesEnabled() {
  return String(process.env.CAREER_MANUAL_WRITE_ENABLED || "false").toLowerCase() === "true";
}

export async function POST(request: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json(
      {
        error: "Career + ATS automatic HubSpot writes are disabled. Research must be manually verified before CRM updates.",
        mode: "manual-verification-required",
      },
      { status: 423, headers: { "Cache-Control": "no-store" } },
    );
  }

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
        autoPushEnabled: false,
        mode: "manual-verification-gated-backfill",
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