import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMaritaPriorityQueue, rescheduleMaritaTasks } from "@/lib/marita-priority";
import { getMaritaPhoneFirstPriority, mergeMaritaPriorityCompanies } from "@/lib/marita-phone-first-priority";
import { rescheduleMaritaPhoneFirstTasks } from "@/lib/marita-phone-first-reschedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const rescheduleSchema = z.object({
  taskIds: z.array(z.string().regex(/^\d+$/)).min(1).max(1000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
});

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
    const [base, phoneFirst] = await Promise.all([
      getMaritaPriorityQueue(forceRefresh),
      getMaritaPhoneFirstPriority(),
    ]);
    const companies = mergeMaritaPriorityCompanies(base.companies, phoneFirst.companies);
    const payload = {
      ...base,
      generatedAt: new Date().toISOString(),
      summary: {
        ...base.summary,
        eligibleCompanies: companies.length,
        readyToCallCompanies: companies.filter((company) => company.callableTaskCount > 0).length,
        highPriorityCompanies: companies.filter((company) => company.callableTaskCount > 0 && (company.priority === "P1" || company.priority === "P2")).length,
        neverAttemptedCompanies: companies.filter((company) => company.neverAttempted).length,
        noAnswerCompanies: companies.filter((company) => company.noAnswerCount > 0).length,
        noAts: companies.filter((company) => company.noAts).length,
        needsPhone: companies.filter((company) => company.callableTaskCount === 0).length,
        phoneFirstCompanies: phoneFirst.companyCount,
        openPhoneFirstTasks: phoneFirst.taskCount,
      },
      sources: {
        extensiveLighter: { companies: base.summary.extensiveLighterCompanies, tasks: base.summary.openExtensiveTasks },
        signalHirePhoneFirst: { companies: phoneFirst.companyCount, tasks: phoneFirst.taskCount },
      },
      companies,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("Marita priority queue failed", error);
    return NextResponse.json({
      error: "Unable to load Marita priority queue",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const parsed = rescheduleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task reschedule request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const ids = unique(parsed.data.taskIds);
    const [extensive, phoneFirst] = await Promise.all([
      rescheduleMaritaTasks(ids, parsed.data.dueDate, parsed.data.dueTime),
      rescheduleMaritaPhoneFirstTasks(ids, parsed.data.dueDate, parsed.data.dueTime),
    ]);
    const updated = extensive.updated + phoneFirst.updated;
    return NextResponse.json({
      ok: true,
      updated,
      skipped: Math.max(0, ids.length - updated),
      bySource: {
        extensiveLighter: extensive.updated,
        signalHirePhoneFirst: phoneFirst.updated,
      },
    });
  } catch (error) {
    console.error("Marita task reschedule failed", error);
    return NextResponse.json({
      error: "Unable to reschedule selected Marita tasks",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
