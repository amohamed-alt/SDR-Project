import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MaqsamCallRecord } from "@/lib/maqsam-types";

type MaqsamStore = {
  version: 1;
  updatedAt: string;
  calls: Record<string, MaqsamCallRecord>;
};

const STORE_PATH = process.env.MAQSAM_CALL_STORE_PATH ?? "/app/data/maqsam-calls.json";
const RETENTION_DAYS = Math.max(1, Number(process.env.MAQSAM_CALL_RETENTION_DAYS ?? 180));
const MAX_RECORDS = Math.max(100, Number(process.env.MAQSAM_CALL_MAX_RECORDS ?? 5000));

let writeQueue: Promise<unknown> = Promise.resolve();

function emptyStore(): MaqsamStore {
  return { version: 1, updatedAt: new Date(0).toISOString(), calls: {} };
}

function cleanOptionalFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)) as Partial<T>;
}

function recordTime(record: MaqsamCallRecord) {
  const candidate = record.noteTimestamp || record.updatedAt || record.firstReceivedAt;
  const parsed = candidate ? Date.parse(candidate) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  if (Number.isFinite(Number(record.timestamp))) return Number(record.timestamp) * 1000;
  return 0;
}

async function readStoreUnsafe(): Promise<MaqsamStore> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<MaqsamStore>;
    if (parsed.version !== 1 || !parsed.calls || typeof parsed.calls !== "object") return emptyStore();
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      calls: parsed.calls,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function writeStoreUnsafe(store: MaqsamStore) {
  const directory = path.dirname(STORE_PATH);
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  const temporaryPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(/* turbopackIgnore: true */ temporaryPath, /* turbopackIgnore: true */ STORE_PATH);
}

function prune(store: MaqsamStore) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const rows = Object.entries(store.calls)
    .filter(([, record]) => {
      const timestamp = recordTime(record);
      return !timestamp || timestamp >= cutoff;
    })
    .sort(([, left], [, right]) => recordTime(right) - recordTime(left))
    .slice(0, MAX_RECORDS);

  store.calls = Object.fromEntries(rows);
}

export async function listMaqsamCalls() {
  const store = await readStoreUnsafe();
  return Object.values(store.calls).sort((left, right) => recordTime(right) - recordTime(left));
}

export async function upsertMaqsamCall(incoming: Partial<MaqsamCallRecord> & Pick<MaqsamCallRecord, "callKey">) {
  const run = writeQueue.then(async () => {
    const store = await readStoreUnsafe();
    const now = new Date().toISOString();
    const existing = store.calls[incoming.callKey];
    const cleanedIncoming = cleanOptionalFields(incoming);
    const merged: MaqsamCallRecord = {
      ...existing,
      ...cleanedIncoming,
      callKey: incoming.callKey,
      firstReceivedAt: existing?.firstReceivedAt ?? incoming.firstReceivedAt ?? now,
      updatedAt: now,
    };

    store.calls[incoming.callKey] = merged;
    store.updatedAt = now;
    prune(store);
    await writeStoreUnsafe(store);
    return merged;
  });

  writeQueue = run.catch(() => undefined);
  return run;
}
