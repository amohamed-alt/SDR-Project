import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PAIRING_STORE = process.env.SALESNAV_COMPANION_STORE_PATH || "/app/data/salesnav-companion.json";
const LATEST_BATCH_STORE = process.env.SALESNAV_COMPANION_BATCH_PATH || "/app/data/salesnav-companion-latest.json";
const FULL_RUN_STORE = process.env.SALESNAV_COMPANION_FULL_RUN_PATH || "/app/data/salesnav-companion-full-run.json";
const FULL_RUN_HISTORY_DIR = process.env.SALESNAV_COMPANION_HISTORY_DIR || "/app/data/salesnav-full-runs";
const FULL_RUN_MAX_LEADS = 2500;

export type CompanionLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  connectionDegree: string;
  salesLeadUrl: string;
  linkedinUrl: string;
  rawText?: string;
};

type PairingStore = {
  tokenHash: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type CompanionBatch = {
  id: string;
  importedAt: string;
  sourceUrl: string;
  pagesRead: number;
  clientVersion?: string;
  parserVersion?: string;
  leads: CompanionLead[];
};

export type CompanionFullRun = {
  id: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string;
  complete: boolean;
  stopReason: string;
  sourceUrl: string;
  searchFingerprint: string;
  pagesRead: number;
  clientVersion?: string;
  parserVersion?: string;
  leads: CompanionLead[];
};

export type CompanionFullRunSummary = Omit<CompanionFullRun, "leads"> & { total: number };

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function leadKey(lead: CompanionLead) {
  return lead.linkedinUrl || lead.salesLeadUrl || `${lead.name.toLowerCase()}:${lead.company.toLowerCase()}`;
}

function historyPath(id: string) {
  return join(FULL_RUN_HISTORY_DIR, `${id}.json`);
}

async function atomicWrite(path: string, payload: string) {
  await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temp, payload, { encoding: "utf8", mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(/* turbopackIgnore: true */ temp, /* turbopackIgnore: true */ path);
  await chmod(path, 0o600);
}

async function readPairingStore(): Promise<PairingStore | null> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ PAIRING_STORE, "utf8")) as Partial<PairingStore>;
    if (!parsed.tokenHash) return null;
    return {
      tokenHash: String(parsed.tokenHash),
      createdAt: String(parsed.createdAt || ""),
      lastUsedAt: String(parsed.lastUsedAt || ""),
    };
  } catch {
    return null;
  }
}

async function readFullRun(path: string): Promise<CompanionFullRun | null> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as CompanionFullRun;
    if (!parsed?.id || !Array.isArray(parsed.leads)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persistFullRun(run: CompanionFullRun) {
  const payload = JSON.stringify(run);
  await Promise.all([
    atomicWrite(FULL_RUN_STORE, payload),
    atomicWrite(historyPath(run.id), payload),
  ]);
}

async function archiveLegacyLatest(nextRunId = "") {
  const latest = await readFullRun(FULL_RUN_STORE);
  if (!latest || latest.id === nextRunId) return;
  const archived = await readFullRun(historyPath(latest.id));
  if (!archived) await atomicWrite(historyPath(latest.id), JSON.stringify(latest));
}

export async function companionStatus() {
  const store = await readPairingStore();
  return {
    paired: Boolean(store?.tokenHash),
    createdAt: store?.createdAt || "",
    lastUsedAt: store?.lastUsedAt || "",
  };
}

export async function generateCompanionToken() {
  const token = `snc_${randomBytes(32).toString("base64url")}`;
  await atomicWrite(PAIRING_STORE, JSON.stringify({
    tokenHash: sha256(token),
    createdAt: new Date().toISOString(),
  }));
  return token;
}

export async function verifyCompanionToken(raw: string) {
  const token = String(raw || "").trim();
  if (!token) return false;
  const store = await readPairingStore();
  if (!store?.tokenHash) return false;
  const expected = Buffer.from(store.tokenHash, "hex");
  const actual = Buffer.from(sha256(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function touchCompanionToken() {
  const store = await readPairingStore();
  if (!store) return;
  await atomicWrite(PAIRING_STORE, JSON.stringify({ ...store, lastUsedAt: new Date().toISOString() }));
}

export async function saveCompanionBatch(batch: CompanionBatch) {
  await atomicWrite(LATEST_BATCH_STORE, JSON.stringify(batch));
}

export async function getLatestCompanionBatch(): Promise<CompanionBatch | null> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ LATEST_BATCH_STORE, "utf8")) as CompanionBatch;
    if (!parsed?.id || !Array.isArray(parsed.leads)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getLatestCompanionFullRun(): Promise<CompanionFullRun | null> {
  return readFullRun(FULL_RUN_STORE);
}

export async function getCompanionFullRun(id: string): Promise<CompanionFullRun | null> {
  const direct = await readFullRun(historyPath(id));
  if (direct) return direct;
  const latest = await getLatestCompanionFullRun();
  return latest?.id === id ? latest : null;
}

export async function listCompanionFullRuns(limit = 50): Promise<CompanionFullRunSummary[]> {
  const summaries: CompanionFullRunSummary[] = [];
  const seen = new Set<string>();
  try {
    await mkdir(/* turbopackIgnore: true */ FULL_RUN_HISTORY_DIR, { recursive: true });
    const files = (await readdir(/* turbopackIgnore: true */ FULL_RUN_HISTORY_DIR))
      .filter((name) => name.endsWith(".json"));
    for (const file of files) {
      const run = await readFullRun(join(FULL_RUN_HISTORY_DIR, file));
      if (!run || seen.has(run.id)) continue;
      seen.add(run.id);
      const { leads, ...rest } = run;
      summaries.push({ ...rest, total: leads.length });
    }
  } catch {
    // History is additive. Fall back to latest for old deployments/migrations.
  }

  const latest = await getLatestCompanionFullRun();
  if (latest && !seen.has(latest.id)) {
    const { leads, ...rest } = latest;
    summaries.push({ ...rest, total: leads.length });
  }

  return summaries
    .sort((a, b) => Date.parse(b.updatedAt || b.startedAt) - Date.parse(a.updatedAt || a.startedAt))
    .slice(0, Math.max(1, limit));
}

export async function saveCompanionFullRunPage(input: {
  id: string;
  sourceUrl: string;
  searchFingerprint: string;
  pageNumber: number;
  clientVersion?: string;
  parserVersion?: string;
  leads: CompanionLead[];
}) {
  const now = new Date().toISOString();
  await archiveLegacyLatest(input.id);
  const existing = await getCompanionFullRun(input.id);
  const base: CompanionFullRun = existing || {
    id: input.id,
    startedAt: now,
    updatedAt: now,
    completedAt: "",
    complete: false,
    stopReason: "",
    sourceUrl: input.sourceUrl,
    searchFingerprint: input.searchFingerprint,
    pagesRead: 0,
    clientVersion: input.clientVersion,
    parserVersion: input.parserVersion,
    leads: [],
  };

  const unique = new Map<string, CompanionLead>();
  for (const lead of [...base.leads, ...input.leads]) {
    const key = leadKey(lead);
    if (!key || unique.has(key)) continue;
    unique.set(key, lead);
    if (unique.size >= FULL_RUN_MAX_LEADS) break;
  }

  const next: CompanionFullRun = {
    ...base,
    updatedAt: now,
    complete: false,
    stopReason: "",
    sourceUrl: base.sourceUrl || input.sourceUrl,
    searchFingerprint: base.searchFingerprint || input.searchFingerprint,
    pagesRead: Math.max(base.pagesRead || 0, input.pageNumber),
    clientVersion: input.clientVersion || base.clientVersion,
    parserVersion: input.parserVersion || base.parserVersion,
    leads: [...unique.values()],
  };
  await persistFullRun(next);
  return next;
}

export async function finishCompanionFullRun(id: string, stopReason: string) {
  const existing = await getCompanionFullRun(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next: CompanionFullRun = {
    ...existing,
    complete: true,
    completedAt: now,
    updatedAt: now,
    stopReason,
  };
  await persistFullRun(next);
  return next;
}
