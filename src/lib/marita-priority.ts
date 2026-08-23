import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { CONNECTED_CALL_DISPOSITION, HUBSPOT_PORTAL_ID, HUBSPOT_UI_DOMAIN } from "@/lib/config";
import type { HubSpotRecord } from "@/lib/types";

const MARITA_OWNER_ID = "31644369";
const EXTENSIVE_LIGHTER_SOURCE = "extensive-lighter";
const NO_ANSWER_DISPOSITION = "73a0d17f-1163-4015-bdd5-ec830791da20";
const RETENTION_PIPELINE_ID = "1026934003";
const PROPOSAL_SHARED_STAGES = new Set(["decisionmakerboughtin", "1435517122"]);
const CACHE_TTL_MS = 5 * 60 * 1000;
const HUBSPOT_API = "https://api.hubapi.com";

const CONTACT_PROPS = [
  "firstname", "lastname", "email", "phone", "mobilephone", "whatsapp_number", "hs_whatsapp_phone_number", "whatsapp_phone_number", "jobtitle", "company", "company_id", "country", "sdr_owner",
] as const;
const COMPANY_PROPS = [
  "name", "domain", "country", "gtm_country", "detected_ats", "ats_status", "ats_confidence", "career_page_url",
  "company_tier", "gtm_icp_tier", "account_type", "account_status",
] as const;
const TASK_PROPS = [
  "hs_task_subject", "hs_task_status", "hs_task_type", "hs_task_priority", "hs_timestamp", "hubspot_owner_id",
  "hs_object_source_label", "hs_object_source_detail_1",
] as const;
const CALL_PROPS = [
  "hs_timestamp", "hs_call_status", "hs_call_direction", "hs_call_disposition", "hubspot_owner_id",
] as const;
const DEAL_PROPS = ["dealname", "pipeline", "dealstage", "hs_is_closed", "hs_is_closed_won"] as const;

export type MaritaPriorityTier = "P1" | "P2" | "P3" | "P4";

export interface MaritaPriorityContactTask {
  contactId: string;
  contactName: string;
  contactTitle: string;
  email: string;
  phone: string;
  hasPhone: boolean;
  hasEmail: boolean;
  taskIds: string[];
  taskCount: number;
  callableTaskIds: string[];
  dueAt: string;
  overdue: boolean;
  contactUrl: string;
}

export interface MaritaPriorityCompany {
  companyId: string;
  companyName: string;
  domain: string;
  country: string;
  companyTier: string;
  icpTier: string;
  detectedAts: string;
  atsStatus: string;
  noAts: boolean;
  priority: MaritaPriorityTier;
  priorityLabel: string;
  priorityScore: number;
  priorityReasons: string[];
  contactId: string;
  contactName: string;
  contactTitle: string;
  email: string;
  phone: string;
  hasEmail: boolean;
  hasPhone: boolean;
  contacts: MaritaPriorityContactTask[];
  contactCount: number;
  taskIds: string[];
  callableTaskIds: string[];
  taskCount: number;
  callableTaskCount: number;
  primaryTaskId: string;
  primaryTaskSubject: string;
  dueAt: string;
  overdue: boolean;
  attemptCount: number;
  connectedCallCount: number;
  noAnswerCount: number;
  neverAttempted: boolean;
  lastAttemptAt: string;
  companyUrl: string;
  contactUrl: string;
}

export interface MaritaPriorityPayload {
  generatedAt: string;
  ownerId: string;
  summary: {
    portfolioContacts: number;
    portfolioCompanies: number;
    connectedCompanies: number;
    noConnectedCompanies: number;
    extensiveLighterCompanies: number;
    eligibleCompanies: number;
    readyToCallCompanies: number;
    highPriorityCompanies: number;
    neverAttemptedCompanies: number;
    noAnswerCompanies: number;
    noAts: number;
    needsPhone: number;
    openExtensiveTasks: number;
    excludedCompanies: number;
    excludedRetention: number;
    excludedDeals: number;
  };
  companies: MaritaPriorityCompany[];
}

type CacheEntry = { expiresAt: number; payload: MaritaPriorityPayload };
type CallStats = { attempts: number; connected: number; noAnswer: number; lastAttemptAt: string };
type Exclusion = { excluded: boolean; reasons: string[]; retention: boolean; deal: boolean };

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

function contactPhone(contact: HubSpotRecord) {
  return text(contact, "whatsapp_number")
    || text(contact, "hs_whatsapp_phone_number")
    || text(contact, "whatsapp_phone_number")
    || text(contact, "mobilephone")
    || text(contact, "phone");
}

function recordUrl(typeId: "0-1" | "0-2", id: string) {
  return `https://${HUBSPOT_UI_DOMAIN}/contacts/${HUBSPOT_PORTAL_ID}/record/${typeId}/${id}?utm_source=sdr_project&utm_medium=dashboard&utm_campaign=marita_priority`;
}

function reliableAts(company: HubSpotRecord) {
  const ats = text(company, "detected_ats");
  const status = text(company, "ats_status").toLowerCase();
  const generic = /^(?:custom|unknown|not detected|not_detected|none|n\/a)$/i.test(ats);
  return Boolean(ats) && !generic && status === "detected";
}

function isExtensiveLighterTask(task: HubSpotRecord) {
  return text(task, "hs_object_source_detail_1").toLowerCase() === EXTENSIVE_LIGHTER_SOURCE;
}

function isOpenMaritaCallTask(task: HubSpotRecord) {
  return text(task, "hubspot_owner_id") === MARITA_OWNER_ID
    && text(task, "hs_task_type") === "CALL"
    && text(task, "hs_task_status") !== "COMPLETED"
    && isExtensiveLighterTask(task);
}

function taskDue(task: HubSpotRecord) {
  return text(task, "hs_timestamp");
}

function earliestDue(tasks: HubSpotRecord[]) {
  return tasks.map(taskDue).filter(Boolean).sort()[0] ?? "";
}

function isPastOutboundCall(call: HubSpotRecord) {
  if (text(call, "hs_call_direction").toUpperCase() === "INBOUND") return false;
  const status = text(call, "hs_call_status").toUpperCase();
  if (["CANCELED", "QUEUED", "RINGING", "CONNECTING", "IN_PROGRESS", "HOLD"].includes(status)) return false;
  const timestamp = Date.parse(text(call, "hs_timestamp"));
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function contactRoleRank(title: string) {
  const value = title.toLowerCase();
  if (/chief.*human|chief.*people|\bchro\b|chief.*talent/.test(value)) return 10;
  if (/vp|vice president|evp|svp/.test(value) && /human|people|talent|hr/.test(value)) return 9;
  if (/director|head/.test(value) && /talent acquisition|recruit/.test(value)) return 9;
  if (/director|head/.test(value) && /human|people|\bhr\b/.test(value)) return 8;
  if (/manager/.test(value) && /talent acquisition|recruit/.test(value)) return 7;
  if (/manager/.test(value) && /human|people|\bhr\b/.test(value)) return 6;
  if (/talent|recruit|human resources|\bhr\b/.test(value)) return 4;
  return 1;
}

function countryBoost(country: string) {
  const value = country.toLowerCase();
  if (/saudi|ksa/.test(value)) return 5;
  if (/united arab emirates|\buae\b|dubai|abu dhabi/.test(value)) return 4;
  return 0;
}

function priorityForScore(score: number): { tier: MaritaPriorityTier; label: string } {
  if (score >= 85) return { tier: "P1", label: "Call first" };
  if (score >= 72) return { tier: "P2", label: "High priority" };
  if (score >= 60) return { tier: "P3", label: "Next up" };
  return { tier: "P4", label: "Needs data" };
}

function companyExclusion(company: HubSpotRecord, deals: HubSpotRecord[]): Exclusion {
  const reasons = new Set<string>();
  let retention = false;
  let deal = false;

  if (text(company, "account_type") === "Retention") {
    retention = true;
    reasons.add("Retention account");
  }

  for (const item of deals) {
    const pipeline = text(item, "pipeline");
    const stage = text(item, "dealstage");
    const isClosed = text(item, "hs_is_closed").toLowerCase();
    const isWon = text(item, "hs_is_closed_won").toLowerCase() === "true";

    if (pipeline === RETENTION_PIPELINE_ID) {
      retention = true;
      reasons.add("Retention deal");
    }
    if (isWon) {
      deal = true;
      reasons.add("Closed Won");
    }
    if (isClosed === "false") {
      deal = true;
      reasons.add("Open deal");
    }
    if (PROPOSAL_SHARED_STAGES.has(stage)) {
      deal = true;
      reasons.add("Proposal shared");
    }
  }

  return { excluded: reasons.size > 0, reasons: [...reasons], retention, deal };
}

function companyIdsForContact(contactId: string, contact: HubSpotRecord | undefined, associations: Map<string, string[]>) {
  return unique([...(associations.get(contactId) ?? []), text(contact, "company_id")]);
}

function scoreCompany(input: {
  attempts: number;
  noAnswer: number;
  hasPhone: boolean;
  hasEmail: boolean;
  noAts: boolean;
  companyTier: string;
  country: string;
  roleRank: number;
}) {
  let score = 35;
  if (input.attempts === 0) score += 20;
  else if (input.noAnswer > 0) score += 10;
  else score += 5;
  if (input.hasPhone) score += 20;
  if (input.hasEmail) score += 3;
  if (input.noAts) score += 10;
  if (input.companyTier === "A") score += 7;
  else if (input.companyTier === "B") score += 4;
  score += countryBoost(input.country);
  score += Math.min(5, Math.floor(input.roleRank / 2));
  if (!input.hasPhone) score = Math.min(score, 59);
  return Math.min(100, score);
}

export async function getMaritaPriorityQueue(forceRefresh = false): Promise<MaritaPriorityPayload> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.payload;

  const portfolioContacts = await searchAll(
    "contacts",
    CONTACT_PROPS,
    [{ propertyName: "sdr_owner", operator: "EQ", value: MARITA_OWNER_ID }],
  );
  const contactById = new Map(portfolioContacts.map((contact) => [contact.id, contact]));
  const portfolioContactIds = portfolioContacts.map((contact) => contact.id);
  const contactCompanies = await readAssociations("contacts", "companies", portfolioContactIds);
  const portfolioCompanyIds = unique(portfolioContacts.flatMap((contact) => companyIdsForContact(contact.id, contact, contactCompanies)));
  const portfolioCompanySet = new Set(portfolioCompanyIds);

  const [companyRecords, openTasks, maritaCalls, companyDeals] = await Promise.all([
    batchRead("companies", portfolioCompanyIds, COMPANY_PROPS),
    searchAll(
      "tasks",
      TASK_PROPS,
      [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID },
        { propertyName: "hs_task_type", operator: "EQ", value: "CALL" },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
        { propertyName: "hs_object_source_detail_1", operator: "EQ", value: "Extensive-Lighter" },
      ],
      ["hs_timestamp"],
    ),
    searchAll(
      "calls",
      CALL_PROPS,
      [{ propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID }],
    ),
    readAssociations("companies", "deals", portfolioCompanyIds),
  ]);

  const companyById = new Map(companyRecords.map((company) => [company.id, company]));
  const dealIds = unique(portfolioCompanyIds.flatMap((companyId) => companyDeals.get(companyId) ?? []));
  const dealRecords = await batchRead("deals", dealIds, DEAL_PROPS);
  const dealById = new Map(dealRecords.map((deal) => [deal.id, deal]));

  const exclusions = new Map<string, Exclusion>();
  for (const companyId of portfolioCompanyIds) {
    const company = companyById.get(companyId);
    if (!company) continue;
    const deals = (companyDeals.get(companyId) ?? []).map((id) => dealById.get(id)).filter((item): item is HubSpotRecord => Boolean(item));
    exclusions.set(companyId, companyExclusion(company, deals));
  }

  const callIds = maritaCalls.map((call) => call.id);
  const [callContacts, callCompanies] = await Promise.all([
    readAssociations("calls", "contacts", callIds),
    readAssociations("calls", "companies", callIds),
  ]);

  const callStats = new Map<string, CallStats>();
  for (const call of maritaCalls) {
    if (!isPastOutboundCall(call)) continue;
    const companyIds = unique([
      ...(callCompanies.get(call.id) ?? []),
      ...(callContacts.get(call.id) ?? []).flatMap((contactId) => companyIdsForContact(contactId, contactById.get(contactId), contactCompanies)),
    ]).filter((companyId) => portfolioCompanySet.has(companyId));
    const disposition = text(call, "hs_call_disposition");
    const occurredAt = text(call, "hs_timestamp");

    for (const companyId of companyIds) {
      const stats = callStats.get(companyId) ?? { attempts: 0, connected: 0, noAnswer: 0, lastAttemptAt: "" };
      stats.attempts += 1;
      if (disposition === CONNECTED_CALL_DISPOSITION) stats.connected += 1;
      if (disposition === NO_ANSWER_DISPOSITION) stats.noAnswer += 1;
      if (occurredAt && (!stats.lastAttemptAt || occurredAt > stats.lastAttemptAt)) stats.lastAttemptAt = occurredAt;
      callStats.set(companyId, stats);
    }
  }

  const taskIds = openTasks.map((task) => task.id);
  const taskContacts = await readAssociations("tasks", "contacts", taskIds);
  const grouped = new Map<string, Map<string, HubSpotRecord[]>>();
  const portfolioOpenTaskIds = new Set<string>();

  for (const task of openTasks.filter(isOpenMaritaCallTask)) {
    const associatedContacts = (taskContacts.get(task.id) ?? []).filter((contactId) => contactById.has(contactId));
    for (const contactId of associatedContacts) {
      const contact = contactById.get(contactId);
      for (const companyId of companyIdsForContact(contactId, contact, contactCompanies)) {
        if (!portfolioCompanySet.has(companyId) || !companyById.has(companyId)) continue;
        const companyBucket = grouped.get(companyId) ?? new Map<string, HubSpotRecord[]>();
        const tasks = companyBucket.get(contactId) ?? [];
        if (!tasks.some((item) => item.id === task.id)) tasks.push(task);
        companyBucket.set(contactId, tasks);
        grouped.set(companyId, companyBucket);
        portfolioOpenTaskIds.add(task.id);
      }
    }
  }

  const companies: MaritaPriorityCompany[] = [];
  for (const [companyId, contactTaskMap] of grouped) {
    const company = companyById.get(companyId);
    if (!company) continue;
    const stats = callStats.get(companyId) ?? { attempts: 0, connected: 0, noAnswer: 0, lastAttemptAt: "" };
    const exclusion = exclusions.get(companyId);
    if (stats.connected > 0 || exclusion?.excluded) continue;

    const contacts: MaritaPriorityContactTask[] = [...contactTaskMap.entries()].map(([contactId, tasks]) => {
      const contact = contactById.get(contactId)!;
      const phone = contactPhone(contact);
      const email = text(contact, "email");
      const dueAt = earliestDue(tasks);
      return {
        contactId,
        contactName: contactName(contact),
        contactTitle: text(contact, "jobtitle"),
        email,
        phone,
        hasPhone: Boolean(phone),
        hasEmail: Boolean(email),
        taskIds: unique(tasks.map((task) => task.id)),
        taskCount: tasks.length,
        callableTaskIds: phone ? unique(tasks.map((task) => task.id)) : [],
        dueAt,
        overdue: Boolean(dueAt && Date.parse(dueAt) < Date.now()),
        contactUrl: recordUrl("0-1", contactId),
      };
    }).sort((left, right) => {
      const leftScore = (left.hasPhone ? 1000 : 0) + contactRoleRank(left.contactTitle) * 20 + (left.hasEmail ? 10 : 0);
      const rightScore = (right.hasPhone ? 1000 : 0) + contactRoleRank(right.contactTitle) * 20 + (right.hasEmail ? 10 : 0);
      return rightScore - leftScore || left.contactName.localeCompare(right.contactName);
    });

    const best = contacts[0];
    if (!best) continue;
    const allTasks = unique(contacts.flatMap((contact) => contact.taskIds));
    const callableTaskIds = unique(contacts.flatMap((contact) => contact.callableTaskIds));
    const taskRecords = allTasks.map((id) => openTasks.find((task) => task.id === id)).filter((task): task is HubSpotRecord => Boolean(task));
    const dueAt = earliestDue(taskRecords);
    const primaryTask = taskRecords.sort((left, right) => (taskDue(left) || "9999").localeCompare(taskDue(right) || "9999"))[0];
    const noAts = !reliableAts(company);
    const companyTier = text(company, "company_tier");
    const country = text(company, "gtm_country") || text(company, "country");
    const score = scoreCompany({
      attempts: stats.attempts,
      noAnswer: stats.noAnswer,
      hasPhone: best.hasPhone,
      hasEmail: best.hasEmail,
      noAts,
      companyTier,
      country,
      roleRank: contactRoleRank(best.contactTitle),
    });
    const priority = priorityForScore(score);
    const reasons = [
      stats.attempts === 0 ? "Never attempted" : stats.noAnswer > 0 ? `No answer ×${stats.noAnswer}` : "No connected call",
      best.hasPhone ? "Phone ready" : "Needs phone",
      noAts ? "No ATS" : "ATS detected",
      companyTier ? `Tier ${companyTier}` : "",
      countryBoost(country) ? country : "",
    ].filter(Boolean);

    companies.push({
      companyId,
      companyName: text(company, "name") || `Company ${companyId}`,
      domain: text(company, "domain"),
      country,
      companyTier,
      icpTier: text(company, "gtm_icp_tier"),
      detectedAts: text(company, "detected_ats"),
      atsStatus: text(company, "ats_status"),
      noAts,
      priority: priority.tier,
      priorityLabel: priority.label,
      priorityScore: score,
      priorityReasons: reasons,
      contactId: best.contactId,
      contactName: best.contactName,
      contactTitle: best.contactTitle,
      email: best.email,
      phone: best.phone,
      hasEmail: best.hasEmail,
      hasPhone: best.hasPhone,
      contacts,
      contactCount: contacts.length,
      taskIds: allTasks,
      callableTaskIds,
      taskCount: allTasks.length,
      callableTaskCount: callableTaskIds.length,
      primaryTaskId: primaryTask?.id ?? "",
      primaryTaskSubject: text(primaryTask, "hs_task_subject"),
      dueAt,
      overdue: Boolean(dueAt && Date.parse(dueAt) < Date.now()),
      attemptCount: stats.attempts,
      connectedCallCount: stats.connected,
      noAnswerCount: stats.noAnswer,
      neverAttempted: stats.attempts === 0,
      lastAttemptAt: stats.lastAttemptAt,
      companyUrl: recordUrl("0-2", companyId),
      contactUrl: best.contactUrl,
    });
  }

  companies.sort((left, right) =>
    right.priorityScore - left.priorityScore
      || Number(right.overdue) - Number(left.overdue)
      || (left.dueAt || "9999").localeCompare(right.dueAt || "9999")
      || left.companyName.localeCompare(right.companyName),
  );

  const connectedCompanies = portfolioCompanyIds.filter((companyId) => (callStats.get(companyId)?.connected ?? 0) > 0).length;
  const excludedCompanies = portfolioCompanyIds.filter((companyId) => exclusions.get(companyId)?.excluded).length;
  const excludedRetention = portfolioCompanyIds.filter((companyId) => exclusions.get(companyId)?.retention).length;
  const excludedDeals = portfolioCompanyIds.filter((companyId) => exclusions.get(companyId)?.deal).length;

  const payload: MaritaPriorityPayload = {
    generatedAt: new Date().toISOString(),
    ownerId: MARITA_OWNER_ID,
    summary: {
      portfolioContacts: portfolioContacts.length,
      portfolioCompanies: portfolioCompanyIds.length,
      connectedCompanies,
      noConnectedCompanies: Math.max(0, portfolioCompanyIds.length - connectedCompanies),
      extensiveLighterCompanies: grouped.size,
      eligibleCompanies: companies.length,
      readyToCallCompanies: companies.filter((company) => company.callableTaskCount > 0).length,
      highPriorityCompanies: companies.filter((company) => company.callableTaskCount > 0 && (company.priority === "P1" || company.priority === "P2")).length,
      neverAttemptedCompanies: companies.filter((company) => company.neverAttempted).length,
      noAnswerCompanies: companies.filter((company) => company.noAnswerCount > 0).length,
      noAts: companies.filter((company) => company.noAts).length,
      needsPhone: companies.filter((company) => company.callableTaskCount === 0).length,
      openExtensiveTasks: portfolioOpenTaskIds.size,
      excludedCompanies,
      excludedRetention,
      excludedDeals,
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
  const queue = await getMaritaPriorityQueue(true);
  const allowedTaskIds = new Set(queue.companies.flatMap((company) => company.callableTaskIds));
  const tasks = await batchRead("tasks", ids, TASK_PROPS);
  const eligible = tasks.filter((task) => isOpenMaritaCallTask(task) && allowedTaskIds.has(task.id));
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
