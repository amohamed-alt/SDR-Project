import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { batchRead, readAssociations } from "@/lib/hubspot";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import {
  DANIEL_COMPANY_PROPERTIES,
  DANIEL_CONTACT_PROPERTIES,
  DANIEL_OWNER_ID,
  MARITA_OWNER_ID,
  evaluateDanielCompany,
  evaluateDanielContact,
} from "@/lib/daniel-evalufy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const transferSchema = z.object({
  taskIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
});

const TASK_PROPS = ["hs_task_status", "hs_task_type", "hubspot_owner_id"] as const;

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function token() {
  const value = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

function isOpenMaritaCallTask(properties: Record<string, unknown>) {
  return String(properties.hubspot_owner_id ?? "") === MARITA_OWNER_ID
    && properties.hs_task_status !== "COMPLETED"
    && properties.hs_task_type === "CALL";
}

async function batchUpdateTaskOwners(taskIds: string[], dueAt: string) {
  const HUBSPOT_API = "https://api.hubapi.com";
  for (const batch of chunks(taskIds, 100)) {
    const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/tasks/batch/update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: batch.map((id) => ({ id, properties: { hubspot_owner_id: DANIEL_OWNER_ID, hs_timestamp: dueAt } })),
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HubSpot task update failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
}

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  }

  const parsed = transferSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid transfer request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const seedTaskIds = unique(parsed.data.taskIds);
    const dueAt = `${parsed.data.dueDate}T${parsed.data.dueTime}:00+03:00`;

    // Step 1 - resolve which COMPANIES the selection points at. The company,
    // not the task, is the unit of transfer: if one of its tasks qualifies
    // for Daniel, every other open Marita call task at that same company
    // must move with it, or the company ends up split between two owners
    // (exactly the mix-up this route used to allow).
    const seedTasks = await batchRead("tasks", seedTaskIds, TASK_PROPS);
    const seedOpenTaskIds = seedTasks.filter((task) => isOpenMaritaCallTask(task.properties)).map((task) => String(task.id));

    const [seedTaskContacts, seedTaskCompanies] = await Promise.all([
      readAssociations("tasks", "contacts", seedOpenTaskIds),
      readAssociations("tasks", "companies", seedOpenTaskIds),
    ]);
    const seedContactIds = unique([...seedTaskContacts.values()].flat());
    const seedContactCompanies = await readAssociations("contacts", "companies", seedContactIds);

    const companyIds = new Set<string>();
    for (const taskId of seedOpenTaskIds) {
      for (const id of seedTaskCompanies.get(taskId) || []) companyIds.add(id);
      for (const contactId of seedTaskContacts.get(taskId) || []) {
        for (const id of seedContactCompanies.get(contactId) || []) companyIds.add(id);
      }
    }
    const targetCompanyIds = [...companyIds];

    // Step 2 - for every one of those companies, pull its FULL set of open
    // tasks and contacts, not just whichever one the user happened to select.
    // Tasks are not reliably associated with companies directly in HubSpot —
    // go through contacts (company -> contacts -> tasks), the same path the
    // working priority queue itself uses, instead of a direct company->task
    // association that mostly comes back empty.
    const [companyContacts, companies] = await Promise.all([
      readAssociations("companies", "contacts", targetCompanyIds),
      batchRead("companies", targetCompanyIds, DANIEL_COMPANY_PROPERTIES),
    ]);
    const companyById = new Map(companies.map((company) => [String(company.id), company]));

    const allContactIds = unique([...companyContacts.values()].flat());
    const [allContacts, contactTasks] = await Promise.all([
      batchRead("contacts", allContactIds, DANIEL_CONTACT_PROPERTIES),
      readAssociations("contacts", "tasks", allContactIds),
    ]);
    const contactById = new Map(allContacts.map((contact) => [String(contact.id), contact]));

    const taskContactAssoc = new Map<string, string[]>();
    for (const [contactId, taskIds] of contactTasks) {
      for (const taskId of taskIds) taskContactAssoc.set(taskId, [...(taskContactAssoc.get(taskId) || []), contactId]);
    }
    const allTaskIds = unique([...contactTasks.values()].flat());
    const allTasks = await batchRead("tasks", allTaskIds, TASK_PROPS);
    const taskById = new Map(allTasks.map((task) => [String(task.id), task]));

    const openTaskIdsByCompany = new Map(
      targetCompanyIds.map((companyId) => {
        const contactIds = companyContacts.get(companyId) || [];
        const taskIds = unique(contactIds.flatMap((contactId) => contactTasks.get(contactId) || []));
        return [companyId, taskIds.filter((taskId) => {
          const task = taskById.get(taskId);
          return task && isOpenMaritaCallTask(task.properties);
        })];
      }),
    );

    // Step 3 - apply eligibility once per company (gate) and once per
    // contact (which of that company's tasks actually move).
    const eligible: string[] = [];
    const skippedCompanies: { companyId: string; companyName: string; reasons: string[] }[] = [];
    const skippedTasks: { taskId: string; companyId: string; reasons: string[] }[] = [];

    for (const companyId of targetCompanyIds) {
      const company = companyById.get(companyId);
      const companyName = String(company?.properties.name ?? companyId);
      const companyTaskIds = openTaskIdsByCompany.get(companyId) || [];
      if (!company) { skippedCompanies.push({ companyId, companyName, reasons: ["company_not_found"] }); continue; }

      const companyCheck = evaluateDanielCompany(company.properties);
      if (!companyCheck.eligible) {
        skippedCompanies.push({ companyId, companyName, reasons: companyCheck.reasons });
        continue;
      }

      if (!companyTaskIds.length) {
        skippedCompanies.push({ companyId, companyName, reasons: ["no_open_tasks_found"] });
        continue;
      }

      let anyEligible = false;
      for (const taskId of companyTaskIds) {
        const contactIds = taskContactAssoc.get(taskId) || [];
        const contactCheck = contactIds.length
          ? contactIds.map((id) => contactById.get(id)).find((contact) => contact && evaluateDanielContact(contact.properties).eligible)
          : undefined;
        if (contactCheck) {
          eligible.push(taskId);
          anyEligible = true;
        } else {
          const reasons = contactIds.length
            ? unique(contactIds.flatMap((id) => { const c = contactById.get(id); return c ? evaluateDanielContact(c.properties).reasons : ["contact_not_found"]; }))
            : ["no_associated_contact"];
          skippedTasks.push({ taskId, companyId, reasons });
        }
      }
      if (!anyEligible) {
        skippedCompanies.push({ companyId, companyName, reasons: ["no_eligible_contact_in_company"] });
      }
    }

    if (eligible.length) await batchUpdateTaskOwners(eligible, dueAt);

    return NextResponse.json({
      ok: true,
      requestedTasks: seedTaskIds.length,
      companiesConsidered: targetCompanyIds.length,
      transferred: eligible.length,
      skippedCompanies,
      skippedTasks,
      dueAt,
    });
  } catch (error) {
    console.error("Marita-to-Daniel transfer failed", error);
    return NextResponse.json({
      error: "Unable to transfer selected tasks to Daniel",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
