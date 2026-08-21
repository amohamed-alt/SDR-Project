import { unstable_cache } from "next/cache";
import { buildDashboard } from "@/lib/analytics";
import {
  readPersistedDashboardSnapshot,
  writePersistedDashboardSnapshot,
} from "@/lib/dashboard-cache-api";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const SNAPSHOT_FRESH_MS = 10 * 60 * 1000;
const BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVE_FILTER_TTL_MS = 60 * 60 * 1000;

const cachedDashboard = unstable_cache(
  async (filters: DashboardFilters) => buildDashboard(filters),
  ["sdr-dashboard-live-v7-fastapi-cache"],
  { revalidate: 600, tags: ["sdr-dashboard"] },
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

const snapshots = new Map<string, SnapshotEntry>();
const activeFilters = new Map<string, ActiveFilterEntry>();
const inflightRefreshes = new Map<string, Promise<DashboardData>>();

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
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  const refresh = buildDashboard(filters)
    .then((data) => {
      const refreshedAt = generatedAtMs(data);
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
      if (!snapshot || now - snapshot.refreshedAt >= BACKGROUND_REFRESH_INTERVAL_MS) {
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
  activeFilters.set(key, { filters, lastAccessedAt: now });

  let snapshot = snapshots.get(key);
  let cacheStatus: DashboardSnapshotResult["cacheStatus"] = "memory";

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
    const data = await cachedDashboard(filters);
    const refreshedAt = generatedAtMs(data);
    snapshot = {
      data,
      refreshedAt,
      lastAccessedAt: now,
    };
    snapshots.set(key, snapshot);
    persistSnapshot(filters, data, refreshedAt);
    cacheStatus = "next-cache";
  } else {
    snapshot.lastAccessedAt = now;
  }

  const stale = now - snapshot.refreshedAt >= SNAPSHOT_FRESH_MS;
  if (forceRefresh || stale) {
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
