import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/dashboard-query";
import { DEFAULT_SDR_OWNER_ID } from "@/lib/config";
import { readMeetingSheet } from "@/lib/meeting-sheet";
import { scopeMeetingSheet, sheetMeetingPerformance } from "@/lib/meeting-sheet-data";
import { dashboardToday } from "@/lib/dashboard-values";
export const runtime="nodejs";
export async function GET(request:NextRequest) {
  const parsed=parseDashboardFilters(request.nextUrl.searchParams,DEFAULT_SDR_OWNER_ID);
  if(!parsed.success||parsed.data.from>parsed.data.to)return NextResponse.json({error:"Choose a valid meeting reporting period"},{status:400});
  const source=await readMeetingSheet(parsed.data.ownerId,request.nextUrl.searchParams.get("refresh")==="1");
  if(!source)return NextResponse.json({error:"No approved meeting tracker for this owner"},{status:404});
  const { from, to } = parsed.data;
  const scoped = scopeMeetingSheet(source, from, to);
  const performance = scoped.status === "ready" ? sheetMeetingPerformance(scoped.rows, from, to, dashboardToday()) : null;
  return NextResponse.json({...scoped,performance},{headers:{"Cache-Control":"private, no-store"}});
}
