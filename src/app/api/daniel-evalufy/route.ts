import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as pushProspect } from "@/app/api/prospecting/push/route";
import { compatibleCompanyIdentity, normalizedCompanyName } from "@/lib/company-dedupe";
import {
  DANIEL_COMPANY_PROPERTIES,
  DANIEL_CONTACT_PROPERTIES,
  DANIEL_EVALUFY_DAILY_TARGET,
  DANIEL_OWNER_ID,
  DANIEL_OWNER_NAME,
  MARITA_OWNER_ID,
  danielEvalufyDueAt,
  evaluateDanielCompany,
  evaluateDanielContact,
  isDanielEvalufyWorkDate,
} from "@/lib/daniel-evalufy";
import { batchRead, HubSpotApiError, readAssociations, searchAll } from "@/lib/hubspot";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVALUFY_PREFIX = "🧪 EVALUFY —";
const DIRECT_APPLICATION_LABEL = "Direct Application Form";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("transfer_existing"),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    limit: z.number().int().min(1).max(DANIEL_EVALUFY_DAILY_TARGET).default(DANIEL_EVALUFY_DAILY_TARGET),
  }),
  z.object({
    action: z.literal("push_net_new"),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    prospect: z.record(z.string(), z.unknown()),
  }),
  z.object({
    action: z.literal("status"),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);

function token() {
  const value = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

async function hubspotRequest<T>(path: string, init: RequestInit = {}) {
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
  if (!response.ok) {
    throw new Error(`HubSpot ${path} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function taskSubject(subject: unknown) {
  const current = clean(subject);
  if (current.startsWith(EVALUFY_PREFIX)) return current;
  const withoutFlame = current.replace(/^🔥\s*/, "");
  return `${EVALUFY_PREFIX} ${withoutFlame || "Call prospect"}`;
}

function taskBody(body: unknown) {
  const current = String(body ?? "").trim();
  const marker = "🧪 **Evalufy SDR Routing**";
  if (current.includes(marker)) return current;
  const addition = [
    marker,
    `Task owner: ${DANIEL_OWNER_NAME}`,
    "Company/contact ownership intentionally left blank.",
    "Eligibility: ATS detected · mobile available · zero company communication · no deals · net-new outreach.",
  ].join("\n");
  return current ? `${current}\n\n${addition}` : addition;
}

async function patchObject(objectType: string, objectId: string, properties: Record<string, string>) {
  if (!objectId || !Object.keys(properties).length) return;
  await hubspotRequest(`/crm/v3/objects/${objectType}/${encodeURIComponent(objectId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

async function readEngagementAssociations(companyIds: string[]) {
  const ids = unique(companyIds);
  if (!ids.length) {
    return {
      calls: new Map<string, string[]>(),
      meetings: new Map<string, string[]>(),
    };
  }

  const [calls, meetings] = await Promise.all([
    readAssociations("companies", "calls", ids),
    readAssociations("companies", "meetings", ids),
  ]);

  return { calls, meetings };
}

function hasDirectEngagement(
  companyId: string,
  engagementMaps: Awaited<ReturnType<typeof readEngagementAssociations>>,
) {
  return (engagementMaps.calls.get(companyId) || []).length > 0
    || (engagementMaps.meetings.get(companyId) || []).length > 0;
}

async function scheduledDanielTasks(dueAt: string) {
  const dueDate = dueAt.slice(0, 10);
  const tasks = await searchAll(
    "tasks",
    ["hs_task_subject", "hs_task_status", "hs_timestamp", "hubspot_owner_id"],
    [{ propertyName: "hubspot_owner_id", operator: "EQ", value: DANIEL_OWNER_ID }],
  );
  return tasks.filter((task) =>
    clean(task.properties.hs_task_subject).startsWith(EVALUFY_PREFIX)
      && clean(task.properties.hs_timestamp).slice(0, 10) === dueDate,
  );
}

async function clearSourceOwnership(company: HubSpotRecord | undefined, contact: HubSpotRecord | undefined) {
  if (company && clean(company.properties.hubspot_owner_id) === MARITA_OWNER_ID) {
    await patchObject("companies", String(company.id), { hubspot_owner_id: "" });
  }
  if (contact && clean(contact.properties.hubspot_owner_id) === MARITA_OWNER_ID) {
    await patchObject("contacts", String(contact.id), { hubspot_owner_id: "" });
  }
}

async function transferExisting(dueDate: string, limit: number) {
  if (!isDanielEvalufyWorkDate(dueDate)) {
    return {
      scheduledCount: 0,
      transferred: 0,
      remaining: 0,
      skipped: true,
      reason: "outside_evalufy_work_window",
    };
  }

  const dueAt = danielEvalufyDueAt(dueDate);
  const alreadyScheduled = await scheduledDanielTasks(dueAt);
  const remainingCapacity = Math.max(0, Math.min(limit, DANIEL_EVALUFY_DAILY_TARGET) - alreadyScheduled.length);

  if (!remainingCapacity) {
    return {
      scheduledCount: alreadyScheduled.length,
      transferred: 0,
      remaining: 0,
      skipped: false,
      taskIds: alreadyScheduled.map((task) => String(task.id)),
    };
  }

  const tasks = await searchAll(
    "tasks",
    ["hs_task_subject", "hs_task_body", "hs_task_status", "hs_task_type", "hubspot_owner_id", "hs_timestamp"],
    [
      { propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID },
      { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
      { propertyName: "hs_task_type", operator: "EQ", value: "CALL" },
    ],
    ["hs_timestamp"],
  );

  const taskIds = tasks.map((task) => String(task.id));
  const [directCompanyAssociations, taskContactAssociations] = await Promise.all([
    readAssociations("tasks", "companies", taskIds),
    readAssociations("tasks", "contacts", taskIds),
  ]);

  const contactIds = unique([...taskContactAssociations.values()].flat());
  const contactCompanyAssociations = await readAssociations("contacts", "companies", contactIds);

  const companyIds = new Set<string>();
  for (const taskId of taskIds) {
    for (const companyId of directCompanyAssociations.get(taskId) || []) companyIds.add(companyId);
    for (const contactId of taskContactAssociations.get(taskId) || []) {
      for (const companyId of contactCompanyAssociations.get(contactId) || []) companyIds.add(companyId);
    }
  }

  const [companies, contacts] = await Promise.all([
    batchRead("companies", [...companyIds], DANIEL_COMPANY_PROPERTIES),
    batchRead("contacts", contactIds, DANIEL_CONTACT_PROPERTIES),
  ]);

  const companyById = new Map(companies.map((company) => [String(company.id), company]));
  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));

  const preliminarilyEligibleCompanyIds = companies
    .filter((company) => evaluateDanielCompany(company.properties).eligible)
    .map((company) => String(company.id));

  const engagementMaps = await readEngagementAssociations(preliminarilyEligibleCompanyIds);
  const selected: Array<{
    task: HubSpotRecord;
    company: HubSpotRecord;
    contact: HubSpotRecord;
  }> = [];
  const usedCompanies = new Set<string>();

  for (const task of tasks) {
    if (selected.length >= remainingCapacity) break;
    const taskId = String(task.id);
    const taskContactIds = taskContactAssociations.get(taskId) || [];
    if (!taskContactIds.length) continue;

    const taskCompanyIds = new Set<string>(directCompanyAssociations.get(taskId) || []);
    for (const contactId of taskContactIds) {
      for (const companyId of contactCompanyAssociations.get(contactId) || []) taskCompanyIds.add(companyId);
    }

    let chosenCompany: HubSpotRecord | undefined;
    let chosenContact: HubSpotRecord | undefined;

    for (const companyId of taskCompanyIds) {
      if (usedCompanies.has(companyId)) continue;
      const company = companyById.get(companyId);
      if (!company || !evaluateDanielCompany(company.properties).eligible) continue;
      if (hasDirectEngagement(companyId, engagementMaps)) continue;

      const contact = taskContactIds
        .map((contactId) => contactById.get(contactId))
        .find((candidate) => candidate && evaluateDanielContact(candidate.properties).eligible);
      if (!contact) continue;

      chosenCompany = company;
      chosenContact = contact;
      break;
    }

    if (!chosenCompany || !chosenContact) continue;
    usedCompanies.add(String(chosenCompany.id));
    selected.push({ task, company: chosenCompany, contact: chosenContact });
  }

  const transferred: Array<{ taskId: string; companyId: string; contactId: string }> = [];
  for (const item of selected) {
    await clearSourceOwnership(item.company, item.contact);
    await patchObject("tasks", String(item.task.id), {
      hubspot_owner_id: DANIEL_OWNER_ID,
      hs_timestamp: dueAt,
      hs_task_subject: taskSubject(item.task.properties.hs_task_subject),
      hs_task_body: taskBody(item.task.properties.hs_task_body),
    });
    transferred.push({
      taskId: String(item.task.id),
      companyId: String(item.company.id),
      contactId: String(item.contact.id),
    });
  }

  const scheduledCount = alreadyScheduled.length + transferred.length;
  return {
    scheduledCount,
    transferred: transferred.length,
    remaining: Math.max(0, DANIEL_EVALUFY_DAILY_TARGET - scheduledCount),
    skipped: false,
    taskIds: [...alreadyScheduled.map((task) => String(task.id)), ...transferred.map((item) => item.taskId)],
    sample: transferred.slice(0, 20),
  };
}

function prospectDomain(prospect: Record<string, unknown>) {
  return normalizeCompanyDomain(clean(prospect.companyDomain) || clean(prospect.companyWebsite));
}

async function findExistingCompanyId(prospect: Record<string, unknown>) {
  const domain = prospectDomain(prospect);
  if (domain) {
    const matches = await searchAll(
      "companies",
      ["name", "domain", "hubspot_owner_id"],
      [{ propertyName: "domain", operator: "EQ", value: domain }],
    );
    if (matches[0]) return String(matches[0].id);
  }

  const companyName = clean(prospect.company);
  if (!companyName) return "";

  const exact = await searchAll(
    "companies",
    ["name", "domain", "hubspot_owner_id"],
    [{ propertyName: "name", operator: "EQ", value: companyName }],
  );
  const exactCompatible = exact.find((match) => compatibleCompanyIdentity({
    requestedName: companyName,
    requestedDomain: domain,
    existingName: clean(match.properties.name),
    existingDomain: clean(match.properties.domain),
  }));
  if (exactCompatible) return String(exactCompatible.id);

  const token = normalizedCompanyName(companyName)
    .split(" ")
    .filter((part) => part.length >= 3)
    .sort((left, right) => right.length - left.length)[0];
  if (!token) return "";

  const fuzzy = await searchAll(
    "companies",
    ["name", "domain", "hubspot_owner_id"],
    [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: token }],
  );
  const compatible = fuzzy.find((match) => compatibleCompanyIdentity({
    requestedName: companyName,
    requestedDomain: domain,
    existingName: clean(match.properties.name),
    existingDomain: clean(match.properties.domain),
  }));
  return compatible ? String(compatible.id) : "";
}

function prospectEmails(prospect: Record<string, unknown>) {
  const emails = Array.isArray(prospect.emails) ? prospect.emails : [];
  return unique([clean(prospect.email), ...emails.map(clean)]);
}

function prospectPhones(prospect: Record<string, unknown>) {
  const phones = Array.isArray(prospect.phones) ? prospect.phones : [];
  return unique([clean(prospect.phone), ...phones.map(clean)]);
}

async function findExistingContactId(prospect: Record<string, unknown>) {
  for (const email of prospectEmails(prospect).slice(0, 5)) {
    const matches = await searchAll(
      "contacts",
      ["email", "hubspot_owner_id", "mobilephone", "phone"],
      [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }],
    );
    if (matches[0]) return String(matches[0].id);
  }

  const linkedinUrl = clean(prospect.linkedinUrl);
  if (!linkedinUrl) return "";
  try {
    const matches = await searchAll(
      "contacts",
      ["gtm_linkedin_url", "hubspot_owner_id", "mobilephone", "phone"],
      [{ propertyName: "gtm_linkedin_url", operator: "EQ", value: linkedinUrl }],
    );
    return matches[0] ? String(matches[0].id) : "";
  } catch (error) {
    if (error instanceof HubSpotApiError && [400, 404].includes(error.status)) return "";
    throw error;
  }
}

async function assertExistingRecordsSafe(prospect: Record<string, unknown>) {
  const [companyId, contactId] = await Promise.all([
    findExistingCompanyId(prospect),
    findExistingContactId(prospect),
  ]);

  let company: HubSpotRecord | undefined;
  let contact: HubSpotRecord | undefined;

  if (companyId) {
    company = (await batchRead("companies", [companyId], DANIEL_COMPANY_PROPERTIES))[0];
    if (!company) throw new Error("Existing company could not be verified.");
    const result = evaluateDanielCompany({
      ...company.properties,
      detected_ats: clean(company.properties.detected_ats) || clean(prospect.detectedAts),
      ats_status: clean(company.properties.ats_status) || (clean(prospect.detectedAts) ? "detected" : ""),
    });
    if (!result.eligible) throw new Error(`Existing company is not Daniel-Evalufy eligible: ${result.reasons.join(", ")}`);
    const engagements = await readEngagementAssociations([companyId]);
    if (hasDirectEngagement(companyId, engagements)) {
      throw new Error("Existing company has call or meeting activity.");
    }
  }

  if (contactId) {
    contact = (await batchRead("contacts", [contactId], DANIEL_CONTACT_PROPERTIES))[0];
    if (!contact) throw new Error("Existing contact could not be verified.");
    const result = evaluateDanielContact(contact.properties, { requireMobile: false });
    if (!result.eligible) throw new Error(`Existing contact is not Daniel-Evalufy eligible: ${result.reasons.join(", ")}`);
  }

  return { company, contact };
}

async function readTask(taskId: string) {
  return (await batchRead("tasks", [taskId], ["hs_task_subject", "hs_task_body", "hubspot_owner_id", "hs_timestamp"]))[0];
}

async function finalizeNetNewTask(payload: Record<string, unknown>, dueDate: string) {
  const dueAt = danielEvalufyDueAt(dueDate);
  const taskId = clean(payload.taskId);
  const companyId = clean(payload.companyId);
  const contactId = clean(payload.contactId);
  if (!taskId || !contactId) throw new Error("Prospecting push did not return a task/contact.");

  const [task, company, contact] = await Promise.all([
    readTask(taskId),
    companyId ? batchRead("companies", [companyId], DANIEL_COMPANY_PROPERTIES).then((rows) => rows[0]) : Promise.resolve(undefined),
    batchRead("contacts", [contactId], DANIEL_CONTACT_PROPERTIES).then((rows) => rows[0]),
  ]);

  if (!task || !contact) throw new Error("Created prospect records could not be verified.");
  if (company && ![MARITA_OWNER_ID, ""].includes(clean(company.properties.hubspot_owner_id))) {
    throw new Error("Company ownership changed during push; task was not reassigned to Daniel.");
  }
  if (![MARITA_OWNER_ID, ""].includes(clean(contact.properties.hubspot_owner_id))) {
    throw new Error("Contact ownership changed during push; task was not reassigned to Daniel.");
  }

  const firstPhone = clean(payload.firstPhone);
  const contactUpdates: Record<string, string> = {};
  if (clean(contact.properties.hubspot_owner_id) === MARITA_OWNER_ID) contactUpdates.hubspot_owner_id = "";
  if (!clean(contact.properties.mobilephone) && firstPhone) contactUpdates.mobilephone = firstPhone;
  if (Object.keys(contactUpdates).length) await patchObject("contacts", contactId, contactUpdates);

  if (company && clean(company.properties.hubspot_owner_id) === MARITA_OWNER_ID) {
    await patchObject("companies", companyId, { hubspot_owner_id: "" });
  }

  await patchObject("tasks", taskId, {
    hubspot_owner_id: DANIEL_OWNER_ID,
    hs_timestamp: dueAt,
    hs_task_subject: taskSubject(task.properties.hs_task_subject),
    hs_task_body: taskBody(task.properties.hs_task_body),
  });

  return { taskId, companyId, contactId, dueAt };
}

async function pushNetNew(request: NextRequest, dueDate: string, prospect: Record<string, unknown>) {
  if (!isDanielEvalufyWorkDate(dueDate)) {
    return NextResponse.json({ error: "Due date is outside Daniel Evalufy work window." }, { status: 400 });
  }

  const scheduled = await scheduledDanielTasks(danielEvalufyDueAt(dueDate));
  if (scheduled.length >= DANIEL_EVALUFY_DAILY_TARGET) {
    return NextResponse.json({
      scheduled: false,
      capacityFull: true,
      scheduledCount: scheduled.length,
      dueDate,
    });
  }

  const phones = prospectPhones(prospect);
  const detectedAts = clean(prospect.detectedAts);
  if (!phones.length) return NextResponse.json({ error: "Mobile/phone is required." }, { status: 400 });
  if (!detectedAts || detectedAts === DIRECT_APPLICATION_LABEL) {
    return NextResponse.json({ error: "A detected ATS is required." }, { status: 400 });
  }

  await assertExistingRecordsSafe(prospect);

  const forwardedProspect = {
    ...prospect,
    assignmentMode: "marita",
    phone: phones[0],
    phones,
    source: clean(prospect.source) || "Daniel Evalufy Daily",
  };

  const forwarded = new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(forwardedProspect),
  });

  const baseResponse = await pushProspect(forwarded);
  const basePayload = await baseResponse.json() as Record<string, unknown>;
  if (!baseResponse.ok) return NextResponse.json(basePayload, { status: baseResponse.status });

  const finalized = await finalizeNetNewTask(
    { ...basePayload, firstPhone: phones[0] },
    dueDate,
  );

  return NextResponse.json({
    ...basePayload,
    ...finalized,
    scheduled: true,
    taskOwnerId: DANIEL_OWNER_ID,
    taskOwnerName: DANIEL_OWNER_NAME,
    companyContactOwnership: "unowned",
    dueDate,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  }

  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid Daniel Evalufy payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    if (parsed.data.action === "status") {
      if (!isDanielEvalufyWorkDate(parsed.data.dueDate)) {
        return NextResponse.json({ dueDate: parsed.data.dueDate, scheduledCount: 0, active: false });
      }
      const tasks = await scheduledDanielTasks(danielEvalufyDueAt(parsed.data.dueDate));
      return NextResponse.json({
        dueDate: parsed.data.dueDate,
        active: true,
        scheduledCount: tasks.length,
        target: DANIEL_EVALUFY_DAILY_TARGET,
        remaining: Math.max(0, DANIEL_EVALUFY_DAILY_TARGET - tasks.length),
      });
    }

    if (parsed.data.action === "transfer_existing") {
      const result = await transferExisting(parsed.data.dueDate, parsed.data.limit);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    return await pushNetNew(request, parsed.data.dueDate, parsed.data.prospect);
  } catch (error) {
    console.error("Daniel Evalufy routing failed", error);
    const message = error instanceof Error ? error.message : "Daniel Evalufy routing failed.";
    const status = /not Daniel-Evalufy eligible|has call or meeting activity|outside Daniel Evalufy|required/i.test(message)
      ? 409
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
