import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAcquisitionPush } from "@/lib/acquisition-data-api";
import { acquisitionOwners } from "@/lib/acquisition-routing";
import { batchRead, HubSpotApiError, readAssociations, searchAll } from "@/lib/hubspot";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARITA_OWNER_ID = "31644369";
const MARITA_OWNER_NAME = "Marita Chedid";
const DIRECT_APPLICATION_LABEL = "Direct Application Form";

const prospectSchema = z.object({
  linkedinUrl: z.string().trim().max(1000).default(""),
  source: z.string().trim().max(120).default("Sales Navigator"),
  signalHireUid: z.string().trim().max(160).default(""),
  assignmentMode: z.enum(["marita", "acquisition"]).default("marita"),
  ownerId: z.string().trim().max(80).default(""),
  ownerName: z.string().trim().max(200).default(""),
  fullName: z.string().trim().min(1).max(250),
  title: z.string().trim().max(250).default(""),
  company: z.string().trim().max(250).default(""),
  companyWebsite: z.string().trim().max(1000).default(""),
  companyDomain: z.string().trim().max(300).default(""),
  companyLinkedIn: z.string().trim().max(1000).default(""),
  careerPageUrl: z.string().trim().max(1500).default(""),
  detectedAts: z.string().trim().max(250).default(""),
  atsConfidence: z.string().trim().max(120).default(""),
  careerConfidence: z.number().min(0).max(100).default(0),
  companyEvidenceUrl: z.string().trim().max(1500).default(""),
  companyVerificationReason: z.string().trim().max(1500).default(""),
  hiring: z.object({
    status: z.enum(["Hiring Now", "Accepting Applications", "No Active Jobs", "Unknown"]).default("Unknown"),
    activeJobs: z.number().min(0).max(100000).default(0),
    hiringScore: z.number().min(0).max(100).default(0),
    hiringLabel: z.string().trim().max(120).default(""),
    hasHrJobs: z.boolean().default(false),
    source: z.string().trim().max(250).default(""),
    sourceUrl: z.string().trim().max(1500).default(""),
    checkedAt: z.string().trim().max(100).default(""),
    jobsSample: z.array(z.object({ title: z.string().max(500), location: z.string().max(500), url: z.string().max(1500) })).max(10).default([]),
  }).default({ status: "Unknown", activeJobs: 0, hiringScore: 0, hiringLabel: "", hasHrJobs: false, source: "", sourceUrl: "", checkedAt: "", jobsSample: [] }),
  location: z.string().trim().max(500).default(""),
  email: z.string().trim().max(320).default(""),
  emails: z.array(z.string().trim().max(320)).max(20).default([]),
  phone: z.string().trim().max(120).default(""),
  phones: z.array(z.string().trim().max(120)).max(20).default([]),
  score: z.number().min(0).max(100),
  priority: z.enum(["high", "medium", "normal"]),
  previousTitle: z.string().trim().max(250).default(""),
  previousCompany: z.string().trim().max(250).default(""),
  recentSignal: z.object({ type: z.string().max(80).default(""), label: z.string().max(250).default(""), ageDays: z.number().nullable().optional() }).default({ type: "", label: "" }),
  scoreReasons: z.array(z.object({ label: z.string().max(250), points: z.number().min(0).max(100) })).max(30).default([]),
});

type Prospect = z.infer<typeof prospectSchema>;

type Assignment = { id: string; name: string; mode: "marita" | "acquisition" };

function token() {
  const value = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function acquisitionAuthorized(request: Request) {
  const expected = String(process.env.ACQUISITION_OWNER_TOKEN || "").trim();
  const supplied = String(request.headers.get("x-acquisition-owner-token") || "").trim();
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function requestedAssignment(prospect: Prospect, request: Request): Assignment {
  if (prospect.assignmentMode !== "acquisition") return { id: MARITA_OWNER_ID, name: MARITA_OWNER_NAME, mode: "marita" };
  if (!acquisitionAuthorized(request)) throw new Error("Owner authorization is required for acquisition pushes.");
  const owner = acquisitionOwners().find((item) => item.id === prospect.ownerId);
  if (!owner) throw new Error("The requested SDR is not enabled for acquisition routing.");
  return { id: owner.id, name: owner.name, mode: "acquisition" };
}

async function hubspotRequest<T>(path: string, init: RequestInit) {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HubSpot ${path} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstname: parts.shift() || fullName, lastname: parts.join(" ") };
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allEmails(prospect: Prospect) { return uniqueValues([prospect.email, ...prospect.emails]); }
function allPhones(prospect: Prospect) { return uniqueValues([prospect.phone, ...prospect.phones]); }

async function contactHasLinkedInProperty() {
  try {
    await hubspotRequest(`/crm/v3/properties/contacts/gtm_linkedin_url`, { method: "GET" });
    return true;
  } catch { return false; }
}

async function findContact(email: string, linkedinUrl: string) {
  if (email) {
    const matches = await searchAll("contacts", ["firstname", "lastname", "email"], [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }]);
    if (matches[0]) return String(matches[0].id);
  }
  if (linkedinUrl) {
    try {
      const matches = await searchAll("contacts", ["firstname", "lastname", "email", "gtm_linkedin_url"], [{ propertyName: "gtm_linkedin_url", operator: "EQ", value: linkedinUrl }]);
      if (matches[0]) return String(matches[0].id);
    } catch (error) {
      if (!(error instanceof HubSpotApiError) || ![400, 404].includes(error.status)) throw error;
    }
  }
  return "";
}

async function createContact(prospect: Prospect, ownerId: string) {
  const name = splitName(prospect.fullName);
  const properties: Record<string, string> = { firstname: name.firstname, lastname: name.lastname, hubspot_owner_id: ownerId };
  if (prospect.email) properties.email = prospect.email.toLowerCase();
  if (prospect.phone) properties.phone = prospect.phone;
  if (prospect.title) properties.jobtitle = prospect.title;
  if (prospect.company) properties.company = prospect.company;
  if (prospect.companyWebsite) properties.website = prospect.companyWebsite;
  if (prospect.linkedinUrl && await contactHasLinkedInProperty()) properties.gtm_linkedin_url = prospect.linkedinUrl;
  const created = await hubspotRequest<{ id: string }>("/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties }) });
  return String(created.id);
}

async function syncMissingContactDetails(contactId: string, prospect: Prospect, ownerId: string) {
  const current = (await batchRead("contacts", [contactId], ["email", "phone", "gtm_linkedin_url", "company", "jobtitle", "hubspot_owner_id"]))[0];
  if (!current) return [] as string[];
  const properties: Record<string, string> = {};
  if (prospect.email && !String(current.properties.email || "").trim()) properties.email = prospect.email.toLowerCase();
  if (prospect.phone && !String(current.properties.phone || "").trim()) properties.phone = prospect.phone;
  if (prospect.company && !String(current.properties.company || "").trim()) properties.company = prospect.company;
  if (prospect.title && !String(current.properties.jobtitle || "").trim()) properties.jobtitle = prospect.title;
  if (!String(current.properties.hubspot_owner_id || "").trim()) properties.hubspot_owner_id = ownerId;
  if (prospect.linkedinUrl && !String(current.properties.gtm_linkedin_url || "").trim() && await contactHasLinkedInProperty()) properties.gtm_linkedin_url = prospect.linkedinUrl;
  const updated = Object.keys(properties);
  if (updated.length) await hubspotRequest(`/crm/v3/objects/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
  return updated;
}

function companyDomain(prospect: Prospect) {
  return normalizeCompanyDomain(prospect.companyDomain || prospect.companyWebsite);
}

async function findCompanyId(domain: string) {
  if (!domain) return "";
  const matches = await searchAll("companies", ["name", "domain", "hubspot_owner_id"], [{ propertyName: "domain", operator: "EQ", value: domain }]);
  return matches[0] ? String(matches[0].id) : "";
}

function companyPropertiesFromProspect(prospect: Prospect, includeIdentity = true, ownerId = "") {
  const properties: Record<string, string> = {};
  const domain = companyDomain(prospect);
  const directApplication = prospect.detectedAts === DIRECT_APPLICATION_LABEL;
  if (includeIdentity && prospect.company) properties.name = prospect.company;
  if (includeIdentity && domain) properties.domain = domain;
  if (includeIdentity && prospect.companyWebsite) properties.company_website = prospect.companyWebsite;
  if (includeIdentity && ownerId) properties.hubspot_owner_id = ownerId;
  if (prospect.careerPageUrl) properties.career_page_url = prospect.careerPageUrl;
  if (prospect.detectedAts && !directApplication) {
    properties.detected_ats = prospect.detectedAts;
    properties.ats_status = "detected";
    if (prospect.atsConfidence) properties.ats_confidence = prospect.atsConfidence;
    if (prospect.companyEvidenceUrl) properties.ats_evidence_url = prospect.companyEvidenceUrl;
    if (prospect.companyVerificationReason) properties.ats_evidence_reason = prospect.companyVerificationReason.slice(0, 1000);
  }
  return properties;
}

async function createCompany(prospect: Prospect, ownerId: string) {
  const properties = companyPropertiesFromProspect(prospect, true, ownerId);
  if (!properties.name || !properties.domain) return "";
  const created = await hubspotRequest<{ id: string }>("/crm/v3/objects/companies", { method: "POST", body: JSON.stringify({ properties }) });
  return String(created.id);
}

async function syncCompany(companyId: string, prospect: Prospect) {
  const fields = ["name", "domain", "company_website", "career_page_url", "detected_ats", "ats_status", "ats_confidence", "ats_evidence_url", "ats_evidence_reason", "hubspot_owner_id"];
  const current = (await batchRead("companies", [companyId], fields))[0];
  if (!current) return { fieldsUpdated: [] as string[], existingOwnerId: "" };
  const desired = companyPropertiesFromProspect(prospect, false);
  if (prospect.companyWebsite && !String(current.properties.company_website || "").trim()) desired.company_website = prospect.companyWebsite;
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (value && !String(current.properties[key] || "").trim()) properties[key] = value;
  }
  const updated = Object.keys(properties);
  if (updated.length) await hubspotRequest(`/crm/v3/objects/companies/${companyId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
  return { fieldsUpdated: updated, existingOwnerId: String(current.properties.hubspot_owner_id || "").trim() };
}

async function ensureCompany(prospect: Prospect, requestedOwnerId: string) {
  const domain = companyDomain(prospect);
  if (!domain) return { companyId: "", created: false, fieldsUpdated: [] as string[], existingOwnerId: "" };
  let companyId = await findCompanyId(domain);
  if (!companyId) {
    companyId = await createCompany(prospect, requestedOwnerId);
    return { companyId, created: Boolean(companyId), fieldsUpdated: [] as string[], existingOwnerId: "" };
  }
  const synced = await syncCompany(companyId, prospect);
  return { companyId, created: false, fieldsUpdated: synced.fieldsUpdated, existingOwnerId: synced.existingOwnerId };
}

function finalAssignment(requested: Assignment, companyExistingOwnerId: string): Assignment {
  if (requested.mode !== "acquisition" || !companyExistingOwnerId) return requested;
  const existing = acquisitionOwners().find((owner) => owner.id === companyExistingOwnerId);
  return existing ? { id: existing.id, name: existing.name, mode: "acquisition" } : requested;
}

async function associateContactCompany(contactId: string, companyId: string) {
  if (!contactId || !companyId) return;
  await hubspotRequest(`/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/default/companies/${encodeURIComponent(companyId)}`, { method: "PUT" });
}

async function existingOpenProspectingTask(contactId: string, fullName: string) {
  try {
    const associations = await readAssociations("contacts", "tasks", [contactId]);
    const ids = (associations.get(contactId) || []).slice(0, 100);
    if (!ids.length) return null;
    const tasks = await batchRead("tasks", ids, ["hs_task_subject", "hs_task_status", "hubspot_owner_id", "hs_timestamp"]);
    const marker = `SALES SIGNAL — ${fullName}`.toLowerCase();
    return tasks.find((task) => String(task.properties.hs_task_status || "") !== "COMPLETED" && String(task.properties.hs_task_subject || "").toLowerCase().includes(marker)) || null;
  } catch { return null; }
}

function taskBody(prospect: Prospect, clickedAt: string, ownerName: string) {
  const reasons = prospect.scoreReasons.map((item) => `• ${item.label} (+${item.points})`).join("\n");
  const signal = prospect.recentSignal.label || "No recent role-change signal detected";
  const emails = allEmails(prospect);
  const phones = allPhones(prospect);
  const priorityLabel = prospect.priority === "high" ? "HIGH" : prospect.priority === "medium" ? "MEDIUM" : "NORMAL";
  const jobs = prospect.hiring.jobsSample.slice(0, 3).map((job) => `• ${job.title}${job.location ? ` — ${job.location}` : ""}`);
  const atsText = prospect.detectedAts === DIRECT_APPLICATION_LABEL
    ? DIRECT_APPLICATION_LABEL
    : `${prospect.detectedAts || "Not detected"}${prospect.atsConfidence ? ` (${prospect.atsConfidence})` : ""}`;
  return [
    `🔥 **${priorityLabel} PRIORITY — SALES SIGNAL**`, "",
    "👤 **Contact**", prospect.fullName,
    prospect.title ? `${prospect.title}${prospect.company ? ` · ${prospect.company}` : ""}` : prospect.company,
    prospect.location, "",
    "👥 **Assigned SDR**", ownerName, "",
    "🎯 **Source**", prospect.source, "",
    "📈 **Person Signal**", signal,
    prospect.previousCompany ? `Previous: ${prospect.previousTitle ? `${prospect.previousTitle} · ` : ""}${prospect.previousCompany}` : "", "",
    "🏢 **Company Intelligence**",
    `Domain: ${companyDomain(prospect) || "Not resolved"}`,
    `Website: ${prospect.companyWebsite || "Not resolved"}`,
    `Career Page: ${prospect.careerPageUrl || "Not found"}`,
    `ATS / Application: ${atsText}`,
    `Hiring: ${prospect.hiring.status}`,
    `Active Jobs: ${prospect.hiring.activeJobs}`,
    `Hiring Score: ${prospect.hiring.hiringScore}/100${prospect.hiring.hiringLabel ? ` · ${prospect.hiring.hiringLabel}` : ""}`,
    prospect.hiring.hasHrJobs ? "HR / Recruiting roles are currently open 🔥" : "",
    ...(jobs.length ? ["", "💼 **Sample Open Roles**", ...jobs] : []), "",
    "⭐ **Priority Score**", `${prospect.score}/100 — ${priorityLabel}`, reasons || "No additional score reasons", "",
    "📱 **Phone Numbers**", ...(phones.length ? phones.map((value, index) => `${index + 1}. ${value}`) : ["Phone not available"]), "",
    "📧 **Email Addresses**", ...(emails.length ? emails.map((value, index) => `${index + 1}. ${value}`) : ["Email not available"]), "",
    ...(prospect.linkedinUrl ? ["🔗 **LinkedIn**", prospect.linkedinUrl, ""] : []),
    "🕒 **Queued At**", clickedAt, "",
    "💡 **Suggested Action**",
    prospect.hiring.status === "Hiring Now"
      ? "Lead with the current hiring activity and recruitment scale, then qualify their ATS/process and current bottlenecks."
      : prospect.hiring.status === "Accepting Applications"
        ? "The company is accepting applications through its career form, but no verified open-role list was found. Use this as a light hiring signal and qualify current hiring volume and process."
        : prospect.recentSignal.type
          ? "Use the recent role/company change as the opening, then qualify current hiring and recruitment process."
          : "Qualify hiring activity, current recruitment process, and ATS before pitching.",
  ].filter(Boolean).join("\n");
}

async function logAcquisitionPush(prospect: Prospect, result: {
  companyId: string;
  contactId: string;
  taskId: string;
  owner: Assignment;
  status?: string;
}) {
  if (prospect.assignmentMode !== "acquisition") return;
  const domain = companyDomain(prospect);
  if (!domain) return;
  try {
    await writeAcquisitionPush({
      accountDomain: domain,
      personUid: prospect.signalHireUid,
      hubspotCompanyId: result.companyId,
      hubspotContactId: result.contactId,
      hubspotTaskId: result.taskId,
      ownerId: result.owner.id,
      ownerName: result.owner.name,
      status: result.status || "pushed",
      snapshot: {
        fullName: prospect.fullName,
        title: prospect.title,
        source: prospect.source,
        score: prospect.score,
        priority: prospect.priority,
        phones: allPhones(prospect).length,
        emails: allEmails(prospect).length,
      },
    });
  } catch (error) {
    console.warn("Acquisition push audit write failed", error);
  }
}

export async function POST(request: Request) {
  const clickedAt = new Date().toISOString();
  try {
    const parsed = prospectSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid prospect payload.", details: parsed.error.flatten() }, { status: 400 });
    const prospect = parsed.data;
    const requestedOwner = requestedAssignment(prospect, request);

    const company = await ensureCompany(prospect, requestedOwner.id);
    const owner = finalAssignment(requestedOwner, company.existingOwnerId);

    let contactId = await findContact(prospect.email, prospect.linkedinUrl);
    let contactCreated = false;
    let contactFieldsUpdated: string[] = [];
    if (!contactId) {
      contactId = await createContact(prospect, owner.id);
      contactCreated = true;
    } else {
      contactFieldsUpdated = await syncMissingContactDetails(contactId, prospect, owner.id);
    }

    if (company.companyId) await associateContactCompany(contactId, company.companyId);

    const duplicateTask = await existingOpenProspectingTask(contactId, prospect.fullName);
    if (duplicateTask) {
      const taskId = String(duplicateTask.id);
      await logAcquisitionPush(prospect, { companyId: company.companyId, contactId, taskId, owner, status: "pushed" });
      return NextResponse.json({
        pushed: false,
        duplicate: true,
        contactId,
        contactCreated,
        contactFieldsUpdated,
        companyId: company.companyId || null,
        companyCreated: company.created,
        companyFieldsUpdated: company.fieldsUpdated,
        taskId,
        ownerId: owner.id,
        ownerName: owner.name,
        ownerPreservedFromCompany: Boolean(company.existingOwnerId && owner.id === company.existingOwnerId),
        clickedAt,
        message: "An open Sales Signal task already exists for this contact. Company/contact intelligence was still synced.",
      });
    }

    const associations: Array<{ to: { id: string }; types: Array<{ associationCategory: "HUBSPOT_DEFINED"; associationTypeId: number }> }> = [
      { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] },
    ];
    if (company.companyId) associations.push({ to: { id: company.companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 192 }] });

    const task = await hubspotRequest<{ id: string }>("/crm/objects/2026-03/tasks", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          hs_timestamp: clickedAt,
          hubspot_owner_id: owner.id,
          hs_task_subject: `🔥 SALES SIGNAL — ${prospect.fullName}`,
          hs_task_body: taskBody(prospect, clickedAt, owner.name),
          hs_task_status: "NOT_STARTED",
          hs_task_priority: prospect.priority === "high" ? "HIGH" : "MEDIUM",
          hs_task_type: allPhones(prospect).length ? "CALL" : allEmails(prospect).length ? "EMAIL" : "TODO",
        },
        associations,
      }),
    });

    await logAcquisitionPush(prospect, { companyId: company.companyId, contactId, taskId: String(task.id), owner });

    return NextResponse.json({
      pushed: true,
      duplicate: false,
      contactId,
      contactCreated,
      contactFieldsUpdated,
      companyId: company.companyId || null,
      companyCreated: company.created,
      companyFieldsUpdated: company.fieldsUpdated,
      taskId: String(task.id),
      ownerId: owner.id,
      ownerName: owner.name,
      ownerPreservedFromCompany: Boolean(company.existingOwnerId && owner.id === company.existingOwnerId),
      clickedAt,
      phonesStoredInTask: allPhones(prospect).length,
      emailsStoredInTask: allEmails(prospect).length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Push prospect to HubSpot failed", error);
    const message = error instanceof Error ? error.message : "Unable to push prospect to HubSpot.";
    const status = /Owner authorization/.test(message) ? 401 : /not enabled for acquisition/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
