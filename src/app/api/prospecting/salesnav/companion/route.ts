import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SALESNAV_SETUP_COOKIE, clearLinkedInSession, verifySalesNavSetupKey } from "@/lib/salesnav-session";
import {
  companionStatus,
  generateCompanionToken,
  getLatestCompanionBatch,
  saveCompanionBatch,
  touchCompanionToken,
  verifyCompanionToken,
} from "@/lib/salesnav-companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_CLIENT_VERSION = "1.2.0";

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

function supportedClient(version: string) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > 1 || (major === 1 && minor >= 2);
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
    return NextResponse.json({ ok: true, paired: true, minimumClientVersion: MIN_CLIENT_VERSION }, { headers: corsHeaders() });
  }

  const isUnlocked = unlocked(request);
  const latest = isUnlocked ? await getLatestCompanionBatch() : null;
  return NextResponse.json({
    ok: true,
    paired: status.paired,
    createdAt: status.createdAt,
    lastUsedAt: status.lastUsedAt,
    unlocked: isUnlocked,
    signalHireConfigured: Boolean(process.env.SIGNALHIRE_API_KEY),
    minimumClientVersion: MIN_CLIENT_VERSION,
    latestBatch: latest,
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

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Sales Nav companion payload." }, { status: 400, headers: corsHeaders() });
  }

  const token = bearer(request);
  if (!await verifyCompanionToken(token)) {
    return NextResponse.json({ error: "Invalid or expired companion pairing token." }, { status: 401, headers: corsHeaders() });
  }

  if (!supportedClient(parsed.data.clientVersion)) {
    return NextResponse.json({
      error: `Update the Chrome Companion to v${MIN_CLIENT_VERSION} or newer before importing. Older parsers can misread company and profile fields.`,
      minimumClientVersion: MIN_CLIENT_VERSION,
    }, { status: 426, headers: corsHeaders() });
  }

  const source = new URL(parsed.data.sourceUrl);
  const host = source.hostname.toLowerCase().replace(/^www\./, "");
  if ((host !== "linkedin.com" && !host.endsWith(".linkedin.com")) || !/^\/sales\/search\/people\/?$/i.test(source.pathname)) {
    return NextResponse.json({ error: "Only LinkedIn Sales Navigator People Search pages can be imported." }, { status: 400, headers: corsHeaders() });
  }

  const unique = new Map<string, z.infer<typeof leadSchema>>();
  for (const lead of parsed.data.leads) {
    const degree = lead.connectionDegree.toLowerCase();
    if (degree === "1st") continue;
    const key = lead.salesLeadUrl || lead.linkedinUrl || `${lead.name.toLowerCase()}:${lead.company.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, lead);
  }
  const leads = [...unique.values()].slice(0, 50);
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
  await touchCompanionToken();

  const companyParsed = leads.filter((lead) => Boolean(lead.company)).length;
  const directLinkedIn = leads.filter((lead) => Boolean(lead.linkedinUrl)).length;
  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    imported: leads.length,
    clientVersion: batch.clientVersion,
    parserVersion: batch.parserVersion,
    diagnostics: { companyParsed, directLinkedIn },
  }, { headers: corsHeaders() });
}
