import { unstable_cache } from "next/cache";
import { SDR_OWNERS } from "@/lib/sdr-owners";
import { buildDashboard } from "@/lib/analytics";
import {
  readPersistedDashboardSnapshot,
  writePersistedDashboardSnapshot,
} from "@/lib/dashboard-cache-api";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const SNAPSHOT_FRESH_MS = 2 * 60 * 1000;
const BACKGROUND_REFRESH_INTERVAL_MS = 60 * 1000;
const ACTIVE_FILTER_TTL_MS = 60 * 60 * 1000;

const cachedDashboard = unstable_cache(
  async (filters: DashboardFilters) => queuedBuild(filters),
  ["sdr-dashboard-live-v8-owner-attribution"],
  { revalidate: 120, tags: ["sdr-dashboard"] },
);

type SnapshotEntry = {
  data: DashboardData;
  refreshedAt: number;
  lastAccessedAt: number;
};

type ActiveFilterEntry = {
  filters: DashboardFilters;
  lastAccessedAt: number;
};

export type DashboardSnapshotResult = {
  data: DashboardData;
  refreshing: boolean;
  ageSeconds: number;
  cacheStatus: "memory" | "fastapi-disk" | "next-cache";
};

// Instrumentation and route bundles must share the same warm snapshots and locks.
type DashboardStore = {
  snapshots: Map<string, SnapshotEntry>;
  activeFilters: Map<string, ActiveFilterEntry>;
  inflightRefreshes: Map<string, Promise<DashboardData>>;
  coldLoads: Map<string, Promise<DashboardData>>;
  buildTail: Promise<unknown>;
};
const processState = globalThis as typeof globalThis & { __sdrDashboardStoreV8?: DashboardStore };
const dashboardStore: DashboardStore = processState.__sdrDashboardStoreV8 ??= {
  snapshots: new Map(), activeFilters: new Map(), inflightRefreshes: new Map(),
  coldLoads: new Map(), buildTail: Promise.resolve(),
};
const { snapshots, activeFilters, inflightRefreshes, coldLoads } = dashboardStore;

function snapshotKey(filters: DashboardFilters) {
  return JSON.stringify({
    from: filters.from,
    to: filters.to,
    ownerId: filters.ownerId,
    country: filters.country ?? "",
    originalSource: filters.originalSource ?? "",
    latestSource: filters.latestSource ?? "",
    tier: filters.tier ?? "",
    persona: filters.persona ?? "",
  });
}

function generatedAtMs(data: DashboardData) {
  const parsed = new Date(data.meta.generatedAt).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function persistSnapshot(filters: DashboardFilters, data: DashboardData, refreshedAt: number) {
  void writePersistedDashboardSnapshot(filters, data, refreshedAt).catch((error) => {
    console.warn("Unable to persist dashboard snapshot", error);
  });
}

function startRefresh(key: string, filters: DashboardFilters) {
  const existing = inflightRefreshes.get(key) ?? coldLoads.get(key);
  if (existing) return existing;

  const refresh = queuedBuild(filters)
    .then((data) => {
      const refreshedAt = generatedAtMs(data);
      trimSnapshots(key);
      snapshots.set(key, {
        data,
        refreshedAt,
        lastAccessedAt: Date.now(),
      });
      persistSnapshot(filters, data, refreshedAt);
      return data;
    })
    .finally(() => {
      inflightRefreshes.delete(key);
    });

  inflightRefreshes.set(key, refresh);
  return refresh;
}

function ensureRefreshScheduler() {
  const globalState = globalThis as typeof globalThis & {
    __sdrDashboardRefreshTimer?: ReturnType<typeof setInterval>;
  };

  if (globalState.__sdrDashboardRefreshTimer) return;

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, active] of activeFilters) {
      if (now - active.lastAccessedAt > ACTIVE_FILTER_TTL_MS) {
        activeFilters.delete(key);
        snapshots.delete(key);
        continue;
      }

      const snapshot = snapshots.get(key);
      if (!snapshot || now - snapshot.refreshedAt >= SNAPSHOT_FRESH_MS) {
        void startRefresh(key, active.filters).catch((error) => {
          console.error("Background dashboard refresh failed", error);
        });
      }
    }
  }, BACKGROUND_REFRESH_INTERVAL_MS);

  timer.unref?.();
  globalState.__sdrDashboardRefreshTimer = timer;
}

ensureRefreshScheduler();

export async function getDashboardSnapshot(
  filters: DashboardFilters,
  forceRefresh = false,
): Promise<DashboardSnapshotResult> {
  const key = snapshotKey(filters);
  const now = Date.now();
  trimSnapshots(key);
  activeFilters.set(key, { filters, lastAccessedAt: now });

  let snapshot = snapshots.get(key);
  let cacheStatus: DashboardSnapshotResult["cacheStatus"] = "memory";
  let loadedFromOriginThisRequest = false;

  if (!snapshot) {
    const persisted = await readPersistedDashboardSnapshot(filters);
    if (persisted) {
      snapshot = {
        data: persisted.data,
        refreshedAt: persisted.refreshedAt,
        lastAccessedAt: now,
      };
      snapshots.set(key, snapshot);
      cacheStatus = "fastapi-disk";
    }
  }

  if (!snapshot) {
    const data = await coldSnapshot(key, filters);
    const refreshedAt = generatedAtMs(data);
    snapshot = {
      data,
      refreshedAt,
      lastAccessedAt: now,
    };
    snapshots.set(key, snapshot);
    persistSnapshot(filters, data, refreshedAt);
    cacheStatus = "next-cache";
    loadedFromOriginThisRequest = true;
  } else {
    snapshot.lastAccessedAt = now;
  }

  const stale = now - snapshot.refreshedAt >= SNAPSHOT_FRESH_MS;
  if (!loadedFromOriginThisRequest && (forceRefresh || stale)) {
    void startRefresh(key, filters).catch((error) => {
      console.error("Dashboard snapshot refresh failed", error);
    });
  }

  return {
    data: snapshot.data,
    refreshing: inflightRefreshes.has(key),
    ageSeconds: Math.max(0, Math.round((now - snapshot.refreshedAt) / 1000)),
    cacheStatus,
  };
}

// One CRM build at a time avoids parallel full-portfolio scans on the VPS.
function queuedBuild(filters: DashboardFilters): Promise<DashboardData> {
  const next = dashboardStore.buildTail.then(() => buildDashboard(filters));
  dashboardStore.buildTail = next.catch(() => undefined);
  return next;
}
function coldSnapshot(key: string, filters: DashboardFilters) {
  const existing = coldLoads.get(key) ?? inflightRefreshes.get(key);
  if (existing) return existing;
  const pending = cachedDashboard(filters).finally(() => coldLoads.delete(key));
  coldLoads.set(key, pending);
  return pending;
}
function trimSnapshots(key: string) {
  if (activeFilters.has(key) || activeFilters.size < 16) return;
  const oldest = [...activeFilters.entries()]
    .filter(([entry]) => !inflightRefreshes.has(entry) && !coldLoads.has(entry))
    .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0];
  if (oldest) { activeFilters.delete(oldest[0]); snapshots.delete(oldest[0]); }
}

export function startDashboardWarmup() {
  if (process.env.DEMO_MODE === "true" || !process.env.HUBSPOT_PRIVATE_APP_TOKEN) return;
  const state = globalThis as typeof globalThis & { __sdrWarmup?: ReturnType<typeof setInterval> };
  if (state.__sdrWarmup) return;
  let running = false;
  const warm = async () => {
    if (running) return;
    running = true;
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = process.env.NEXT_PUBLIC_DEFAULT_START_DATE || `${to.slice(0, 7)}-01`;
      for (const owner of Object.values(SDR_OWNERS)) {
        try { await getDashboardSnapshot({ from, to, ownerId: owner.ownerId }); }
        catch { console.warn(`Dashboard warmup unavailable for ${owner.key}`); }
      }
    } finally { running = false; }
  };
  const start = setTimeout(() => void warm(), 5_000);
  start.unref?.();
  state.__sdrWarmup = setInterval(() => void warm(), 60_000);
  state.__sdrWarmup.unref?.();
}
