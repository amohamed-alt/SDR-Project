import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";

const LATEST_BATCH_STORE = process.env.SIGNALHIRE_COMPANION_BATCH_PATH || "/app/data/signalhire-companion-latest.json";

export type SignalHireCompanionLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  linkedinUrl: string;
  signalHireProfileUrl: string;
  email: string;
  emails: string[];
  phone: string;
  phones: string[];
  rawText?: string;
};

export type SignalHireCompanionBatch = {
  id: string;
  importedAt: string;
  sourceUrl: string;
  listName: string;
  clientVersion?: string;
  parserVersion?: string;
  leads: SignalHireCompanionLead[];
};

async function atomicWrite(path: string, payload: string) {
  await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temp, payload, { encoding: "utf8", mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(/* turbopackIgnore: true */ temp, /* turbopackIgnore: true */ path);
  await chmod(path, 0o600);
}

export async function saveSignalHireCompanionBatch(batch: SignalHireCompanionBatch) {
  await atomicWrite(LATEST_BATCH_STORE, JSON.stringify(batch));
}

export async function getLatestSignalHireCompanionBatch(): Promise<SignalHireCompanionBatch | null> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ LATEST_BATCH_STORE, "utf8")) as SignalHireCompanionBatch;
    if (!parsed?.id || !Array.isArray(parsed.leads)) return null;
    return parsed;
  } catch {
    return null;
  }
}
