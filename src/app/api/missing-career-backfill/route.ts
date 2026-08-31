import { NextRequest, NextResponse } from "next/server";
import { getMissingCareerBackfillStatus, runMissingCareerBackfillBatch } from "@/lib/missing-career-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeBatch: Promise<Awaited<ReturnType<typeof runMissingCareerBackfillBatch>>> | null = null;

function writesEnabled() {
  return String(process.env.CAREER_MANUAL_WRITE_ENABLED || "false").toLowerCase() === "true";
}

export async function GET() {
  try {
    const status = await getMissingCareerBackfillStatus();
    return NextResponse.json(
      {
        ...status,
        activeInProcess: Boolean(activeBatch),
        writeMode: writesEnabled() ? "enabled" : "manual-verification-required",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing Career Page backfill status failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json(
      {
        error: "Automatic missing Career Page HubSpot writes are disabled. Each company must be manually verified before CRM update.",
        mode: "manual-verification-required",
      },
      { status: 423, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (activeBatch) {
    return NextResponse.json(
      { error: "A missing Career Page backfill batch is already running." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const body = await request.json().catch(() => ({})) as { limit?: number };
    const limit = Math.max(1, Math.min(100, Number(body.limit || 50)));
    activeBatch = runMissingCareerBackfillBatch({ limit });
    const payload = await activeBatch;
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing Career Page backfill batch failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    activeBatch = null;
  }
}