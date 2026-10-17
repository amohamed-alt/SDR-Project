import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePersonUrl } from "./ai-sdr-qualification.ts";

type JsonObject = Record<string, unknown>;
export type SalesNavPushAttempt = {
  version: 1;
  identity: string;
  ownerId: string;
  dueAt: string;
  prospect: JsonObject;
  contactId: string;
  companyId: string;
  taskId: string;
  contactWriteStarted: boolean;
  companyWriteStarted: boolean;
  taskWriteStarted: boolean;
  result?: JsonObject;
};
type PushContext = { attempt: SalesNavPushAttempt; save: () => Promise<void>; directory: string };
const context = new AsyncLocalStorage<PushContext>();

export class SalesNavPushAttemptError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

const LEASE_MS = 10 * 60_000;

async function acquireLease(lock: string, waitForActiveMs = 0) {
  const leaseId = randomUUID();
  const ownerFile = path.join(lock, "owner.json");
  const owns = async () => {
    try { return JSON.parse(await readFile(ownerFile, "utf8")).id === leaseId; }
    catch { return false; }
  };
  const renew = async () => {
    if (!await owns()) throw new SalesNavPushAttemptError("The push lease changed. Refresh its saved checkpoints before retrying.");
    const temporary = path.join(lock, `${leaseId}.${randomUUID()}.renew`);
    await writeFile(temporary, JSON.stringify({ id: leaseId, expiresAt: Date.now() + LEASE_MS }), { mode: 0o600 });
    if (!await owns()) throw new SalesNavPushAttemptError("The push lease changed. Refresh its saved checkpoints before retrying.");
    await rename(temporary, ownerFile);
  };
  const waitUntil = Date.now() + waitForActiveMs;
  let staleClaims = 0;
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let expiresAt = Infinity;
      try { expiresAt = Number(JSON.parse(await readFile(ownerFile, "utf8")).expiresAt); }
      catch { expiresAt = (await stat(lock)).mtimeMs + LEASE_MS; }
      if (Number.isFinite(expiresAt) && expiresAt > Date.now() && Date.now() < waitUntil) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      if (!Number.isFinite(expiresAt) || expiresAt > Date.now() || staleClaims++ >= 2) {
        throw new SalesNavPushAttemptError("This push is already running. An interrupted worker can resume after its 10-minute safety lease expires.");
      }
      // Moving the expired lease is atomic. Its old worker must pass owns()
      // again before a checkpoint/write; uncertain POST markers stay durable.
      const stale = `${lock}.expired.${randomUUID()}`;
      try { await rename(lock, stale); await rm(stale, { recursive: true, force: true }); }
      catch (claimError) { if ((claimError as NodeJS.ErrnoException).code !== "ENOENT") throw claimError; }
    }
  }
  await writeFile(ownerFile, JSON.stringify({ id: leaseId, expiresAt: Date.now() + LEASE_MS }), { mode: 0o600 });
  const heartbeat = setInterval(() => { void renew().catch(() => undefined); }, 30_000);
  heartbeat.unref();
  return { renew, release: async () => { clearInterval(heartbeat); if (await owns()) await rm(lock, { recursive: true, force: true }); } };
}

export function currentSalesNavPushAttempt() { return context.getStore()?.attempt; }

export async function readSalesNavPushStates(identities: { linkedinUrl?: string; name?: string }[], stateDirectory?: string) {
  const directory = stateDirectory || process.env.SALESNAV_PUSH_ATTEMPTS_DIRECTORY || "/app/data/salesnav-push-attempts";
  const nameKey = (value: unknown) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const read = async (item: { linkedinUrl?: string; name?: string }) => {
    const identity = normalizePersonUrl(item.linkedinUrl);
    if (!identity) return null;
    const key = createHash("sha256").update(identity).digest("hex");
    try {
      const saved = JSON.parse(await readFile(path.join(directory, `${key}.json`), "utf8")) as SalesNavPushAttempt;
      if (saved.version !== 1 || saved.identity !== identity || normalizePersonUrl(saved.prospect?.linkedinUrl) !== identity
        || (item.name && nameKey(item.name) !== nameKey(saved.prospect?.providerFullName || saved.prospect?.fullName))) return null;
      const complete = Boolean(saved.result && saved.taskId);
      return { resumeContactId: !complete ? saved.contactId || "" : "", pushRetryable: !complete && Boolean(saved.contactId),
        prospect: saved.prospect, taskId: complete ? saved.taskId : "", contactId: saved.contactId || "", companyId: saved.companyId || "", result: saved.result };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const states: Awaited<ReturnType<typeof read>>[] = Array(identities.length).fill(null);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, identities.length) }, async () => {
    for (let index = cursor++; index < identities.length; index = cursor++) states[index] = await read(identities[index]);
  }));
  return states;
}

/** Serialize same-company creates and retain their IDs through HubSpot search-index lag. */
export async function withSalesNavPushCompany<T>(domain: string, action: (knownId: string, remember: (id: string, writeStarted?: boolean) => Promise<void>) => Promise<T>): Promise<T> {
  const current = context.getStore();
  if (!current || !domain) return await action("", async () => {});
  const key = `company-${createHash("sha256").update(domain).digest("hex")}`;
  const file = path.join(current.directory, `${key}.json`);
  const lock = path.join(current.directory, `${key}.lock`);
  const lease = await acquireLease(lock, 60_000);
  try {
    let knownId = "";
    try {
      const saved = JSON.parse(await readFile(file, "utf8")) as { domain: string; companyId: string; writeStarted?: boolean };
      if (saved.domain !== domain || typeof saved.companyId !== "string") throw new SalesNavPushAttemptError("The saved company create is invalid. Reconcile it before retrying.", 503);
      knownId = saved.companyId;
      if (saved.writeStarted && !knownId) throw new SalesNavPushAttemptError("A previous create for this company is uncertain. Reconcile it before another company/contact write.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return await action(knownId, async (companyId, writeStarted = true) => {
      await lease.renew();
      const temporary = path.join(lock, `${randomUUID()}.json`);
      await writeFile(temporary, JSON.stringify({ domain, companyId, writeStarted }), { mode: 0o600 });
      await lease.renew();
      await rename(temporary, file);
    });
  } finally { await lease.release(); }
}

/** Only the server wrapper supplies this context; callers cannot inject checkpoints. */
export async function checkpointSalesNavPush(patch: Partial<SalesNavPushAttempt>) {
  const current = context.getStore();
  if (!current) return;
  Object.assign(current.attempt, patch);
  await current.save();
}

export async function withSalesNavPushAttempt<T>(input: {
  identity: string;
  ownerId: string;
  dueAt: string;
  prospect: JsonObject;
  stateDirectory?: string;
}, action: (attempt: SalesNavPushAttempt) => Promise<T>): Promise<T> {
  const directory = input.stateDirectory || process.env.SALESNAV_PUSH_ATTEMPTS_DIRECTORY || "/app/data/salesnav-push-attempts";
  await mkdir(directory, { recursive: true });
  const key = createHash("sha256").update(input.identity).digest("hex");
  const file = path.join(directory, `${key}.json`);
  const lock = path.join(directory, `${key}.lock`);
  const lease = await acquireLease(lock);
  try {
    let attempt: SalesNavPushAttempt;
    try {
      attempt = JSON.parse(await readFile(file, "utf8")) as SalesNavPushAttempt;
      if (attempt.version !== 1 || attempt.identity !== input.identity || !attempt.prospect || typeof attempt.prospect !== "object"
        || typeof attempt.ownerId !== "string" || typeof attempt.dueAt !== "string"
        || [attempt.contactId, attempt.companyId, attempt.taskId].some(value => typeof value !== "string")
        || [attempt.contactWriteStarted, attempt.companyWriteStarted, attempt.taskWriteStarted].some(value => typeof value !== "boolean")) {
        throw new SalesNavPushAttemptError("The saved push attempt is invalid. Reconcile it before another CRM write.", 503);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      attempt = { version: 1, identity: input.identity, ownerId: input.ownerId, dueAt: input.dueAt, prospect: input.prospect,
        contactId: "", companyId: "", taskId: "", contactWriteStarted: false, companyWriteStarted: false, taskWriteStarted: false };
    }
    const save = async () => {
      await lease.renew();
      const temporary = path.join(lock, `${randomUUID()}.json`);
      await writeFile(temporary, JSON.stringify(attempt), { encoding: "utf8", mode: 0o600 });
      await lease.renew();
      await rename(temporary, file);
    };
    // The first checkpoint is written immediately before a CRM mutation, after
    // the wrapper's current safety check. Rejected requests create no attempt.
    return await context.run({ attempt, save, directory }, () => action(attempt));
  } finally { await lease.release(); }
}
