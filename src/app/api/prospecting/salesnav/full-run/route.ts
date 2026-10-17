import { readSalesNavPushStates } from "@/lib/salesnav-push-attempt";
import { cachedSalesNavIdentityMismatch, salesNavNameMismatch } from "@/lib/salesnav-identity";
import { salesNavLeadStates } from "@/lib/salesnav-lead-ledger";
import { originMatchesRequestHosts } from "@/lib/request-origin";
import { z } from "zod";
import { publicPersonProfile } from "@/lib/salesnav-profile-sync";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  finishCompanionFullRun,
  getCompanionFullRun,
  getLatestCompanionBatch,
  getLatestCompanionFullRun,
  listCompanionFullRuns,
  saveCompanionFullRunPage,
  syncCompanionProfile,
} from "@/lib/salesnav-companion";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unlocked(request: NextRequest) {
  return sdrAdminAuthorized(request);
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
  if (requestedId && !z.string().uuid().safeParse(requestedId).success) return NextResponse.json({ error: "Invalid saved run ID." }, { status: 400 });
  const run = requestedId ? await getCompanionFullRun(requestedId) : await migrateLegacyBatchIfNeeded();
  const history = await listCompanionFullRuns(100);
  const [reveals, pushes] = run ? await Promise.all([salesNavLeadStates(run.leads), readSalesNavPushStates(run.leads)]) : [[], []];
  const leadStates = run?.leads.map((lead, index) => {
    const saved = reveals[index], push = pushes[index];
    if (!push) return saved;
    const mismatch = cachedSalesNavIdentityMismatch(lead.linkedinUrl, { cachedProspect: push.prospect }) || salesNavNameMismatch(lead, push.prospect);
    if (mismatch) return { ...saved, resumeContactId: "", pushRetryable: false, revealStatus: "uncertain", revealError: mismatch };
    return { ...saved, prospect: saved?.prospect || push.prospect,
      revealStatus: saved?.revealStatus || "completed", resumeContactId: push.resumeContactId, pushRetryable: push.pushRetryable,
      taskId: push.taskId || saved?.taskId, contactId: push.contactId || saved?.contactId,
      companyId: push.companyId || saved?.companyId, pushCompleted: Boolean(push.result && push.taskId) };
  });

  return NextResponse.json({
    ok: true,
    run: run ? { ...run, total: run.leads.length, leadStates } : null,
    history,
  }, { headers: { "Cache-Control": "no-store" } });
}

// Repair a saved person from a public URL read in their rendered profile.
export async function POST(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if ((site && !["same-origin", "same-site", "none"].includes(site)) || !originMatchesRequestHosts({ origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), requestHost: request.nextUrl.host })) return NextResponse.json({ error: "Cross-site profile changes are not allowed." }, { status: 403 });
  if (!unlocked(request)) return NextResponse.json({ error: "Unlock SDR tools first." }, { status: 401 });
  const parsed = z.object({ runId: z.string().uuid(), salesLeadUrl: z.string().url().max(1500), linkedinUrl: z.string().url().max(1500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || !publicPersonProfile(parsed.data.linkedinUrl)) return NextResponse.json({ error: "Enter an HTTPS LinkedIn person URL containing /in/." }, { status: 400 });
  const run = await getCompanionFullRun(parsed.data.runId);
  if (!run) return NextResponse.json({ error: "Saved run was not found." }, { status: 404 });
  const lead = run.leads.find(person => person.salesLeadUrl === parsed.data.salesLeadUrl);
  if (!lead) return NextResponse.json({ error: "Person was not found in this saved run." }, { status: 404 });
  try {
    const synced = await syncCompanionProfile({ ...lead, linkedinUrl: parsed.data.linkedinUrl }, run.id);
    if (!synced) return NextResponse.json({ error: "Profile link could not be matched to this person." }, { status: 409 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Profile link could not be saved." }, { status: 409 });
  }
}
