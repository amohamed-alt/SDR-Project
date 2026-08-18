import { NextResponse } from "next/server";
import { z } from "zod";
import { batchRead, HubSpotApiError, readAssociations, searchAll } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARITA_OWNER_ID = "31644369";
const MARITA_OWNER_NAME = "Marita Chedid";

const prospectSchema = z.object({
  linkedinUrl: z.string().url().max(1000),
  source: z.string().trim().max(120).default("Sales Navigator"),
  fullName: z.string().trim().min(1).max(250),
  title: z.string().trim().max(250).default(""),
  company: z.string().trim().max(250).default(""),
  companyWebsite: z.string().trim().max(1000).default(""),
  location: z.string().trim().max(500).default(""),
  email: z.string().trim().max(320).default(""),
  emails: z.array(z.string().trim().max(320)).max(20).default([]),
  phone: z.string().trim().max(120).default(""),
  phones: z.array(z.string().trim().max(120)).max(20).default([]),
  score: z.number().min(0).max(100),
  priority: z.enum(["high", "medium", "normal"]),
  previousTitle: z.string().trim().max(250).default(""),
  previousCompany: z.string().trim().max(250).default(""),
  recentSignal: z.object({
    type: z.string().max(80).default(""),
    label: z.string().max(250).default(""),
    ageDays: z.number().nullable().optional(),
  }).default({ type: "", label: "" }),
  scoreReasons: z.array(z.object({ label: z.string().max(250), points: z.number().min(0).max(100) })).max(20).default([]),
});

type Prospect = z.infer<typeof prospectSchema>;

function token() {
  const value = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

async function hubspotRequest<T>(path: string, init: RequestInit) {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HubSpot ${path} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstname: parts.shift() || fullName,
    lastname: parts.join(" "),
  };
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

function allEmails(prospect: Prospect) {
  return uniqueValues([prospect.email, ...prospect.emails]);
}

function allPhones(prospect: Prospect) {
  return uniqueValues([prospect.phone, ...prospect.phones]);
}

function companyDomain(website: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function contactHasLinkedInProperty() {
  try {
    await hubspotRequest(`/crm/v3/properties/contacts/gtm_linkedin_url`, { method: "GET" });
    return true;
  } catch {
    return false;
  }
}

async function findContact(email: string, linkedinUrl: string) {
  if (email) {
    const matches = await searchAll("contacts", ["firstname", "lastname", "email"], [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }]);
    if (matches[0]) return String(matches[0].id);
  }
  try {
    const matches = await searchAll("contacts", ["firstname", "lastname", "email", "gtm_linkedin_url"], [{ propertyName: "gtm_linkedin_url", operator: "EQ", value: linkedinUrl }]);
    if (matches[0]) return String(matches[0].id);
  } catch (error) {
    if (!(error instanceof HubSpotApiError) || ![400, 404].includes(error.status)) throw error;
  }
  return "";
}

async function createContact(prospect: Prospect) {
  const name = splitName(prospect.fullName);
  const properties: Record<string, string> = {
    firstname: name.firstname,
    lastname: name.lastname,
  };
  if (prospect.email) properties.email = prospect.email.toLowerCase();
  if (prospect.phone) properties.phone = prospect.phone;
  if (prospect.title) properties.jobtitle = prospect.title;
  if (prospect.company) properties.company = prospect.company;
  if (prospect.companyWebsite) properties.website = prospect.companyWebsite;
  if (await contactHasLinkedInProperty()) properties.gtm_linkedin_url = prospect.linkedinUrl;

  const created = await hubspotRequest<{ id: string }>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  return String(created.id);
}

async function syncMissingContactDetails(contactId: string, prospect: Prospect) {
  const current = (await batchRead("contacts", [contactId], ["email", "phone", "gtm_linkedin_url"]))[0];
  if (!current) return [] as string[];

  const properties: Record<string, string> = {};
  if (prospect.email && !String(current.properties.email || "").trim()) properties.email = prospect.email.toLowerCase();
  if (prospect.phone && !String(current.properties.phone || "").trim()) properties.phone = prospect.phone;
  if (prospect.linkedinUrl && !String(current.properties.gtm_linkedin_url || "").trim() && await contactHasLinkedInProperty()) {
    properties.gtm_linkedin_url = prospect.linkedinUrl;
  }

  const updated = Object.keys(properties);
  if (!updated.length) return updated;

  await hubspotRequest(`/crm/v3/objects/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  return updated;
}

async function findCompanyId(website: string) {
  const domain = companyDomain(website);
  if (!domain) return "";
  try {
    const matches = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "EQ", value: domain }]);
    return matches[0] ? String(matches[0].id) : "";
  } catch {
    return "";
  }
}

async function existingOpenProspectingTask(contactId: string, fullName: string) {
  try {
    const associations = await readAssociations("contacts", "tasks", [contactId]);
    const ids = (associations.get(contactId) || []).slice(0, 100);
    if (!ids.length) return null;
    const tasks = await batchRead("tasks", ids, ["hs_task_subject", "hs_task_status", "hubspot_owner_id", "hs_timestamp"]);
    const marker = `SALES SIGNAL — ${fullName}`.toLowerCase();
    return tasks.find((task) => {
      const subject = String(task.properties.hs_task_subject || "").toLowerCase();
      const status = String(task.properties.hs_task_status || "");
      return status !== "COMPLETED" && subject.includes(marker);
    }) || null;
  } catch {
    return null;
  }
}

function taskBody(prospect: Prospect, clickedAt: string) {
  const reasons = prospect.scoreReasons.map((item) => `• ${item.label} (+${item.points})`).join("\n");
  const signal = prospect.recentSignal.label || "No recent role-change signal detected";
  const emails = allEmails(prospect);
  const phones = allPhones(prospect);
  const priorityLabel = prospect.priority === "high" ? "HIGH" : prospect.priority === "medium" ? "MEDIUM" : "NORMAL";

  return [
    `🔥 **${priorityLabel} PRIORITY — SALES SIGNAL**`,
    "",
    "👤 **Contact**",
    prospect.fullName,
    prospect.title ? `${prospect.title}${prospect.company ? ` · ${prospect.company}` : ""}` : prospect.company,
    prospect.location,
    "",
    "🎯 **Source**",
    prospect.source,
    "",
    "📈 **Signal**",
    signal,
    prospect.previousCompany ? `Previous: ${prospect.previousTitle ? `${prospect.previousTitle} · ` : ""}${prospect.previousCompany}` : "",
    "",
    "⭐ **Priority Score**",
    `${prospect.score}/100 — ${priorityLabel}`,
    reasons || "No additional score reasons",
    "",
    "📱 **Phone Numbers**",
    ...(phones.length ? phones.map((value, index) => `${index + 1}. ${value}`) : ["Phone not available"]),
    "",
    "📧 **Email Addresses**",
    ...(emails.length ? emails.map((value, index) => `${index + 1}. ${value}`) : ["Email not available"]),
    "",
    "🔗 **LinkedIn**",
    prospect.linkedinUrl,
    "",
    "🕒 **Queued At**",
    clickedAt,
    "",
    "💡 **Suggested Action**",
    prospect.recentSignal.type ? "Use the recent role/company change as the opening, then qualify current hiring and recruitment process." : "Qualify hiring activity, current recruitment process, and ATS before pitching.",
  ].join("\n");
}

export async function POST(request: Request) {
  const clickedAt = new Date().toISOString();

  try {
    const parsed = prospectSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid prospect payload." }, { status: 400 });
    const prospect = parsed.data;

    let contactId = await findContact(prospect.email, prospect.linkedinUrl);
    let contactCreated = false;
    let contactFieldsUpdated: string[] = [];
    if (!contactId) {
      contactId = await createContact(prospect);
      contactCreated = true;
    } else {
      contactFieldsUpdated = await syncMissingContactDetails(contactId, prospect);
    }

    const duplicateTask = await existingOpenProspectingTask(contactId, prospect.fullName);
    if (duplicateTask) {
      return NextResponse.json({
        pushed: false,
        duplicate: true,
        contactId,
        contactCreated,
        contactFieldsUpdated,
        taskId: String(duplicateTask.id),
        ownerId: MARITA_OWNER_ID,
        ownerName: MARITA_OWNER_NAME,
        clickedAt,
        message: "An open Sales Signal task already exists for this contact.",
      });
    }

    const companyId = await findCompanyId(prospect.companyWebsite);
    const associations: Array<{ to: { id: string }; types: Array<{ associationCategory: "HUBSPOT_DEFINED"; associationTypeId: number }> }> = [
      { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] },
    ];
    if (companyId) associations.push({ to: { id: companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 192 }] });

    const task = await hubspotRequest<{ id: string }>("/crm/objects/2026-03/tasks", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          hs_timestamp: clickedAt,
          hubspot_owner_id: MARITA_OWNER_ID,
          hs_task_subject: `🔥 SALES SIGNAL — ${prospect.fullName}`,
          hs_task_body: taskBody(prospect, clickedAt),
          hs_task_status: "NOT_STARTED",
          hs_task_priority: prospect.priority === "high" ? "HIGH" : "MEDIUM",
          hs_task_type: allPhones(prospect).length ? "CALL" : allEmails(prospect).length ? "EMAIL" : "TODO",
        },
        associations,
      }),
    });

    return NextResponse.json({
      pushed: true,
      duplicate: false,
      contactId,
      contactCreated,
      contactFieldsUpdated,
      companyId: companyId || null,
      taskId: String(task.id),
      ownerId: MARITA_OWNER_ID,
      ownerName: MARITA_OWNER_NAME,
      clickedAt,
      phonesStoredInTask: allPhones(prospect).length,
      emailsStoredInTask: allEmails(prospect).length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Push prospect to Marita failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to push prospect to HubSpot." }, { status: 500 });
  }
}
