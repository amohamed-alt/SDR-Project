"use client";
import type { DashboardData } from "@/lib/types";
import { Section } from "./dashboard/DashboardPrimitives";
export function MeetingSheetEvidence({source,from,to}:{source:DashboardData["meetingSheet"];from:string;to:string}) {
  if(!source)return null;
  return <Section title="Meeting tracker · source of truth" description={source.scope || "Approved Google Sheet · owner and meeting date"}>
    {source.status!=="ready"?<p role="alert">{source.error}. HubSpot meeting activity is shown as a labelled fallback; sheet targets are unavailable.</p>:<>
      <p style={{fontSize:13}}>{from} – {to} · {source.rows.length} rows · last read {new Date(source.syncedAt).toLocaleString("en-GB")} · refreshes automatically. <a href={source.url} target="_blank" rel="noreferrer">Open source sheet ↗</a></p>
      <details><summary style={{cursor:"pointer",fontSize:14}}>Review meeting rows and source links</summary><div style={{overflowX:"auto"}}><table style={{minWidth:600,fontSize:13}}><thead><tr><th>Date</th><th>Company</th><th>Source</th><th>Status</th><th>Sales rep</th><th>Evidence</th></tr></thead><tbody>{source.rows.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.company}</td><td>{r.motion}</td><td>{r.status==="Completed"?"Attended":r.status}</td><td>{r.salesRep||"Unassigned"}</td><td><a href={r.sheetUrl} target="_blank" rel="noreferrer">Sheet row ↗</a>{r.hubspotUrl ? <> · <a href={r.hubspotUrl} target="_blank" rel="noreferrer">HubSpot ↗</a></>:null}</td></tr>)}</tbody></table></div></details>
    </>}
  </Section>;
}
