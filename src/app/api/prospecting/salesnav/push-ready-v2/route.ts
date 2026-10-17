import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as pushProspect } from "@/app/api/prospecting/push/route";
import { POST as hubspotPrecheckV2 } from "@/app/api/prospecting/salesnav/precheck-v2/route";
import { manualTaskOwners } from "@/lib/acquisition-routing";
import { saveSalesNavPush } from "@/lib/salesnav-lead-ledger";
import { salesNavNameMismatch } from "@/lib/salesnav-identity";
import { normalizePersonUrl } from "@/lib/ai-sdr-qualification";
import { checkpointSalesNavPush, SalesNavPushAttemptError, withSalesNavPushAttempt, type SalesNavPushAttempt } from "@/lib/salesnav-push-attempt";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().trim().max(120).default(""),
  taskOwnerId: z.string().trim().min(1).max(80),
  taskDueAt: z.string().trim().min(1).max(100),
  lead: z.object({
    name: z.string().trim().min(1).max(220),
    title: z.string().trim().max(320).default(""),
    company: z.string().trim().max(320).default(""),
    location: z.string().trim().max(320).default(""),
    linkedinUrl: z.string().trim().max(1500).default(""),
    salesLeadUrl: z.string().trim().max(2000).default(""),
  }),
  prospect: z.record(z.string(), z.unknown()),
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

function unique(values: unknown[]) {
  const seen = new Set<string>();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prospectPhones(prospect: JsonObject) {
  return unique([prospect.phone, ...(Array.isArray(prospect.phones) ? prospect.phones : [])]);
}

function dueIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Choose a valid task date and time.");
  return date.toISOString();
}

async function safetyCheck(request: NextRequest, lead: z.infer<typeof schema>["lead"], prospect: JsonObject) {
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
  if (!response.ok) throw new Error(String(payload.error || "HubSpot safety recheck failed."));
  return payload as {
    contact: { inHubSpot: boolean; id: string; matchedBy: string };
    company: { inHubSpot: boolean; id: string; protected: boolean; protectedReason?: string; detectedAts?: string; careerPageUrl?: string;
      gateReason?: string; accountType?: string; meetingCount?: number; connectedCallCount?: number; engagementChecked?: boolean };
  };
}

function authorized(request: NextRequest) {
  if (sdrAdminAuthorized(request)) return true;
  const expected = Buffer.from(String(process.env.ACQUISITION_OWNER_TOKEN || "").trim());
  const supplied = Buffer.from(String(request.headers.get("x-acquisition-owner-token") || "").trim());
  return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function companyStillEligibleForRecovery(company: Awaited<ReturnType<typeof safetyCheck>>["company"]) {
  // precheck-v2 marks the company protected when this attempt's own newly
  // created contact is found. Only that one reason may be bypassed; all current
  // company engagement/Retention guards still apply and unknown data fails closed.
  return company.gateReason === "Existing person blocked"
    && typeof company.accountType === "string" && company.accountType.toLowerCase() !== "retention"
    && company.meetingCount === 0 && company.connectedCallCount === 0
    && (!company.inHubSpot || company.engagementChecked === true);
}

export async function POST(request: NextRequest) {
  let progress: SalesNavPushAttempt | undefined;
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Ready push payload." }, { status: 400 });
    const input = parsed.data;
    const nameMismatch = salesNavNameMismatch(input.lead, input.prospect);
    if (nameMismatch) return NextResponse.json({ error: nameMismatch }, { status: 409 });
    if (!authorized(request)) return NextResponse.json({ error: "Owner authorization is required for acquisition pushes." }, { status: 401 });
    const owner = manualTaskOwners().find((item) => item.id === input.taskOwnerId);
    if (!owner) return NextResponse.json({ error: "Selected task owner is not enabled." }, { status: 400 });
    const dueAt = dueIso(input.taskDueAt);
    const identity = normalizePersonUrl(input.lead.linkedinUrl || String(input.prospect.linkedinUrl || ""));
    if (!identity || normalizePersonUrl(String(input.prospect.linkedinUrl || "")) !== identity) {
      return NextResponse.json({ error: "A matching public LinkedIn profile is required before Push." }, { status: 422 });
    }
    return await withSalesNavPushAttempt({ identity, ownerId: owner.id, dueAt, prospect: { ...input.prospect, linkedinUrl: identity } }, async (attempt) => {
      progress = attempt;
      if (attempt.result) return NextResponse.json({ ...attempt.result, pushed: false, duplicate: true, message: "This saved push already completed. Existing contact and task kept." });
      const writesStarted = Boolean(attempt.contactWriteStarted || attempt.companyWriteStarted || attempt.taskWriteStarted || attempt.contactId || attempt.companyId || attempt.taskId);
      if (writesStarted && (attempt.ownerId !== owner.id || attempt.dueAt !== dueAt)) {
        return NextResponse.json({ error: `This partial push is saved for ${manualTaskOwners().find(item => item.id === attempt.ownerId)?.name || attempt.ownerId} at ${attempt.dueAt}. Restore that owner/date to finish the saved push.`,
          retryable: true, contactId: attempt.contactId, companyId: attempt.companyId, taskId: attempt.taskId, ownerId: attempt.ownerId, dueAt: attempt.dueAt }, { status: 409 });
      }
      const prospect: JsonObject = { ...attempt.prospect, assignmentMode: "acquisition", ownerId: attempt.ownerId };
      const safety = await safetyCheck(request, input.lead, prospect);
      const recoveringOwnContact = Boolean(attempt.contactId && safety.contact.id === attempt.contactId);
      if (safety.contact.inHubSpot && !recoveringOwnContact) {
        return NextResponse.json({
          error: `Existing HubSpot person${safety.contact.matchedBy ? ` · matched by ${safety.contact.matchedBy}` : ""}. Ready to Push is net-new people only.`,
        }, { status: 409 });
      }
      if (safety.company.protected && !(recoveringOwnContact && companyStillEligibleForRecovery(safety.company))) {
        return NextResponse.json({ error: safety.company.protectedReason || "Company is blocked by the HubSpot gate." }, { status: 409 });
      }

      const phones = prospectPhones(prospect);
      if (!phones.length) return NextResponse.json({ error: "Phone required. Reveal this eligible new person first." }, { status: 422 });
      if ((attempt.contactWriteStarted && !attempt.contactId) || (attempt.companyWriteStarted && !attempt.companyId)) {
        return NextResponse.json({ error: "A previous CRM create returned no record ID. Reconcile that uncertain write before creating another record.", retryable: false }, { status: 409 });
      }

      // Preserve known HubSpot company intelligence without making reveal wait for slow ATS research.
      if (!String(prospect.detectedAts || "").trim() && safety.company.detectedAts) prospect.detectedAts = safety.company.detectedAts;
      if (!String(prospect.careerPageUrl || "").trim() && safety.company.careerPageUrl) prospect.careerPageUrl = safety.company.careerPageUrl;

      // Forward only the caller's authentication, not arbitrary incoming headers.
      // The downstream acquisition owner gate validates this credential before writing.
      const pushHeaders: Record<string, string> = { "Content-Type": "application/json" };
      const adminCookie = request.headers.get("cookie");
      if (adminCookie) pushHeaders.cookie = adminCookie;
      const ownerToken = request.headers.get("x-acquisition-owner-token");
      if (ownerToken) pushHeaders["x-acquisition-owner-token"] = ownerToken;
      const pushRequest = new Request(new URL("/api/prospecting/push", request.url), {
        method: "POST",
        headers: pushHeaders,
        body: JSON.stringify(prospect),
      });
      await checkpointSalesNavPush({});
      const pushResponse = await pushProspect(pushRequest);
      const pushPayload = await jsonFrom(pushResponse);
      if (!pushResponse.ok) return NextResponse.json({ ...pushPayload, retryable: Boolean(attempt.contactId || (!attempt.contactWriteStarted && !attempt.companyWriteStarted)),
        contactId: attempt.contactId, companyId: attempt.companyId, taskId: attempt.taskId }, { status: pushResponse.status });

      const taskId = String(pushPayload.taskId || "");
      const contactId = String(pushPayload.contactId || "");
      const companyId = String(pushPayload.companyId || safety.company.id || "");
      const duplicate = Boolean(pushPayload.duplicate);

      await saveSalesNavPush({ identity: input.lead, prospect, runId: input.runId, taskId, contactId, companyId });
      const result = {
        ok: true,
        pushed: !duplicate,
        duplicate,
        taskId,
        contactId,
        companyId: companyId || null,
        ownerId: String(pushPayload.ownerId || attempt.ownerId),
        ownerName: String(pushPayload.ownerName || owner.name),
        dueAt: String(pushPayload.scheduledAt || attempt.dueAt),
        message: duplicate ? "Existing open Sales Signal task kept." : "Net-new contact/company pushed and CALL task scheduled.",
      };
      await checkpointSalesNavPush({ result });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    console.error("Sales Nav v2 Ready push failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav Ready push failed.",
      ...(progress ? { retryable: Boolean(progress.contactId || (!progress.contactWriteStarted && !progress.companyWriteStarted)),
        contactId: progress.contactId, companyId: progress.companyId, taskId: progress.taskId } : {}),
    }, { status: error instanceof SalesNavPushAttemptError ? error.status : 500 });
  }
}
