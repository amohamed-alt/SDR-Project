"use client";
import { ExternalLink } from "lucide-react";
import { WhatsAppQuickAction } from "@/components/WhatsAppQuickAction";
import type { GtmColumn } from "@/components/GtmTable";
import type { ActivityRow, CompanyRow, ContactRow, DealRow } from "@/lib/types";
import type { DashboardRecord, RecordKind } from "@/lib/dashboard-records";
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

export function externalLink(url: string, label = "HubSpot") {
  if (!url || url === "#") return <span className="cell-muted">Unavailable</span>;
  return <a href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={11}/></a>;
}

export const contactColumns: GtmColumn<ContactRow>[] = [
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

export const activityColumns: GtmColumn<ActivityRow>[] = [
  { id: "type", header: "Type", accessor: (row) => row.type, width: 90 },
  { id: "subject", header: "Activity", accessor: (row) => row.subject, width: 260, render: (row) => <div className="cell-main"><strong>{row.subject}</strong><span>{row.detail || "—"}</span></div> },
  { id: "relatedContactName", header: "Contact", accessor: (row) => row.relatedContactName, width: 170, render: (row) => row.relatedContactName || "Not associated" },
  { id: "assignedTo", header: "Assigned to", accessor: (row) => row.assignedTo, width: 150, render: (row) => row.assignedTo || "Unassigned" },
  { id: "status", header: "Status", accessor: (row) => row.status, width: 120 },
  { id: "metricAt", header: "Activity date", accessor: (row) => row.metricAt, width: 150, render: (row) => dateTime(row.dueAt || row.occurredAt || row.metricAt) },
  { id: "dueBucket", header: "Due bucket", accessor: (row) => row.dueBucket, width: 120, render: (row) => row.type === "Task" ? row.dueBucket || "—" : "—" },
  { id: "actions", header: "Actions", accessor: () => "", width: 170, sortable: false, render: (row) => <div className="cell-actions">{row.type === "Task" && row.relatedContactId && row.relatedContactHasPhone && <WhatsAppQuickAction contactId={row.relatedContactId}/>} {externalLink(row.url)}</div> },
];

export const companyColumns: GtmColumn<CompanyRow>[] = [
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

export const dealColumns: GtmColumn<DealRow>[] = [
  { id: "name", header: "Deal", accessor: (row) => row.name, width: 230, render: (row) => <div className="cell-main"><a href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong></a><span>{row.stage}</span></div> },
  { id: "stage", header: "Stage", accessor: (row) => row.stage, width: 160 },
  { id: "owner", header: "Owner", accessor: (row) => row.owner, width: 150, render: (row) => row.owner || "Unassigned" },
  { id: "amount", header: "Amount", accessor: (row) => row.amount, width: 120, render: (row) => money(row.amount) },
  { id: "createdAt", header: "Created", accessor: (row) => row.createdAt, width: 120, render: (row) => shortDate(row.createdAt) },
  { id: "closeDate", header: "Close date", accessor: (row) => row.closeDate, width: 120, render: (row) => shortDate(row.closeDate) },
  { id: "isOpen", header: "State", accessor: (row) => row.isOpen, width: 90, render: (row) => row.isOpen ? "Open" : "Closed" },
  { id: "actions", header: "Actions", accessor: () => "", width: 90, sortable: false, render: (row) => externalLink(row.url) },
];


export function dashboardRecordColumns(kind: RecordKind, variant?: "priority" | "attribution" | "accounts"): GtmColumn<DashboardRecord>[] {
  return (variant === "priority" ? priorityLeadColumns : variant === "attribution" ? attributionColumns : variant === "accounts" ? accountColumns : { contacts: contactColumns, activities: activityColumns, companies: companyColumns, deals: dealColumns }[kind]) as unknown as GtmColumn<DashboardRecord>[];
}

function prettyRecordValue(value: string) { return value.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()); }

function HubSpotLink({ href, label = "HubSpot" }: { href: string; label?: string }) { return externalLink(href, label); }
export const priorityLeadColumns: GtmColumn<ContactRow>[] = [
  { id: "priorityScore", header: "Priority", accessor: (row) => row.priorityScore, width: 80, render: (row) => <span className={"score " + (row.priorityScore >= 85 ? "high" : row.priorityScore >= 65 ? "medium" : "low")}>{row.priorityScore}</span> },
  { id: "name", header: "Contact", accessor: (row) => row.name, width: 230, render: (row) => <a className="record-link" href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong><small>{row.title || "No job title"}</small></a> },
  { id: "company", header: "Company", accessor: (row) => row.company, width: 180, render: (row) => row.companyUrl ? <a className="text-link" href={row.companyUrl} target="_blank" rel="noreferrer">{row.company || "—"}</a> : row.company || "—" },
  { id: "country", header: "Country", accessor: (row) => row.country, width: 120 },
  { id: "tier", header: "ICP tier", accessor: (row) => row.tier, width: 90, render: (row) => <span className="tag">{row.tier || "—"}</span> },
  { id: "contactPriority", header: "Contact priority", accessor: (row) => row.contactPriority, width: 120, render: (row) => <span className="tag priority-tag">{row.contactPriority || "—"}</span> },
  { id: "leadStatus", header: "Lead status", accessor: (row) => row.leadStatus, width: 120 },
  { id: "phoneStatus", header: "Phone status", accessor: (row) => row.phoneStatus, width: 110 },
  { id: "nextActivity", header: "Next activity", accessor: (row) => row.nextActivity, width: 130, render: (row) => shortDate(row.nextActivity) },
  { id: "hubspot", header: "HubSpot", accessor: () => "", width: 92, sortable: false, render: (row) => <HubSpotLink href={row.url}/> },
];

export const accountColumns: GtmColumn<CompanyRow>[] = [
  { id: "name", header: "Company", accessor: (row) => row.name, width: 230, render: (row) => <a className="record-link" href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong><small>{row.domain || "No domain"}</small></a> },
  { id: "country", header: "Country", accessor: (row) => row.country, width: 120 },
  { id: "industry", header: "Industry", accessor: (row) => row.industry, width: 160, render: (row) => prettyRecordValue(row.industry || "Unknown") },
  { id: "employees", header: "Employees", accessor: (row) => row.employees, width: 100 },
  { id: "tier", header: "Tier", accessor: (row) => row.tier, width: 90, render: (row) => <span className="tag">{row.tier || "—"}</span> },
  { id: "ats", header: "ATS", accessor: (row) => row.ats, width: 150, render: (row) => <span>{row.ats || "Unknown"}<small>{prettyRecordValue(row.atsCategory)}</small></span> },
  { id: "atsConfidence", header: "Confidence", accessor: (row) => row.atsConfidence, width: 110, render: (row) => prettyRecordValue(row.atsConfidence || "Unknown") },
  { id: "associatedContacts", header: "SDR contacts", accessor: (row) => row.associatedContacts, width: 110 },
  { id: "hubspot", header: "HubSpot", accessor: () => "", width: 92, sortable: false, render: (row) => <HubSpotLink href={row.url}/> },
];


export const attributionColumns: GtmColumn<ContactRow>[] = [
  ...priorityLeadColumns.slice(0, 4),
  ...(["originalSource", "originalSourceDetail", "latestSource", "recordSource", "recordSourceDetail", "leadSource"] as const).map(field => ({ id: field, header: { originalSource: "Original Traffic Source", originalSourceDetail: "Original Source Detail", latestSource: "Latest Traffic Source", recordSource: "Record Source", recordSourceDetail: "Record Source Detail 1", leadSource: "Lead Source" }[field], accessor: (row: ContactRow) => row[field], width: 180 })),
  priorityLeadColumns[priorityLeadColumns.length - 1],
];
