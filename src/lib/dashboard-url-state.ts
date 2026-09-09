import type { DashboardFilters } from "@/lib/types";

export type DashboardViewTab = "overview" | "attribution" | "activities" | "quality" | "companies" | "pipeline";
export type DashboardViewMode = "analytics" | "workspace";

const TAB_VALUES = new Set<DashboardViewTab>(["overview", "attribution", "activities", "quality", "companies", "pipeline"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: string | null, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function safeDate(value: string | null, fallback: string) {
  const candidate = clean(value, 10);
  if (!DATE_PATTERN.test(candidate)) return fallback;
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : candidate;
}

export function readDashboardView(search: string, defaults: DashboardFilters) {
  const params = new URLSearchParams(search);
  const rawTab = clean(params.get("tab"), 24) as DashboardViewTab;
  const filters: DashboardFilters = {
    ...defaults,
    from: safeDate(params.get("from"), defaults.from),
    to: safeDate(params.get("to"), defaults.to),
  };

  const country = clean(params.get("country"));
  const originalSource = clean(params.get("originalSource"));
  const latestSource = clean(params.get("latestSource"));
  const tier = clean(params.get("tier"));
  const persona = clean(params.get("persona"));
  if (country) filters.country = country;
  if (originalSource) filters.originalSource = originalSource;
  if (latestSource) filters.latestSource = latestSource;
  if (tier) filters.tier = tier;
  if (persona) filters.persona = persona;

  return {
    filters,
    tab: TAB_VALUES.has(rawTab) ? rawTab : "overview" as DashboardViewTab,
    mode: params.get("workspace") === "1" ? "workspace" as DashboardViewMode : "analytics" as DashboardViewMode,
  };
}

function setOrDelete(params: URLSearchParams, key: string, value?: string) {
  const next = clean(value ?? "");
  if (next) params.set(key, next);
  else params.delete(key);
}

export function syncDashboardView(filters: DashboardFilters, mode: DashboardViewMode, tab: DashboardViewTab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("from", filters.from);
  url.searchParams.set("to", filters.to);
  setOrDelete(url.searchParams, "country", filters.country);
  setOrDelete(url.searchParams, "originalSource", filters.originalSource);
  setOrDelete(url.searchParams, "latestSource", filters.latestSource);
  setOrDelete(url.searchParams, "tier", filters.tier);
  setOrDelete(url.searchParams, "persona", filters.persona);
  if (tab === "overview") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  if (mode === "workspace") url.searchParams.set("workspace", "1");
  else url.searchParams.delete("workspace");
  window.history.replaceState({}, "", url);
}
