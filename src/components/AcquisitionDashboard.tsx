"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, BriefcaseBusiness, CheckCircle2,
  Clock3, ExternalLink, ListFilter, Target,
} from "lucide-react";
import type { Drilldown } from "@/components/DrilldownDrawer";
import type {
  AcquisitionData, AcquisitionPeriodMetrics, AcquisitionRepSummary, ActivityRow,
  ChartDatum, ContactRow, DealRow,
} from "@/lib/types";

type PeriodKey = "yesterday" | "mtd" | "ytd";

const PERIODS: Array<{ key: PeriodKey; label: string; helper: string; tone: string }> = [
  { key: "yesterday", label: "Yesterday", helper: "Latest completed business day", tone: "blue" },
  { key: "mtd", label: "Month to Date", helper: "Current month", tone: "green" },
  { key: "ytd", label: "Year to Date", helper: "Current year", tone: "purple" },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function zonedDay(value: string, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function inPeriod(value: string, period: AcquisitionPeriodMetrics, timezone: string) {
  const day = zonedDay(value, timezone);
  return Boolean(day && day >= period.from && day <= period.to);
}

function recordOwner<T extends { ownerId?: string }>(row: T, selectedOwnerId: string) {
  return selectedOwnerId === "all" || row.ownerId === selectedOwnerId;
}

function sourceData(rows: ContactRow[], period: AcquisitionPeriodMetrics, timezone: string) {
  const counts = new Map<string, number>();
  for (const row of rows.filter((contact) => inPeriod(contact.createdAt, period, timezone))) {
    counts.set(row.originalSource, (counts.get(row.originalSource) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function stageData(rows: DealRow[]) {
  const counts = new Map<string, { value: number; amount: number }>();
  for (const row of rows.filter((deal) => deal.isOpen)) {
    const current = counts.get(row.stage) ?? { value: 0, amount: 0 };
    counts.set(row.stage, { value: current.value + 1, amount: current.amount + row.amount });
  }
  return [...counts.entries()].map(([name, totals]) => ({ name, ...totals })).sort((a, b) => b.amount - a.amount);
}

export function AcquisitionDashboard({ refreshKey, onOpen }: { refreshKey: number; onOpen: (drilldown: Drilldown) => void }) {
  const [data, setData] = useState<AcquisitionData | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/acquisition${refreshKey ? "?refresh=1" : ""}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Acquisition request failed");
      setData(payload as AcquisitionData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Acquisition dashboard");
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const summary = data
    ? selectedOwnerId === "all" ? data.team : data.reps.find((rep) => rep.ownerId === selectedOwnerId) ?? data.team
    : null;
  const contacts = useMemo(() => data?.contacts.filter((row) => recordOwner(row, selectedOwnerId)) ?? [], [data, selectedOwnerId]);
  const activities = useMemo(() => data?.activities.filter((row) => recordOwner(row, selectedOwnerId)) ?? [], [data, selectedOwnerId]);
  const deals = useMemo(() => data?.deals.filter((row) => recordOwner(row, selectedOwnerId)) ?? [], [data, selectedOwnerId]);
  const ytdSources = data && summary ? sourceData(contacts, summary.ytd, data.meta.timezone) : [];
  const stages = stageData(deals);

  function openContacts(title: string, description: string, rows: ContactRow[]) {
    if (!data) return;
    onOpen({ kind: "contacts", title, description, rows, hubspotUrl: data.meta.hubspotUrls.contacts });
  }

  function openActivities(title: string, description: string, rows: ActivityRow[], hubspotUrl: string) {
    onOpen({ kind: "activities", title, description, rows, hubspotUrl });
  }

  function openDeals(title: string, description: string, rows: DealRow[]) {
    if (!data) return;
    onOpen({ kind: "deals", title, description, rows, hubspotUrl: data.meta.hubspotUrls.deals });
  }

  function periodActivities(type: ActivityRow["type"], period: AcquisitionPeriodMetrics, dateField: "metricAt" | "occurredAt" = "metricAt") {
    if (!data) return [];
    return activities.filter((row) => row.type === type && inPeriod(row[dateField], period, data.meta.timezone));
  }

  function periodDeals(period: AcquisitionPeriodMetrics, dateField: "createdAt" | "closeDate" = "createdAt") {
    if (!data) return [];
    return deals.filter((row) => inPeriod(row[dateField], period, data.meta.timezone));
  }

  if (error) return <div className="acquisition-error"><AlertTriangle size={22}/><div><strong>Acquisition dashboard failed to load</strong><span>{error}</span></div><button onClick={() => void load()}>Try again</button></div>;
  if (!data || !summary) return <div className="acquisition-loading"><div className="loader"/><strong>Building Acquisition intelligence…</strong><span>Loading team owners, activities, leads, and pipeline</span></div>;

  const needContact = contacts.filter((row) => !row.lastContacted);
  const rankABUntouched = needContact.filter((row) => /(tier 1|tier 2|tier a|tier b|rank a|rank b)/i.test(row.tier));
  const atRiskDeals = deals.filter((row) => row.isOpen && ((!row.nextActivity) || (row.closeDate && zonedDay(row.closeDate, data.meta.timezone) < data.meta.today)));
  const openDealRows = deals.filter((row) => row.isOpen);

  return <div className="acquisition-dashboard">
    <section className="acquisition-owner-strip">
      <button className={selectedOwnerId === "all" ? "active" : ""} onClick={() => setSelectedOwnerId("all")}><span className="rep-dot team">TM</span><strong>Team Overview</strong></button>
      {data.reps.map((rep) => <button key={rep.ownerId} className={selectedOwnerId === rep.ownerId ? "active" : ""} onClick={() => setSelectedOwnerId(rep.ownerId)}><span className="rep-dot" style={{ background: rep.color }}>{rep.initials}</span><strong>{rep.name}</strong></button>)}
    </section>

    {data.meta.warnings.length > 0 && <div className="warning-banner"><AlertTriangle size={17}/><div><strong>Some HubSpot data was unavailable</strong><span>{data.meta.warnings.join(" · ")}</span></div></div>}

    <section className="acquisition-focus">
      <div className="acquisition-section-heading"><div><span>TODAY&apos;S EXECUTIVE FOCUS</span><h2>{summary.name}</h2></div><small><ListFilter size={12}/>Every number opens its records</small></div>
      <div className="acquisition-focus-grid">
        <FocusCard tone="red" icon={Clock3} label="Leads need contact" value={summary.focus.leadsNeedContact} helper={`${summary.focus.eligibleLeads} eligible total`} onClick={() => openContacts("Leads needing contact", `${summary.name} contacts with no logged Last Contacted value.`, needContact)}/>
        <FocusCard tone="amber" icon={Target} label="Rank A/B untouched" value={summary.focus.rankABUntouched} helper="High-priority outreach" onClick={() => openContacts("Rank A/B untouched", "Rank A/B contacts with no logged outreach.", rankABUntouched)}/>
        <FocusCard tone="purple" icon={BriefcaseBusiness} label="Deals at risk" value={summary.focus.dealsAtRisk} helper="Overdue close or no next step" onClick={() => openDeals("Deals at risk", "Open deals with an overdue close date or no next activity.", atRiskDeals)}/>
        <FocusCard tone="green" icon={CheckCircle2} label="Contact rate" value={`${summary.focus.contactRate}%`} helper={`${summary.focus.contactedLeads}/${summary.focus.eligibleLeads} contacted`} onClick={() => openContacts("Contact coverage", "All contacts used to calculate the displayed contact rate.", contacts)}/>
      </div>
    </section>

    <section className="acquisition-performance">
      <div className="acquisition-section-heading"><div><span>TEAM PERFORMANCE</span><h2>Execution and sales outcomes</h2></div><small>Yesterday · MTD · YTD</small></div>
      <div className="period-grid">
        {PERIODS.map((periodDefinition) => <PeriodCard
          key={periodDefinition.key}
          definition={periodDefinition}
          period={summary[periodDefinition.key]}
          onMetric={(metric) => {
            const period = summary[periodDefinition.key];
            const label = `${periodDefinition.label} · ${summary.name}`;
            if (metric === "contacts") return openContacts(`${label} leads`, "Contacts created during this period.", contacts.filter((row) => inPeriod(row.createdAt, period, data.meta.timezone)));
            if (metric === "calls") return openActivities(`${label} calls`, "Calls logged during this period.", periodActivities("Call", period), data.meta.hubspotUrls.calls);
            if (metric === "connected") return openActivities(`${label} connected calls`, "Calls with the Connected disposition.", periodActivities("Call", period).filter((row) => row.status === "Connected"), data.meta.hubspotUrls.calls);
            if (metric === "meetingsBooked") return openActivities(`${label} meetings booked`, "Meetings created during this period.", periodActivities("Meeting", period), data.meta.hubspotUrls.meetings);
            if (metric === "meetingsCompleted") return openActivities(`${label} completed meetings`, "Completed meetings occurring during this period.", periodActivities("Meeting", period, "occurredAt").filter((row) => row.status === "Completed"), data.meta.hubspotUrls.meetings);
            if (metric === "tasks") return openActivities(`${label} completed tasks`, "Tasks completed during this period.", periodActivities("Task", period, "occurredAt"), data.meta.hubspotUrls.tasks);
            if (metric === "dealsCreated" || metric === "pipeline") return openDeals(`${label} deals created`, "Deals created during this period.", periodDeals(period));
            if (metric === "won") return openDeals(`${label} won deals`, "Deals closed won during this period.", periodDeals(period, "closeDate").filter((row) => row.isWon));
            return openDeals(`${label} lost deals`, "Deals closed lost during this period.", periodDeals(period, "closeDate").filter((row) => !row.isOpen && !row.isWon));
          }}
        />)}
      </div>
    </section>

    {selectedOwnerId === "all" && <section className="acquisition-team-grid">
      {data.reps.map((rep) => <RepCard key={rep.ownerId} rep={rep} onClick={() => setSelectedOwnerId(rep.ownerId)}/>)}
    </section>}

    <div className="acquisition-insight-grid">
      <RankedList title="Original Traffic Sources" helper="YTD lead acquisition" rows={ytdSources} valueLabel="leads" onSelect={(item) => openContacts(`Original Traffic Source · ${item.name}`, "YTD contacts acquired from this source.", contacts.filter((row) => row.originalSource === item.name && inPeriod(row.createdAt, summary.ytd, data.meta.timezone)))}/>
      <RankedList title="Open Pipeline by Stage" helper={`${openDealRows.length} open deals · ${formatCurrency(summary.focus.openPipeline)}`} rows={stages} amount valueLabel="deals" onSelect={(item) => openDeals(`Open pipeline · ${item.name}`, "Open deals currently in this HubSpot stage.", openDealRows.filter((row) => row.stage === item.name))}/>
    </div>

    <section className="acquisition-priority-list">
      <div className="acquisition-section-heading"><div><span>PRIORITY LEADS</span><h2>Highest-priority records to action</h2></div><button onClick={() => openContacts("Priority leads", `${summary.name} leads ordered by execution priority.`, contacts)}>{contacts.length} records<ArrowRight size={13}/></button></div>
      <div className="acquisition-lead-table"><div className="acquisition-lead-head"><span>Lead</span><span>Owner</span><span>Country</span><span>ICP</span><span>Status</span><span>Next activity</span><span/></div>{contacts.slice(0, 12).map((row) => <div className="acquisition-lead-row" key={row.id}><span><strong>{row.name}</strong><small>{row.company || row.title || "No company"}</small></span><span>{row.ownerName || "—"}</span><span>{row.country || "—"}</span><span><i>{row.tier}</i></span><span>{row.leadStatus}</span><span>{row.nextActivity ? zonedDay(row.nextActivity, data.meta.timezone) : "No next step"}</span><a href={row.url} target="_blank" rel="noreferrer" aria-label={`Open ${row.name} in HubSpot`}><ExternalLink size={14}/></a></div>)}</div>
    </section>

    {loading && <div className="acquisition-refreshing"><div className="loader"/><span>Refreshing Acquisition data…</span></div>}
  </div>;
}

function FocusCard({ tone, icon: Icon, label, value, helper, onClick }: { tone: string; icon: typeof Target; label: string; value: number | string; helper: string; onClick: () => void }) {
  return <button className={`acquisition-focus-card tone-${tone}`} onClick={onClick}><span><Icon size={17}/>{label}</span><strong>{typeof value === "number" ? formatNumber(value) : value}</strong><small>{helper}<ListFilter size={11}/></small></button>;
}

type MetricName = "calls" | "connected" | "meetingsBooked" | "meetingsCompleted" | "contacts" | "tasks" | "dealsCreated" | "won" | "lost" | "pipeline";

function PeriodCard({ definition, period, onMetric }: { definition: typeof PERIODS[number]; period: AcquisitionPeriodMetrics; onMetric: (metric: MetricName) => void }) {
  const metrics: Array<{ key: MetricName; label: string; value: string }> = [
    { key: "calls", label: "Calls", value: formatNumber(period.calls) },
    { key: "connected", label: "Connected", value: formatNumber(period.connectedCalls) },
    { key: "meetingsBooked", label: "Meetings booked", value: formatNumber(period.meetingsBooked) },
    { key: "meetingsCompleted", label: "Meetings completed", value: formatNumber(period.meetingsCompleted) },
    { key: "contacts", label: "Leads", value: formatNumber(period.contacts) },
    { key: "tasks", label: "Tasks completed", value: formatNumber(period.tasksCompleted) },
    { key: "dealsCreated", label: "New deals", value: formatNumber(period.dealsCreated) },
    { key: "won", label: "Won", value: formatNumber(period.dealsWon) },
    { key: "lost", label: "Lost", value: formatNumber(period.dealsLost) },
    { key: "pipeline", label: "Pipeline created", value: formatCurrency(period.pipelineCreated) },
  ];
  return <article className={`period-card period-${definition.tone}`}><div className="period-card-heading"><div><strong>{definition.label}</strong><span>{definition.helper}</span></div><b>{period.connectionRate}%</b></div><div className="period-card-metrics">{metrics.map((metric) => <button key={metric.key} onClick={() => onMetric(metric.key)}><strong>{metric.value}</strong><span>{metric.label}</span></button>)}</div></article>;
}

function RepCard({ rep, onClick }: { rep: AcquisitionRepSummary; onClick: () => void }) {
  return <button className="acquisition-rep-card" onClick={onClick}><div><span className="rep-dot" style={{ background: rep.color }}>{rep.initials}</span><div><strong>{rep.name}</strong><span>{rep.email || "HubSpot owner"}</span></div><ArrowRight size={14}/></div><dl><div><dt>MTD Calls</dt><dd>{formatNumber(rep.mtd.calls)}</dd></div><div><dt>Connected</dt><dd>{rep.mtd.connectionRate}%</dd></div><div><dt>Meetings</dt><dd>{formatNumber(rep.mtd.meetingsCompleted)}</dd></div><div><dt>Open Pipeline</dt><dd>{formatCurrency(rep.focus.openPipeline)}</dd></div></dl></button>;
}

function RankedList({ title, helper, rows, amount = false, valueLabel, onSelect }: { title: string; helper: string; rows: ChartDatum[]; amount?: boolean; valueLabel: string; onSelect: (item: ChartDatum) => void }) {
  const max = Math.max(...rows.slice(0, 8).map((row) => amount ? row.amount ?? 0 : row.value), 1);
  return <section className="acquisition-ranked"><div><span>LIVE HUBSPOT</span><h3>{title}</h3><p>{helper}</p></div>{rows.length ? <div className="acquisition-ranked-list">{rows.slice(0, 8).map((row) => { const numeric = amount ? row.amount ?? 0 : row.value; return <button key={row.name} onClick={() => onSelect(row)}><span><strong>{row.name}</strong><small>{row.value} {valueLabel}</small></span><i><b style={{ width: `${Math.max(4, (numeric / max) * 100)}%` }}/></i><em>{amount ? formatCurrency(numeric) : formatNumber(numeric)}</em></button>; })}</div> : <div className="acquisition-empty">No data for this selection</div>}</section>;
}
