import { NextRequest, NextResponse } from "next/server";
import { runCareerBatch } from "@/lib/career-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeBatch: Promise<Awaited<ReturnType<typeof runCareerBatch>>> | null = null;

export async function POST(request: NextRequest) {
  if (activeBatch) {
    return NextResponse.json(
      { error: "A Career Intelligence batch is already running. Refresh the dashboard to follow its progress." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      limit?: number;
      companyIds?: string[];
      forceRefresh?: boolean;
    };
    const limit = Math.max(1, Math.min(100, Number(body.limit || process.env.CAREER_SCAN_LIMIT || 25)));
    const companyIds = Array.isArray(body.companyIds) ? body.companyIds.map(String).filter(Boolean).slice(0, 100) : undefined;
    activeBatch = runCareerBatch({ limit, companyIds, forceRefresh: Boolean(body.forceRefresh) });
    const payload = await activeBatch;
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Career scan failed" }, { status: 500 });
  } finally {
    activeBatch = null;
  }
}
