import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as crmPrecheck } from "@/app/api/prospecting/salesnav/precheck-v2/route";
import { POST as existingPush } from "@/app/api/prospecting/salesnav/push-ready-v2/route";
import { assessAiSdrLead, normalizePersonUrl, type AiCrmCheck, type AiLead } from "@/lib/ai-sdr-qualification";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { originMatchesRequestHosts } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().trim().max(120).default(""),
  taskDueAt: z.string().trim().max(100),
  lead: z.object({
    name: z.string().trim().min(2).max(220),
    title: z.string().trim().max(320),
    company: z.string().trim().min(2).max(320),
    location: z.string().trim().max(320),
    companyCountry: z.string().trim().max(100),
    companyDomain: z.string().trim().max(320),
    employeeCount: z.number().int().nonnegative().nullable(),
    linkedinUrl: z.string().trim().min(1).max(1500),
    salesLeadUrl: z.string().trim().max(2000),
    detectedAts: z.string().trim().max(120),
    atsStatus: z.enum(["unknown", "verified_with_ats", "verified_no_ats"]),
    atsEvidence: z.string().trim().max(1000),
    sector: z.string().trim().max(120),
  }),
  prospect: z.record(z.string(), z.unknown()),
});

type ApiReply = Record<string, unknown>;

async function parseReply(response: Response): Promise<ApiReply> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as ApiReply : {};
}

function makeInternalRequest(request: NextRequest, path: string, payload: unknown) {
  return new NextRequest(new URL(path, request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function phoneAvailable(prospect: Record<string, unknown>) {
  return Boolean(String(prospect.phone || "").trim()
    || (Array.isArray(prospect.phones) && prospect.phones.some(p => String(p || "").trim())));
}

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Admin authorization required." }, { status: 401 });
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((site && !["same-origin", "same-site", "none"].includes(site))
    || !originMatchesRequestHosts({
      origin,
      forwardedHost: request.headers.get("x-forwarded-host"),
      host: request.headers.get("host"),
      requestHost: request.nextUrl.host,
    })) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  if (process.env.DEMO_MODE === "true") return NextResponse.json({ error: "CRM write disabled in demo mode." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 45_000) return NextResponse.json({ error: "Request too large." }, { status: 413 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid AI SDR push request." }, { status: 400 });
  const { lead, prospect, taskDueAt, runId } = parsed.data;
  if (!normalizePersonUrl(lead.linkedinUrl)) return NextResponse.json({ error: "Verified public LinkedIn person URL required." }, { status: 422 });
  if (!phoneAvailable(prospect)) return NextResponse.json({ error: "Phone required. Reveal through approved SignalHire path first." }, { status: 422 });
  const prospectProfile = normalizePersonUrl(prospect.linkedinUrl || lead.linkedinUrl);
  if (prospectProfile !== normalizePersonUrl(lead.linkedinUrl)) return NextResponse.json({ error: "Revealed profile does not match selected person." }, { status: 409 });
  if (!taskDueAt || !Number.isFinite(Date.parse(taskDueAt)) || Date.parse(taskDueAt) < Date.now() - 120_000) {
    return NextResponse.json({ error: "Choose a future task date." }, { status: 422 });
  }
  const currentCompany = String(prospect.company || lead.company).trim().toLowerCase();
  if (currentCompany !== lead.company.trim().toLowerCase()) return NextResponse.json({ error: "Revealed company differs from selected company. Review manually." }, { status: 409 });

  const checkResponse = await crmPrecheck(makeInternalRequest(request, "/api/prospecting/salesnav/precheck-v2", {
    name: lead.name,
    company: lead.company,
    companyDomain: String(prospect.companyDomain || lead.companyDomain),
    companyWebsite: String(prospect.companyWebsite || ""),
    linkedinUrl: lead.linkedinUrl,
    email: String(prospect.email || ""),
    emails: Array.isArray(prospect.emails) ? prospect.emails : [],
    phone: String(prospect.phone || ""),
    phones: Array.isArray(prospect.phones) ? prospect.phones : [],
  }));
  const checked = await parseReply(checkResponse);
  if (!checkResponse.ok) return NextResponse.json({ error: String(checked.error || "HubSpot recheck failed.") }, { status: 502 });

  const verdict = assessAiSdrLead(lead as AiLead, checked as unknown as AiCrmCheck);
  if (verdict.status !== "eligible") return NextResponse.json({ error: verdict.reason, policyStatus: verdict.status }, { status: 409 });

  // The legacy Ready route performs a second server-side CRM recheck and is
  // responsible for idempotent contact creation, task creation and ledger writes.
  const result = await existingPush(makeInternalRequest(request, "/api/prospecting/salesnav/push-ready-v2", {
    runId,
    taskOwnerId: verdict.ownerId,
    taskDueAt,
    lead: {
      name: lead.name, title: lead.title, company: lead.company,
      location: lead.location, linkedinUrl: lead.linkedinUrl, salesLeadUrl: lead.salesLeadUrl,
    },
    prospect: { ...prospect, linkedinUrl: lead.linkedinUrl, company: lead.company },
  }));
  const answer = await parseReply(result);
  return NextResponse.json(result.ok
    ? { ...answer, aiSdrGate: "passed", aiSdrRoutedTo: verdict.ownerName }
    : answer,
    { status: result.status, headers: { "Cache-Control": "no-store" } });
}
