"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Building2, ExternalLink, Search, UsersRound, WalletCards, X,
} from "lucide-react";
import type { ActivityRow, CompanyRow, ContactRow, DealRow } from "@/lib/types";

export type Drilldown =
  | { kind: "contacts"; title: string; description: string; rows: ContactRow[]; hubspotUrl: string }
  | { kind: "activities"; title: string; description: string; rows: ActivityRow[]; hubspotUrl: string }
  | { kind: "companies"; title: string; description: string; rows: CompanyRow[]; hubspotUrl: string }
  | { kind: "deals"; title: string; description: string; rows: DealRow[]; hubspotUrl: string };

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function dateTime(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function externalLink(url: string, label = "Open record in HubSpot") {
  if (!url || url === "#") return <span className="drawer-record-link disabled">HubSpot link unavailable</span>;
  return <a className="drawer-record-link" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={13}/></a>;
}

function ContactCard({ row }: { row: ContactRow }) {
  return <article className="drawer-record-card">
    <div className="drawer-record-main"><span className="drawer-record-type"><UsersRound size={14}/>Contact</span><h3>{row.name}</h3><p>{row.title || "No job title"}{row.company ? ` · ${row.company}` : ""}</p></div>
    <div className="drawer-record-fields"><span><b>Country</b>{row.country || "—"}</span><span><b>ICP Tier</b>{row.tier}</span><span><b>Priority</b>{row.contactPriority}</span><span><b>Lead Status</b>{row.leadStatus}</span><span><b>Original Source</b>{row.originalSource}</span><span><b>Record Source</b>{row.recordSourceDetail !== "—" ? `${row.recordSource} · ${row.recordSourceDetail}` : row.recordSource}</span><span><b>Created</b>{shortDate(row.createdAt)}</span><span><b>Next Activity</b>{shortDate(row.nextActivity)}</span></div>
    <div className="drawer-record-actions"><span className={`score ${row.priorityScore >= 85 ? "high" : row.priorityScore >= 65 ? "medium" : "low"}`}>{row.priorityScore}</span>{row.companyUrl && externalLink(row.companyUrl, "Company")}{externalLink(row.url)}</div>
  </article>;
}

function ActivityCard({ row }: { row: ActivityRow }) {
  return <article className="drawer-record-card">
    <div className="drawer-record-main"><span className={`activity-type type-${row.type.toLowerCase()}`}><Activity size={12}/>{row.type}</span><h3>{row.subject}</h3><p>{row.status} · {row.detail}</p></div>
    <div className="drawer-record-fields activity-fields"><span><b>Assigned to</b>{row.assignedTo || "Unassigned"}</span><span><b>{row.type === "Task" ? "Due / Activity date" : "Activity date"}</b>{dateTime(row.dueAt || row.occurredAt)}</span>{row.type === "Task" && <span><b>Workload bucket</b>{row.dueBucket}</span>}<span><b>State</b>{row.isOpen ? "Open" : "Closed / completed"}</span></div>
    <div className="drawer-record-actions">{externalLink(row.url)}</div>
  </article>;
}

function CompanyCard({ row }: { row: CompanyRow }) {
  return <article className="drawer-record-card">
    <div className="drawer-record-main"><span className="drawer-record-type"><Building2 size={14}/>Company</span><h3>{row.name}</h3><p>{row.domain || "No domain"}</p></div>
    <div className="drawer-record-fields"><span><b>Country</b>{row.country || "—"}</span><span><b>Industry</b>{row.industry || "—"}</span><span><b>Employees</b>{row.employees || "—"}</span><span><b>Tier</b>{row.tier || "—"}</span><span><b>Detected ATS</b>{row.ats || "Unknown"}</span><span><b>ATS confidence</b>{row.atsConfidence || "Unknown"}</span><span><b>SDR contacts</b>{row.associatedContacts}</span></div>
    <div className="drawer-record-actions">{externalLink(row.url)}</div>
  </article>;
}

function DealCard({ row }: { row: DealRow }) {
  return <article className="drawer-record-card">
    <div className="drawer-record-main"><span className="drawer-record-type"><WalletCards size={14}/>Deal</span><h3>{row.name}</h3><p>{row.stage}</p></div>
    <div className="drawer-record-fields"><span><b>Owner</b>{row.owner || "Unassigned"}</span><span><b>Amount</b>{money(row.amount)}</span><span><b>Created</b>{shortDate(row.createdAt)}</span><span><b>Close date</b>{shortDate(row.closeDate)}</span><span><b>State</b>{row.isOpen ? "Open" : "Closed"}</span></div>
    <div className="drawer-record-actions">{externalLink(row.url)}</div>
  </article>;
}

export function DrilldownDrawer({ drilldown, onClose }: { drilldown: Drilldown; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return drilldown.rows;
    return drilldown.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(term));
  }, [drilldown.rows, query]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("drawer-open");
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.classList.remove("drawer-open"); };
  }, [onClose]);

  return <div className="drilldown-layer" role="dialog" aria-modal="true" aria-label={drilldown.title}>
    <button className="drilldown-backdrop" onClick={onClose} aria-label="Close details" />
    <aside className="drilldown-drawer">
      <header className="drilldown-header"><div><span>DRILL-DOWN · LIVE HUBSPOT DATA</span><h2>{drilldown.title}</h2><p>{drilldown.description}</p></div><button className="drawer-close" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
      <div className="drilldown-toolbar"><label><Search size={15}/><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} placeholder="Search these records…" /></label><div><strong>{filtered.length}</strong><span>{query ? `matching of ${drilldown.rows.length}` : "records"}</span></div></div>
      <div className="drilldown-list">
        {!filtered.length && <div className="drawer-empty"><Search size={26}/><strong>No matching records</strong><span>Try a different search inside this result set.</span></div>}
        {filtered.slice(0, limit).map((row) => {
          if (drilldown.kind === "contacts") return <ContactCard key={row.id} row={row as ContactRow}/>;
          if (drilldown.kind === "activities") return <ActivityCard key={`${(row as ActivityRow).type}-${row.id}`} row={row as ActivityRow}/>;
          if (drilldown.kind === "companies") return <CompanyCard key={row.id} row={row as CompanyRow}/>;
          return <DealCard key={row.id} row={row as DealRow}/>;
        })}
        {filtered.length > limit && <button className="load-more" onClick={() => setLimit((current) => current + 50)}>Show 50 more · {filtered.length - limit} remaining</button>}
      </div>
      <footer className="drilldown-footer"><span>Showing records behind the selected metric.</span>{externalLink(drilldown.hubspotUrl, "Open full object list in HubSpot")}</footer>
    </aside>
  </div>;
}
