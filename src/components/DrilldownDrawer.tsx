"use client";

import { useEffect } from "react";
import {
  Activity, Building2, ExternalLink, UsersRound, WalletCards, X,
} from "lucide-react";
import { GtmDataSurface, type GtmSortOption } from "@/components/GtmDataSurface";
import { WhatsAppQuickAction } from "@/components/WhatsAppQuickAction";
import type { ActivityRow, CompanyRow, ContactRow, DealRow } from "@/lib/types";

export type Drilldown =
  | { kind: "contacts"; title: string; description: string; rows: ContactRow[]; hubspotUrl: string }
  | { kind: "activities"; title: string; description: string; rows: ActivityRow[]; hubspotUrl: string }
  | { kind: "companies"; title: string; description: string; rows: CompanyRow[]; hubspotUrl: string }
  | { kind: "deals"; title: string; description: string; rows: DealRow[]; hubspotUrl: string };

type DrawerRow = ContactRow | ActivityRow | CompanyRow | DealRow;

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
    <div className="drawer-record-fields activity-fields"><span><b>Associated contact</b>{row.relatedContactName || "Not associated"}</span><span><b>Assigned to</b>{row.assignedTo || "Unassigned"}</span><span><b>{row.type === "Task" ? "Due / Activity date" : "Activity date"}</b>{dateTime(row.dueAt || row.occurredAt)}</span>{row.type === "Task" && <span><b>Workload bucket</b>{row.dueBucket}</span>}<span><b>State</b>{row.isOpen ? "Open" : "Closed / completed"}</span></div>
    <div className="drawer-record-actions">{row.type === "Task" && row.relatedContactId && row.relatedContactHasPhone && <WhatsAppQuickAction contactId={row.relatedContactId}/>} {externalLink(row.url, row.relatedContactUrl ? "Open contact timeline in HubSpot" : "Open activity list in HubSpot")}</div>
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

function rowLabel(row: DrawerRow) {
  return "subject" in row ? row.subject : row.name;
}

function rowTimestamp(row: DrawerRow) {
  const value = "metricAt" in row ? row.metricAt : "createdAt" in row ? row.createdAt : "";
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const SORT_OPTIONS: GtmSortOption<DrawerRow>[] = [
  { id: "newest", label: "Newest first", compare: (left, right) => rowTimestamp(right) - rowTimestamp(left) },
  { id: "oldest", label: "Oldest first", compare: (left, right) => rowTimestamp(left) - rowTimestamp(right) },
  { id: "az", label: "Name A–Z", compare: (left, right) => rowLabel(left).localeCompare(rowLabel(right)) },
  { id: "za", label: "Name Z–A", compare: (left, right) => rowLabel(right).localeCompare(rowLabel(left)) },
];

function exportDrawerRow(row: DrawerRow, kind: Drilldown["kind"]) {
  if (kind === "contacts") {
    const contact = row as ContactRow;
    return { Name: contact.name, Title: contact.title, Company: contact.company, Country: contact.country, Tier: contact.tier, Priority: contact.contactPriority, "Lead Status": contact.leadStatus, "Original Source": contact.originalSource, "Record Source": contact.recordSource, "Record Source Detail": contact.recordSourceDetail, Created: contact.createdAt, "Next Activity": contact.nextActivity, "Priority Score": contact.priorityScore, "HubSpot URL": contact.url };
  }
  if (kind === "activities") {
    const activity = row as ActivityRow;
    return { Type: activity.type, Subject: activity.subject, Status: activity.status, Detail: activity.detail, "Associated Contact": activity.relatedContactName, "Assigned To": activity.assignedTo, "Activity Date": activity.occurredAt, "Due Date": activity.dueAt, "Due Bucket": activity.dueBucket, Open: activity.isOpen, "HubSpot URL": activity.url };
  }
  if (kind === "companies") {
    const company = row as CompanyRow;
    return { Company: company.name, Domain: company.domain, Country: company.country, Industry: company.industry, Employees: company.employees, Tier: company.tier, ATS: company.ats, "ATS Confidence": company.atsConfidence, "SDR Contacts": company.associatedContacts, "HubSpot URL": company.url };
  }
  const deal = row as DealRow;
  return { Deal: deal.name, Stage: deal.stage, Owner: deal.owner, Amount: deal.amount, Created: deal.createdAt, "Close Date": deal.closeDate, Open: deal.isOpen, "HubSpot URL": deal.url };
}

function exportFileName(title: string, kind: Drilldown["kind"]) {
  const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${clean || kind}-${kind}.csv`;
}

export function DrilldownDrawer({ drilldown, onClose }: { drilldown: Drilldown; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("drawer-open");
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.classList.remove("drawer-open"); };
  }, [onClose]);

  const rows = drilldown.rows as DrawerRow[];

  return <div className="drilldown-layer" role="dialog" aria-modal="true" aria-label={drilldown.title}>
    <button className="drilldown-backdrop" onClick={onClose} aria-label="Close details" />
    <aside className="drilldown-drawer">
      <header className="drilldown-header"><div><span>DRILL-DOWN · LIVE HUBSPOT DATA</span><h2>{drilldown.title}</h2><p>{drilldown.description}</p></div><button className="drawer-close" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
      <div className="drilldown-list">
        <GtmDataSurface<DrawerRow>
          rows={rows}
          getKey={(row) => "type" in row ? `${row.type}-${row.id}` : row.id}
          getSearchText={(row) => JSON.stringify(row)}
          sortOptions={SORT_OPTIONS}
          defaultSortId="newest"
          renderRow={(row) => {
            if (drilldown.kind === "contacts") return <ContactCard row={row as ContactRow}/>;
            if (drilldown.kind === "activities") return <ActivityCard row={row as ActivityRow}/>;
            if (drilldown.kind === "companies") return <CompanyCard row={row as CompanyRow}/>;
            return <DealCard row={row as DealRow}/>;
          }}
          exportFileName={exportFileName(drilldown.title, drilldown.kind)}
          exportRow={(row) => exportDrawerRow(row, drilldown.kind)}
        />
      </div>
      <footer className="drilldown-footer"><span>Showing records behind the selected metric.</span>{externalLink(drilldown.hubspotUrl, "Open full object list in HubSpot")}</footer>
    </aside>
  </div>;
}
