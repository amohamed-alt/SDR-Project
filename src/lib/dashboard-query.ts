import { z } from "zod";
import { dashboardToday } from "./dashboard-values.ts";

export const dashboardDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const dashboardFilterSchema = z.object({
  from: dashboardDate, to: dashboardDate, ownerId: z.string().regex(/^\d+$/),
  country: z.string().max(120).optional(), originalSource: z.string().max(120).optional(),
  latestSource: z.string().max(120).optional(), tier: z.string().max(120).optional(), persona: z.string().max(120).optional(),
}).refine(value => value.from <= value.to, { message: "The start date must be before the end date" });

export function parseDashboardFilters(params: URLSearchParams, defaultOwner: string) {
  const today = dashboardToday();
  return dashboardFilterSchema.safeParse({
    from: params.get("from") ?? process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? today.slice(0, 7) + "-01",
    to: params.get("to") ?? today,
    ownerId: params.get("ownerId") ?? defaultOwner,
    ...Object.fromEntries(["country", "originalSource", "latestSource", "tier", "persona"].map(key => [key, params.get(key) || undefined])),
  });
}
