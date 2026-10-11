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
    company: { inHubSpot: boolean; id: string; protected: boolean; protectedReason?: string; detectedAts?: string; atsStatus?: string; ownerId?: string; careerPageUrl?: string };
  };
}

function hubspotToken() {
  const value = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

async function patchTask(taskId: string, ownerId: string, dueAt: string) {
  if (!taskId) return;
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${hubspotToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { hubspot_owner_id: ownerId, hs_timestamp: dueAt, hs_task_type: "CALL" } }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HubSpot task update failed (${response.status}): ${text.slice(0, 300)}`);
}

export async function POST(request: NextRequest) {
  try {
    if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Unlock SDR admin access before pushing." }, { status: 401 });
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Ready push payload." }, { status: 400 });
    const input = parsed.data;
    const dueAt = dueIso(input.taskDueAt);
    const prospect: JsonObject = { ...input.prospect };

    const safety = await safetyCheck(request, input.lead, prospect);
    if (safety.contact.inHubSpot) {
      return NextResponse.json({
        error: `Existing HubSpot person${safety.contact.matchedBy ? ` · matched by ${safety.contact.matchedBy}` : ""}. Ready to Push is net-new people only.`,
      }, { status: 409 });
    }
    if (safety.company.protected) {
      return NextResponse.json({ error: safety.company.protectedReason || "Company is blocked by the HubSpot gate." }, { status: 409 });
    }

    const routedOwnerId = input.taskOwnerId === "auto"
      ? salesNavSdrOwner(String(safety.company.detectedAts || ""), String(safety.company.atsStatus || ""))
      : input.taskOwnerId;
    const owner = manualTaskOwners().find((item) => item.id === routedOwnerId && ["31644369", "37624223"].includes(item.id));
    if (!owner) return NextResponse.json({ error: "Choose enabled Marita or Daniel." }, { status: 422 });
    const existingOwner = manualTaskOwners().find((item) => item.id === safety.company.ownerId);
    if (existingOwner && existingOwner.id !== owner.id) return NextResponse.json({ error: `Company belongs to ${existingOwner.name}. Review ownership before assigning ${owner.name}.` }, { status: 409 });
    prospect.assignmentMode = "acquisition"; prospect.ownerId = owner.id; prospect.ownerName = owner.name;

    const phones = prospectPhones(prospect).filter((value) => /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 8 && value.replace(/\D/g, "").length <= 15);
    if (!phones.length) return NextResponse.json({ error: "Phone required. Reveal this eligible new person first." }, { status: 422 });

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
    if (!duplicate) {
      await patchTask(taskId, owner.id, dueAt);
      const task = (await batchRead("tasks", [taskId], ["hubspot_owner_id", "hs_timestamp", "hs_task_type"]))[0];
      if (!task || String(task.properties.hubspot_owner_id) !== owner.id || Date.parse(String(task.properties.hs_timestamp)) !== Date.parse(dueAt) || task.properties.hs_task_type !== "CALL") throw new Error(`Task ${taskId} was created but assignment verification failed; review before retry.`);
    }
    await saveSalesNavPush({ identity: input.lead, prospect, runId: input.runId, taskId, contactId, companyId });

    return NextResponse.json({
      ok: true,
      pushed: !duplicate,
      duplicate,
      taskId,
      contactId,
      companyId: companyId || null,
      ownerId: duplicate ? String(pushPayload.ownerId || "") : owner.id,
      ownerName: duplicate ? String(pushPayload.ownerName || "Existing task owner") : owner.name,
      dueAt: duplicate ? String(pushPayload.clickedAt || "") : dueAt,
      message: duplicate ? "Existing open Sales Signal task kept." : "Net-new contact/company pushed and CALL task scheduled.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sales Nav v2 Ready push failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav Ready push failed." }, { status: 500 });
  }
}
