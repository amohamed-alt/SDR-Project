import { salesNavAliases } from "./salesnav-identity";
import { mkdir, readFile, rename, writeFile, rmdir } from "node:fs/promises";
import { dirname } from "node:path";

const LEDGER_PATH = process.env.SALESNAV_LEAD_LEDGER_PATH || "/app/data/salesnav-lead-ledger.json";

type UnknownRecord = Record<string, unknown>;

export type SalesNavLeadIdentity = {
  name?: string;
  company?: string;
  linkedinUrl?: string;
  salesLeadUrl?: string;
};

export type SalesNavLeadLedgerRecord = {
  key: string;
  aliases: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  name: string;
  company: string;
  linkedinUrl: string;
  salesLeadUrl: string;
  revealAttemptedAt: string;
  revealedAt: string;
  cachedProspect?: UnknownRecord;
  lastPushAt: string;
  taskId: string;
  contactId: string;
  companyId: string;
  runIds: string[];
};

type Ledger = { version: 1; records: Record<string, SalesNavLeadLedgerRecord> };

let writeQueue: Promise<void> = Promise.resolve();

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function aliasesFor(identity: SalesNavLeadIdentity, prospect?: UnknownRecord) {
  const aliases = salesNavAliases({ ...identity, linkedinUrl: String(identity.linkedinUrl || prospect?.linkedinUrl || "") });
  const uid = clean(prospect?.uid || prospect?.signalHireUid);
  if (uid) aliases.push(`signalhire:${uid}`);
  if (!aliases.length) throw new Error("ID_WEAK: a verified person identity is required before reveal or push");
  return aliases;
}

function emptyLedger(): Ledger {
  return { version: 1, records: {} };
}

async function readLedger(): Promise<Ledger> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ LEDGER_PATH, "utf8")) as Partial<Ledger>;
    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) throw new Error("Invalid Sales Nav ledger; review before any spend or write.");
    return parsed as Ledger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
    throw error;
  }
}

async function writeLedger(ledger: Ledger) {
  await mkdir(/* turbopackIgnore: true */ dirname(LEDGER_PATH), { recursive: true });
  const temp = `${LEDGER_PATH}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temp, JSON.stringify(ledger), { encoding: "utf8", mode: 0o600 });
  await rename(/* turbopackIgnore: true */ temp, /* turbopackIgnore: true */ LEDGER_PATH);
}

function findRecord(ledger: Ledger, aliases: string[]) {
  const wanted = new Set(aliases);
  const matches = Object.values(ledger.records).filter((record) => {
    // Upgrade old URL-shaped aliases without losing paid reveal history.
    const strong = salesNavAliases(record);
    for (const alias of record.aliases || []) {
      if (/^sales:https:/.test(alias)) strong.push(...salesNavAliases({ salesLeadUrl: alias.slice(6) }));
      else if (/^li:https:/.test(alias)) strong.push(...salesNavAliases({ linkedinUrl: alias.slice(3) }));
      else if (!alias.startsWith("name-company:")) strong.push(alias);
    }
    return strong.some((alias) => wanted.has(alias));
  });
  if (matches.length > 1) throw new Error("Ambiguous lead ledger identity; reconcile before spend.");
  return matches[0] || null;
}

function canonicalKey(aliases: string[]) {
  return aliases.find((alias) => alias.startsWith("li:"))
    || aliases.find((alias) => alias.startsWith("sales:"))
    || aliases.find((alias) => alias.startsWith("signalhire:"))
    || aliases[0]
    || `unknown:${Date.now()}`;
}

async function mutate(action: (ledger: Ledger) => void | Promise<void>) {
  const pending = writeQueue.then(async () => {
    await mkdir(dirname(LEDGER_PATH), { recursive: true });
    const lock = `${LEDGER_PATH}.lock`;
    try { await mkdir(lock); }
    catch { throw new Error("Lead ledger is busy or needs reconciliation; no history overwritten."); }
    try {
      const ledger = await readLedger();
      await action(ledger);
      await writeLedger(ledger);
    } finally { await rmdir(lock); }
  });
  writeQueue = pending.catch(() => undefined);
  await pending;
}

export async function lookupSalesNavLead(identity: SalesNavLeadIdentity) {
  const ledger = await readLedger();
  const record = findRecord(ledger, aliasesFor(identity));
  return record ? { ...record } : null;
}

export async function saveSalesNavReveal(input: {
  identity: SalesNavLeadIdentity;
  prospect?: UnknownRecord;
  runId?: string;
  attempted?: boolean;
}) {
  const now = new Date().toISOString();
  let saved: SalesNavLeadLedgerRecord | null = null;
  await mutate(async (ledger) => {
    const aliases = aliasesFor(input.identity, input.prospect);
    const existing = findRecord(ledger, aliases);
    const key = existing?.key || canonicalKey(aliases);
    const mergedAliases = [...new Set([...(existing?.aliases || []), ...aliases])];
    const runIds = [...new Set([...(existing?.runIds || []), ...(input.runId ? [input.runId] : [])])].slice(-100);
    const record: SalesNavLeadLedgerRecord = {
      key,
      aliases: mergedAliases,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      name: clean(input.identity.name || input.prospect?.fullName || existing?.name),
      company: clean(input.identity.company || input.prospect?.company || existing?.company),
      linkedinUrl: clean(input.prospect?.linkedinUrl || input.identity.linkedinUrl || existing?.linkedinUrl),
      salesLeadUrl: clean(input.identity.salesLeadUrl || existing?.salesLeadUrl),
      revealAttemptedAt: input.attempted ? now : existing?.revealAttemptedAt || "",
      revealedAt: input.prospect ? now : existing?.revealedAt || "",
      cachedProspect: input.prospect || existing?.cachedProspect,
      lastPushAt: existing?.lastPushAt || "",
      taskId: existing?.taskId || "",
      contactId: existing?.contactId || "",
      companyId: existing?.companyId || "",
      runIds,
    };
    if (existing && existing.key !== key) delete ledger.records[existing.key];
    ledger.records[key] = record;
    saved = record;
  });
  return saved;
}

export async function saveSalesNavPush(input: {
  identity: SalesNavLeadIdentity;
  prospect?: UnknownRecord;
  runId?: string;
  taskId?: string;
  contactId?: string;
  companyId?: string;
}) {
  const now = new Date().toISOString();
  let saved: SalesNavLeadLedgerRecord | null = null;
  await mutate(async (ledger) => {
    const aliases = aliasesFor(input.identity, input.prospect);
    const existing = findRecord(ledger, aliases);
    const key = existing?.key || canonicalKey(aliases);
    const record: SalesNavLeadLedgerRecord = {
      key,
      aliases: [...new Set([...(existing?.aliases || []), ...aliases])],
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      name: clean(input.identity.name || input.prospect?.fullName || existing?.name),
      company: clean(input.identity.company || input.prospect?.company || existing?.company),
      linkedinUrl: clean(input.prospect?.linkedinUrl || input.identity.linkedinUrl || existing?.linkedinUrl),
      salesLeadUrl: clean(input.identity.salesLeadUrl || existing?.salesLeadUrl),
      revealAttemptedAt: existing?.revealAttemptedAt || "",
      revealedAt: existing?.revealedAt || (input.prospect ? now : ""),
      cachedProspect: input.prospect || existing?.cachedProspect,
      lastPushAt: now,
      taskId: clean(input.taskId || existing?.taskId),
      contactId: clean(input.contactId || existing?.contactId),
      companyId: clean(input.companyId || existing?.companyId),
      runIds: [...new Set([...(existing?.runIds || []), ...(input.runId ? [input.runId] : [])])].slice(-100),
    };
    ledger.records[key] = record;
    saved = record;
  });
  return saved;
}
