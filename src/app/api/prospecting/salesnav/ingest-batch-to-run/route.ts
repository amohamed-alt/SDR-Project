import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLatestCompanionBatch, saveCompanionFullRunPage, finishCompanionFullRun } from "@/lib/salesnav-companion";
import { SALESNAV_SETUP_COOKIE, verifySalesNavSetupKey } from "@/lib/salesnav-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unlocked(request: NextRequest) {
  return verifySalesNavSetupKey(request.cookies.get(SALESNAV_SETUP_COOKIE)?.value || "");
}

export async function POST(request: NextRequest) {
  if (!unlocked(request)) {
    return NextResponse.json({ error: "Unlock Sales Nav admin settings first." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const batch = await getLatestCompanionBatch();
  if (!batch?.leads?.length) {
    return NextResponse.json({ error: "No companion batch is available." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const runId = randomUUID();
  const run = await saveCompanionFullRunPage({
    id: runId,
    sourceUrl: batch.sourceUrl,
    searchFingerprint: batch.sourceUrl,
    pageNumber: Math.max(1, Math.min(100, batch.pagesRead || 1)),
    clientVersion: batch.clientVersion,
    parserVersion: batch.parserVersion,
    leads: batch.leads,
  });
  const finished = await finishCompanionFullRun(runId, `Imported companion batch (${batch.pagesRead || 1} page${batch.pagesRead === 1 ? "" : "s"})`);
  return NextResponse.json({ ok: true, run: finished || run, total: (finished || run).leads.length }, { headers: { "Cache-Control": "no-store" } });
}
