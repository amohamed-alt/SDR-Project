import { cachedSalesNavIdentityMismatch, salesNavNameMismatch } from "./salesnav-identity.ts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const LEDGER_PATH = process.env.SALESNAV_LEAD_LEDGER_PATH || "/app/data/salesnav-lead-ledger.json";

type UnknownRecord = Record<string, unknown>;

export type SalesNavLeadIdentity = {
  name?: string;
  company?: string;
  linkedinUrl?: string;
  salesLeadUrl?: string;
};

export type RevealStatus = "pending" | "completed" | "no-result" | "retryable" | "uncertain";

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
  revealStatus?: RevealStatus;
  revealError?: string;
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

function normalizedText(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
}

function normalizeLinkedIn(raw: unknown) {
  try {
    const url = new URL(clean(raw));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return "";
    if (!/^\/in\/[^/?#]+/i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch { return ""; }
}

function normalizeSalesLead(raw: unknown) {
  try {
    const url = new URL(clean(raw));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return "";
    if (!/^\/sales\/lead\//i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`.toLowerCase();
  } catch { return ""; }
}

function aliasesFor(identity: SalesNavLeadIdentity, prospect?: UnknownRecord) {
  const aliases = new Set<string>();
  const linkedin = normalizeLinkedIn(identity.linkedinUrl || prospect?.linkedinUrl);
  const salesLead = normalizeSalesLead(identity.salesLeadUrl);
  const name = normalizedText(identity.name || prospect?.fullName);
  const company = normalizedText(identity.company || prospect?.company);
  const uid = clean(prospect?.uid || prospect?.signalHireUid);
  if (linkedin) aliases.add(`li:${linkedin}`);
  if (salesLead) aliases.add(`sales:${salesLead}`);
  if (uid) aliases.add(`signalhire:${uid.toLowerCase()}`);
  if (name && company) aliases.add(`name-company:${name}|${company}`);
  return [...aliases];
}

function emptyLedger(): Ledger {
  return { version: 1, records: {} };
}

async function readLedger(): Promise<Ledger> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ LEDGER_PATH, "utf8")) as Partial<Ledger>;
    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) throw new Error("Invalid saved Sales Navigator ledger. Review durable state before paid operations.");
    return { version: 1, records: parsed.records };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
    throw error; // Missing/corrupt durable state must never enable another paid reveal.
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
  return Object.values(ledger.records).find((record) => record.aliases.some((alias) => wanted.has(alias))) || null;
}

function canonicalKey(aliases: string[]) {
  return aliases.find((alias) => alias.startsWith("li:"))
    || aliases.find((alias) => alias.startsWith("sales:"))
    || aliases.find((alias) => alias.startsWith("signalhire:"))
    || aliases[0]
    || `unknown:${Date.now()}`;
}

async function mutate(action: (ledger: Ledger) => void | Promise<void>) {
  let resultError: unknown;
  writeQueue = writeQueue.then(async () => {
    try {
      const ledger = await readLedger();
      await action(ledger);
      await writeLedger(ledger);
    } catch (error) {
      resultError = error;
      throw error;
    }
  }).catch(() => undefined);
  await writeQueue;
  if (resultError) throw resultError;
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
  status?: RevealStatus;
  error?: string;
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
      revealStatus: input.status || (input.prospect ? "completed" : existing?.revealStatus),
      revealError: input.error ?? existing?.revealError ?? "",
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
      revealStatus: existing?.revealStatus || (input.prospect ? "completed" : undefined),
      revealError: existing?.revealError || "",
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

/** Legacy attempts without a saved result are uncertain, never a confirmed no-result. */
export function salesNavRevealStatus(record: SalesNavLeadLedgerRecord): RevealStatus | "" {
  return record.revealStatus || (record.cachedProspect ? "completed" : record.revealAttemptedAt ? "uncertain" : "");
}

/** Reserve inside the same write queue as the lookup, before a provider request. */
export async function reserveSalesNavReveal(input: { identity: SalesNavLeadIdentity; runId?: string }) {
  let reserved = false;
  let saved: SalesNavLeadLedgerRecord | null = null;
  await mutate((ledger) => {
    const aliases = aliasesFor(input.identity);
    const existing = findRecord(ledger, aliases);
    if (existing && salesNavRevealStatus(existing) !== "retryable" && salesNavRevealStatus(existing) !== "") { saved = existing; return; }
    const now = new Date().toISOString();
    const key = existing?.key || canonicalKey(aliases);
    const record: SalesNavLeadLedgerRecord = {
      key, aliases: [...new Set([...(existing?.aliases || []), ...aliases])],
      firstSeenAt: existing?.firstSeenAt || now, lastSeenAt: now,
      name: clean(input.identity.name), company: clean(input.identity.company),
      linkedinUrl: clean(input.identity.linkedinUrl), salesLeadUrl: clean(input.identity.salesLeadUrl),
      revealAttemptedAt: now, revealStatus: "pending", revealError: "", revealedAt: existing?.revealedAt || "",
      cachedProspect: existing?.cachedProspect, lastPushAt: existing?.lastPushAt || "",
      taskId: existing?.taskId || "", contactId: existing?.contactId || "", companyId: existing?.companyId || "",
      runIds: [...new Set([...(existing?.runIds || []), ...(input.runId ? [input.runId] : [])])].slice(-100),
    };
    ledger.records[key] = record; saved = record; reserved = true;
  });
  return { reserved, record: saved as SalesNavLeadLedgerRecord | null };
}

/** One read per saved run; no provider calls and no raw aliases exposed to the page. */
export async function salesNavLeadStates(identities: SalesNavLeadIdentity[]) {
  const ledger = await readLedger();
  const byAlias = new Map<string, SalesNavLeadLedgerRecord>();
  for (const record of Object.values(ledger.records)) for (const alias of record.aliases) if (!byAlias.has(alias)) byAlias.set(alias, record);
  return identities.map(identity => {
    const record = aliasesFor(identity).map(alias => byAlias.get(alias)).find(Boolean);
    if (!record) return null;
    const mismatch = record.cachedProspect ? (identity.linkedinUrl ? cachedSalesNavIdentityMismatch(identity.linkedinUrl, record) : "") || salesNavNameMismatch(identity, record.cachedProspect) : "";
    if (mismatch) return { revealStatus: "uncertain" as const, revealError: mismatch, lastPushAt: "", taskId: "" };
    return { prospect: record.cachedProspect, revealStatus: salesNavRevealStatus(record), revealError: record.revealError || "", revealedAt: record.revealedAt, lastPushAt: record.lastPushAt, taskId: record.taskId, contactId: record.contactId, companyId: record.companyId };
  });
}

