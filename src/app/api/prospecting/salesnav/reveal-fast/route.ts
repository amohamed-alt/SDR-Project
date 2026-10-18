import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as resolveCompanion } from "@/app/api/prospecting/resolve-companion/route";
import { POST as hubspotPrecheckV2 } from "@/app/api/prospecting/salesnav/precheck-v2/route";
import { lookupSalesNavLead, reserveSalesNavReveal, salesNavRevealStatus, saveSalesNavReveal } from "@/lib/salesnav-lead-ledger";
import { normalizePersonUrl } from "@/lib/ai-sdr-qualification";
import { cachedSalesNavIdentityMismatch, salesNavNameMismatch } from "@/lib/salesnav-identity";

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
    freshCompanyEngagement: true,
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
    const publicProfile = normalizePersonUrl(lead.linkedinUrl);
    if (lead.linkedinUrl && !publicProfile) return NextResponse.json({ error: "Invalid public LinkedIn profile URL. Clear it to use name + company search.", creditUsed: false }, { status: 422 });
    if (!publicProfile && !lead.company) return NextResponse.json({ error: "Company is required for name + company search. No contact credits were used.", creditUsed: false }, { status: 422 });
    lead.linkedinUrl = publicProfile;

    const previous = await lookupSalesNavLead(lead);
    if (previous?.revealAttemptedAt) {
      const mismatch = (publicProfile ? cachedSalesNavIdentityMismatch(publicProfile, previous) : "")
        || (previous.cachedProspect ? salesNavNameMismatch(lead, previous.cachedProspect) : "");
      if (mismatch) return NextResponse.json({ error: mismatch, creditUsed: false }, { status: 409 });
    }
    const reservation = await reserveSalesNavReveal({ identity: lead, runId });
    const cached = reservation.record;
    if (cached) {
      const mismatch = (publicProfile ? cachedSalesNavIdentityMismatch(publicProfile, cached) : "") || (cached.cachedProspect ? salesNavNameMismatch(lead, cached.cachedProspect) : "");
      if (mismatch) return NextResponse.json({ error: mismatch, creditUsed: false }, { status: 409 });
    }
    if (!reservation.reserved && cached) {
      const status = salesNavRevealStatus(cached);
      if (cached.cachedProspect) {
        const prospect = cached.cachedProspect as JsonObject;
        const check = await postRevealCheck(request, lead, prospect);
        return NextResponse.json({ ok: true, cached: true, creditUsed: false, prospect, hasPhone: hasPhone(prospect), postRevealCheck: check,
          message: "Reused a previous SignalHire reveal — 0 new Contact Credits." }, { headers: { "Cache-Control": "no-store" } });
      }
      if (status === "no-result") return NextResponse.json({ ok: true, cached: true, creditUsed: false, prospect: null, hasPhone: false,
        message: "SignalHire completed this reveal without usable contacts. No repeat credit spend." }, { headers: { "Cache-Control": "no-store" } });
      return NextResponse.json({ error: cached.revealError || (status === "pending" ? "This reveal is already in progress. Reload its saved result shortly; another paid request was not sent." : "The previous provider response is uncertain. Review the attempt before another paid request; contact credits may have been used."), revealStatus: status, creditUsed: false }, { status: 409 });
    }

    if (!reservation.reserved) throw new Error("Reveal could not be reserved safely. No provider request was sent.");

    try {
      const preflight = await postRevealCheck(request, lead, {});
      const contact = preflight.contact as JsonObject | undefined;
      const company = preflight.company as JsonObject | undefined;
      if (contact?.inHubSpot || company?.protected) {
        const message = String(company?.protectedReason || "This person is no longer eligible for a paid reveal.");
        await saveSalesNavReveal({ identity: lead, runId, status: "retryable", error: message });
        return NextResponse.json({ error: message, postRevealCheck: preflight, creditUsed: false, revealStatus: "retryable" }, { status: 409 });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "HubSpot eligibility could not be verified.";
      await saveSalesNavReveal({ identity: lead, runId, status: "retryable", error: message });
      return NextResponse.json({ error: message, creditUsed: false, revealStatus: "retryable" }, { status: 503 });
    }

    let revealResponse: Response;
    let revealPayload: JsonObject;
    try {
      revealResponse = await resolveCompanion(requestLike(request, "/api/prospecting/resolve-companion", {
        linkedinUrl: lead.linkedinUrl, name: lead.name, company: lead.company, title: lead.title,
        location: lead.location, source: "Sales Nav Full Search",
      }));
      revealPayload = await jsonFrom(revealResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider response was interrupted.";
      await saveSalesNavReveal({ identity: lead, runId, status: "uncertain", error: message });
      return NextResponse.json({ error: `${message} Review this attempt before retrying; provider acceptance is unknown.`, revealStatus: "uncertain" }, { status: 502 });
    }
    if (!revealResponse.ok || !revealPayload.prospect) {
      const message = String(revealPayload.error || "SignalHire could not reveal this lead.");
      const status = revealPayload.definitiveNoResult === true ? "no-result" : revealPayload.creditUsed === false ? "retryable" : "uncertain";
      await saveSalesNavReveal({ identity: lead, runId, status, error: message });
      return NextResponse.json({ error: message, revealStatus: status, creditUsed: revealPayload.creditUsed ?? null }, { status: revealResponse.ok ? 502 : revealResponse.status });
    }

    // Keep the reveal critical path focused on contact data. ATS/career/hiring research
    // used to run synchronously here and was the main source of long waits. It can be
    // enriched later during downstream company workflows; phone/email are available now.
    const prospect = revealPayload.prospect as JsonObject;
    const nameMismatch = salesNavNameMismatch(lead, prospect) || (publicProfile ? cachedSalesNavIdentityMismatch(publicProfile, { linkedinUrl: String(prospect.linkedinUrl || "") }) : "");
    if (nameMismatch) {
      await saveSalesNavReveal({ identity: lead, runId, status: "uncertain", error: nameMismatch });
      return NextResponse.json({ error: nameMismatch, creditUsed: true, revealStatus: "uncertain" }, { status: 409 });
    }
    await saveSalesNavReveal({ identity: lead, prospect, runId, status: "completed", error: "" });
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

