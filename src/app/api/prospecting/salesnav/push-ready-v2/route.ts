import { usablePhone } from "@/lib/saudi-ats-policy";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { salesNavLeadId } from "@/lib/salesnav-identity";
import { lookupOperation, claimOperation, checkpointOperation, operationFingerprint, type Operation } from "@/lib/salesnav-operations";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as pushProspect } from "@/app/api/prospecting/push/route";
import { POST as hubspotPrecheckV2 } from "@/app/api/prospecting/salesnav/precheck-v2/route";
import { salesNavSdrOwner } from "@/lib/salesnav-company-gate";
import { batchRead } from "@/lib/hubspot";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { manualTaskOwners } from "@/lib/acquisition-routing";
import { saveSalesNavPush } from "@/lib/salesnav-lead-ledger";

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
    connectionDegree: z.string().max(20).default(""),
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
  }));
  const payload = await jsonFrom(response);
  if (!response.ok) throw new Error(String(payload.error || "HubSpot safety recheck failed."));
  return payload as {
    contact: { inHubSpot: boolean; id: string; matchedBy: string };
    company: { inHubSpot: boolean; id: string; protected: boolean; domain?: string; protectedReason?: string; detectedAts?: string; atsStatus?: string; ownerId?: string; careerPageUrl?: string };
  };
}

export async function POST(request: NextRequest) {
  let operation: Operation | undefined;
  try {
    if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Unlock SDR admin access before pushing." }, { status: 401 });
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Ready push payload." }, { status: 400 });
    const input = parsed.data;
    const dueAt = dueIso(input.taskDueAt);
    const leadId = salesNavLeadId(input.lead);
    if (!leadId) return NextResponse.json({ error: "ID_WEAK: verify person identity before push." }, { status: 422 });
    if (input.lead.connectionDegree.toLowerCase() === "1st") return NextResponse.json({ error: "DEGREE_1ST: captured but excluded from this queue." }, { status: 409 });
    const key = `push:${leadId}`;
    const prior = await lookupOperation(key);
    const reveal = await lookupOperation(`reveal:${leadId}`);
    if (reveal.result.identityReview) return NextResponse.json({ error: "PERSON_COMPANY_CHANGED: verify the saved paid result before push." }, { status: 409 });
    if (prior.state === "completed") return NextResponse.json({ ...prior.result.response as JsonObject, ok: true, cached: true });
    const prospect: JsonObject = { ...input.prospect };

    const safety = await safetyCheck(request, input.lead, prospect);
    if (safety.contact.inHubSpot && safety.contact.id !== String(prior.result.contactId || "")) {
      return NextResponse.json({
        error: `Existing HubSpot person${safety.contact.matchedBy ? ` · matched by ${safety.contact.matchedBy}` : ""}. Ready to Push is net-new people only.`,
      }, { status: 409 });
    }
    if (safety.company.protected) {
      return NextResponse.json({ error: safety.company.protectedReason || "Company is blocked by the HubSpot gate." }, { status: 409 });
    }

    let routedOwnerId: string;
    try { routedOwnerId = input.taskOwnerId === "auto"
      ? salesNavSdrOwner(String(safety.company.detectedAts || ""), String(safety.company.atsStatus || ""))
      : input.taskOwnerId; } catch { return NextResponse.json({ error: "ROUTE_UNVERIFIED: choose Marita or Daniel manually after reviewing ATS evidence." }, { status: 422 }); }
    const owner = manualTaskOwners().find((item) => item.id === routedOwnerId && ["31644369", "37624223"].includes(item.id));
    if (!owner) return NextResponse.json({ error: "Choose enabled Marita or Daniel." }, { status: 422 });
    const existingOwner = String(safety.company.ownerId || "");
    if (existingOwner && existingOwner !== owner.id) return NextResponse.json({ error: `Company belongs to ${existingOwner}. Review ownership before assigning ${owner.name}.` }, { status: 409 });
    if (!safety.company.id && !String(prospect.companyDomain || prospect.companyWebsite || "").trim()) return NextResponse.json({ error: "CO_UNRESOLVED: verify a company domain before creating a contact." }, { status: 422 });
    prospect.assignmentMode = "acquisition"; prospect.ownerId = owner.id; prospect.ownerName = owner.name;

    const phones = prospectPhones(prospect).filter((value) => /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 8 && value.replace(/\D/g, "").length <= 15 && usablePhone(value));
    if (!phones.length) return NextResponse.json({ error: "Phone required. Reveal this eligible new person first." }, { status: 422 });

    const resource = String(prior.result.resource || `company:${normalizeCompanyDomain(safety.company.domain || String(prospect.companyDomain || prospect.companyWebsite || "")) || safety.company.id}`);
    const claim = await claimOperation(key, "push", resource, operationFingerprint({
      leadId, ownerId: owner.id,
      domain: normalizeCompanyDomain(safety.company.domain || String(prospect.companyDomain || prospect.companyWebsite || "")),
      company: String(prospect.company || input.lead.company),
      name: String(prospect.fullName || input.lead.name),
      linkedinUrl: String(prospect.linkedinUrl || input.lead.linkedinUrl),
      phones: [...phones].sort(), emails: unique([prospect.email, ...(Array.isArray(prospect.emails) ? prospect.emails : [])]).sort(),
    }));
    if (!claim.claimed || !claim.lease) return NextResponse.json({ error: `PUSH_${claim.state.toUpperCase()}: wait or reconcile the saved operation.` }, { status: 409 });
    operation = { key, lease: claim.lease, result: claim.result };
    await checkpointOperation(operation, { resource });
    prospect.salesNavOperation = { key, lease: claim.lease };
    prospect.requestedTaskDueAt = dueAt;

    prospect.phone = phones[0]; prospect.phones = phones;

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
    const pushResponse = await pushProspect(pushRequest);
    const pushPayload = await jsonFrom(pushResponse);
    if (!pushResponse.ok) throw new Error(String(pushPayload.error || "HubSpot push failed."));

    const taskId = String(pushPayload.taskId || "");
    const contactId = String(pushPayload.contactId || "");
    const companyId = String(pushPayload.companyId || safety.company.id || "");
    const duplicate = Boolean(pushPayload.duplicate);

    if (!taskId || !contactId) throw new Error("HubSpot push returned no verified contact/task ID.");
    const scheduledAt = String(pushPayload.scheduledAt || "");
    const task = (await batchRead("tasks", [taskId], ["hubspot_owner_id", "hs_timestamp", "hs_task_type"]))[0];
    if (!task || String(task.properties.hubspot_owner_id) !== owner.id || !scheduledAt || Date.parse(String(task.properties.hs_timestamp)) !== Date.parse(scheduledAt) || task.properties.hs_task_type !== "CALL") throw new Error(`Task ${taskId} exists but readback failed; resume verification before retrying a write.`);
    await saveSalesNavPush({ identity: input.lead, prospect, runId: input.runId, taskId, contactId, companyId });

    const result = {
      ok: true,
      pushed: !duplicate,
      duplicate,
      taskId,
      contactId,
      companyId: companyId || null,
      ownerId: duplicate ? String(pushPayload.ownerId || "") : owner.id,
      ownerName: duplicate ? String(pushPayload.ownerName || "Existing task owner") : owner.name,
      dueAt: scheduledAt,
      resumed: Boolean(prior.result.contactId),
      message: duplicate ? "Existing open Sales Signal task kept." : "Net-new contact/company pushed and CALL task scheduled.",
    };
    await checkpointOperation(operation, { response: result }, "completed");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (operation) await checkpointOperation(operation, { error: error instanceof Error ? error.message : "Push interrupted" }, "review").catch(() => undefined);
    console.error("Sales Nav v2 Ready push failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav Ready push failed." }, { status: 500 });
  }
}
