import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as resolveCompanion } from "@/app/api/prospecting/resolve-companion/route";
import { POST as enrichIntelligence } from "@/app/api/prospecting/intelligence/route";
import { POST as hubspotPrecheck } from "@/app/api/prospecting/signalhire/precheck/route";
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

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Sales Nav reveal payload." }, { status: 400 });
    const { lead, runId } = parsed.data;

    const cached = await lookupSalesNavLead(lead);
    if (cached?.revealAttemptedAt) {
      if (cached.cachedProspect) {
        const cachedProspect: JsonObject = cached.cachedProspect;
        const precheckResponse = await hubspotPrecheck(requestLike(request, "/api/prospecting/signalhire/precheck", {
          name: cachedProspect.fullName || lead.name,
          company: cachedProspect.company || lead.company,
          companyWebsite: cachedProspect.companyWebsite || "",
          companyDomain: cachedProspect.companyDomain || "",
          linkedinUrl: cachedProspect.linkedinUrl || lead.linkedinUrl,
          email: cachedProspect.email || "",
          emails: cachedProspect.emails || [],
          phone: cachedProspect.phone || "",
          phones: cachedProspect.phones || [],
        }));
        const postRevealCheck = await jsonFrom(precheckResponse);
        return NextResponse.json({
          ok: true,
          cached: true,
          creditUsed: false,
          prospect: cachedProspect,
          hasPhone: hasPhone(cachedProspect),
          postRevealCheck,
          message: "Reused a previously revealed SignalHire record; no new contact credit was requested.",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json({
        ok: true,
        cached: true,
        creditUsed: false,
        prospect: null,
        hasPhone: false,
        message: "This lead was already revealed previously but no usable contact record was returned. A second reveal was intentionally blocked to protect credits.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

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

    const baseProspect = revealPayload.prospect as JsonObject;
    const intelResponse = await enrichIntelligence(requestLike(request, "/api/prospecting/intelligence", {
      linkedinUrl: baseProspect.linkedinUrl || "",
      company: baseProspect.company || lead.company,
      companyWebsite: baseProspect.companyWebsite || "",
      companyDomain: baseProspect.companyDomain || "",
      email: baseProspect.email || "",
      emails: baseProspect.emails || [],
      score: baseProspect.score || 0,
      scoreReasons: baseProspect.scoreReasons || [],
    }));
    const intelPayload = await jsonFrom(intelResponse);
    const prospect: JsonObject = {
      ...baseProspect,
      ...(intelResponse.ok && intelPayload.patch && typeof intelPayload.patch === "object" ? intelPayload.patch as JsonObject : {}),
      source: "Sales Nav Full Search",
    };

    await saveSalesNavReveal({ identity: lead, prospect, runId, attempted: true });

    const precheckResponse = await hubspotPrecheck(requestLike(request, "/api/prospecting/signalhire/precheck", {
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
    const postRevealCheck = await jsonFrom(precheckResponse);

    return NextResponse.json({
      ok: true,
      cached: false,
      creditUsed: true,
      prospect,
      hasPhone: hasPhone(prospect),
      postRevealCheck,
      message: "SignalHire reveal completed and HubSpot was checked again using the revealed identifiers.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sales Nav reveal failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav reveal failed." }, { status: 500 });
  }
}
