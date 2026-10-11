import { normalizedCompanyName } from "@/lib/company-dedupe";
import { salesNavLeadId } from "@/lib/salesnav-identity";
import { claimOperation, checkpointOperation, operationFingerprint, type Operation } from "@/lib/salesnav-operations";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
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
    connectionDegree: z.string().max(20).default(""),
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
  let operation: Operation | undefined;
  try {
    if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Unlock SDR admin access before revealing." }, { status: 401 });
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Sales Nav reveal payload." }, { status: 400 });
    const { lead, runId } = parsed.data;
    const leadId = salesNavLeadId(lead);
    if (!leadId) return NextResponse.json({ error: "ID_WEAK: verify this person's LinkedIn identity before spending." }, { status: 422 });
    if (lead.connectionDegree.toLowerCase() === "1st") return NextResponse.json({ error: "DEGREE_1ST: captured but excluded before spending." }, { status: 409 });

    const beforeReveal = await postRevealCheck(request, lead, {});
    const contact = beforeReveal.contact as JsonObject | undefined;
    const company = beforeReveal.company as JsonObject | undefined;
    if (contact?.inHubSpot || company?.protected) return NextResponse.json({ error: String(company?.protectedReason || "Existing HubSpot person — reveal blocked before spending credits."), postRevealCheck: beforeReveal }, { status: 409 });

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
      return NextResponse.json({ error: "REVEAL_UNKNOWN: previous attempt has no saved result. Reconcile before another paid call.", creditUsed: null }, { status: 409 });
    }

    const key = `reveal:${leadId}`;
    const claim = await claimOperation(key, "reveal", key, operationFingerprint(leadId));
    if (!claim.claimed || !claim.lease) {
      const prospect = claim.result.prospect as JsonObject | undefined;
      if (claim.state === "completed" && prospect && !claim.result.identityReview) {
        return NextResponse.json({ ok: true, cached: true, creditUsed: false, prospect, hasPhone: hasPhone(prospect), postRevealCheck: await postRevealCheck(request, lead, prospect) });
      }
      return NextResponse.json({ error: `REVEAL_${claim.state.toUpperCase()}: reconcile or wait before another paid call.`, creditUsed: null }, { status: 409 });
    }
    operation = { key, lease: claim.lease, result: claim.result };
    // This durable marker precedes every call; timeout/crash cannot silently repeat spend.
    await checkpointOperation(operation, { pending: "provider", creditOutcome: "unknown", runId });
    const revealResponse = await resolveCompanion(requestLike(request, "/api/prospecting/resolve-companion", {
      linkedinUrl: lead.linkedinUrl, name: lead.name, company: lead.company,
      title: lead.title, location: lead.location, source: "Sales Nav Full Search",
    }));
    const revealPayload = await jsonFrom(revealResponse);
    if (!revealResponse.ok || !revealPayload.prospect) {
      const sent = revealPayload.paidRequestSent !== false;
      await checkpointOperation(operation, {
        pending: sent ? "provider" : "", creditOutcome: sent ? "unknown" : "not_sent",
        error: String(revealPayload.error || "No contact result"),
      }, "review");
      return NextResponse.json({ error: String(revealPayload.error || "Provider could not reveal this lead."), reasonCode: sent ? "REVEAL_UNKNOWN" : "REVEAL_RETRYABLE", creditUsed: sent ? null : false }, { status: revealResponse.status || 502 });
    }

    // Keep the reveal critical path focused on contact data. ATS/career/hiring research
    // used to run synchronously here and was the main source of long waits. It can be
    // enriched later during downstream company workflows; phone/email are available now.
    const prospect = revealPayload.prospect as JsonObject;
    // Preserve the paid result even when its current company has changed; do not spend again.
    if (normalizedCompanyName(String(prospect.company || lead.company)) !== normalizedCompanyName(lead.company)) {
      await checkpointOperation(operation, { pending: "", prospect, creditOutcome: "unknown", identityReview: true }, "completed");
      return NextResponse.json({ error: "PERSON_COMPANY_CHANGED: paid result saved; verify current company before push.", creditUsed: null }, { status: 409 });
    }
    await checkpointOperation(operation, { pending: "", prospect, creditOutcome: "unknown", providerMeta: revealPayload.meta || {} }, "completed");
    await saveSalesNavReveal({ identity: lead, prospect, runId, attempted: true });
    const check = await postRevealCheck(request, lead, prospect);

    return NextResponse.json({
      ok: true,
      cached: false,
      creditUsed: null,
      creditOutcome: "unknown",
      prospect,
      hasPhone: hasPhone(prospect),
      postRevealCheck: check,
      intelligenceDeferred: true,
      message: "SignalHire contact reveal completed. HubSpot was rechecked immediately; ATS/career research no longer blocks reveal speed.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (operation) await checkpointOperation(operation, { error: error instanceof Error ? error.message : "Reveal interrupted" }, "review").catch(() => undefined);
    console.error("Fast Sales Nav reveal failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav reveal failed." }, { status: 500 });
  }
}
