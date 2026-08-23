import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { runCareerBatch } from "@/lib/career-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeBatch: Promise<Awaited<ReturnType<typeof runCareerBatch>>> | null = null;

async function recoverInterruptedProcessingRecords() {
  const storePath = process.env.CAREER_INTELLIGENCE_STORE_PATH || "/app/data/career-intelligence.json";
  try {
    const raw = await fs.readFile(/* turbopackIgnore: true */ storePath, "utf8");
    const store = JSON.parse(raw) as {
      updatedAt?: string;
      records?: Record<string, {
        status?: string;
        verificationReason?: string;
        verificationSource?: string;
        updatedAt?: string;
      }>;
    };
    let changed = false;
    const timestamp = new Date().toISOString();
    for (const record of Object.values(store.records || {})) {
      if (record.status !== "processing") continue;
      record.status = "needs_research";
      record.verificationReason = "Recovered after an interrupted Career Intelligence batch; queued for a safe retry.";
      record.verificationSource = "Batch recovery";
      record.updatedAt = timestamp;
      changed = true;
    }
    if (!changed) return;
    store.updatedAt = timestamp;
    const temp = `${storePath}.recovery.tmp`;
    await fs.writeFile(/* turbopackIgnore: true */ temp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(/* turbopackIgnore: true */ temp, /* turbopackIgnore: true */ storePath);
  } catch {
    // Missing/empty store is normal on the first run. A malformed store will be
    // surfaced by the regular portfolio load rather than blocking the endpoint here.
  }
}

export async function POST(request: NextRequest) {
  if (activeBatch) {
    return NextResponse.json(
      { error: "A Career Intelligence batch is already running. Refresh the dashboard to follow its progress." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await recoverInterruptedProcessingRecords();
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
