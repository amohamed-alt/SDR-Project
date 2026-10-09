import type { ActivityRow, DashboardData, DashboardFilters } from "./types.ts";
export const MEETING_SHEETS = {
  "31644369": { id: "1Mkc2IEF3gxR1ld_36fAFzlidxOAD9YXIfI1dYmfsBCk", owner: "Marita", monthly: true },
  "37624223": { id: "1OAub1dzDrSwTP02gQUdhEa4gwPIYiLGmNpr9ny5Nbp4", owner: "Daniel", monthly: false },
} as const;
export type SheetMeeting = { id: string; date: string; company: string; salesRep: string; product: string; status: string; motion: "Inbound" | "Outbound" | "Unknown"; sheetUrl: string; hubspotUrl: string };
export type SheetSnapshot = { rows: SheetMeeting[]; syncedAt: string; warnings: string[]; url: string; status: "ready" | "unavailable"; error?: string };
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g," ").trim();
export function sheetDate(raw: unknown): string {
  const s = clean(raw).replace(/0ct/ig,"Oct");
  let year: number, month: number, day: number;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const words = s.match(/^(\d{1,2})[\s\-/]+([a-z]+)[\s\-/]+(\d{4})$/i);
  const numeric = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) [year,month,day] = [Number(iso[1]),Number(iso[2]),Number(iso[3])];
  else if (words) { year=Number(words[3]); day=Number(words[1]); month=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(words[2].slice(0,3).toLowerCase())+1; }
  else if (numeric) [year,month,day]=[Number(numeric[3]),Number(numeric[1]),Number(numeric[2])]; // FORMATTED_VALUE from en_US sheets
  else return "";
  const date=new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return "";
  return date.toISOString().slice(0,10);
}
function safeHubSpotLink(raw: string) {
  if (/^\d+$/.test(raw)) return `https://app-eu1.hubspot.com/contacts/145742477/record/0-47/${raw}`;
  try { const u=new URL(raw); return u.protocol==="https:" && /^(app|app-eu1)\.hubspot\.com$/.test(u.hostname) ? u.href : ""; } catch { return ""; }
}
export function parseMeetingTab(values: unknown[][], sheetId: string, gid: number, owner: string) {
  const header = values.findIndex(r=>r.some(v=>clean(v)==="Meeting Date") && r.some(v=>clean(v)==="Booked By"));
  if (header < 0) throw new Error("Meeting tracker headers are missing");
  const names = values[header].map(clean);
  const col=(name:string)=>names.indexOf(name);
  const required=["Meeting Date","Booked By","Company","Meeting Status","Lead Source"];
  if (required.some(n=>col(n)<0)) throw new Error("Meeting tracker required columns changed");
  const rows: SheetMeeting[]=[], warnings: string[]=[];
  for (let i=header+1;i<values.length;i++) {
    const cells=values[i]; const get=(name:string)=>clean(cells[col(name)]);
    if (!cells.some(v=>clean(v))) continue;
    if (get("Booked By").toLowerCase()!==owner.toLowerCase()) continue;
    const date=sheetDate(get("Meeting Date"));
    if (!date) { warnings.push(`Row ${i+1}: invalid or missing meeting date`); continue; }
    const source=get("Lead Source").toLowerCase();
    const motion=source==="inbound" ? "Inbound" : source==="outbound" ? "Outbound" : "Unknown";
    const rawStatus=get("Meeting Status").toLowerCase().replace(/[-_]/g," ");
    const status=({attended:"Completed",completed:"Completed","no show":"No show",canceled:"Canceled",cancelled:"Canceled",rescheduled:"Rescheduled",scheduled:"Scheduled"} as Record<string,string>)[rawStatus] || "Unknown";
    const rawLink=get("HubSpot Meeting Link / ID");
    if (motion==="Unknown") warnings.push(`Row ${i+1}: unknown lead source`);
    if (rawLink && !safeHubSpotLink(rawLink)) warnings.push(`Row ${i+1}: HubSpot link needs review`);
    rows.push({id:`sheet-${sheetId}-${gid}-${i+1}`,date,company:get("Company")||"Company missing",salesRep:get("Sales Rep"),product:get("Product"),status,motion,sheetUrl:`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}&range=A${i+1}`,hubspotUrl:safeHubSpotLink(rawLink)});
  }
  return {rows,warnings};
}
export function sheetMeetingPerformance(rows: SheetMeeting[], from: string, to: string, today: string) {
  const selected=rows.filter(r=>r.date>=from&&r.date<=to);
  const active=selected.filter(r=>!["Canceled","Rescheduled"].includes(r.status));
  const elapsed=active.filter(r=>r.date<=today);
  const held=elapsed.filter(r=>r.status==="Completed");
  return {booked:selected.length,inbound:active.filter(r=>r.motion==="Inbound").length,outbound:active.filter(r=>r.motion==="Outbound").length,unknown:active.filter(r=>r.motion==="Unknown").length,backfilled:0,held:held.length,elapsed:elapsed.length,upcoming:active.filter(r=>r.date>today).length,missingOutcomes:elapsed.filter(r=>["Unknown","Scheduled"].includes(r.status)).length,attendanceRate:elapsed.length?Math.round(held.length/elapsed.length*1000)/10:0,canceled:selected.filter(r=>r.status==="Canceled").length,rescheduled:selected.filter(r=>r.status==="Rescheduled").length};
}
export function applyMeetingSheet(data: DashboardData, source: SheetSnapshot, filters: DashboardFilters, today: string): DashboardData {
  // CRM cohort filters have no matching columns in these trackers. Keep the sheet owner/date scope explicit.
  const scope="Meetings use tracker owner + meeting date; CRM country/source/persona filters do not apply to meetings.";
  if (source.status!=="ready") return {...data,meetingSheet:{...source,rows:[]},meetingPerformance:undefined,meta:{...data.meta,warnings:[...data.meta.warnings,`Meeting sheet unavailable: ${source.error}. Meeting activity falls back to HubSpot; targets unavailable.`]}};
  const rows=source.rows.filter(r=>r.date>=filters.from&&r.date<=filters.to);
  const p=sheetMeetingPerformance(rows,filters.from,filters.to,today);
  const counts=(field:"status"|"motion"|"salesRep")=>Object.entries(rows.reduce<Record<string,number>>((acc,r)=>{const v=r[field]||"Unassigned";acc[v]=(acc[v]||0)+1;return acc;},{})).map(([name,value])=>({name,value}));
  const activities: ActivityRow[]=rows.map(r=>({id:r.id,type:"Meeting",subject:`${r.company} · ${r.product}`,status:r.status,detail:r.motion,assignedTo:r.salesRep||"Unassigned",occurredAt:`${r.date}T12:00:00+03:00`,metricAt:`${r.date}T12:00:00+03:00`,bookedInPeriod:true,heldInPeriod:r.date<=today&&r.status==="Completed",dueAt:"",dueBucket:"",isOpen:["Scheduled","Unknown"].includes(r.status),isHighPriority:false,opened:false,clicked:false,replied:false,url:r.sheetUrl}));
  return {...data,hubspotMeetingEvidence:data.recentActivities.filter(r=>r.type==="Meeting"),meetingSheet:{...source,rows,scope},meetingPerformance:p,kpis:{...data.kpis,bookedMeetings:p.booked,completedMeetings:p.held,meetingCompletionRate:p.attendanceRate},dailyActivities:data.dailyActivities.map(d=>({...d,meetingsBooked:rows.filter(r=>r.date===d.date).length})),meetingOutcomes:counts("status"),meetingOwners:counts("salesRep"),meetingSources:counts("motion"),recentActivities:[...data.recentActivities.filter(r=>r.type!=="Meeting"),...activities],intelligence:{...data.intelligence,meetingToDealConversion:{numerator:data.kpis.dealsCreated,denominator:p.booked,rate:p.booked?Math.round(data.kpis.dealsCreated/p.booked*1000)/10:0},connectedCallToMeetingConversion:{numerator:p.booked,denominator:data.kpis.connectedCalls,rate:data.kpis.connectedCalls?Math.round(p.booked/data.kpis.connectedCalls*1000)/10:0}},meta:{...data.meta,warnings:[...data.meta.warnings,...source.warnings.map(w=>`Meeting sheet: ${w}`)]}};
}
