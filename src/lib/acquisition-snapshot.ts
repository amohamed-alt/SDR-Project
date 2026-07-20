import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildAcquisitionDashboard } from "@/lib/acquisition";
import type { AcquisitionData } from "@/lib/types";

const SNAPSHOT_PATH = process.env.ACQUISITION_SNAPSHOT_PATH ?? "/app/data/acquisition-dashboard.json";
const SNAPSHOT_TTL_MS = Math.max(
  60_000,
  Number(process.env.ACQUISITION_SNAPSHOT_TTL_MS ?? "900000") || 900_000,
);
const CURRENT_SCHEMA_VERSION = 2;

type SnapshotSource = "memory" | "disk" | "live";
type RefreshState = "idle" | "started" | "running" | "completed";

interface SnapshotState {
  data?: AcquisitionData;
  serialized?: string;
  diskLoaded: boolean;
  source?: SnapshotSource;
  refreshPromise?: Promise<AcquisitionData>;
  lastError?: string;
}

export interface AcquisitionSnapshotResult {
  data: AcquisitionData;
  serialized: string;
  source: SnapshotSource;
  ageSeconds: number;
  refreshState: RefreshState;
  lastError?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __talenteraAcquisitionSnapshot: SnapshotState | undefined;
}

const state = globalThis.__talenteraAcquisitionSnapshot ??= {
  diskLoaded: false,
};

function isAcquisitionData(value: unknown): value is AcquisitionData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AcquisitionData>;
  return Boolean(
    candidate.meta?.generatedAt
    && candidate.team
    && Array.isArray(candidate.reps)
    && Array.isArray(candidate.contacts)
    && Array.isArray(candidate.activities)
    && Array.isArray(candidate.deals),
  );
}

function ageSeconds(data: AcquisitionData) {
  const generatedAt = new Date(data.meta.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor((Date.now() - generatedAt) / 1_000));
}

function isStale(data: AcquisitionData) {
  return data.meta.schemaVersion !== CURRENT_SCHEMA_VERSION
    || ageSeconds(data) * 1_000 >= SNAPSHOT_TTL_MS;
}

async function loadSnapshotFromDisk() {
  if (state.data) {
    return {
      data: state.data,
      serialized: state.serialized ?? JSON.stringify(state.data),
      source: state.source ?? "memory" as SnapshotSource,
    };
  }

  if (state.diskLoaded) return null;
  state.diskLoaded = true;

  try {
    const serialized = await readFile(SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(serialized) as unknown;
    if (!isAcquisitionData(parsed)) throw new Error("Snapshot JSON does not match AcquisitionData");

    state.data = parsed;
    state.serialized = serialized;
    state.source = "disk";
    return { data: parsed, serialized, source: "disk" as SnapshotSource };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") console.error("Unable to read Acquisition snapshot", error);
    return null;
  }
}

async function persistSnapshot(data: AcquisitionData) {
  const serialized = JSON.stringify(data);

  state.data = data;
  state.serialized = serialized;
  state.source = "memory";
  state.lastError = undefined;

  const directory = dirname(SNAPSHOT_PATH);
  const temporaryPath = `${SNAPSHOT_PATH}.${process.pid}.${Date.now()}.tmp`;

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, SNAPSHOT_PATH);
  } catch (error) {
    state.lastError = `Snapshot persistence failed: ${error instanceof Error ? error.message : "unknown error"}`;
    console.error("Unable to persist Acquisition snapshot", error);
  }

  return serialized;
}

export function startAcquisitionSnapshotRefresh() {
  if (state.refreshPromise) return state.refreshPromise;

  const refreshPromise = (async () => {
    try {
      const data = await buildAcquisitionDashboard();
      await persistSnapshot(data);
      return data;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "Acquisition refresh failed";
      throw error;
    } finally {
      state.refreshPromise = undefined;
    }
  })();

  state.refreshPromise = refreshPromise;
  return refreshPromise;
}

export async function getAcquisitionSnapshot(options: { refresh?: boolean; wait?: boolean } = {}): Promise<AcquisitionSnapshotResult> {
  const snapshot = await loadSnapshotFromDisk();
  const refreshWasRunning = Boolean(state.refreshPromise);

  if (options.refresh) {
    const refreshPromise = startAcquisitionSnapshotRefresh();

    if (options.wait || !snapshot) {
      const data = await refreshPromise;
      const serialized = state.serialized ?? JSON.stringify(data);
      return {
        data,
        serialized,
        source: "live",
        ageSeconds: ageSeconds(data),
        refreshState: "completed",
        lastError: state.lastError,
      };
    }

    return {
      ...snapshot,
      ageSeconds: ageSeconds(snapshot.data),
      refreshState: refreshWasRunning ? "running" : "started",
      lastError: state.lastError,
    };
  }

  if (!snapshot) {
    const data = await startAcquisitionSnapshotRefresh();
    const serialized = state.serialized ?? JSON.stringify(data);
    return {
      data,
      serialized,
      source: "live",
      ageSeconds: ageSeconds(data),
      refreshState: "completed",
      lastError: state.lastError,
    };
  }

  if (isStale(snapshot.data) && !state.refreshPromise) {
    void startAcquisitionSnapshotRefresh().catch((error) => {
      console.error("Background Acquisition refresh failed", error);
    });
  }

  return {
    ...snapshot,
    ageSeconds: ageSeconds(snapshot.data),
    refreshState: state.refreshPromise ? "running" : "idle",
    lastError: state.lastError,
  };
}
