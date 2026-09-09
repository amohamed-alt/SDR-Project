import { NextRequest, NextResponse } from "next/server";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { DANIEL_OWNER_ID, MARITA_OWNER_ID } from "@/lib/daniel-evalufy";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_CUTOFF = "2026-09-13T00:00:00Z";
const REQUEST_TIMEOUT_MS = 45_000;
const BATCH_SIZE = 100;

const PLAN = [
  { date: "2026-09-13", target: 100 },
  { date: "2026-09-14", target: 100 },
  { date: "2026-09-15", target: 100 },
  { date: "2026-09-16", target: 100 },
  { date: "2026-09-17", target: 100 },
  { date: "2026-09-20", target: 50 },
  { date: "2026-09-21", target: 50 },
  { date: "2026-09-22", target: 50 },
  { date: "2026-09-23", target: 50 },
  { date: "2026-09-24", target: 50 },
] as const;

const COMPANY_PROPERTIES = [
  "name",
  "hubspot_owner_id",
  "account_type",
  "account_status",
  "customer_type",
  "company_type",
  "hs_lead_status",
  "csm",
  "csm_team",
] as const;

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "hubspot_owner_id",
  "phone",
  "mobilephone",
  "hs_whatsapp_phone_number",
  "whatsapp_phone_number",
  "whatsapp_number",
  "contact_number",
  "csm_owner",
  "hs_lead_status",
  "lifecyclestage",
] as const;

type PropertyBag = Record<string, unknown>;

type SelectedTransfer = {
  taskId: string;
  contactId: string;
  companyId: string;
  companyName: string;
  sourceDueAt: string;
  targetDate: string;
  targetDueAt: string;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return clean(value).toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function dueAt(date: string) {
  return `${date}T09:00:00+03:00`;
}

function dateKey(value: unknown) {
  const raw = clean(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

function sourceOwnerAllowed(value: unknown) {
  const owner = clean(value);
  return !owner || owner === MARITA_OWNER_ID;
}

function hasAnyPhone(properties: PropertyBag) {
  return [
    properties.mobilephone,
    properties.phone,
    properties.hs_whatsapp_phone_number,
    properties.whatsapp_phone_number,
    properties.whatsapp_number,
    properties.contact_number,
  ].some((value) => clean(value).length > 0);
}

function eligibleCompany(company: HubSpotRecord | undefined) {
  if (!company) return false;
  const properties = company.properties;
  const accountType = normalized(properties.account_type);
  const customerType = normalized(properties.customer_type);
  const accountStatus = normalized(properties.account_status);
  const companyType = normalized(properties.company_type);
  const leadStatus = normalized(properties.hs_lead_status);

  if (!sourceOwnerAllowed(properties.hubspot_owner_id)) return false;
  if (accountType.includes("retention") || customerType.includes("retention")) return false;
  if (clean(properties.csm) || clean(properties.csm_team)) return false;
  if (accountStatus === "active" || accountStatus === "churned") return false;
  if (/job\s*seeker/.test(companyType)) return false;
  if (/unqualified/.test(leadStatus)) return false;
  return true;
}

function eligibleContact(contact: HubSpotRecord | undefined) {
  if (!contact) return false;
  const properties = contact.properties;
  const leadStatus = normalized(properties.hs_lead_status);
  const lifecycle = normalized(properties.lifecyclestage);

  if (!sourceOwnerAllowed(properties.hubspot_owner_id)) return false;
  if (!hasAnyPhone(properties)) return false;
  if (clean(properties.csm_owner)) return false;
  if (/unqualified/.test(leadStatus)) return false;
  if (lifecycle === "customer") return false;
  return true;
}

function token() {
  const value = clean(process.env.HUBSPOT_PRIVATE_APP_TOKEN);
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

async function hubspotRequest<T>(path: string, init: RequestInit = {}) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`https://api.hubapi.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const text = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        const retryAfter = Number(response.headers.get("retry-after") || "0");
        await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : attempt * 1200));
        continue;
      }

      throw new Error(`HubSpot ${path} failed (${response.status}): ${text.slice(0, 700)}`);
    } catch (error) {
      lastError = error;
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("HubSpot request failed.");
}

async function batchUpdateTasks(transfers: SelectedTransfer[]) {
  const batches = chunks(transfers, BATCH_SIZE);
  for (const batch of batches) {
    await hubspotRequest("/crm/v3/objects/tasks/batch/update", {
      method: "POST",
      body: JSON.stringify({
        inputs: batch.map((item) => ({
          id: item.taskId,
          properties: {
            hubspot_owner_id: DANIEL_OWNER_ID,
            hs_timestamp: item.targetDueAt,
          },
        })),
      }),
    });
  }
}

async function readTaskCompanyIds(taskIds: string[]) {
  if (!taskIds.length) return new Set<string>();
  const [direct, contacts] = await Promise.all([
    readAssociations("tasks", "companies", taskIds),
    readAssociations("tasks", "contacts", taskIds),
  ]);
  const contactIds = unique([...contacts.values()].flat());
  const contactCompanies = await readAssociations("contacts", "companies", contactIds);
  const companyIds = new Set<string>();

  for (const taskId of taskIds) {
    for (const companyId of direct.get(taskId) || []) companyIds.add(companyId);
    for (const contactId of contacts.get(taskId) || []) {
      for (const companyId of contactCompanies.get(contactId) || []) companyIds.add(companyId);
    }
  }
  return companyIds;
}

async function executePlan(dryRun: boolean) {
  const planDates = new Set(PLAN.map((item) => item.date));

  const [existingDanielTasks, sourceTasks] = await Promise.all([
    searchAll(
      "tasks",
      ["hs_task_status", "hs_task_type", "hubspot_owner_id", "hs_timestamp"],
      [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: DANIEL_OWNER_ID },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
        { propertyName: "hs_task_type", operator: "EQ", value: "CALL" },
      ],
      ["hs_timestamp"],
    ),
    searchAll(
      "tasks",
      ["hs_task_subject", "hs_task_status", "hs_task_type", "hubspot_owner_id", "hs_timestamp"],
      [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
        { propertyName: "hs_task_type", operator: "EQ", value: "CALL" },
        { propertyName: "hs_timestamp", operator: "GTE", value: SOURCE_CUTOFF },
      ],
      ["hs_timestamp"],
    ),
  ]);

  const existingByDate = new Map<string, number>();
  const existingPlanTaskIds: string[] = [];
  for (const task of existingDanielTasks) {
    const date = dateKey(task.properties.hs_timestamp);
    if (!planDates.has(date as (typeof PLAN)[number]["date"])) continue;
    existingByDate.set(date, (existingByDate.get(date) || 0) + 1);
    existingPlanTaskIds.push(String(task.id));
  }

  const remainingByDate = new Map<string, number>();
  for (const item of PLAN) {
    remainingByDate.set(item.date, Math.max(0, item.target - (existingByDate.get(item.date) || 0)));
  }

  const totalNeeded = [...remainingByDate.values()].reduce((sum, value) => sum + value, 0);
  if (totalNeeded === 0) {
    return {
      success: true,
      dryRun,
      transferred: 0,
      totalNeeded: 0,
      sourceTasksScanned: 0,
      plan: PLAN.map((item) => ({
        ...item,
        existing: existingByDate.get(item.date) || 0,
        transferred: 0,
        final: existingByDate.get(item.date) || 0,
      })),
      sample: [],
    };
  }

  const sourceTaskIds = sourceTasks.map((task) => String(task.id));
  const [taskCompanies, taskContacts, existingDanielCompanyIds] = await Promise.all([
    readAssociations("tasks", "companies", sourceTaskIds),
    readAssociations("tasks", "contacts", sourceTaskIds),
    readTaskCompanyIds(existingPlanTaskIds),
  ]);

  const contactIds = unique([...taskContacts.values()].flat());
  const contactCompanies = await readAssociations("contacts", "companies", contactIds);
  const companyIds = new Set<string>();

  for (const taskId of sourceTaskIds) {
    for (const companyId of taskCompanies.get(taskId) || []) companyIds.add(companyId);
    for (const contactId of taskContacts.get(taskId) || []) {
      for (const companyId of contactCompanies.get(contactId) || []) companyIds.add(companyId);
    }
  }

  const [contacts, companies] = await Promise.all([
    batchRead("contacts", contactIds, CONTACT_PROPERTIES),
    batchRead("companies", [...companyIds], COMPANY_PROPERTIES),
  ]);

  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  const companyById = new Map(companies.map((company) => [String(company.id), company]));
  const usedCompanies = new Set(existingDanielCompanyIds);
  const selected: SelectedTransfer[] = [];

  let planIndex = 0;
  const advancePlan = () => {
    while (planIndex < PLAN.length && (remainingByDate.get(PLAN[planIndex].date) || 0) <= 0) planIndex += 1;
  };
  advancePlan();

  for (const task of sourceTasks) {
    if (selected.length >= totalNeeded || planIndex >= PLAN.length) break;
    const taskId = String(task.id);
    const taskContactIds = taskContacts.get(taskId) || [];
    if (!taskContactIds.length) continue;

    let chosenContact: HubSpotRecord | undefined;
    let chosenCompany: HubSpotRecord | undefined;

    for (const contactId of taskContactIds) {
      const contact = contactById.get(contactId);
      if (!eligibleContact(contact)) continue;

      const associatedCompanyIds = unique([
        ...(contactCompanies.get(contactId) || []),
        ...(taskCompanies.get(taskId) || []),
      ]);

      const company = associatedCompanyIds
        .map((companyId) => companyById.get(companyId))
        .find((candidate) => candidate && !usedCompanies.has(String(candidate.id)) && eligibleCompany(candidate));

      if (!company) continue;
      chosenContact = contact;
      chosenCompany = company;
      break;
    }

    if (!chosenContact || !chosenCompany) continue;

    advancePlan();
    if (planIndex >= PLAN.length) break;
    const planItem = PLAN[planIndex];
    const remaining = remainingByDate.get(planItem.date) || 0;
    if (remaining <= 0) continue;

    usedCompanies.add(String(chosenCompany.id));
    selected.push({
      taskId,
      contactId: String(chosenContact.id),
      companyId: String(chosenCompany.id),
      companyName: clean(chosenCompany.properties.name),
      sourceDueAt: clean(task.properties.hs_timestamp),
      targetDate: planItem.date,
      targetDueAt: dueAt(planItem.date),
    });
    remainingByDate.set(planItem.date, remaining - 1);
    advancePlan();
  }

  if (!dryRun && selected.length) await batchUpdateTasks(selected);

  const transferredByDate = new Map<string, number>();
  for (const item of selected) {
    transferredByDate.set(item.targetDate, (transferredByDate.get(item.targetDate) || 0) + 1);
  }

  const plan = PLAN.map((item) => {
    const existing = existingByDate.get(item.date) || 0;
    const transferred = transferredByDate.get(item.date) || 0;
    return {
      ...item,
      existing,
      transferred,
      final: existing + transferred,
      missing: Math.max(0, item.target - existing - transferred),
    };
  });

  return {
    success: plan.every((item) => item.final >= item.target),
    dryRun,
    transferred: selected.length,
    totalNeeded,
    sourceTasksScanned: sourceTasks.length,
    eligibleCompaniesUsed: selected.length,
    plan,
    sample: selected.slice(0, 25),
  };
}

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  }

  try {
    const payload = await request.json().catch(() => ({})) as { dryRun?: boolean };
    const result = await executePlan(payload.dryRun === true);
    return NextResponse.json(result, {
      status: result.success ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Daniel transfer plan failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Daniel transfer plan failed." },
      { status: 500 },
    );
  }
}
