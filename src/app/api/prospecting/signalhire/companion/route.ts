import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { companionStatus, touchCompanionToken, verifyCompanionToken } from "@/lib/salesnav-companion";
import { getLatestSignalHireCompanionBatch, saveSignalHireCompanionBatch } from "@/lib/signalhire-companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_CLIENT_VERSION = "1.4.0";
const REQUIRED_PARSER_VERSION = "signalhire-list-v2";

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
  return major > 1 || (major === 1 && minor >= 4);
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

function normalizedSignalHireProfile(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "signalhire.com" && !host.endsWith(".signalhire.com")) return "";
    const path = url.pathname.toLowerCase();
    if (/lead[-_ ]?lists?|lists?\//i.test(path)) return "";
    if (!/(?:candidate|profile|resume|people|person)/i.test(path)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function suspiciousLeadName(value: string) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!name) return true;
  if (/^(?:contact info|contact information|personal emails?|work emails?|emails?|phone numbers?|phones?|experience|employment|education|skills?|languages?|certifications?|licenses?|projects?|publications?|interests?|summary|about|show \d+ more|expert no pdf|company|lead tracker beta)$/i.test(name)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\s*[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|present|current)\b/i.test(name)) return true;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(name)) return true;
  if (/@|https?:|www\.|\+?\d{5,}/i.test(name)) return true;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length < 2 || words.length > 7;
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
    requiredParserVersion: REQUIRED_PARSER_VERSION,
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

  if (!supportedClient(parsed.data.clientVersion) || parsed.data.parserVersion !== REQUIRED_PARSER_VERSION) {
    return NextResponse.json({
      error: `Update the Talentera Prospecting Companion to v${MIN_CLIENT_VERSION} or newer before syncing SignalHire.`,
      minimumClientVersion: MIN_CLIENT_VERSION,
      requiredParserVersion: REQUIRED_PARSER_VERSION,
    }, { status: 426, headers: corsHeaders() });
  }

  const source = new URL(parsed.data.sourceUrl);
  const host = source.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "signalhire.com" && !host.endsWith(".signalhire.com")) {
    return NextResponse.json({ error: "Only SignalHire pages can be imported into the SignalHire queue." }, { status: 400, headers: corsHeaders() });
  }

  const unique = new Map<string, z.infer<typeof leadSchema>>();
  let rejected = 0;
  for (const raw of parsed.data.leads) {
    const linkedinUrl = normalizedLinkedIn(raw.linkedinUrl);
    const signalHireProfileUrl = normalizedSignalHireProfile(raw.signalHireProfileUrl);

    // Server-side identity gate: contact info, experience, education and history rows
    // are never accepted as leads even if a browser parser regresses later.
    if (suspiciousLeadName(raw.name) || (!linkedinUrl && !signalHireProfileUrl)) {
      rejected += 1;
      continue;
    }

    const emails = [...new Set([raw.email, ...raw.emails].map((value) => value.trim().toLowerCase()).filter(Boolean))];
    const phones = [...new Set([raw.phone, ...raw.phones].map((value) => value.trim()).filter(Boolean))];
    const lead = {
      ...raw,
      linkedinUrl,
      signalHireProfileUrl,
      email: emails[0] || "",
      emails,
      phone: phones[0] || "",
      phones,
    };
    const key = lead.linkedinUrl || lead.signalHireProfileUrl || lead.email.toLowerCase() || `${lead.name.toLowerCase()}:${lead.company.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, lead);
  }

  const leads = [...unique.values()].slice(0, 100);
  if (!leads.length) {
    return NextResponse.json({
      error: "No validated candidate rows were found. Open the SignalHire Lead List and sync again with the updated companion.",
      rejected,
    }, { status: 422, headers: corsHeaders() });
  }

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
    rejected,
    listName: batch.listName,
    diagnostics: {
      linkedin: leads.filter((lead) => Boolean(lead.linkedinUrl)).length,
      signalHireProfile: leads.filter((lead) => Boolean(lead.signalHireProfileUrl)).length,
      email: leads.filter((lead) => Boolean(lead.email || lead.emails.length)).length,
      phone: leads.filter((lead) => Boolean(lead.phone || lead.phones.length)).length,
      company: leads.filter((lead) => Boolean(lead.company)).length,
    },
  }, { headers: corsHeaders() });
}
