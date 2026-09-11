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
import type { HubSpotRecord } from "@/lib/types";

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
    const taskIds = unique(parsed.data.taskIds);
    const dueAt = `${parsed.data.dueDate}T${parsed.data.dueTime}:00+03:00`;

    // Re-validate against live HubSpot data — never trust the client's filtered
    // list for a mutation this consequential. A task only transfers if it is
    // still an open Marita call task AND its contact/company still pass the
    // same eligibility rules used by the original Daniel transfer plan.
    const tasks = await batchRead("tasks", taskIds, TASK_PROPS);
    const openMaritaTasks = tasks.filter((task) =>
      String(task.properties.hubspot_owner_id ?? "") === MARITA_OWNER_ID
      && task.properties.hs_task_status !== "COMPLETED"
      && task.properties.hs_task_type === "CALL",
    );
    const openTaskIds = openMaritaTasks.map((task) => String(task.id));

    const [taskContacts, taskCompanies] = await Promise.all([
      readAssociations("tasks", "contacts", openTaskIds),
      readAssociations("tasks", "companies", openTaskIds),
    ]);
    const contactIds = unique([...taskContacts.values()].flat());
    const contactCompanies = await readAssociations("contacts", "companies", contactIds);

    const companyIds = new Set<string>();
    for (const taskId of openTaskIds) {
      for (const id of taskCompanies.get(taskId) || []) companyIds.add(id);
      for (const contactId of taskContacts.get(taskId) || []) {
        for (const id of contactCompanies.get(contactId) || []) companyIds.add(id);
      }
    }

    const [contacts, companies] = await Promise.all([
      batchRead("contacts", contactIds, DANIEL_CONTACT_PROPERTIES),
      batchRead("companies", [...companyIds], DANIEL_COMPANY_PROPERTIES),
    ]);
    const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));
    const companyById = new Map(companies.map((company) => [String(company.id), company]));

    const usedCompanies = new Set<string>();
    const eligible: string[] = [];
    const skipped: { taskId: string; reasons: string[] }[] = [];

    for (const taskId of openTaskIds) {
      const reasons: string[] = [];
      const contactCandidates = (taskContacts.get(taskId) || [])
        .map((id) => contactById.get(id))
        .filter((contact): contact is HubSpotRecord => Boolean(contact));

      let matchedCompany: string | undefined;
      for (const contact of contactCandidates) {
        const contactCheck = evaluateDanielContact(contact.properties);
        if (!contactCheck.eligible) { reasons.push(...contactCheck.reasons); continue; }

        const associatedCompanyIds = unique([
          ...(contactCompanies.get(String(contact.id)) || []),
          ...(taskCompanies.get(taskId) || []),
        ]);
        const company = associatedCompanyIds
          .map((id) => companyById.get(id))
          .find((candidate): candidate is HubSpotRecord => {
            if (!candidate || usedCompanies.has(String(candidate.id))) return false;
            return evaluateDanielCompany(candidate.properties).eligible;
          });
        if (company) { matchedCompany = String(company.id); break; }
      }

      if (matchedCompany) {
        usedCompanies.add(matchedCompany);
        eligible.push(taskId);
      } else {
        skipped.push({ taskId, reasons: unique(reasons.length ? reasons : ["no_eligible_contact_company"]) });
      }
    }

    if (eligible.length) await batchUpdateTaskOwners(eligible, dueAt);

    return NextResponse.json({
      ok: true,
      requested: taskIds.length,
      transferred: eligible.length,
      skipped: skipped.length + (taskIds.length - openTaskIds.length),
      skippedTasks: skipped,
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
