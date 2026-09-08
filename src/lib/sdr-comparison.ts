import type { DashboardData } from "./types.ts";

export function summarizeSdr(data: DashboardData) {
  return { meta: { ownerId: data.meta.ownerId, ownerName: data.meta.ownerName, from: data.meta.from, to: data.meta.to, generatedAt: data.meta.generatedAt, warnings: data.meta.warnings, isDemo: data.meta.isDemo }, kpis: data.kpis, dailyActivities: data.dailyActivities };
}
export type SdrSummary = ReturnType<typeof summarizeSdr>;
