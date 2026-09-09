"use client";

import { useEffect, useMemo } from "react";
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
  { accessorKey: "priorityScore", header: "Score", size: 70, cell: ({ getValue }) => <span className="cell-score">{String(getValue())}</span> },
  { accessorKey: "name", header: "Contact", size: 220, cell: ({ row }) => <div className="cell-main"><a href={row.original.url} target="_blank" rel="noreferrer"><strong>{row.original.name}</strong></a><span>{row.original.title || "No job title"}</span></div> },
  { accessorKey: "company", header: "Company", size: 180, cell: ({ row }) => <div className="cell-main"><strong>{row.original.company || "—"}</strong><span>{row.original.country || "—"}</span></div> },
  { accessorKey: "tier", header: "ICP", size: 90 },
  { accessorKey: "contactPriority", header: "Priority", size: 90 },
  { accessorKey: "leadStatus", header: "Lead status", size: 120 },
  { accessorKey: "originalSource", header: "Original source", size: 150 },
  { accessorKey: "nextActivity", header: "Next activity", size: 120, cell: ({ row }) => shortDate(row.original.nextActivity) },
  { id: "actions", header: "Actions", size: 120, enableSorting: false, cell: ({ row }) => <div className="cell-actions">{row.original.companyUrl && externalLink(row.original.companyUrl, "Company")}{externalLink(row.original.url)}</div> },
];

const activityColumns: GtmColumn<ActivityRow>[] = [
  { accessorKey: "type", header: "Type", size: 90 },
  { accessorKey: "subject", header: "Activity", size: 260, cell: ({ row }) => <div className="cell-main"><strong>{row.original.subject}</strong><span>{row.original.detail || "—"}</span></div> },
  { accessorKey: "relatedContactName", header: "Contact", size: 170, cell: ({ row }) => row.original.relatedContactName || "Not associated" },
  { accessorKey: "assignedTo", header: "Assigned to", size: 150, cell: ({ row }) => row.original.assignedTo || "Unassigned" },
  { accessorKey: "status", header: "Status", size: 120 },
  { accessorKey: "metricAt", header: "Activity date", size: 150, cell: ({ row }) => dateTime(row.original.dueAt || row.original.occurredAt || row.original.metricAt) },
  { accessorKey: "dueBucket", header: "Due bucket", size: 120, cell: ({ row }) => row.original.type === "Task" ? row.original.dueBucket || "—" : "—" },
  { id: "actions", header: "Actions", size: 170, enableSorting: false, cell: ({ row }) => <div className="cell-actions">{row.original.type === "Task" && row.original.relatedContactId && row.original.relatedContactHasPhone ? <WhatsAppQuickAction contactId={row.original.relatedContactId}/> : null}{externalLink(row.original.url)}</div> },
];

const companyColumns: GtmColumn<CompanyRow>[] = [
  { accessorKey: "name", header: "Company", size: 220, cell: ({ row }) => <div className="cell-main"><a href={row.original.url} target="_blank" rel="noreferrer"><strong>{row.original.name}</strong></a><span>{row.original.domain || "No domain"}</span></div> },
  { accessorKey: "country", header: "Country", size: 120 },
  { accessorKey: "industry", header: "Industry", size: 170 },
  { accessorKey: "employees", header: "Employees", size: 100 },
  { accessorKey: "tier", header: "Tier", size: 90 },
  { accessorKey: "ats", header: "Detected ATS", size: 140 },
  { accessorKey: "atsConfidence", header: "Confidence", size: 110 },
  { accessorKey: "associatedContacts", header: "SDR contacts", size: 100 },
  { id: "actions", header: "Actions", size: 90, enableSorting: false, cell: ({ row }) => externalLink(row.original.url) },
];

const dealColumns: GtmColumn<DealRow>[] = [
  { accessorKey: "name", header: "Deal", size: 230, cell: ({ row }) => <div className="cell-main"><a href={row.original.url} target="_blank" rel="noreferrer"><strong>{row.original.name}</strong></a><span>{row.original.stage}</span></div> },
  { accessorKey: "stage", header: "Stage", size: 160 },
  { accessorKey: "owner", header: "Owner", size: 150, cell: ({ row }) => row.original.owner || "Unassigned" },
  { accessorKey: "amount", header: "Amount", size: 120, cell: ({ row }) => money(row.original.amount) },
  { accessorKey: "createdAt", header: "Created", size: 120, cell: ({ row }) => shortDate(row.original.createdAt) },
  { accessorKey: "closeDate", header: "Close date", size: 120, cell: ({ row }) => shortDate(row.original.closeDate) },
  { accessorKey: "isOpen", header: "State", size: 90, cell: ({ row }) => row.original.isOpen ? "Open" : "Closed" },
  { id: "actions", header: "Actions", size: 90, enableSorting: false, cell: ({ row }) => externalLink(row.original.url) },
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

  const table = useMemo(() => {
    if (drilldown.kind === "contacts") return <ContactsTable drilldown={drilldown}/>;
    if (drilldown.kind === "activities") return <ActivitiesTable drilldown={drilldown}/>;
    if (drilldown.kind === "companies") return <CompaniesTable drilldown={drilldown}/>;
    return <DealsTable drilldown={drilldown}/>;
  }, [drilldown]);

  return <div className="drilldown-layer" role="dialog" aria-modal="true" aria-label={drilldown.title}>
    <button className="drilldown-backdrop" onClick={onClose} aria-label="Close details" />
    <aside className="drilldown-drawer">
      <header className="drilldown-header"><div><span>DRILL-DOWN · LIVE HUBSPOT DATA</span><h2>{drilldown.title}</h2><p>{drilldown.description}</p></div><button className="drawer-close" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
      <div className="drilldown-list">{table}</div>
      <footer className="drilldown-footer"><span>Sortable operational records behind the selected metric.</span>{externalLink(drilldown.hubspotUrl, "Open full object list")}</footer>
    </aside>
  </div>;
}
