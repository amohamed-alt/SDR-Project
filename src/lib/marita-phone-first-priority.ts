import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { CONNECTED_CALL_DISPOSITION, HUBSPOT_PORTAL_ID, HUBSPOT_UI_DOMAIN } from "@/lib/config";
import type { HubSpotRecord } from "@/lib/types";
import type { MaritaPriorityCompany, MaritaPriorityContactTask, MaritaPriorityTier } from "@/lib/marita-priority";

const MARITA_OWNER_ID = "31644369";
const PHONE_FIRST_SUBJECT = "🔥 SALES SIGNAL —";
const RETENTION_PIPELINE_ID = "1026934003";
const PROPOSAL_SHARED_STAGES = new Set(["decisionmakerboughtin", "1435517122"]);

const TASK_PROPS = [
  "hs_task_subject", "hs_task_status", "hs_task_type", "hs_task_priority", "hs_timestamp", "hubspot_owner_id",
] as const;
const CONTACT_PROPS = [
  "firstname", "lastname", "email", "phone", "mobilephone", "whatsapp_number", "hs_whatsapp_phone_number", "whatsapp_phone_number", "jobtitle", "company", "country",
] as const;
const COMPANY_PROPS = [
  "name", "domain", "country", "gtm_country", "detected_ats", "ats_status", "company_tier", "gtm_icp_tier", "account_type", "account_status",
] as const;
const CALL_PROPS = ["hs_timestamp", "hs_call_status", "hs_call_direction", "hs_call_disposition", "hubspot_owner_id"] as const;
const DEAL_PROPS = ["pipeline", "dealstage", "hs_is_closed", "hs_is_closed_won"] as const;

function text(record: HubSpotRecord | undefined, key: string) {
  return String(record?.properties?.[key] ?? "").trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function recordUrl(typeId: "0-1" | "0-2", id: string) {
  return `https://${HUBSPOT_UI_DOMAIN}/contacts/${HUBSPOT_PORTAL_ID}/record/${typeId}/${id}?utm_source=sdr_project&utm_medium=dashboard&utm_campaign=marita_phone_first`;
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

function isPhoneFirstTask(task: HubSpotRecord) {
  return text(task, "hubspot_owner_id") === MARITA_OWNER_ID
    && text(task, "hs_task_type") === "CALL"
    && text(task, "hs_task_status") !== "COMPLETED"
    && text(task, "hs_task_subject").startsWith(PHONE_FIRST_SUBJECT);
}

function roleRank(title: string) {
  const value = title.toLowerCase();
  if (/director|head|vp|vice president/.test(value) && /talent acquisition/.test(value)) return 10;
  if (/director|head|vp|vice president/.test(value) && /recruit/.test(value)) return 9;
  if (/chief.*human|chief.*people|\bchro\b/.test(value)) return 9;
  if (/director|head|vp|vice president/.test(value) && /human|people|\bhr\b/.test(value)) return 8;
  if (/manager|lead/.test(value) && /talent acquisition|recruit/.test(value)) return 7;
  return 4;
}

function marketBoost(country: string) {
  const value = country.toLowerCase();
  if (/saudi|ksa/.test(value)) return 10;
  if (/united arab emirates|\buae\b|dubai|abu dhabi/.test(value)) return 9;
  if (/egypt|مصر/.test(value)) return 8;
  if (/south africa/.test(value)) return 8;
  if (/morocco|maroc|المغرب/.test(value)) return 6;
  if (/qatar|قطر|kuwait|الكويت/.test(value)) return 5;
  if (/jordan|الأردن|الاردن|oman|عمان|bahrain|البحرين|iraq|العراق/.test(value)) return 3;
  return 0;
}

function priority(score: number): { tier: MaritaPriorityTier; label: string } {
  if (score >= 85) return { tier: "P1", label: "Call first" };
  if (score >= 72) return { tier: "P2", label: "High priority" };
  if (score >= 60) return { tier: "P3", label: "Next up" };
  return { tier: "P4", label: "Needs data" };
}

function reliableAts(company: HubSpotRecord) {
  const ats = text(company, "detected_ats");
  const status = text(company, "ats_status").toLowerCase();
  const generic = /^(?:custom|unknown|not detected|not_detected|none|n\/a)$/i.test(ats);
  return Boolean(ats) && !generic && status === "detected";
}

function isPastOutboundCall(call: HubSpotRecord) {
  if (text(call, "hs_call_direction").toUpperCase() === "INBOUND") return false;
  const status = text(call, "hs_call_status").toUpperCase();
  if (["CANCELED", "QUEUED", "RINGING", "CONNECTING", "IN_PROGRESS", "HOLD"].includes(status)) return false;
  const timestamp = Date.parse(text(call, "hs_timestamp"));
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function companyCommerciallyExcluded(company: HubSpotRecord, deals: HubSpotRecord[]) {
  if (text(company, "account_type") === "Retention") return true;
  return deals.some((deal) => {
    if (text(deal, "pipeline") === RETENTION_PIPELINE_ID) return true;
    if (text(deal, "hs_is_closed_won").toLowerCase() === "true") return true;
    if (text(deal, "hs_is_closed").toLowerCase() === "false") return true;
    return PROPOSAL_SHARED_STAGES.has(text(deal, "dealstage"));
  });
}

export type MaritaPhoneFirstPriority = {
  generatedAt: string;
  taskCount: number;
  companyCount: number;
  companies: MaritaPriorityCompany[];
};

export async function getMaritaPhoneFirstPriority(): Promise<MaritaPhoneFirstPriority> {
  const allOpenCalls = await searchAll(
    "tasks",
    TASK_PROPS,
    [
      { propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID },
      { propertyName: "hs_task_type", operator: "EQ", value: "CALL" },
      { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
    ],
    ["hs_timestamp"],
  );
  const tasks = allOpenCalls.filter(isPhoneFirstTask);
  if (!tasks.length) return { generatedAt: new Date().toISOString(), taskCount: 0, companyCount: 0, companies: [] };

  const taskIds = tasks.map((task) => task.id);
  const [taskContacts, taskCompanies] = await Promise.all([
    readAssociations("tasks", "contacts", taskIds),
    readAssociations("tasks", "companies", taskIds),
  ]);
  const contactIds = unique(taskIds.flatMap((taskId) => taskContacts.get(taskId) ?? []));
  const contacts = await batchRead("contacts", contactIds, CONTACT_PROPS);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const contactCompanies = await readAssociations("contacts", "companies", contactIds);
  const companyIds = unique(taskIds.flatMap((taskId) => [
    ...(taskCompanies.get(taskId) ?? []),
    ...(taskContacts.get(taskId) ?? []).flatMap((contactId) => contactCompanies.get(contactId) ?? []),
  ]));
  const companies = await batchRead("companies", companyIds, COMPANY_PROPS);
  const companyById = new Map(companies.map((company) => [company.id, company]));

  const [companyDeals, maritaCalls] = await Promise.all([
    readAssociations("companies", "deals", companyIds),
    searchAll("calls", CALL_PROPS, [{ propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID }]),
  ]);
  const dealIds = unique(companyIds.flatMap((companyId) => companyDeals.get(companyId) ?? []));
  const deals = await batchRead("deals", dealIds, DEAL_PROPS);
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));

  const callIds = maritaCalls.map((call) => call.id);
  const [callContacts, callCompanies] = await Promise.all([
    readAssociations("calls", "contacts", callIds),
    readAssociations("calls", "companies", callIds),
  ]);
  const connectedCompanies = new Set<string>();
  const attemptCount = new Map<string, number>();
  const lastAttempt = new Map<string, string>();

  for (const call of maritaCalls) {
    if (!isPastOutboundCall(call)) continue;
    const associatedCompanies = unique([
      ...(callCompanies.get(call.id) ?? []),
      ...(callContacts.get(call.id) ?? []).flatMap((contactId) => contactCompanies.get(contactId) ?? []),
    ]).filter((companyId) => companyById.has(companyId));
    for (const companyId of associatedCompanies) {
      attemptCount.set(companyId, (attemptCount.get(companyId) ?? 0) + 1);
      const occurredAt = text(call, "hs_timestamp");
      if (occurredAt && occurredAt > (lastAttempt.get(companyId) ?? "")) lastAttempt.set(companyId, occurredAt);
      if (text(call, "hs_call_disposition") === CONNECTED_CALL_DISPOSITION) connectedCompanies.add(companyId);
    }
  }

  const grouped = new Map<string, Map<string, HubSpotRecord[]>>();
  for (const task of tasks) {
    const associatedContacts = taskContacts.get(task.id) ?? [];
    const directCompanies = taskCompanies.get(task.id) ?? [];
    for (const contactId of associatedContacts) {
      const contact = contactById.get(contactId);
      if (!contact || !contactPhone(contact)) continue;
      const associatedCompanies = unique([...(directCompanies), ...(contactCompanies.get(contactId) ?? [])]);
      for (const companyId of associatedCompanies) {
        if (!companyById.has(companyId)) continue;
        const companyBucket = grouped.get(companyId) ?? new Map<string, HubSpotRecord[]>();
        const personTasks = companyBucket.get(contactId) ?? [];
        if (!personTasks.some((item) => item.id === task.id)) personTasks.push(task);
        companyBucket.set(contactId, personTasks);
        grouped.set(companyId, companyBucket);
      }
    }
  }

  const output: MaritaPriorityCompany[] = [];
  for (const [companyId, contactTaskMap] of grouped) {
    const company = companyById.get(companyId);
    if (!company || connectedCompanies.has(companyId)) continue;
    const associatedDeals = (companyDeals.get(companyId) ?? []).map((id) => dealById.get(id)).filter((item): item is HubSpotRecord => Boolean(item));
    if (companyCommerciallyExcluded(company, associatedDeals)) continue;

    const contactRows: MaritaPriorityContactTask[] = [...contactTaskMap.entries()].map(([contactId, personTasks]) => {
      const contact = contactById.get(contactId)!;
      const phone = contactPhone(contact);
      const email = text(contact, "email");
      const dueAt = personTasks.map((task) => text(task, "hs_timestamp")).filter(Boolean).sort()[0] ?? "";
      const ids = unique(personTasks.map((task) => task.id));
      return {
        contactId,
        contactName: contactName(contact),
        contactTitle: text(contact, "jobtitle"),
        email,
        phone,
        hasPhone: Boolean(phone),
        hasEmail: Boolean(email),
        taskIds: ids,
        taskCount: ids.length,
        callableTaskIds: phone ? ids : [],
        dueAt,
        overdue: Boolean(dueAt && Date.parse(dueAt) < Date.now()),
        contactUrl: recordUrl("0-1", contactId),
      };
    }).sort((left, right) => (Number(right.hasPhone) * 1000 + roleRank(right.contactTitle) * 20) - (Number(left.hasPhone) * 1000 + roleRank(left.contactTitle) * 20));

    const best = contactRows[0];
    if (!best) continue;
    const allTaskIds = unique(contactRows.flatMap((contact) => contact.taskIds));
    const callableTaskIds = unique(contactRows.flatMap((contact) => contact.callableTaskIds));
    const taskRecords = allTaskIds.map((id) => tasks.find((task) => task.id === id)).filter((task): task is HubSpotRecord => Boolean(task));
    const primaryTask = [...taskRecords].sort((left, right) => text(left, "hs_timestamp").localeCompare(text(right, "hs_timestamp")))[0];
    const dueAt = taskRecords.map((task) => text(task, "hs_timestamp")).filter(Boolean).sort()[0] ?? "";
    const country = text(company, "gtm_country") || text(company, "country");
    const noAts = !reliableAts(company);
    const companyTier = text(company, "company_tier");
    const attempts = attemptCount.get(companyId) ?? 0;
    let score = 58 + roleRank(best.contactTitle) * 2 + marketBoost(country);
    if (text(primaryTask, "hs_task_priority") === "HIGH") score += 10;
    if (noAts) score += 6;
    if (companyTier === "A") score += 5;
    if (companyTier === "B") score += 3;
    if (attempts === 0) score += 5;
    score = Math.min(100, score);
    const ranked = priority(score);

    output.push({
      companyId,
      companyName: text(company, "name") || `Company ${companyId}`,
      domain: text(company, "domain"),
      country,
      companyTier,
      icpTier: text(company, "gtm_icp_tier"),
      detectedAts: text(company, "detected_ats"),
      atsStatus: text(company, "ats_status"),
      noAts,
      priority: ranked.tier,
      priorityLabel: ranked.label,
      priorityScore: score,
      priorityReasons: ["Verified SignalHire phone", "Best-fit HR / TA persona", attempts === 0 ? "Never attempted" : "No connected call", noAts ? "No ATS" : "ATS detected", country].filter(Boolean),
      contactId: best.contactId,
      contactName: best.contactName,
      contactTitle: best.contactTitle,
      email: best.email,
      phone: best.phone,
      hasEmail: best.hasEmail,
      hasPhone: best.hasPhone,
      contacts: contactRows,
      contactCount: contactRows.length,
      taskIds: allTaskIds,
      callableTaskIds,
      taskCount: allTaskIds.length,
      callableTaskCount: callableTaskIds.length,
      primaryTaskId: primaryTask?.id ?? "",
      primaryTaskSubject: text(primaryTask, "hs_task_subject"),
      dueAt,
      overdue: Boolean(dueAt && Date.parse(dueAt) < Date.now()),
      attemptCount: attempts,
      connectedCallCount: 0,
      noAnswerCount: 0,
      neverAttempted: attempts === 0,
      lastAttemptAt: lastAttempt.get(companyId) ?? "",
      companyUrl: recordUrl("0-2", companyId),
      contactUrl: best.contactUrl,
    });
  }

  output.sort((left, right) => right.priorityScore - left.priorityScore || left.companyName.localeCompare(right.companyName));
  return { generatedAt: new Date().toISOString(), taskCount: tasks.length, companyCount: output.length, companies: output };
}

export function mergeMaritaPriorityCompanies(base: MaritaPriorityCompany[], phoneFirst: MaritaPriorityCompany[]) {
  const merged = new Map(base.map((company) => [company.companyId, company]));
  for (const incoming of phoneFirst) {
    const existing = merged.get(incoming.companyId);
    if (!existing) {
      merged.set(incoming.companyId, incoming);
      continue;
    }
    const contacts = new Map(existing.contacts.map((contact) => [contact.contactId, contact]));
    for (const contact of incoming.contacts) {
      const current = contacts.get(contact.contactId);
      contacts.set(contact.contactId, current ? {
        ...current,
        taskIds: unique([...current.taskIds, ...contact.taskIds]),
        taskCount: unique([...current.taskIds, ...contact.taskIds]).length,
        callableTaskIds: unique([...current.callableTaskIds, ...contact.callableTaskIds]),
      } : contact);
    }
    const combinedContacts = [...contacts.values()].sort((left, right) => (Number(right.hasPhone) * 1000 + roleRank(right.contactTitle) * 20) - (Number(left.hasPhone) * 1000 + roleRank(left.contactTitle) * 20));
    const best = incoming.priorityScore >= existing.priorityScore && incoming.hasPhone ? incoming : existing;
    const taskIds = unique([...existing.taskIds, ...incoming.taskIds]);
    const callableTaskIds = unique([...existing.callableTaskIds, ...incoming.callableTaskIds]);
    merged.set(existing.companyId, {
      ...existing,
      priority: best.priority,
      priorityLabel: best.priorityLabel,
      priorityScore: Math.max(existing.priorityScore, incoming.priorityScore),
      priorityReasons: unique([...incoming.priorityReasons, ...existing.priorityReasons]),
      contactId: best.contactId,
      contactName: best.contactName,
      contactTitle: best.contactTitle,
      email: best.email,
      phone: best.phone,
      hasEmail: best.hasEmail,
      hasPhone: best.hasPhone,
      contacts: combinedContacts,
      contactCount: combinedContacts.length,
      taskIds,
      callableTaskIds,
      taskCount: taskIds.length,
      callableTaskCount: callableTaskIds.length,
      primaryTaskId: best.primaryTaskId,
      primaryTaskSubject: best.primaryTaskSubject,
      dueAt: [existing.dueAt, incoming.dueAt].filter(Boolean).sort()[0] ?? "",
      overdue: existing.overdue || incoming.overdue,
    });
  }
  return [...merged.values()].sort((left, right) => right.priorityScore - left.priorityScore || Number(right.overdue) - Number(left.overdue) || left.companyName.localeCompare(right.companyName));
}
