import { batchRead } from "@/lib/hubspot";
import { getMaritaPhoneFirstPriority } from "@/lib/marita-phone-first-priority";
import type { HubSpotRecord } from "@/lib/types";

const MARITA_OWNER_ID = "31644369";
const PHONE_FIRST_SUBJECT = "🔥 SALES SIGNAL —";
const TASK_PROPS = ["hs_task_subject", "hs_task_status", "hs_task_type", "hubspot_owner_id"] as const;

function text(record: HubSpotRecord | undefined, key: string) {
  return String(record?.properties?.[key] ?? "").trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isPhoneFirstTask(task: HubSpotRecord) {
  return text(task, "hubspot_owner_id") === MARITA_OWNER_ID
    && text(task, "hs_task_type") === "CALL"
    && text(task, "hs_task_status") !== "COMPLETED"
    && text(task, "hs_task_subject").startsWith(PHONE_FIRST_SUBJECT);
}

export async function rescheduleMaritaPhoneFirstTasks(taskIds: string[], dueDate: string, dueTime: string) {
  const ids = unique(taskIds).slice(0, 1000);
  if (!ids.length) return { updated: 0, skipped: 0 };

  const queue = await getMaritaPhoneFirstPriority();
  const allowedTaskIds = new Set(queue.companies.flatMap((company) => company.callableTaskIds));
  const tasks = await batchRead("tasks", ids, TASK_PROPS);
  const eligible = tasks.filter((task) => allowedTaskIds.has(task.id) && isPhoneFirstTask(task));
  const dueAt = `${dueDate}T${dueTime}:00+03:00`;
  const token = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured");

  let updated = 0;
  for (const task of eligible) {
    const response = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${task.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { hs_timestamp: dueAt } }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HubSpot task ${task.id} reschedule failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
    updated += 1;
  }

  return { updated, skipped: ids.length - updated };
}
