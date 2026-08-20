import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMaritaPriorityQueue, rescheduleMaritaTasks } from "@/lib/marita-priority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const rescheduleSchema = z.object({
  taskIds: z.array(z.string().regex(/^\d+$/)).min(1).max(1000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
});

export async function GET(request: NextRequest) {
  try {
    const payload = await getMaritaPriorityQueue(request.nextUrl.searchParams.get("refresh") === "1");
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
    const result = await rescheduleMaritaTasks(parsed.data.taskIds, parsed.data.dueDate, parsed.data.dueTime);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Marita task reschedule failed", error);
    return NextResponse.json({
      error: "Unable to reschedule selected Marita tasks",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
