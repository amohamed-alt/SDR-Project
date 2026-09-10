"use client";

import { useEffect, useState } from "react";
import type { DashboardData, DashboardFilters } from "@/lib/types";

type Result = { data: DashboardData; refreshing: boolean; etag?: string };
const cache = new Map<string, Result>();
const pending = new Map<string, Promise<Result>>();

export function dashboardQuery(filters: DashboardFilters) {
  const query = new URLSearchParams();
  Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return query.toString();
}

async function readDashboard(key: string, force: boolean): Promise<Result> {
  const requestKey = `${key}:${force}`;
  const existing = pending.get(requestKey);
  if (existing) return existing;
  const promise = (async () => {
    const response = await fetch(`/api/dashboard?${key}${force ? "&refresh=1" : ""}`, {
      headers: cache.get(key)?.etag ? { "If-None-Match": cache.get(key)!.etag! } : {},
      // Normal reads may use the browser's short private cache so a reload or
      // revisit can paint from an already-downloaded compact snapshot. Manual
      // refresh still bypasses every cache and asks the server to refresh.
      cache: force ? "no-store" : "default",
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 304 && cache.has(key)) {
      const result = { ...cache.get(key)!, refreshing: response.headers.get("X-Dashboard-Refreshing") === "1" };
      cache.set(key, result);
      return result;
    }
    const raw = await response.text();
    let data: Record<string, unknown>;
    try {
      data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
      const detail = raw.trim().slice(0, 180);
      throw new Error(response.status >= 500
        ? `Dashboard server unavailable (${response.status})${detail ? `: ${detail}` : ""}`
        : `Dashboard returned an invalid response (${response.status})`);
    }
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to load HubSpot data");
    const result = { etag: response.headers.get("etag") || undefined, data: data as unknown as DashboardData, refreshing: response.headers.get("X-Dashboard-Refreshing") === "1" };
    cache.delete(key);
    cache.set(key, result);
    while (cache.size > 12) cache.delete(cache.keys().next().value!);
    return result;
  })().finally(() => pending.delete(requestKey));
  pending.set(requestKey, promise);
  return promise;
}

export function useDashboard(filters: DashboardFilters, refreshKey: number, active = true) {
  const key = dashboardQuery(filters);
  const [state, setState] = useState<{ key: string; result?: Result; error: string; requesting: boolean }>(() => ({
    key, result: cache.get(key), error: "", requesting: !cache.has(key),
  }));
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    async function update(force = false) {
      if (running || !alive) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(() => void update(), 30_000); return; }
      running = true;
      setState(current => ({ key, result: current.key === key ? current.result : cache.get(key), error: "", requesting: true }));
      let delay = 30_000;
      try {
        const result = await readDashboard(key, force);
        if (alive) setState({ key, result, error: "", requesting: false });
        if (result.refreshing) delay = 3_000;
      } catch (error) {
        if (alive) setState(current => ({ ...current, requesting: false, error: error instanceof Error ? error.message : "Unable to refresh" }));
      } finally {
        running = false;
        if (alive) timer = setTimeout(() => void update(), delay);
      }
    }
    void update(refreshKey > 0);
    const onVisible = () => { if (!document.hidden) void update(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [key, refreshKey, active]);
  const result = state.key === key ? state.result : cache.get(key);
  const requesting = state.key === key ? state.requesting : false;
  return {
    data: result?.data ?? null,
    error: state.key === key ? state.error : "",
    loading: !result && (requesting || state.key !== key),
    requesting,
    refreshing: result?.refreshing ?? false,
  };
}
