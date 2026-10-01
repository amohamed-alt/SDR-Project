import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MARITA_DAILY_CAP = 70;
export const ELEVATUS_DAILY_TARGET = 10;
const TIME_ZONE = "Africa/Cairo";

export type ScheduledTask = {
  id: string;
  properties: Record<string, string | null | undefined>;
};
type Reservation = {
  contactId: string;
  companyId: string;
  dueAt: string;
  elevatus: boolean;
  taskId?: string;
};
type Journal = { version: 1; reservations: Reservation[] };

export class MaritaScheduleError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "MaritaScheduleError";
    this.status = status;
  }
}

export function cairoDate(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new MaritaScheduleError("Invalid task date; capacity cannot be verified.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDay(day: string) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function cairoMorning(day: string) {
  // Nine AM is outside Cairo's DST transition hour. Resolve its UTC offset
  // from the timezone database instead of retaining summer's fixed +03:00.
  const noon = new Date(`${day}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "shortOffset" })
    .formatToParts(noon).find((p) => p.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part || "");
  if (!match) throw new MaritaScheduleError("Unable to resolve Cairo timezone.");
  const offset = (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === "+" ? 1 : -1);
  return new Date(Date.parse(`${day}T09:00:00Z`) - offset * 60_000).toISOString();
}

export function planMaritaTask(tasks: ScheduledTask[], reservations: Reservation[], elevatus: boolean, now = new Date(), policy = { ownerId: "31644369", dailyCap: MARITA_DAILY_CAP, elevatusTarget: ELEVATUS_DAILY_TARGET }) {
  const counts = new Map<string, { total: number; elevatus: number }>();
  const observed = new Set<string>();
  const today = cairoDate(now);
  let carry = 0;
  function count(dueAt: string, isElevatus: boolean) {
    const day = cairoDate(dueAt);
    // Outstanding work due today or earlier consumes future capacity first.
    // Its CRM date stays intact, including any promised follow-up date.
    if (day <= today) { carry += 1; return; }
    const entry = counts.get(day) || { total: 0, elevatus: 0 };
    entry.total += 1;
    entry.elevatus += Number(isElevatus);
    counts.set(day, entry);
  }
  for (const task of tasks) {
    if (observed.has(task.id)) continue;
    observed.add(task.id);
    if (task.properties.hubspot_owner_id !== policy.ownerId || task.properties.hs_task_status === "COMPLETED") continue;
    if (!task.properties.hs_timestamp) throw new MaritaScheduleError(`An open task for SDR ${policy.ownerId} has no date; reconcile it before automatic scheduling.`);
    count(task.properties.hs_timestamp, /\belevatus\b/i.test(task.properties.hs_task_subject || ""));
  }
  for (const reservation of reservations) {
    if (!reservation.taskId || !observed.has(reservation.taskId)) count(reservation.dueAt, reservation.elevatus);
  }
  let day = addDay(cairoDate(now));
  for (let checked = 0; checked < 366; checked++, day = addDay(day)) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday === 5 || weekday === 6) continue;
    const used = counts.get(day) || { total: 0, elevatus: 0 };
    const carried = Math.min(carry, Math.max(0, policy.dailyCap - used.total));
    carry -= carried;
    used.total += carried;
    const reservedForElevatus = Math.max(0, policy.elevatusTarget - used.elevatus);
    const hasRoom = elevatus
      ? used.total < policy.dailyCap && used.elevatus < policy.elevatusTarget
      : used.total < policy.dailyCap - reservedForElevatus;
    if (hasRoom) return cairoMorning(day);
  }
  throw new MaritaScheduleError("No Marita capacity is available in the next year.");
}

async function readJournal(file: string): Promise<Journal> {
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, reservations: [] };
    throw error;
  }
  const journal = JSON.parse(raw) as Journal;
  if (journal.version !== 1 || !Array.isArray(journal.reservations) || journal.reservations.some((r) =>
    !r || typeof r.contactId !== "string" || typeof r.companyId !== "string" ||
    typeof r.elevatus !== "boolean" || typeof r.dueAt !== "string" || !Number.isFinite(Date.parse(r.dueAt)) ||
    (r.taskId !== undefined && typeof r.taskId !== "string"))) {
    throw new MaritaScheduleError("Invalid Marita scheduling journal; automatic scheduling is paused.", 503);
  }
  return journal;
}

async function saveJournal(file: string, journal: Journal) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(journal), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

export async function createScheduledMaritaTask<T extends { id: string }>(input: {
  contactId: string;
  companyId: string;
  elevatus: boolean;
  readTasks: () => Promise<ScheduledTask[]>;
  createTask: (dueAt: string) => Promise<T>;
  now?: Date;
  stateDirectory?: string;
  ownerId?: "31644369" | "37624223";
}) {
  const ownerId = input.ownerId || "31644369";
  const directory = input.stateDirectory || (ownerId === "37624223" ? "/app/data/daniel-task-schedule" : "/app/data/marita-task-schedule");
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, "lock");
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new MaritaScheduleError("Marita scheduling is busy or requires reconciliation after a stopped worker.", 503);
    }
    throw error;
  }
  try {
    const file = path.join(directory, "reservations.json");
    const journal = await readJournal(file);
    const now = input.now || new Date();
    const today = cairoDate(now);
    // Retain uncertain writes indefinitely. A network timeout is not evidence
    // that HubSpot failed to create the task. Never retry that company's POST.
    journal.reservations = journal.reservations.filter((r) => !r.taskId || cairoDate(r.dueAt) >= today);
    const existing = journal.reservations.find((r) => r.contactId === input.contactId || (input.companyId && r.companyId === input.companyId));
    if (existing) throw new MaritaScheduleError(`A Marita task is already reserved for this contact/company${existing.taskId ? ` (task ${existing.taskId})` : "; reconcile the previous uncertain write"}.`);
    const tasks = await input.readTasks();
    const dueAt = planMaritaTask(tasks, journal.reservations, input.elevatus, now, { ownerId, dailyCap: ownerId === "37624223" ? 50 : MARITA_DAILY_CAP, elevatusTarget: ownerId === "37624223" ? 0 : ELEVATUS_DAILY_TARGET });
    const reservation: Reservation = { contactId: input.contactId, companyId: input.companyId, dueAt, elevatus: input.elevatus };
    journal.reservations.push(reservation);
    await saveJournal(file, journal);
    const task = await input.createTask(dueAt);
    if (!task.id) throw new MaritaScheduleError("HubSpot did not return a task ID; reconcile the reserved write.", 503);
    reservation.taskId = String(task.id);
    await saveJournal(file, journal);
    return { task, dueAt };
  } finally {
    await rmdir(lock);
  }
}
