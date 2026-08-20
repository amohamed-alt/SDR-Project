import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { HUBSPOT_PORTAL_ID, HUBSPOT_UI_DOMAIN } from "@/lib/config";
import { listMaqsamCalls } from "@/lib/maqsam-calls";
import type { HubSpotRecord } from "@/lib/types";

const MARITA_OWNER_ID = "31644369";
const CACHE_TTL_MS = 2 * 60 * 1000;
const HUBSPOT_API = "https://api.hubapi.com";

const CONTACT_PROPS = [
  "firstname", "lastname", "email", "phone", "mobilephone", "jobtitle", "company", "company_id", "country", "sdr_owner",
] as const;
const COMPANY_PROPS = [
  "name", "domain", "country", "gtm_country", "detected_ats", "ats_status", "ats_confidence", "career_page_url",
] as const;
const TASK_PROPS = [
  "hs_task_subject", "hs_task_status", "hs_task_type", "hs_task_priority", "hs_timestamp", "hubspot_owner_id",
] as const;
const CALL_PROPS = ["hs_timestamp", "hs_call_status", "hs_call_direction", "hubspot_owner_id"] as const;

export type MaritaPriorityTier = "P1" | "P2" | "P3" | "P4";

export interface MaritaPriorityCompany {
  companyId: string;
  companyName: string;
  domain: string;
  country: string;
  detectedAts: string;
  atsStatus: string;
  noAts: boolean;
  priority: MaritaPriorityTier;
  priorityLabel: string;
  contactId: string;
  contactName: string;
  contactTitle: string;
  email: string;
  phone: string;
  hasEmail: boolean;
  hasPhone: boolean;
  taskIds: string[];
  taskCount: number;
  primaryTaskId: string;
  primaryTaskSubject: string;
  dueAt: string;
  overdue: boolean;
  companyUrl: string;
  contactUrl: string;
}

export interface MaritaPriorityPayload {
  generatedAt: string;
  ownerId: string;
  summary: {
    totalNeverCalledCompanies: number;
    noAts: number;
    phoneAndEmail: number;
    phoneOnly: number;
    overdueCompanies: number;
    openTasks: number;
  };
  companies: MaritaPriorityCompany[];
}

type CacheEntry = { expiresAt: number; payload: MaritaPriorityPayload };
let cache: CacheEntry | null = null;

function text(record: HubSpotRecord | undefined, key: string) {
  return String(record?.properties?.[key] ?? "").trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function contactName(contact: HubSpotRecord) {
  return [text(contact, "firstname"), text(contact, "lastname")].filter(Boolean).join(" ") || text(contact, "email") || `Contact ${contact.id}`;
}

function reliableAts(company: HubSpotRecord) {
  const ats = text(company, "detected_ats");
  const status = text(company, "ats_status").toLowerCase();
  const generic = /^(?:custom|unknown|not detected|not_detected|none|n\/a)$/i.test(ats);
  return Boolean(ats) && !generic && status === "detected";
}

function priorityFor(noAts: boolean, hasEmail: boolean): { tier: MaritaPriorityTier; label: string } {
  if (noAts && hasEmail) return { tier: "P1", label: "Phone + email · No ATS" };
  if (noAts) return { tier: "P2", label: "Phone only · No ATS" };
  if (hasEmail) return { tier: "P3", label: "Phone + email" };
  return { tier: "P4", label: "Phone only" };
}

function priorityRank(tier: MaritaPriorityTier) {
  return ({ P1: 1, P2: 2, P3: 3, P4: 4 } as const)[tier];
}

function taskDue(task: HubSpotRecord) {
  return text(task, "hs_timestamp");
}

function isPastCall(call: HubSpotRecord) {
  const direction = text(call, "hs_call_direction").toUpperCase();
  if (direction === "INBOUND") return false;
  const status = text(call, "hs_call_status").toUpperCase();
  if (["CANCELED", "QUEUED", "RINGING", "CONNECTING", "IN_PROGRESS", "HOLD"].includes(status)) return false;
  const timestamp = Date.parse(text(call, "hs_timestamp"));
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function recordUrl(typeId: "0-1" | "0-2", id: string) {
  return `https://${HUBSPOT_UI_DOMAIN}/contacts/${HUBSPOT_PORTAL_ID}/record/${typeId}/${id}?utm_source=sdr_project&utm_medium=dashboard&utm_campaign=marita_priority`;
}

async function calledCompanyIds() {
  const hubspotCalls = (await searchAll(
    "calls",
    CALL_PROPS,
    [{ propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID }],
  )).filter(isPastCall);

  const callIds = hubspotCalls.map((call) => call.id);
  const [callContacts, callCompanies, maqsamCalls] = await Promise.all([
    readAssociations("calls", "contacts", callIds),
    readAssociations("calls", "companies", callIds),
    listMaqsamCalls(),
  ]);

  const calledContacts = unique([
    ...callIds.flatMap((id) => callContacts.get(id) ?? []),
    ...maqsamCalls
      .filter((call) => call.matchStatus === "matched" && String(call.direction ?? "").toUpperCase() !== "INBOUND")
      .map((call) => String(call.hubspotContactId ?? "")),
  ]);

  const contactCompanies = await readAssociations("contacts", "companies", calledContacts);
  return new Set(unique([
    ...callIds.flatMap((id) => callCompanies.get(id) ?? []),
    ...calledContacts.flatMap((id) => contactCompanies.get(id) ?? []),
  ]));
}

export async function getMaritaPriorityQueue(forceRefresh = false): Promise<MaritaPriorityPayload> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.payload;

  const openTasks = await searchAll(
    "tasks",
    TASK_PROPS,
    [
      { propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID },
      { propertyName: "hs_task_type", operator: "EQ", value: "CALL" },
      { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
    ],
    ["hs_timestamp"],
  );

  const taskIds = openTasks.map((task) => task.id);
  const [taskContacts, taskCompanies, calledCompanies] = await Promise.all([
    readAssociations("tasks", "contacts", taskIds),
    readAssociations("tasks", "companies", taskIds),
    calledCompanyIds(),
  ]);

  const contactIds = unique(taskIds.flatMap((id) => taskContacts.get(id) ?? []));
  const contacts = await batchRead("contacts", contactIds, CONTACT_PROPS);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const maritaContacts = contacts.filter((contact) => text(contact, "sdr_owner") === MARITA_OWNER_ID);
  const maritaContactIds = new Set(maritaContacts.map((contact) => contact.id));
  const contactCompanies = await readAssociations("contacts", "companies", maritaContacts.map((contact) => contact.id));

  const companyIds = unique(taskIds.flatMap((taskId) => {
    const associatedContacts = (taskContacts.get(taskId) ?? []).filter((id) => maritaContactIds.has(id));
    if (!associatedContacts.length) return [];
    const direct = taskCompanies.get(taskId) ?? [];
    const viaContact = associatedContacts.flatMap((contactId) => contactCompanies.get(contactId) ?? []);
    const viaProperty = associatedContacts.map((contactId) => text(contactById.get(contactId), "company_id"));
    return [...direct, ...viaContact, ...viaProperty];
  }));

  const companyRecords = await batchRead("companies", companyIds, COMPANY_PROPS);
  const companyById = new Map(companyRecords.map((company) => [company.id, company]));

  const grouped = new Map<string, { taskIds: string[]; contacts: string[]; tasks: HubSpotRecord[] }>();
  for (const task of openTasks) {
    const associatedContacts = (taskContacts.get(task.id) ?? []).filter((id) => maritaContactIds.has(id));
    if (!associatedContacts.length) continue;
    const companiesForTask = unique([
      ...(taskCompanies.get(task.id) ?? []),
      ...associatedContacts.flatMap((contactId) => contactCompanies.get(contactId) ?? []),
      ...associatedContacts.map((contactId) => text(contactById.get(contactId), "company_id")),
    ]);
    for (const companyId of companiesForTask) {
      if (!companyById.has(companyId) || calledCompanies.has(companyId)) continue;
      const bucket = grouped.get(companyId) ?? { taskIds: [], contacts: [], tasks: [] };
      bucket.taskIds.push(task.id);
      bucket.contacts.push(...associatedContacts);
      bucket.tasks.push(task);
      grouped.set(companyId, bucket);
    }
  }

  const companies: MaritaPriorityCompany[] = [];
  for (const [companyId, bucket] of grouped) {
    const company = companyById.get(companyId);
    if (!company) continue;
    const candidates = unique(bucket.contacts)
      .map((id) => contactById.get(id))
      .filter((contact): contact is HubSpotRecord => Boolean(contact))
      .map((contact) => {
        const phone = text(contact, "mobilephone") || text(contact, "phone");
        const email = text(contact, "email");
        return { contact, phone, email, score: (phone ? 100 : 0) + (email ? 20 : 0) };
      })
      .filter((candidate) => Boolean(candidate.phone))
      .sort((a, b) => b.score - a.score || contactName(a.contact).localeCompare(contactName(b.contact)));

    const best = candidates[0];
    if (!best) continue;

    const noAts = !reliableAts(company);
    const priority = priorityFor(noAts, Boolean(best.email));
    const tasks = bucket.tasks
      .filter((task, index, all) => all.findIndex((item) => item.id === task.id) === index)
      .sort((a, b) => (taskDue(a) || "9999").localeCompare(taskDue(b) || "9999"));
    const primaryTask = tasks[0];
    const dueAt = taskDue(primaryTask);

    companies.push({
      companyId,
      companyName: text(company, "name") || `Company ${companyId}`,
      domain: text(company, "domain"),
      country: text(company, "gtm_country") || text(company, "country"),
      detectedAts: text(company, "detected_ats"),
      atsStatus: text(company, "ats_status"),
      noAts,
      priority: priority.tier,
      priorityLabel: priority.label,
      contactId: best.contact.id,
      contactName: contactName(best.contact),
      contactTitle: text(best.contact, "jobtitle"),
      email: best.email,
      phone: best.phone,
      hasEmail: Boolean(best.email),
      hasPhone: true,
      taskIds: unique(tasks.map((task) => task.id)),
      taskCount: tasks.length,
      primaryTaskId: primaryTask?.id ?? "",
      primaryTaskSubject: text(primaryTask, "hs_task_subject"),
      dueAt,
      overdue: Boolean(dueAt && Date.parse(dueAt) < Date.now()),
      companyUrl: recordUrl("0-2", companyId),
      contactUrl: recordUrl("0-1", best.contact.id),
    });
  }

  companies.sort((a, b) =>
    priorityRank(a.priority) - priorityRank(b.priority)
      || Number(b.overdue) - Number(a.overdue)
      || (a.dueAt || "9999").localeCompare(b.dueAt || "9999")
      || a.companyName.localeCompare(b.companyName),
  );

  const payload: MaritaPriorityPayload = {
    generatedAt: new Date().toISOString(),
    ownerId: MARITA_OWNER_ID,
    summary: {
      totalNeverCalledCompanies: companies.length,
      noAts: companies.filter((company) => company.noAts).length,
      phoneAndEmail: companies.filter((company) => company.hasEmail).length,
      phoneOnly: companies.filter((company) => !company.hasEmail).length,
      overdueCompanies: companies.filter((company) => company.overdue).length,
      openTasks: companies.reduce((sum, company) => sum + company.taskCount, 0),
    },
    companies,
  };

  cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
  return payload;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function rescheduleMaritaTasks(taskIds: string[], dueDate: string, dueTime: string) {
  const ids = unique(taskIds).slice(0, 1000);
  const tasks = await batchRead("tasks", ids, TASK_PROPS);
  const eligible = tasks.filter((task) =>
    text(task, "hubspot_owner_id") === MARITA_OWNER_ID
      && text(task, "hs_task_type") === "CALL"
      && text(task, "hs_task_status") !== "COMPLETED",
  );
  const dueAt = `${dueDate}T${dueTime}:00+03:00`;
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured");

  for (const batch of chunks(eligible, 100)) {
    const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/tasks/batch/update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: batch.map((task) => ({ id: task.id, properties: { hs_timestamp: dueAt } })) }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HubSpot task update failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }

  cache = null;
  return { requested: ids.length, updated: eligible.length, skipped: ids.length - eligible.length, dueAt };
}
