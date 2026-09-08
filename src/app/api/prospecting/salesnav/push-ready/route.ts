import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as pushProspect } from "@/app/api/prospecting/push/route";
import { POST as hubspotPrecheck } from "@/app/api/prospecting/signalhire/precheck/route";
import { manualTaskOwners } from "@/lib/acquisition-routing";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { saveSalesNavPush } from "@/lib/salesnav-lead-ledger";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().trim().max(120).default(""),
  taskOwnerId: z.string().trim().min(1).max(80),
  taskDueAt: z.string().trim().min(1).max(100),
  existingPhone: z.string().trim().max(120).default(""),
  existingEmail: z.string().trim().max(320).default(""),
  lead: z.object({
    name: z.string().trim().min(1).max(220),
    title: z.string().trim().max(320).default(""),
    company: z.string().trim().max(320).default(""),
    location: z.string().trim().max(320).default(""),
    linkedinUrl: z.string().trim().max(1500).default(""),
    salesLeadUrl: z.string().trim().max(2000).default(""),
  }),
  precheck: z.object({
    contact: z.object({ id: z.string().trim().max(100).default(""), inHubSpot: z.boolean().default(false) }).passthrough(),
    company: z.object({ id: z.string().trim().max(100).default(""), inHubSpot: z.boolean().default(false), protected: z.boolean().default(false) }).passthrough(),
  }).passthrough().optional(),
  prospect: z.record(z.string(), z.unknown()).nullable().optional(),
});

type JsonObject = Record<string, unknown>;

function token() {
  const value = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

async function hubspotRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = response.status === 204 ? "" : await response.text();
  if (!response.ok) throw new Error(`HubSpot ${path} failed (${response.status}): ${text.slice(0, 400)}`);
  if (!text.trim()) return undefined as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`HubSpot ${path} returned non-JSON: ${text.slice(0, 180)}`); }
}

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

function prospectPhones(prospect?: JsonObject | null) {
  if (!prospect) return [];
  return unique([prospect.phone, ...(Array.isArray(prospect.phones) ? prospect.phones : [])]);
}

function prospectEmails(prospect?: JsonObject | null) {
  if (!prospect) return [];
  return unique([prospect.email, ...(Array.isArray(prospect.emails) ? prospect.emails : [])]);
}

function validDue(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error("Choose a valid task due date and time.");
  return date.toISOString();
}

async function runPrecheck(request: NextRequest, input: z.infer<typeof schema>) {
  const prospect = input.prospect || {};
  const response = await hubspotPrecheck(requestLike(request, "/api/prospecting/signalhire/precheck", {
    name: prospect.fullName || input.lead.name,
    company: prospect.company || input.lead.company,
    companyWebsite: prospect.companyWebsite || "",
    companyDomain: prospect.companyDomain || "",
    linkedinUrl: prospect.linkedinUrl || input.lead.linkedinUrl,
    email: prospect.email || input.existingEmail || "",
    emails: prospect.emails || [],
    phone: prospect.phone || input.existingPhone || "",
    phones: prospect.phones || [],
  }));
  const payload = await jsonFrom(response);
  if (!response.ok) throw new Error(String(payload.error || "HubSpot safety recheck failed."));
  return payload as {
    contact: { inHubSpot: boolean; id: string; matchedBy: string; properties?: Record<string, unknown> };
    company: { inHubSpot: boolean; id: string; protected: boolean; protectedReason?: string; gateReason?: string; accountType?: string };
  };
}

async function openSalesSignalTask(contactId: string, fullName: string) {
  try {
    const associations = await readAssociations("contacts", "tasks", [contactId]);
    const ids = (associations.get(contactId) || []).slice(0, 100);
    if (!ids.length) return null;
    const tasks = await batchRead("tasks", ids, ["hs_task_subject", "hs_task_status", "hubspot_owner_id", "hs_timestamp"]);
    const marker = `SALES SIGNAL — ${fullName}`.toLowerCase();
    return tasks.find((task) => String(task.properties.hs_task_status || "") !== "COMPLETED"
      && String(task.properties.hs_task_subject || "").toLowerCase().includes(marker)) || null;
  } catch { return null; }
}

function existingTaskBody(input: z.infer<typeof schema>, ownerName: string, phone: string, gateReason: string) {
  const prospect = input.prospect || {};
  const phones = unique([phone, ...prospectPhones(prospect)]);
  const emails = unique([input.existingEmail, ...prospectEmails(prospect)]);
  return [
    "🔥 SALES NAV READY — CALL",
    "",
    `Contact: ${String(prospect.fullName || input.lead.name)}`,
    `Title: ${String(prospect.title || input.lead.title || "")}`,
    `Company: ${String(prospect.company || input.lead.company || "")}`,
    `Location: ${String(prospect.location || input.lead.location || "")}`,
    `Assigned SDR: ${ownerName}`,
    `HubSpot gate: ${gateReason || "Eligible"}`,
    "",
    `Phones: ${phones.join(" · ") || "Not available"}`,
    `Emails: ${emails.join(" · ") || "Not available"}`,
    input.lead.salesLeadUrl ? `Sales Nav: ${input.lead.salesLeadUrl}` : "",
    String(prospect.linkedinUrl || input.lead.linkedinUrl || "") ? `LinkedIn: ${String(prospect.linkedinUrl || input.lead.linkedinUrl)}` : "",
    String(prospect.careerPageUrl || "") ? `Career page: ${String(prospect.careerPageUrl)}` : "",
    String(prospect.detectedAts || "") ? `ATS: ${String(prospect.detectedAts)}` : "",
  ].filter(Boolean).join("\n");
}

async function createTask(input: {
  contactId: string;
  companyId: string;
  fullName: string;
  ownerId: string;
  ownerName: string;
  dueAt: string;
  body: string;
}) {
  const associations: Array<{ to: { id: string }; types: Array<{ associationCategory: "HUBSPOT_DEFINED"; associationTypeId: number }> }> = [
    { to: { id: input.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] },
  ];
  if (input.companyId) associations.push({ to: { id: input.companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 192 }] });
  return hubspotRequest<{ id: string }>("/crm/objects/2026-03/tasks", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_timestamp: input.dueAt,
        hubspot_owner_id: input.ownerId,
        hs_task_subject: `🔥 SALES SIGNAL — ${input.fullName}`,
        hs_task_body: input.body,
        hs_task_status: "NOT_STARTED",
        hs_task_priority: "HIGH",
        hs_task_type: "CALL",
      },
      associations,
    }),
  });
}

async function syncExistingContact(contactId: string, prospect: JsonObject | null | undefined) {
  if (!prospect) return;
  const current = (await batchRead("contacts", [contactId], ["email", "phone", "mobilephone", "gtm_linkedin_url", "company", "jobtitle"]))[0];
  if (!current) return;
  const properties: Record<string, string> = {};
  const phones = prospectPhones(prospect);
  const emails = prospectEmails(prospect);
  if (emails[0] && !String(current.properties.email || "").trim()) properties.email = emails[0].toLowerCase();
  if (phones[0] && !String(current.properties.mobilephone || "").trim()) properties.mobilephone = phones[0];
  if (phones[0] && !String(current.properties.phone || "").trim()) properties.phone = phones[0];
  if (prospect.company && !String(current.properties.company || "").trim()) properties.company = String(prospect.company);
  if (prospect.title && !String(current.properties.jobtitle || "").trim()) properties.jobtitle = String(prospect.title);
  if (prospect.linkedinUrl && !String(current.properties.gtm_linkedin_url || "").trim()) properties.gtm_linkedin_url = String(prospect.linkedinUrl);
  if (Object.keys(properties).length) {
    await hubspotRequest(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, { method: "PATCH", body: JSON.stringify({ properties }) });
  }

  const additional = phones.filter((value) => value !== String(properties.phone || current.properties.phone || "") && value !== String(properties.mobilephone || current.properties.mobilephone || ""));
  if (additional.length) {
    try {
      await hubspotRequest(`/crm/v3/properties/contacts/gtm_additional_phone_numbers`, { method: "GET" });
      await hubspotRequest(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: { gtm_additional_phone_numbers: additional.join("; ") } }),
      });
    } catch { /* optional property */ }
  }
}

async function ensureCompanyForExistingContact(prospect: JsonObject | null | undefined, fallbackCompanyId: string) {
  if (fallbackCompanyId || !prospect) return fallbackCompanyId;
  const name = String(prospect.company || "").trim();
  const domain = normalizeCompanyDomain(String(prospect.companyDomain || prospect.companyWebsite || ""));
  if (!name || !domain) return "";
  const matches = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "EQ", value: domain }]);
  if (matches[0]) return String(matches[0].id);
  const properties: Record<string, string> = { name, domain };
  if (prospect.companyWebsite) properties.company_website = String(prospect.companyWebsite);
  if (prospect.careerPageUrl) properties.career_page_url = String(prospect.careerPageUrl);
  if (prospect.detectedAts && String(prospect.detectedAts) !== "Direct Application Form") {
    properties.detected_ats = String(prospect.detectedAts);
    properties.ats_status = "detected";
  }
  const created = await hubspotRequest<{ id: string }>("/crm/v3/objects/companies", { method: "POST", body: JSON.stringify({ properties }) });
  return String(created?.id || "");
}

async function syncExistingCompany(companyId: string, prospect: JsonObject | null | undefined) {
  if (!companyId || !prospect) return;
  const current = (await batchRead("companies", [companyId], ["career_page_url", "detected_ats", "ats_status", "company_website"]))[0];
  if (!current) return;
  const properties: Record<string, string> = {};
  if (prospect.careerPageUrl && !String(current.properties.career_page_url || "").trim()) properties.career_page_url = String(prospect.careerPageUrl);
  if (prospect.companyWebsite && !String(current.properties.company_website || "").trim()) properties.company_website = String(prospect.companyWebsite);
  if (prospect.detectedAts && String(prospect.detectedAts) !== "Direct Application Form" && !String(current.properties.detected_ats || "").trim()) {
    properties.detected_ats = String(prospect.detectedAts);
    properties.ats_status = "detected";
  }
  if (Object.keys(properties).length) {
    await hubspotRequest(`/crm/v3/objects/companies/${encodeURIComponent(companyId)}`, { method: "PATCH", body: JSON.stringify({ properties }) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Ready push payload." }, { status: 400 });
    const input = parsed.data;
    const owner = manualTaskOwners().find((item) => item.id === input.taskOwnerId);
    if (!owner) return NextResponse.json({ error: "Selected task owner is not enabled." }, { status: 400 });
    const dueAt = validDue(input.taskDueAt);

    const safety = await runPrecheck(request, input);
    if (safety.company.protected) {
      return NextResponse.json({ error: safety.company.protectedReason || "Company is blocked by the HubSpot communication gate.", gate: safety.company }, { status: 409 });
    }

    const prospect = input.prospect || null;
    const revealedPhones = prospectPhones(prospect);
    let contactId = safety.contact.inHubSpot ? safety.contact.id : input.precheck?.contact.id || "";
    let companyId = safety.company.inHubSpot ? safety.company.id : input.precheck?.company.id || "";

    if (contactId) {
      const contact = (await batchRead("contacts", [contactId], ["firstname", "lastname", "email", "phone", "mobilephone"]))[0];
      if (!contact) return NextResponse.json({ error: "Existing HubSpot contact could not be verified." }, { status: 409 });
      const existingPhone = String(contact.properties.mobilephone || contact.properties.phone || input.existingPhone || "").trim();
      const phone = revealedPhones[0] || existingPhone;
      if (!phone) return NextResponse.json({ error: "Phone required. This lead is not Ready yet." }, { status: 422 });

      await syncExistingContact(contactId, prospect);
      companyId = await ensureCompanyForExistingContact(prospect, companyId);
      await syncExistingCompany(companyId, prospect);
      if (companyId) {
        try {
          await hubspotRequest(`/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/default/companies/${encodeURIComponent(companyId)}`, { method: "PUT" });
        } catch { /* association may already exist */ }
      }

      const duplicate = await openSalesSignalTask(contactId, String(prospect?.fullName || input.lead.name));
      if (duplicate) {
        await saveSalesNavPush({ identity: input.lead, prospect: prospect || undefined, runId: input.runId, taskId: String(duplicate.id), contactId, companyId });
        return NextResponse.json({
          ok: true,
          duplicate: true,
          taskId: String(duplicate.id),
          contactId,
          companyId: companyId || null,
          ownerId: String(duplicate.properties.hubspot_owner_id || ""),
          ownerName: "Existing task owner",
          dueAt: String(duplicate.properties.hs_timestamp || ""),
          message: "An open Sales Signal task already exists; no duplicate task was created.",
        }, { headers: { "Cache-Control": "no-store" } });
      }

      const task = await createTask({
        contactId,
        companyId,
        fullName: String(prospect?.fullName || input.lead.name),
        ownerId: owner.id,
        ownerName: owner.name,
        dueAt,
        body: existingTaskBody(input, owner.name, phone, safety.company.gateReason || "Eligible"),
      });
      const taskId = String(task?.id || "");
      await saveSalesNavPush({ identity: input.lead, prospect: prospect || undefined, runId: input.runId, taskId, contactId, companyId });
      return NextResponse.json({ ok: true, pushed: true, duplicate: false, taskId, contactId, companyId: companyId || null, ownerId: owner.id, ownerName: owner.name, dueAt }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!prospect || !revealedPhones.length) {
      return NextResponse.json({ error: "Phone required. Reveal this eligible lead first." }, { status: 422 });
    }

    // Net-new person: reuse the mature contact/company creation path, then move the
    // created CALL task to the explicitly selected owner/date.
    const pushRequest = new Request(new URL("/api/prospecting/push", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prospect),
    });
    const pushResponse = await pushProspect(pushRequest);
    const pushPayload = await jsonFrom(pushResponse);
    if (!pushResponse.ok) throw new Error(String(pushPayload.error || "HubSpot push failed."));

    contactId = String(pushPayload.contactId || "");
    companyId = String(pushPayload.companyId || "");
    const taskId = String(pushPayload.taskId || "");
    const duplicate = Boolean(pushPayload.duplicate);

    if (taskId && !duplicate) {
      await hubspotRequest(`/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: { hubspot_owner_id: owner.id, hs_timestamp: dueAt, hs_task_type: "CALL" } }),
      });
    }
    if (contactId) await syncExistingContact(contactId, prospect);
    if (companyId) await syncExistingCompany(companyId, prospect);

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
      message: duplicate ? "Existing open Sales Signal task kept." : "Contact/company pushed and CALL task scheduled.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sales Nav Ready push failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav Ready push failed." }, { status: 500 });
  }
}
