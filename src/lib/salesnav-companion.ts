import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PAIRING_STORE = process.env.SALESNAV_COMPANION_STORE_PATH || "/app/data/salesnav-companion.json";
const LATEST_BATCH_STORE = process.env.SALESNAV_COMPANION_BATCH_PATH || "/app/data/salesnav-companion-latest.json";

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

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
