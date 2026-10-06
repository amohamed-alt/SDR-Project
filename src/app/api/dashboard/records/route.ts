import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_SDR_OWNER_ID } from "@/lib/config";
import { getDashboardRecordSnapshot } from "@/lib/dashboard-snapshot";
import { parseDashboardFilters, dashboardDate } from "@/lib/dashboard-query";
import { createMockDashboard } from "@/lib/mock-data";
import { compressedJsonResponse } from "@/lib/compressed-json";
import { dashboardRecordsCsv, queryDashboardRecords } from "@/lib/dashboard-records";

export const runtime = "nodejs";

const field = z.enum(["name", "id", "email", "phone", "linkedinUrl", "title", "company", "country", "originalSource", "originalSourceDetail", "latestSource", "recordSource", "recordSourceDetail", "leadSource", "contactSource", "leadStatus", "lifecycleStage", "tier", "contactPriority", "persona", "emailStatus", "phoneStatus", "createdAt", "lastContacted", "nextActivity", "leadResponseTimeHours", "hasConnectedCall", "hasMeeting", "hasDeal", "hasOpenDeal", "qualityIssues", "priorityScore", "type", "subject", "status", "detail", "assignedTo", "occurredAt", "metricAt", "dueAt", "dueBucket", "isOpen", "isHighPriority", "opened", "clicked", "replied", "relatedContactName", "domain", "industry", "employees", "ats", "atsConfidence", "associatedContacts", "stage", "owner", "amount", "closeDate"]);
const selectionSchema = z.object({
  kind: z.enum(["contacts", "activities", "companies", "deals"]),
  scope: z.enum(["source", "created", "activity-period", "task-status"]).optional(),
  where: z.array(z.object({ field, op: z.enum(["eq", "contains", "missing", "present", "pretty"]).optional(), value: z.union([z.string().max(200), z.number(), z.boolean()]).optional() })).max(10).optional(),
  signal: z.enum(["staleDeals", "dealsWithoutFutureActivity", "dealsWithOverdueCloseDate", "meetingsWithoutFollowUp", "completedMeetingsWithoutProgression", "noShowMeetings", "highEngagementAccountsWithoutMeeting", "contactsWithConnectedCallsWithoutMeeting", "response-overdue", "missing-contact-info"]).optional(),
  alert: z.enum(["meeting-outcomes", "outcomes", "due-today", "due-tomorrow", "due", "overdue", "high-priority-tasks", "untouched-24h", "no-next-activity", "response-time-missing", "response-time-known", "high-icp", "tier-a", "high-priority-untouched", "wrong-phone", "phones", "missing-source"]).optional(),
  day: dashboardDate.optional(), funnel: z.enum(["Portfolio", "Contacted", "Connected", "Meeting", "Deal", "Open Deal"]).optional(),
  emailEngagement: z.enum(["Sent", "Opened", "Clicked", "Replied"]).optional(), outcome: z.string().max(200).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const started = performance.now();
  const params = request.nextUrl.searchParams;
  const filters = parseDashboardFilters(params, DEFAULT_SDR_OWNER_ID);
  const version = z.string().datetime().safeParse(params.get("version"));
  let input: unknown;
  try {
    const raw = params.get("selection") || "";
    if (raw.length > 4_000) throw new Error("Too large");
    input = JSON.parse(raw);
  } catch { return NextResponse.json({ error: "Invalid record selection" }, { status: 400 }); }
  const selection = selectionSchema.safeParse(input);
  const options = z.object({
    q: z.string().max(200), sort: field.optional(), direction: z.enum(["asc", "desc"]),
    offset: z.coerce.number().int().min(0).max(1_000_000), limit: z.coerce.number().int().refine(value => [25, 50, 100].includes(value)),
    format: z.enum(["json", "csv"]),
  }).safeParse({ q: params.get("q") || "", sort: params.get("sort") || undefined, direction: params.get("direction") || "asc", offset: params.get("offset") || 0, limit: params.get("limit") || 50, format: params.get("format") || "json" });
  if (!filters.success || !version.success || !selection.success || !options.success) return NextResponse.json({ error: "Invalid dashboard record query" }, { status: 400 });
  try {
    const demo = process.env.DEMO_MODE === "true" ? createMockDashboard(filters.data.from, filters.data.to, filters.data.ownerId) : null;
    if (demo) demo.meta.generatedAt = version.data;
    const data = process.env.DEMO_MODE === "true"
      ? demo
      : await getDashboardRecordSnapshot(filters.data, version.data);
    if (!data) return NextResponse.json({ error: "This snapshot has expired. Reload the dashboard to use the latest matching records.", code: "SNAPSHOT_EXPIRED" }, { status: 409 });
    const snapshotMs = performance.now() - started;
    const page = queryDashboardRecords(data, selection.data, { ...options.data, ...(options.data.format === "csv" ? { offset: 0, limit: Number.MAX_SAFE_INTEGER } : {}) });
    const headers = { "Cache-Control": "private, no-store", "Server-Timing": `snapshot;dur=${snapshotMs.toFixed(1)}, query;dur=${(performance.now() - started - snapshotMs).toFixed(1)}`, "X-Dashboard-Records-Total": String(page.total) };
    if (options.data.format === "csv") return new Response(dashboardRecordsCsv(page.rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dashboard-${selection.data.kind}.csv"` } });
    return compressedJsonResponse(request, page, headers);
  } catch (error) {
    console.error("Dashboard detail read failed", error);
    return NextResponse.json({ error: "Unable to load matching records. Please retry." }, { status: 503 });
  }
}
