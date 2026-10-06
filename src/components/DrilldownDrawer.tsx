"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { GtmTable } from "@/components/GtmTable";
import { externalLink, contactColumns, activityColumns, companyColumns, dealColumns } from "./DashboardRecordColumns";
import { DashboardRecordsTable } from "./DashboardRecordsTable";
import type { DashboardRecordSource } from "@/lib/dashboard-records";
import type { ActivityRow, CompanyRow, ContactRow, DealRow } from "@/lib/types";

export type Drilldown = { source?: DashboardRecordSource } & (
  | { kind: "contacts"; title: string; description: string; rows: ContactRow[]; hubspotUrl: string }
  | { kind: "activities"; title: string; description: string; rows: ActivityRow[]; hubspotUrl: string }
  | { kind: "companies"; title: string; description: string; rows: CompanyRow[]; hubspotUrl: string }
  | { kind: "deals"; title: string; description: string; rows: DealRow[]; hubspotUrl: string });

function exportFileName(title: string, kind: Drilldown["kind"]) {
  const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${clean || kind}-${kind}.csv`;
}

function ContactsTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "contacts" }> }) {
  if (drilldown.source) return <DashboardRecordsTable key={JSON.stringify(drilldown.source)} source={drilldown.source}/>;
  return <GtmTable rows={drilldown.rows} columns={contactColumns} getRowId={(row) => row.id} getSearchText={(row) => JSON.stringify(row)} exportFileName={exportFileName(drilldown.title, drilldown.kind)} exportRow={(contact) => ({ Name: contact.name, Title: contact.title, Company: contact.company, Country: contact.country, Tier: contact.tier, Priority: contact.contactPriority, "Lead Status": contact.leadStatus, "Original Source": contact.originalSource, Created: contact.createdAt, "Next Activity": contact.nextActivity, "Priority Score": contact.priorityScore, "HubSpot URL": contact.url })}/>;
}

function ActivitiesTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "activities" }> }) {
  if (drilldown.source) return <DashboardRecordsTable key={JSON.stringify(drilldown.source)} source={drilldown.source}/>;
  return <GtmTable rows={drilldown.rows} columns={activityColumns} getRowId={(row) => `${row.type}-${row.id}`} getSearchText={(row) => JSON.stringify(row)} exportFileName={exportFileName(drilldown.title, drilldown.kind)} exportRow={(activity) => ({ Type: activity.type, Subject: activity.subject, Status: activity.status, Detail: activity.detail, "Associated Contact": activity.relatedContactName, "Assigned To": activity.assignedTo, "Activity Date": activity.occurredAt, "Due Date": activity.dueAt, "Due Bucket": activity.dueBucket, Open: activity.isOpen, "HubSpot URL": activity.url })}/>;
}

function CompaniesTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "companies" }> }) {
  if (drilldown.source) return <DashboardRecordsTable key={JSON.stringify(drilldown.source)} source={drilldown.source}/>;
  return <GtmTable rows={drilldown.rows} columns={companyColumns} getRowId={(row) => row.id} getSearchText={(row) => JSON.stringify(row)} exportFileName={exportFileName(drilldown.title, drilldown.kind)} exportRow={(company) => ({ Company: company.name, Domain: company.domain, Country: company.country, Industry: company.industry, Employees: company.employees, Tier: company.tier, ATS: company.ats, "ATS Confidence": company.atsConfidence, "SDR Contacts": company.associatedContacts, "HubSpot URL": company.url })}/>;
}

function DealsTable({ drilldown }: { drilldown: Extract<Drilldown, { kind: "deals" }> }) {
  if (drilldown.source) return <DashboardRecordsTable key={JSON.stringify(drilldown.source)} source={drilldown.source}/>;
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
    <motion.button
      className="drilldown-backdrop"
      onClick={onClose}
      aria-label="Close details"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    />
    <motion.aside
      className="drilldown-drawer"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="drilldown-header"><div><span>DRILL-DOWN · LIVE HUBSPOT DATA</span><h2>{drilldown.title}</h2><p>{drilldown.description}</p></div><button className="drawer-close" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
      <div className="drilldown-list">{table}</div>
      <footer className="drilldown-footer"><span>Sortable operational records behind the selected metric.</span>{externalLink(drilldown.hubspotUrl, "Open full object list")}</footer>
    </motion.aside>
  </div>;
}
