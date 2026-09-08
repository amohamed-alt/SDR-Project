import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SALESNAV_SETUP_COOKIE, clearLinkedInSession, verifySalesNavSetupKey } from "@/lib/salesnav-session";
import {
  companionStatus,
  finishCompanionFullRun,
  generateCompanionToken,
  getLatestCompanionBatch,
  getLatestCompanionFullRun,
  saveCompanionBatch,
  saveCompanionFullRunPage,
  touchCompanionToken,
  verifyCompanionToken,
} from "@/lib/salesnav-companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_CLIENT_VERSION = "1.2.0";
const FULL_RUN_MIN_CLIENT_VERSION = "1.5.0";

const leadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(300).default(""),
  company: z.string().trim().max(300).default(""),
  location: z.string().trim().max(300).default(""),
  connectionDegree: z.string().trim().max(20).default(""),
  salesLeadUrl: z.string().trim().max(1500).default(""),
  linkedinUrl: z.string().trim().max(1500).default(""),
  rawText: z.string().trim().max(2500).optional(),
});

const importSchema = z.object({
  action: z.literal("import"),
  sourceUrl: z.string().trim().url().max(6000),
  pagesRead: z.number().int().min(1).max(2).default(1),
  clientVersion: z.string().trim().max(30).default(""),
  parserVersion: z.string().trim().max(60).default(""),
  leads: z.array(leadSchema).min(1).max(50),
});

const fullRunPageSchema = z.object({
  action: z.literal("full_run_page"),
  runId: z.string().uuid(),
  sourceUrl: z.string().trim().url().max(6000),
  searchFingerprint: z.string().trim().min(1).max(7000),
  pageNumber: z.number().int().min(1).max(100),
  clientVersion: z.string().trim().max(30).default(""),
  parserVersion: z.string().trim().max(60).default(""),
  leads: z.array(leadSchema).max(25).default([]),
});

const fullRunFinishSchema = z.object({
  action: z.literal("full_run_finish"),
  runId: z.string().uuid(),
  stopReason: z.string().trim().max(240).default("Completed"),
});

const generateSchema = z.object({ action: z.literal("generate_token") });

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Companion-Version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}

function unlocked(request: NextRequest) {
  return verifySalesNavSetupKey(request.cookies.get(SALESNAV_SETUP_COOKIE)?.value || "");
}

function bearer(request: NextRequest) {
  const value = request.headers.get("authorization") || "";
  return value.replace(/^Bearer\s+/i, "").trim();
}

function versionAtLeast(version: string, minimum: string) {
  const parse = (value: string) => String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) || [];
  const current = parse(version);
  const required = parse(minimum);
  if (current.length !== 3 || required.length !== 3) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > required[index]) return true;
    if (current[index] < required[index]) return false;
  }
  return true;
}

function validSalesNavSource(raw: string) {
  try {
    const source = new URL(raw);
    const host = source.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "linkedin.com" || host.endsWith(".linkedin.com"))
      && /^\/sales\/search\/people\/?$/i.test(source.pathname);
  } catch {
    return false;
  }
}

function uniqueCleanLeads(leads: z.infer<typeof leadSchema>[], limit: number) {
  const unique = new Map<string, z.infer<typeof leadSchema>>();
  for (const lead of leads) {
    if (lead.connectionDegree.toLowerCase() === "1st") continue;
    const key = lead.salesLeadUrl || lead.linkedinUrl || `${lead.name.toLowerCase()}:${lead.company.toLowerCase()}`;
    if (!key || unique.has(key)) continue;
    unique.set(key, lead);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  const status = await companionStatus();
  const token = bearer(request);
  if (token) {
    const ok = await verifyCompanionToken(token);
    if (!ok) return NextResponse.json({ ok: false, paired: status.paired }, { status: 401, headers: corsHeaders() });
    await touchCompanionToken();
    return NextResponse.json({
      ok: true,
      paired: true,
      minimumClientVersion: MIN_CLIENT_VERSION,
      fullRunMinimumClientVersion: FULL_RUN_MIN_CLIENT_VERSION,
    }, { headers: corsHeaders() });
  }

  const isUnlocked = unlocked(request);
  const [latest, fullRun] = isUnlocked
    ? await Promise.all([getLatestCompanionBatch(), getLatestCompanionFullRun()])
    : [null, null];
  return NextResponse.json({
    ok: true,
    paired: status.paired,
    createdAt: status.createdAt,
    lastUsedAt: status.lastUsedAt,
    unlocked: isUnlocked,
    signalHireConfigured: Boolean(process.env.SIGNALHIRE_API_KEY),
    minimumClientVersion: MIN_CLIENT_VERSION,
    fullRunMinimumClientVersion: FULL_RUN_MIN_CLIENT_VERSION,
    latestBatch: latest,
    latestFullRun: fullRun ? {
      id: fullRun.id,
      startedAt: fullRun.startedAt,
      updatedAt: fullRun.updatedAt,
      completedAt: fullRun.completedAt,
      complete: fullRun.complete,
      stopReason: fullRun.stopReason,
      sourceUrl: fullRun.sourceUrl,
      pagesRead: fullRun.pagesRead,
      total: fullRun.leads.length,
      clientVersion: fullRun.clientVersion,
      parserVersion: fullRun.parserVersion,
    } : null,
  }, { headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const generate = generateSchema.safeParse(body);
  if (generate.success) {
    if (!unlocked(request)) {
      return NextResponse.json({ error: "Unlock Sales Nav admin settings first." }, { status: 401, headers: corsHeaders() });
    }
    const token = await generateCompanionToken();
    await clearLinkedInSession();
    return NextResponse.json({
      ok: true,
      token,
      oldVpsSessionCleared: true,
      message: "Pairing token generated. The old VPS LinkedIn session was removed. Save this token in the Chrome Companion.",
    }, { headers: corsHeaders() });
  }

  const token = bearer(request);
  if (!await verifyCompanionToken(token)) {
    return NextResponse.json({ error: "Invalid or expired companion pairing token." }, { status: 401, headers: corsHeaders() });
  }

  const fullRunPage = fullRunPageSchema.safeParse(body);
  if (fullRunPage.success) {
    if (!versionAtLeast(fullRunPage.data.clientVersion, FULL_RUN_MIN_CLIENT_VERSION)) {
      return NextResponse.json({
        error: `Update the Chrome Companion to v${FULL_RUN_MIN_CLIENT_VERSION} or newer for full-search capture.`,
        minimumClientVersion: FULL_RUN_MIN_CLIENT_VERSION,
      }, { status: 426, headers: corsHeaders() });
    }
    if (!validSalesNavSource(fullRunPage.data.sourceUrl)) {
      return NextResponse.json({ error: "Only LinkedIn Sales Navigator People Search pages can be captured." }, { status: 400, headers: corsHeaders() });
    }
    const leads = uniqueCleanLeads(fullRunPage.data.leads, 25);
    const run = await saveCompanionFullRunPage({
      id: fullRunPage.data.runId,
      sourceUrl: fullRunPage.data.sourceUrl,
      searchFingerprint: fullRunPage.data.searchFingerprint,
      pageNumber: fullRunPage.data.pageNumber,
      clientVersion: fullRunPage.data.clientVersion,
      parserVersion: fullRunPage.data.parserVersion,
      leads,
    });
    await touchCompanionToken();
    return NextResponse.json({
      ok: true,
      runId: run.id,
      pageNumber: fullRunPage.data.pageNumber,
      accepted: leads.length,
      pagesRead: run.pagesRead,
      total: run.leads.length,
      complete: run.complete,
    }, { headers: corsHeaders() });
  }

  const fullRunFinish = fullRunFinishSchema.safeParse(body);
  if (fullRunFinish.success) {
    const run = await finishCompanionFullRun(fullRunFinish.data.runId, fullRunFinish.data.stopReason);
    if (!run) {
      return NextResponse.json({ error: "Full-search run was not found or was replaced by a newer run." }, { status: 404, headers: corsHeaders() });
    }
    await touchCompanionToken();
    return NextResponse.json({
      ok: true,
      runId: run.id,
      pagesRead: run.pagesRead,
      total: run.leads.length,
      complete: run.complete,
      stopReason: run.stopReason,
    }, { headers: corsHeaders() });
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Sales Nav companion payload." }, { status: 400, headers: corsHeaders() });
  }

  if (!versionAtLeast(parsed.data.clientVersion, MIN_CLIENT_VERSION)) {
    return NextResponse.json({
      error: `Update the Chrome Companion to v${MIN_CLIENT_VERSION} or newer before importing. Older parsers can misread company and profile fields.`,
      minimumClientVersion: MIN_CLIENT_VERSION,
    }, { status: 426, headers: corsHeaders() });
  }

  if (!validSalesNavSource(parsed.data.sourceUrl)) {
    return NextResponse.json({ error: "Only LinkedIn Sales Navigator People Search pages can be imported." }, { status: 400, headers: corsHeaders() });
  }

  const leads = uniqueCleanLeads(parsed.data.leads, 50);
  if (!leads.length) {
    return NextResponse.json({ error: "All extracted people were 1st-degree or duplicates." }, { status: 422, headers: corsHeaders() });
  }

  const batch = {
    id: randomUUID(),
    importedAt: new Date().toISOString(),
    sourceUrl: parsed.data.sourceUrl,
    pagesRead: parsed.data.pagesRead,
    clientVersion: parsed.data.clientVersion,
    parserVersion: parsed.data.parserVersion,
    leads,
  };
  await saveCompanionBatch(batch);

  // Quick 25/50 extracts now enter the same persistent history as full-search runs.
  // This keeps every Companion action in one queue and prevents the legacy viewer
  // from becoming a second destination for leads.
  const quickRunId = randomUUID();
  const quickRun = await saveCompanionFullRunPage({
    id: quickRunId,
    sourceUrl: parsed.data.sourceUrl,
    searchFingerprint: parsed.data.sourceUrl,
    pageNumber: Math.max(1, parsed.data.pagesRead),
    clientVersion: parsed.data.clientVersion,
    parserVersion: parsed.data.parserVersion,
    leads,
  });
  const persistedRun = await finishCompanionFullRun(quickRunId, `Quick extract · ${parsed.data.pagesRead} page${parsed.data.pagesRead === 1 ? "" : "s"}`);
  await touchCompanionToken();

  const companyParsed = leads.filter((lead) => Boolean(lead.company)).length;
  const directLinkedIn = leads.filter((lead) => Boolean(lead.linkedinUrl)).length;
  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    runId: (persistedRun || quickRun).id,
    persistentQueue: true,
    imported: leads.length,
    clientVersion: batch.clientVersion,
    parserVersion: batch.parserVersion,
    diagnostics: { companyParsed, directLinkedIn },
  }, { headers: corsHeaders() });
}
