import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as resolveCompanion } from "@/app/api/prospecting/resolve-companion/route";
import { POST as hubspotPrecheckV2 } from "@/app/api/prospecting/salesnav/precheck-v2/route";
import { lookupSalesNavLead, saveSalesNavReveal } from "@/lib/salesnav-lead-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().trim().max(120).default(""),
  lead: z.object({
    name: z.string().trim().min(1).max(220),
    title: z.string().trim().max(320).default(""),
    company: z.string().trim().max(320).default(""),
    location: z.string().trim().max(320).default(""),
    linkedinUrl: z.string().trim().max(1500).default(""),
    salesLeadUrl: z.string().trim().max(2000).default(""),
  }),
});

type JsonObject = Record<string, unknown>;

async function jsonFrom(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {} as JsonObject;
  try { return JSON.parse(text) as JsonObject; }
  catch { throw new Error(`Upstream returned non-JSON: ${text.slice(0, 180)}`); }
}

function requestLike(base: NextRequest, pathname: string, body: unknown) {
  return new NextRequest(new URL(pathname, base.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function hasPhone(prospect: JsonObject) {
  const primary = String(prospect.phone || "").trim();
  const phones = Array.isArray(prospect.phones) ? prospect.phones.map(String).map((value) => value.trim()).filter(Boolean) : [];
  return Boolean(primary || phones.length);
}

async function postRevealCheck(request: NextRequest, lead: z.infer<typeof schema>["lead"], prospect: JsonObject) {
  const response = await hubspotPrecheckV2(requestLike(request, "/api/prospecting/salesnav/precheck-v2", {
    name: prospect.fullName || lead.name,
    company: prospect.company || lead.company,
    companyWebsite: prospect.companyWebsite || "",
    companyDomain: prospect.companyDomain || "",
    linkedinUrl: prospect.linkedinUrl || lead.linkedinUrl,
    email: prospect.email || "",
    emails: prospect.emails || [],
    phone: prospect.phone || "",
    phones: prospect.phones || [],
  }));
  const payload = await jsonFrom(response);
  if (!response.ok) throw new Error(String(payload.error || "HubSpot post-reveal check failed."));
  return payload;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Sales Nav reveal payload." }, { status: 400 });
    const { lead, runId } = parsed.data;

    const cached = await lookupSalesNavLead(lead);
    if (cached?.revealAttemptedAt) {
      if (cached.cachedProspect) {
        const prospect = cached.cachedProspect as JsonObject;
        const check = await postRevealCheck(request, lead, prospect);
        return NextResponse.json({
          ok: true,
          cached: true,
          creditUsed: false,
          prospect,
          hasPhone: hasPhone(prospect),
          postRevealCheck: check,
          message: "Reused a previous SignalHire reveal — 0 new Contact Credits.",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json({
        ok: true,
        cached: true,
        creditUsed: false,
        prospect: null,
        hasPhone: false,
        message: "Previously revealed with no usable contact result; repeat credit spend is blocked.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    // Mark first-time reveal before contacting SignalHire so accidental retries cannot
    // spend another credit if the browser times out after the provider accepted it.
    await saveSalesNavReveal({ identity: lead, runId, attempted: true });

    const revealResponse = await resolveCompanion(requestLike(request, "/api/prospecting/resolve-companion", {
      linkedinUrl: lead.linkedinUrl,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      location: lead.location,
      source: "Sales Nav Full Search",
    }));
    const revealPayload = await jsonFrom(revealResponse);
    if (!revealResponse.ok || !revealPayload.prospect) {
      return NextResponse.json({
        error: String(revealPayload.error || "SignalHire could not reveal this lead."),
        creditUsed: true,
      }, { status: revealResponse.status || 502 });
    }

    // Keep the reveal critical path focused on contact data. ATS/career/hiring research
    // used to run synchronously here and was the main source of long waits. It can be
    // enriched later during downstream company workflows; phone/email are available now.
    const prospect = revealPayload.prospect as JsonObject;
    await saveSalesNavReveal({ identity: lead, prospect, runId, attempted: true });
    const check = await postRevealCheck(request, lead, prospect);

    return NextResponse.json({
      ok: true,
      cached: false,
      creditUsed: true,
      prospect,
      hasPhone: hasPhone(prospect),
      postRevealCheck: check,
      intelligenceDeferred: true,
      message: "SignalHire contact reveal completed. HubSpot was rechecked immediately; ATS/career research no longer blocks reveal speed.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Fast Sales Nav reveal failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav reveal failed." }, { status: 500 });
  }
}
