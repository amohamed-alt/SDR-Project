import { salesNavLeadId } from "@/lib/salesnav-identity";
import { readOperationStates } from "@/lib/salesnav-operations";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  finishCompanionFullRun,
  getCompanionFullRun,
  getLatestCompanionBatch,
  getLatestCompanionFullRun,
  listCompanionFullRuns,
  saveCompanionFullRunPage,
} from "@/lib/salesnav-companion";
import { SALESNAV_SETUP_COOKIE, verifySalesNavSetupKey } from "@/lib/salesnav-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unlocked(request: NextRequest) {
  return verifySalesNavSetupKey(request.cookies.get(SALESNAV_SETUP_COOKIE)?.value || "");
}

async function migrateLegacyBatchIfNeeded() {
  const existing = await getLatestCompanionFullRun();
  if (existing) return existing;

  const batch = await getLatestCompanionBatch();
  if (!batch?.leads?.length) return null;

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
  return await finishCompanionFullRun(runId, `Migrated legacy Companion batch · ${batch.pagesRead || 1} page${batch.pagesRead === 1 ? "" : "s"}`) || run;
}

export async function GET(request: NextRequest) {
  if (!unlocked(request)) {
    return NextResponse.json({ error: "Unlock Sales Nav admin settings first." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const requestedId = String(request.nextUrl.searchParams.get("id") || "").trim();
  const run = requestedId ? await getCompanionFullRun(requestedId) : await migrateLegacyBatchIfNeeded();
  const history = await listCompanionFullRuns(100);

  const keys = (run?.leads || []).flatMap((lead) => { const id = salesNavLeadId(lead); return id ? [`reveal:${id}`, `push:${id}`] : []; });
  // Missing durable state is visible; the UI cannot assume a previous paid run was empty.
  let operations: Record<string, { state: string; result: Record<string, unknown> }> = {};
  let operationError = "";
  try { if (keys.length) operations = (await readOperationStates(keys)).operations; }
  catch { operationError = "Saved operation state is unavailable. Reveal/push paused; retry loading the run."; }
  return NextResponse.json({
    operations, operationError,
    ok: true,
    run: run ? { ...run, total: run.leads.length } : null,
    history,
  }, { headers: { "Cache-Control": "no-store" } });
}
