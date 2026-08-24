import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { companionStatus, touchCompanionToken, verifyCompanionToken } from "@/lib/salesnav-companion";
import { getLatestSignalHireCompanionBatch, saveSignalHireCompanionBatch } from "@/lib/signalhire-companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_CLIENT_VERSION = "1.3.0";

const leadSchema = z.object({
  name: z.string().trim().min(1).max(220),
  title: z.string().trim().max(320).default(""),
  company: z.string().trim().max(320).default(""),
  location: z.string().trim().max(320).default(""),
  linkedinUrl: z.string().trim().max(1500).default(""),
  signalHireProfileUrl: z.string().trim().max(1500).default(""),
  email: z.string().trim().max(320).default(""),
  emails: z.array(z.string().trim().max(320)).max(20).default([]),
  phone: z.string().trim().max(120).default(""),
  phones: z.array(z.string().trim().max(120)).max(20).default([]),
  rawText: z.string().trim().max(3000).optional(),
});

const importSchema = z.object({
  action: z.literal("import"),
  sourceUrl: z.string().trim().url().max(6000),
  listName: z.string().trim().max(180).default("SignalHire Lead List"),
  clientVersion: z.string().trim().max(30).default(""),
  parserVersion: z.string().trim().max(60).default(""),
  leads: z.array(leadSchema).min(1).max(100),
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Companion-Version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}

function bearer(request: NextRequest) {
  return String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function supportedClient(version: string) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > 1 || (major === 1 && minor >= 3);
}

function normalizedLinkedIn(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if ((host !== "linkedin.com" && !host.endsWith(".linkedin.com")) || !/^\/in\//i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const status = await companionStatus();
  return NextResponse.json({
    ok: true,
    paired: status.paired,
    createdAt: status.createdAt,
    lastUsedAt: status.lastUsedAt,
    signalHireConfigured: Boolean(process.env.SIGNALHIRE_API_KEY),
    minimumClientVersion: MIN_CLIENT_VERSION,
    latestBatch: await getLatestSignalHireCompanionBatch(),
  }, { headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  const token = bearer(request);
  if (!await verifyCompanionToken(token)) {
    return NextResponse.json({ error: "Invalid or expired companion pairing token." }, { status: 401, headers: corsHeaders() });
  }

  const parsed = importSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SignalHire lead-list payload." }, { status: 400, headers: corsHeaders() });
  }

  if (!supportedClient(parsed.data.clientVersion)) {
    return NextResponse.json({
      error: `Update the Talentera Prospecting Companion to v${MIN_CLIENT_VERSION} or newer.`,
      minimumClientVersion: MIN_CLIENT_VERSION,
    }, { status: 426, headers: corsHeaders() });
  }

  const source = new URL(parsed.data.sourceUrl);
  const host = source.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "signalhire.com" && !host.endsWith(".signalhire.com")) {
    return NextResponse.json({ error: "Only SignalHire pages can be imported into the SignalHire queue." }, { status: 400, headers: corsHeaders() });
  }

  const unique = new Map<string, z.infer<typeof leadSchema>>();
  for (const raw of parsed.data.leads) {
    const lead = {
      ...raw,
      linkedinUrl: normalizedLinkedIn(raw.linkedinUrl),
      emails: [...new Set([raw.email, ...raw.emails].map((value) => value.trim().toLowerCase()).filter(Boolean))],
      phones: [...new Set([raw.phone, ...raw.phones].map((value) => value.trim()).filter(Boolean))],
    };
    const key = lead.linkedinUrl || lead.email.toLowerCase() || lead.signalHireProfileUrl || `${lead.name.toLowerCase()}:${lead.company.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, lead);
  }

  const leads = [...unique.values()].slice(0, 100);
  const batch = {
    id: randomUUID(),
    importedAt: new Date().toISOString(),
    sourceUrl: parsed.data.sourceUrl,
    listName: parsed.data.listName || "SignalHire Lead List",
    clientVersion: parsed.data.clientVersion,
    parserVersion: parsed.data.parserVersion,
    leads,
  };

  await saveSignalHireCompanionBatch(batch);
  await touchCompanionToken();

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    imported: batch.leads.length,
    listName: batch.listName,
    diagnostics: {
      linkedin: leads.filter((lead) => Boolean(lead.linkedinUrl)).length,
      email: leads.filter((lead) => Boolean(lead.email || lead.emails.length)).length,
      phone: leads.filter((lead) => Boolean(lead.phone || lead.phones.length)).length,
      company: leads.filter((lead) => Boolean(lead.company)).length,
    },
  }, { headers: corsHeaders() });
}
