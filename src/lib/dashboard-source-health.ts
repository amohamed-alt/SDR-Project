import type { DashboardData } from "./types.ts";

export const LAST_KNOWN_GOOD_WARNING =
  "Serving the last known good dashboard snapshot because critical HubSpot sources are unavailable; values may be stale.";

const CRITICAL_SOURCE_PREFIXES = [
  "Owners:",
  "Meeting creator mapping unavailable",
  "Calls:",
  "Meetings:",
  "Tasks due:",
  "Tasks completed:",
  "Open tasks (",
  "Emails:",
  "WhatsApp messages:",
  "Call associations:",
  "Meeting associations:",
  "Task associations:",
  "Email associations:",
  "WhatsApp associations:",
  "Deal associations:",
  "Companies:",
  "Deals:",
] as const;

export function criticalDashboardWarnings(data: DashboardData) {
  return data.meta.warnings.filter((warning) =>
    CRITICAL_SOURCE_PREFIXES.some((prefix) => warning.startsWith(prefix)),
  );
}

export function dashboardSnapshotIsTrustworthy(data: DashboardData) {
  return criticalDashboardWarnings(data).length === 0;
}

export function criticalDashboardFailureMessage(data: DashboardData) {
  const warnings = criticalDashboardWarnings(data);
  return warnings.length
    ? `Critical HubSpot dashboard sources failed: ${warnings.join(" | ")}`
    : "";
}

export function createLastKnownGoodDashboard(
  previous: DashboardData,
  failedRefresh: DashboardData,
): DashboardData {
  const warnings = [...new Set([
    ...failedRefresh.meta.warnings,
    LAST_KNOWN_GOOD_WARNING,
  ])];

  return {
    ...previous,
    meta: {
      ...previous.meta,
      warnings,
    },
  };
}
