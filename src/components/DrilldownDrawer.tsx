"use client";

import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { GtmTable, type GtmColumn } from "@/components/GtmTable";
import { WhatsAppQuickAction } from "@/components/WhatsAppQuickAction";
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
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function externalLink(url: string, label = "HubSpot") {
  if (!url || url === "#") return <span className="cell-muted">Unavailable</span>;
  return <a href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={11}/></a>;
}

function exportFileName(title: string, kind: Drilldown["kind"]) {
  const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${clean || kind}-${kind}.csv`;
}

const contactColumns: GtmColumn<ContactRow>[] = [
  { id: "priorityScore", header: "Score", accessor: (row) => row.priorityScore, width: 70, render: (row) => <span className="cell-score">{row.priorityScore}</span> },
  { id: "name", header: "Contact", accessor: (row) => row.name, width: 220, render: (row) => <div className="cell-main"><a href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong></a><span>{row.title || "No job title"}</span></div> },
  { id: "company", header: "Company", accessor: (row) => row.company, width: 180, render: (row) => <div className="cell-main"><strong>{row.company || "—"}</strong><span>{row.country || "—"}</span></div> },
  { id: "tier", header: "ICP", accessor: (row) => row.tier, width: 90 },
  { id: "contactPriority", header: "Priority", accessor: (row) => row.contactPriority, width: 90 },
  { id: "leadStatus", header: "Lead status", accessor: (row) => row.leadStatus, width: 120 },
  { id: "originalSource", header: "Original source", accessor: (row) => row.originalSource, width: 150 },
  { id: "nextActivity", header: "Next activity", accessor: (row) => row.nextActivity, width: 120, render: (row) => shortDate(row.nextActivity) },
  { id: "actions", header: "Actions", accessor: () => "", width: 120, sortable: false, render: (row) => <div className="cell-actions">{row.companyUrl && externalLink(row.companyUrl, "Company")}{externalLink(row.url)}</div> },
];

const activityColumns: GtmColumn<ActivityRow>[] = [
  { id: "type", header: "Type", accessor: (row) => row.type, width: 90 },
  { id: "subject", header: "Activity", accessor: (row) => row.subject, width: 260, render: (row) => <div className="cell-main"><strong>{row.subject}</strong><span>{row.detail || "—"}</span></div> },
  { id: "relatedContactName", header: "Contact", accessor: (row) => row.relatedContactName, width: 170, render: (row) => row.relatedContactName || "Not associated" },
  { id: "assignedTo", header: "Assigned to", accessor: (row) => row.assignedTo, width: 150, render: (row) => row.assignedTo || "Unassigned" },
  { id: "status", header: "Status", accessor: (row) => row.status, width: 120 },
  { id: "metricAt", header: "Activity date", accessor: (row) => row.metricAt, width: 150, render: (row) => dateTime(row.dueAt || row.occurredAt || row.metricAt) },
  { id: "dueBucket", header: "Due bucket", accessor: (row) => row.dueBucket, width: 120, render: (row) => row.type === "Task" ? row.dueBucket || "—" : "—" },
  { id: "actions", header: "Actions", accessor: () => "", width: 170, sortable: false, render: (row) => <div className="cell-actions">{row.type === "Task" && row.relatedContactId && row.relatedContactHasPhone ? <WhatsAppQuickAction contactId={row.relatedContactId}/> : null}{externalLink(row.url)}</div> },
];

const companyColumns: GtmColumn<CompanyRow>[] = [
  { id: "name", header: "Company", accessor: (row) => row.name, width: 220, render: (row) => <div className="cell-main"><a href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong></a><span>{row.domain || "No domain"}</span></div> },
  { id: "country", header: "Country", accessor: (row) => row.country, width: 120 },
  { id: "industry", header: "Industry", accessor: (row) => row.industry, width: 170 },
  { id: "employees", header: "Employees", accessor: (row) => row.employees, width: 100 },
  { id: "tier", header: "Tier", accessor: (row) => row.tier, width: 90 },
  { id: "ats", header: "Detected ATS", accessor: (row) => row.ats, width: 140 },
  { id: "atsConfidence", header: "Confidence", accessor: (row) => row.atsConfidence, width: 110 },
  { id: "associatedContacts", header: "SDR contacts", accessor: (row) => row.associatedContacts, width: 100 },
  { id: "actions", header: "Actions", accessor: () => "", width: 90, sortable: false, render: (row) => externalLink(row.url) },
];

const dealColumns: GtmColumn<DealRow>[] = [
  { id: "name", header: "Deal", accessor: (row) => row.name, width: 230, render: (row) => <div className="cell-main"><a href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong></a><span>{row.stage}</span></div> },
  { id: "stage", header: "Stage", accessor: (row) => row.stage, width: 160 },
  { id: "owner", header: "Owner", accessor: (row) => row.owner, width: 150, render: (row) => row.owner || "Unassigned" },
  { id: "amount", header: "Amount", accessor: (row) => row.amount, width: 120, render: (row) => money(row.amount) },
  { id: "createdAt", header: "Created", accessor: (row) => row.createdAt, width: 120, render: (row) => shortDate(row.createdAt) },
  { id: "closeDate", header: "Close date", accessor: (row) => row.closeDate, width: 120, render: (row) => shortDate(row.closeDate) },
  { id: "isOpen", header: "State", accessor: (row) => row.isOpen, width: 90, render: (row) => row.isOpen ? "Open" : "Closed" },
  { id: "actions", header: "Actions", accessor: () => "", width: 90, sortable: false, render: (row) => externalLink(row.url) },
];

function ContactsTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "contacts" }> }) {
  return <GtmTable rows={drilldown.rows} columns={contactColumns} getRowId={(row) => row.id} getSearchText={(row) => JSON.stringify(row)} exportFileName={exportFileName(drilldown.title, drilldown.kind)} exportRow={(contact) => ({ Name: contact.name, Title: contact.title, Company: contact.company, Country: contact.country, Tier: contact.tier, Priority: contact.contactPriority, "Lead Status": contact.leadStatus, "Original Source": contact.originalSource, Created: contact.createdAt, "Next Activity": contact.nextActivity, "Priority Score": contact.priorityScore, "HubSpot URL": contact.url })}/>;
}

function ActivitiesTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "activities" }> }) {
  return <GtmTable rows={drilldown.rows} columns={activityColumns} getRowId={(row) => `${row.type}-${row.id}`} getSearchText={(row) => JSON.stringify(row)} exportFileName={exportFileName(drilldown.title, drilldown.kind)} exportRow={(activity) => ({ Type: activity.type, Subject: activity.subject, Status: activity.status, Detail: activity.detail, "Associated Contact": activity.relatedContactName, "Assigned To": activity.assignedTo, "Activity Date": activity.occurredAt, "Due Date": activity.dueAt, "Due Bucket": activity.dueBucket, Open: activity.isOpen, "HubSpot URL": activity.url })}/>;
}

function CompaniesTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "companies" }> }) {
  return <GtmTable rows={drilldown.rows} columns={companyColumns} getRowId={(row) => row.id} getSearchText={(row) => JSON.stringify(row)} exportFileName={exportFileName(drilldown.title, drilldown.kind)} exportRow={(company) => ({ Company: company.name, Domain: company.domain, Country: company.country, Industry: company.industry, Employees: company.employees, Tier: company.tier, ATS: company.ats, "ATS Confidence": company.atsConfidence, "SDR Contacts": company.associatedContacts, "HubSpot URL": company.url })}/>;
}

function DealsTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "deals" }> }) {
  return <GtmTable rows={drilldown.rows} columns={dealColumns} getRowId={(row) => row.id} getSearchText={(row) => JSON.stringify(row)} exportFileName={exportFileName(drilldown.title, drilldown.kind)} exportRow={(deal) => ({ Deal: deal.name, Stage: deal.stage, Owner: deal.owner, Amount: deal.amount, Created: deal.createdAt, "Close Date": deal.closeDate, Open: deal.isOpen, "HubSpot URL": deal.url })}/>;
}

export function DrilldownDrawer({ drilldown, onClose }: { drilldown: Drilldown; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("drawer-open");
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.classList.remove("drawer-open"); };
  }, [onClose]);

  const table = drilldown.kind === "contacts" ? <ContactsTable drilldown={drilldown}/>
    : drilldown.kind === "activities" ? <ActivitiesTable drilldown={drilldown}/>
      : drilldown.kind === "companies" ? <CompaniesTable drilldown={drilldown}/>
        : <DealsTable drilldown={drilldown}/>;

  return <div className="drilldown-layer" role="dialog" aria-modal="true" aria-label={drilldown.title}>
    <button className="drilldown-backdrop" onClick={onClose} aria-label="Close details" />
    <aside className="drilldown-drawer">
      <header className="drilldown-header"><div><span>DRILL-DOWN · LIVE HUBSPOT DATA</span><h2>{drilldown.title}</h2><p>{drilldown.description}</p></div><button className="drawer-close" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
      <div className="drilldown-list">{table}</div>
      <footer className="drilldown-footer"><span>Sortable operational records behind the selected metric.</span>{externalLink(drilldown.hubspotUrl, "Open full object list")}</footer>
    </aside>
  </div>;
}
