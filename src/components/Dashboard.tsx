"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, BarChart3, BriefcaseBusiness,
  Building2, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Database,
  ExternalLink, Filter, Gauge, ListFilter, ListTodo, Mail, MousePointerClick, Phone,
  RefreshCw, Search, ShieldCheck, Target, UsersRound, type LucideIcon,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList,
  Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { DrilldownDrawer, type Drilldown } from "@/components/DrilldownDrawer";
import { MaritaWorkspace } from "@/components/MaritaWorkspace";
import type {
  ActivityRow, ChartDatum, CompanyRow, ContactRow, DailyActivityDatum, DashboardData,
  DashboardFilters, DealRow, LabelOption,
} from "@/lib/types";

type Tab = "overview" | "attribution" | "activities" | "quality" | "companies" | "pipeline";
type PageMode = "analytics" | "workspace";

const COLORS = ["#087a50", "#f1bd28", "#3a7de0", "#744bc4", "#e85d4a", "#1aa6a0", "#d98d25", "#6a7d75"];
const GRID = "#dce7e2";
const TICK = "#667a71";
const defaultStart = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? new Date().toISOString().slice(0, 7) + "-01";
const today = new Date().toISOString().slice(0, 10);

const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "attribution", label: "Lead Sources", icon: Target },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "quality", label: "Data Quality", icon: ShieldCheck },
  { id: "companies", label: "Companies & ATS", icon: Building2 },
  { id: "pipeline", label: "Pipeline", icon: BriefcaseBusiness },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function pretty(value: string) {
  if (!value) return "Unknown";
  return value.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function dateTime(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function zonedDay(value: string, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function inPeriod(value: string, from: string, to: string, timezone?: string) {
  if (!value) return false;
  const day = timezone ? zonedDay(value, timezone) : value.slice(0, 10);
  return day >= from && day <= to;
}

function HubSpotLink({ href, label = "Open in HubSpot" }: { href: string; label?: string }) {
  return <a className="hubspot-link" href={href} target="_blank" rel="noreferrer">{label}<ExternalLink size={13}/></a>;
}

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}

function EmptyChart() {
  return <div className="empty-state"><BarChart3 size={28}/><span>No data for the selected filters</span></div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip">{label && <strong>{label}</strong>}{payload.map((item, index) => <div key={(item.name ?? "value") + "-" + index}><span style={{ background: item.color }}/>{item.name}: <b>{formatNumber(item.value ?? 0)}</b></div>)}</div>;
}

function selectedDatum(entry: unknown) {
  const candidate = entry as ChartDatum & { payload?: ChartDatum };
  return candidate.payload ?? candidate;
}

function selectedPoint(entry: unknown) {
  return (entry as { payload?: DailyActivityDatum }).payload;
}

function DrilldownHint() {
  return <span className="drilldown-hint"><MousePointerClick size={13}/>Click a value</span>;
}

function DonutChart({ data, centerLabel, onSelect }: { data: ChartDatum[]; centerLabel: string; onSelect?: (item: ChartDatum) => void }) {
  if (!data.length) return <EmptyChart/>;
  return <div className={"donut-wrap" + (onSelect ? " is-clickable" : "")}>
    <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={data.slice(0, 8)} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="#fff" strokeWidth={2} cursor={onSelect ? "pointer" : "default"} onClick={onSelect ? (entry) => onSelect(selectedDatum(entry)) : undefined}>{data.slice(0, 8).map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]}/>)}</Pie><Tooltip content={<ChartTooltip/>}/></PieChart></ResponsiveContainer>
    <div className="donut-center"><strong>{formatNumber(data.reduce((sum, item) => sum + item.value, 0))}</strong><span>{centerLabel}</span></div>
    <div className="legend-list">{data.slice(0, 8).map((item, index) => <button type="button" disabled={!onSelect} onClick={() => onSelect?.(item)} key={item.name}><i style={{ background: COLORS[index % COLORS.length] }}/><span>{item.name}</span><b>{item.value}</b></button>)}</div>
  </div>;
}

function HorizontalBars({ data, color = "#087a50", amount = false, onSelect }: { data: ChartDatum[]; color?: string; amount?: boolean; onSelect?: (item: ChartDatum) => void }) {
  if (!data.length) return <EmptyChart/>;
  return <ResponsiveContainer width="100%" height={Math.max(250, Math.min(440, data.slice(0, 10).length * 40 + 50))}><BarChart data={data.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 24 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID}/><XAxis type="number" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={amount ? (value) => "$" + Math.round(value / 1000) + "k" : undefined}/><YAxis type="category" dataKey="name" width={125} tick={{ fill: "#31483e", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip content={<ChartTooltip/>}/><Bar dataKey={amount ? "amount" : "value"} name={amount ? "Amount" : "Records"} fill={color} radius={[0, 7, 7, 0]} cursor={onSelect ? "pointer" : "default"} onClick={onSelect ? (entry) => onSelect(selectedDatum(entry)) : undefined}/></BarChart></ResponsiveContainer>;
}

function KpiCard({ label, value, helper, icon: Icon, tone, onClick }: { label: string; value: string; helper: string; icon: LucideIcon; tone: string; onClick: () => void }) {
  return <button className={"kpi-card tone-" + tone} onClick={onClick}><div className="kpi-top"><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{helper}<ListFilter size={13}/></small></button>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: LabelOption[]; onChange: (value: string) => void }) {
  return <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [pageMode, setPageMode] = useState<PageMode>("analytics");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [draft, setDraft] = useState<DashboardFilters>({ from: defaultStart, to: today, ownerId: "31644369" });
  const [applied, setApplied] = useState<DashboardFilters>(draft);

  // Return directly to Marita Workspace after the Google OAuth callback.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query.get("workspace") === "1") setPageMode("workspace");
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams();
    Object.entries(applied).forEach(([key, item]) => { if (item) query.set(key, item); });
    if (refreshKey) query.set("refresh", "1");
    try {
      const response = await fetch("/api/dashboard?" + query.toString(), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Dashboard request failed");
      setData(payload as DashboardData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [applied, refreshKey]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  function showContacts(title: string, description: string, rows: ContactRow[]) {
    if (!data) return;
    setDrilldown({ kind: "contacts", title, description, rows, hubspotUrl: data.meta.hubspotUrls.contacts });
  }

  function showActivities(title: string, description: string, rows: ActivityRow[], hubspotUrl?: string) {
    if (!data) return;
    setDrilldown({ kind: "activities", title, description, rows, hubspotUrl: hubspotUrl ?? data.meta.hubspotUrls.calls });
  }

  function showCompanies(title: string, description: string, rows: CompanyRow[]) {
    if (!data) return;
    setDrilldown({ kind: "companies", title, description, rows, hubspotUrl: data.meta.hubspotUrls.companies });
  }

  function showDeals(title: string, description: string, rows: DealRow[]) {
    if (!data) return;
    setDrilldown({ kind: "deals", title, description, rows, hubspotUrl: data.meta.hubspotUrls.deals });
  }

  function sourceContactRows() {
    if (!data) return [];
    const created = data.priorityContacts.filter((row) => inPeriod(row.createdAt, data.meta.from, data.meta.to, data.meta.timezone));
    return created.length ? created : data.priorityContacts;
  }

  function responseContactRows() {
    return sourceContactRows();
  }

  function activitiesOf(type: ActivityRow["type"]) {
    return data?.recentActivities.filter((row) => row.type === type) ?? [];
  }

  function openDailyActivity(type: ActivityRow["type"], entry: unknown, label: string, predicate?: (row: ActivityRow) => boolean) {
    if (!data) return;
    const point = selectedPoint(entry);
    if (!point) return;
    const rows = activitiesOf(type).filter((row) => zonedDay(row.metricAt, data.meta.timezone) === point.date && (!predicate || predicate(row)));
    showActivities(label + " · " + shortDate(point.date), "Records behind the selected chart point.", rows, type === "Task" ? data.meta.hubspotUrls.tasks : type === "Meeting" ? data.meta.hubspotUrls.meetings : type === "Email" ? data.meta.hubspotUrls.emails : data.meta.hubspotUrls.calls);
  }

  function openAlert(alert: DashboardData["alerts"][number]) {
    if (!data) return;
    const contacts = data.priorityContacts;
    const tasks = activitiesOf("Task");
    if (alert.id === "due-today") return showActivities(alert.title, alert.detail, tasks.filter((row) => row.isOpen && row.dueBucket === "Due today"), data.meta.hubspotUrls.tasks);
    if (alert.id === "due-tomorrow" || alert.id === "due") return showActivities(alert.title, alert.detail, tasks.filter((row) => row.isOpen && row.dueBucket === "Due tomorrow"), data.meta.hubspotUrls.tasks);
    if (alert.id === "overdue") return showActivities(alert.title, alert.detail, tasks.filter((row) => row.isOpen && row.dueAt && new Date(row.dueAt).getTime() < Date.now()), data.meta.hubspotUrls.tasks);
    if (alert.id === "high-priority-tasks") return showActivities(alert.title, alert.detail, tasks.filter((row) => row.isOpen && row.isHighPriority), data.meta.hubspotUrls.tasks);
    if (alert.id === "untouched-24h") return showContacts(alert.title, alert.detail, contacts.filter((row) => !row.lastContacted && new Date(row.createdAt).getTime() < Date.now() - 86_400_000));
    if (alert.id === "no-next-activity") return showContacts(alert.title, alert.detail, contacts.filter((row) => !row.nextActivity));
    if (alert.id === "response-time-missing") return showContacts(alert.title, alert.detail, responseContactRows().filter((row) => row.leadResponseTimeHours === null));
    if (alert.id === "high-icp" || alert.id === "tier-a") return showContacts(alert.title, alert.detail, contacts.filter((row) => row.tier === "Tier 1" && !row.lastContacted));
    if (alert.id === "high-priority-untouched") return showContacts(alert.title, alert.detail, contacts.filter((row) => row.contactPriority === "High" && !row.lastContacted));
    if (alert.id === "wrong-phone" || alert.id === "phones") return showContacts(alert.title, alert.detail, contacts.filter((row) => /wrong/i.test(row.phoneStatus)));
    if (alert.id === "meeting-outcomes" || alert.id === "outcomes") return showActivities(alert.title, alert.detail, activitiesOf("Meeting").filter((row) => row.status === "Unknown"), data.meta.hubspotUrls.meetings);
    if (alert.id === "missing-source") return showContacts(alert.title, alert.detail, contacts.filter((row) => row.qualityIssues.includes("hs_analytics_source")));
    showContacts(alert.title, alert.detail, contacts);
  }

  function setPreset(preset: "today" | "week" | "month" | "sinceJuly") {
    const now = new Date();
    let from = today;
    if (preset === "week") {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      from = start.toISOString().slice(0, 10);
    }
    if (preset === "month") from = today.slice(0, 7) + "-01";
    if (preset === "sinceJuly") from = "2026-07-01";
    setDraft((current) => ({ ...current, from, to: today }));
  }

  function resetFilters() {
    const reset = { from: defaultStart, to: today, ownerId: "31644369" };
    setDraft(reset);
    setApplied(reset);
  }

  const kpis = data ? [
    { label: "SDR portfolio", value: formatNumber(data.kpis.portfolioContacts), helper: data.kpis.newContacts + " created in period", icon: UsersRound, tone: "green", onClick: () => showContacts("SDR portfolio", "All contacts owned by the selected SDR and dashboard filters.", data.priorityContacts) },
    { label: "Companies", value: formatNumber(data.kpis.companies), helper: "Distinct associated accounts", icon: Building2, tone: "blue", onClick: () => showCompanies("Associated companies", "Companies associated with the selected SDR contact portfolio.", data.companies) },
    { label: "Calls", value: formatNumber(data.kpis.calls), helper: data.kpis.connectionRate + "% connected", icon: Phone, tone: "teal", onClick: () => showActivities("Calls", "Calls logged in the selected reporting period.", activitiesOf("Call"), data.meta.hubspotUrls.calls) },
    { label: "Meetings", value: formatNumber(data.kpis.bookedMeetings), helper: data.kpis.completedMeetings + " completed", icon: CalendarDays, tone: "amber", onClick: () => showActivities("Meetings", "Deduplicated meetings created in the selected reporting period.", activitiesOf("Meeting"), data.meta.hubspotUrls.meetings) },
    { label: "Open tasks", value: formatNumber(data.kpis.openTasks), helper: data.kpis.dueToday + " due today", icon: CheckCircle2, tone: data.kpis.dueToday > 75 ? "red" : "blue", onClick: () => showActivities("Open tasks", "All current open tasks for the selected SDR.", activitiesOf("Task").filter((row) => row.isOpen), data.meta.hubspotUrls.tasks) },
    { label: "Email reply rate", value: data.kpis.emailReplyRate + "%", helper: data.kpis.emailReplies + " replies / " + data.kpis.emailsSent + " sent", icon: Mail, tone: "purple", onClick: () => showActivities("Sales emails", "Outgoing email activities in the selected reporting period.", activitiesOf("Email"), data.meta.hubspotUrls.emails) },
    { label: "Open deals", value: formatNumber(data.kpis.openDeals), helper: data.kpis.dealsCreated + " created in period", icon: BriefcaseBusiness, tone: "green", onClick: () => showDeals("Open deals", "Open deals associated with contacts in the SDR portfolio.", data.deals.filter((row) => row.isOpen)) },
    { label: "Open pipeline", value: formatCurrency(data.kpis.pipelineValue), helper: "Attributed through SDR contacts", icon: CircleDollarSign, tone: "amber", onClick: () => showDeals("Open pipeline", "Open deal records contributing to the displayed pipeline value.", data.deals.filter((row) => row.isOpen)) },
  ] : [];

  return <main className="app-shell">
    <header className="topbar"><div className="top-title"><strong>SDR Command Center</strong><span>Live HubSpot performance & attribution</span></div><div className="top-actions"><span className={"status-pill " + (data?.meta.isDemo ? "demo" : "live")}><i/>{data?.meta.isDemo ? "Demo data" : "LIVE · HUBSPOT"}</span>{pageMode === "analytics" && <button className="icon-button" onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Toggle filters"><Filter size={18}/></button>}<button className="refresh-button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""}/>Refresh data</button></div></header>

    <div className="workspace">
      <aside className="sidebar"><div className="brand"><div className="brand-logo" role="img" aria-label="Talentera ATS"/><span className="brand-subtitle">SDR Intelligence</span></div><div className="nav-label">MAIN</div><nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={pageMode === "analytics" && activeTab === id ? "active" : ""} onClick={() => { setActiveTab(id); setPageMode("analytics"); }}><Icon size={17}/><span>{label}</span>{pageMode === "analytics" && activeTab === id && <ChevronRight size={15}/>}</button>)}</nav><div className="nav-label owner-label">SDR OWNER</div><div className="owner-card"><div className="avatar">MC</div><div><span>Reporting for</span><strong>{data?.meta.ownerName ?? "Marita Chedid"}</strong></div><BadgeCheck size={17}/></div><div className="sync-card"><Database size={18}/><div><strong>Last sync</strong><span>{data ? new Date(data.meta.generatedAt).toLocaleString("en-GB") : "Loading…"}</span></div></div></aside>

      <div className="content"><div className="page-title"><div><span className="eyebrow">TALENTERA · SDR PERFORMANCE</span><h1>{pageMode === "workspace" ? "Marita Workspace" : tabs.find((tab) => tab.id === activeTab)?.label}</h1><p>{data ? pageMode === "workspace" ? "Daily execution center · Live HubSpot data" : shortDate(data.meta.from) + " – " + shortDate(data.meta.to) + " · " + data.meta.timezone : "Loading dashboard data…"}</p></div></div>

        <div className="page-mode-tabs"><button className={pageMode === "analytics" ? "active" : ""} onClick={() => setPageMode("analytics")}><Gauge size={15}/><span>Analytics Dashboard</span></button><button className={pageMode === "workspace" ? "active" : ""} onClick={() => { setPageMode("workspace"); setFiltersOpen(false); }}><UsersRound size={15}/><span>Marita Workspace</span><i>NEW</i></button></div>

        {pageMode === "analytics" && <div className={"filter-drawer " + (filtersOpen ? "open" : "")}><div className="preset-row"><span>Quick range</span><button onClick={() => setPreset("today")}>Today</button><button onClick={() => setPreset("week")}>This week</button><button onClick={() => setPreset("month")}>This month</button><button onClick={() => setPreset("sinceJuly")}>Since 1 July</button></div><div className="filter-grid"><label className="filter-field"><span>From</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })}/></label><label className="filter-field"><span>To</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })}/></label><FilterSelect label="Country" value={draft.country ?? ""} options={data?.filterOptions.countries ?? []} onChange={(country) => setDraft({ ...draft, country })}/><FilterSelect label="Original Traffic Source" value={draft.originalSource ?? ""} options={data?.filterOptions.originalSources ?? []} onChange={(originalSource) => setDraft({ ...draft, originalSource })}/><FilterSelect label="Latest Traffic Source" value={draft.latestSource ?? ""} options={data?.filterOptions.latestSources ?? []} onChange={(latestSource) => setDraft({ ...draft, latestSource })}/><FilterSelect label="ICP Tier" value={draft.tier ?? ""} options={data?.filterOptions.tiers ?? []} onChange={(tier) => setDraft({ ...draft, tier })}/><FilterSelect label="Persona" value={draft.persona ?? ""} options={data?.filterOptions.personas ?? []} onChange={(persona) => setDraft({ ...draft, persona })}/><div className="filter-actions"><button className="secondary-button" onClick={resetFilters}>Reset</button><button className="primary-button" onClick={() => setApplied(draft)}><Search size={15}/>Apply</button></div></div><p className="filter-note">Labels are loaded from HubSpot. Internal values are used only behind the scenes for filtering.</p></div>}

        {data?.meta.warnings.length ? <div className="warning-banner"><AlertTriangle size={17}/><div><strong>{data.meta.isDemo ? "Demo mode" : "Some HubSpot data sources were unavailable"}</strong><span>{data.meta.warnings.join(" · ")}</span></div></div> : null}
        {error && <div className="error-banner"><AlertTriangle size={20}/><div><strong>Dashboard failed to load</strong><span>{error}</span></div><button onClick={() => void loadDashboard()}>Try again</button></div>}

        {data && pageMode === "workspace" && <MaritaWorkspace data={data} onOpen={setDrilldown}/>} 
        {data && pageMode === "analytics" && <>
          {activeTab === "overview" && <>
            <div className="kpi-grid">{kpis.map((card) => <KpiCard key={card.label} {...card}/>)}</div>
            <section className="execution-focus"><div className="focus-heading"><div><span>TODAY&apos;S EXECUTION FOCUS</span><strong>What needs attention now</strong></div><DrilldownHint/></div><div className="focus-grid">
              <FocusMetric label="Untouched over 24h" value={formatNumber(data.kpis.untouchedOver24h)} helper={data.kpis.untouchedContacts + " untouched total"} icon={Clock3} tone="red" onClick={() => showContacts("Untouched over 24 hours", "Contacts created more than 24 hours ago with no logged contact.", data.priorityContacts.filter((row) => !row.lastContacted && new Date(row.createdAt).getTime() < Date.now() - 86_400_000))}/>
              <FocusMetric label="No next activity" value={formatNumber(data.kpis.noNextActivity)} helper={data.kpis.nextActivityCoverage + "% coverage"} icon={CalendarDays} tone="amber" onClick={() => showContacts("No next activity", "Contacts with no next activity date scheduled.", data.priorityContacts.filter((row) => !row.nextActivity))}/>
              <FocusMetric label="Tasks due today" value={formatNumber(data.kpis.dueToday)} helper={data.kpis.openTasks + " open tasks"} icon={ListTodo} tone="green" onClick={() => showActivities("Tasks due today", "Open tasks due today in HubSpot.", activitiesOf("Task").filter((row) => row.isOpen && row.dueBucket === "Due today"), data.meta.hubspotUrls.tasks)}/>
              <FocusMetric label="High-priority tasks" value={formatNumber(data.kpis.highPriorityOpenTasks)} helper="Open High priority queue" icon={AlertTriangle} tone="purple" onClick={() => showActivities("High-priority open tasks", "Open tasks marked High priority.", activitiesOf("Task").filter((row) => row.isOpen && row.isHighPriority), data.meta.hubspotUrls.tasks)}/>
              <FocusMetric label="Response time coverage" value={data.kpis.leadResponseCoverage + "%"} helper="Click to inspect missing values" icon={ShieldCheck} tone="blue" onClick={() => showContacts("Missing lead response time", "Reporting-cohort contacts without Lead response time.", responseContactRows().filter((row) => row.leadResponseTimeHours === null))}/>
              <FocusMetric label="Median response time" value={data.kpis.leadResponseCoverage ? data.kpis.medianLeadResponseHours + "h" : "—"} helper="Contacts with a populated value" icon={Gauge} tone="teal" onClick={() => showContacts("Lead response time details", "Reporting-cohort contacts with a populated response time.", responseContactRows().filter((row) => row.leadResponseTimeHours !== null))}/>
            </div></section>
            <div className="two-column wide-left">
              <Section title="Daily SDR execution" description="Click any series point to inspect its records." action={<DrilldownHint/>}><ResponsiveContainer width="100%" height={330}><AreaChart data={data.dailyActivities} margin={{ left: -12, right: 10, top: 12 }}><defs><linearGradient id="calls" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#087a50" stopOpacity={0.28}/><stop offset="95%" stopColor="#087a50" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis dataKey="date" tickFormatter={(item) => item.slice(5)} tick={{ fill: TICK, fontSize: 11 }} axisLine={false}/><YAxis tick={{ fill: TICK, fontSize: 11 }} axisLine={false}/><Tooltip content={<ChartTooltip/>}/><Legend/><Area type="monotone" dataKey="calls" stroke="#087a50" fill="url(#calls)" strokeWidth={2.5} cursor="pointer" onClick={(entry) => openDailyActivity("Call", entry, "Calls")}/><Line type="monotone" dataKey="connected" stroke="#3a7de0" strokeWidth={2} cursor="pointer" onClick={(entry) => openDailyActivity("Call", entry, "Connected calls", (row) => row.status === "Connected")}/><Line type="monotone" dataKey="tasksCompleted" stroke="#d98d25" strokeWidth={2} cursor="pointer" onClick={(entry) => openDailyActivity("Task", entry, "Completed tasks", (row) => !row.isOpen)}/><Line type="monotone" dataKey="meetingsBooked" stroke="#744bc4" strokeWidth={2} cursor="pointer" onClick={(entry) => openDailyActivity("Meeting", entry, "Meetings")}/></AreaChart></ResponsiveContainer></Section>
              <Section title="SDR conversion funnel" description="Click a funnel stage to inspect its contacts or deals." action={<DrilldownHint/>}>{data.funnel.length ? <ResponsiveContainer width="100%" height={330}><FunnelChart><Tooltip content={<ChartTooltip/>}/><Funnel dataKey="value" data={data.funnel} isAnimationActive cursor="pointer" onClick={(entry) => { const item = selectedDatum(entry); if (item.name === "Deal") showDeals("Deals in funnel", "Deals associated with the selected SDR portfolio.", data.deals); else if (item.name === "Open Deal") showDeals("Open deals in funnel", "Open deals associated with the selected SDR portfolio.", data.deals.filter((row) => row.isOpen)); else showContacts(item.name + " contacts", "Contacts contributing to this funnel stage.", data.priorityContacts.filter((row) => item.name === "Portfolio" || (item.name === "Contacted" && Boolean(row.lastContacted)) || (item.name === "Connected" && row.hasConnectedCall) || (item.name === "Meeting" && row.hasMeeting))); }}><LabelList position="right" fill="#213b30" stroke="none" dataKey="name"/>{data.funnel.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]}/>)}</Funnel></FunnelChart></ResponsiveContainer> : <EmptyChart/>}</Section>
            </div>
            <div className="two-column alerts-layout">
              <Section title="Operational alerts" description="Click an alert to inspect the affected records."><div className="alert-list">{data.alerts.slice(0, 7).map((alert) => <button key={alert.id} className={"alert-item " + alert.severity} onClick={() => openAlert(alert)}><span className="alert-icon">{alert.severity === "critical" ? <AlertTriangle size={17}/> : <Activity size={17}/>}</span><div><strong>{alert.title}</strong><p>{alert.detail}</p><small>{alert.action}<ListFilter size={12}/></small></div><b>{alert.count}</b></button>)}</div></Section>
              <Section title="Lead Status" description="HubSpot display labels across the SDR portfolio." action={<DrilldownHint/>}><HorizontalBars data={data.leadStatuses} onSelect={(item) => showContacts("Lead Status · " + item.name, "Contacts with the selected HubSpot Lead Status.", data.priorityContacts.filter((row) => row.leadStatus === item.name))}/></Section>
            </div>
            <Section title="Priority leads" description="The table links open exact HubSpot records; KPI and chart clicks open internal lists first." action={<HubSpotLink href={data.meta.hubspotUrls.contacts} label={"View all " + data.kpis.portfolioContacts}/>}><ContactTable rows={data.priorityContacts.slice(0, 20)}/></Section>
          </>}

          {activeTab === "attribution" && <>
            <div className="source-audit">
              <button onClick={() => showContacts("Record Source · Integration", "Reporting-period contacts created by an integration.", sourceContactRows().filter((row) => row.recordSource === "Integration"))}><span>Record Source: Integration</span><strong>{data.sourceAudit.integrationRecords}</strong><small>{data.sourceAudit.apiShare}% of contacts in source period</small></button>
              <button className="featured" onClick={() => showContacts("Integration · Extensive-Lighter", "Reporting-period contacts created by the Extensive-Lighter API integration.", sourceContactRows().filter((row) => row.recordSourceDetail.toLowerCase() === "extensive-lighter"))}><span>Record Source Detail 1</span><strong>{data.sourceAudit.extensiveLighterRecords}</strong><small>Extensive-Lighter API records</small></button>
              <button onClick={() => showContacts("Record Source · Forms", "Reporting-period contacts created by HubSpot forms.", sourceContactRows().filter((row) => row.recordSource === "Forms"))}><span>Record Source: Forms</span><strong>{data.sourceAudit.formRecords}</strong><small>HubSpot form-created records</small></button>
            </div>
            <div className="section-intro"><Target size={21}/><div><strong>HubSpot source audit</strong><p>Original Traffic Source describes acquisition. Record Source identifies how the contact was created. Extensive-Lighter is correctly captured as Integration → Record source detail 1.</p></div></div>
            <div className="three-column">
              <Section title="Original Traffic Source" description="HubSpot label: first known acquisition channel." action={<DrilldownHint/>}><DonutChart data={data.originalSources} centerLabel="first touch" onSelect={(item) => showContacts("Original Traffic Source · " + item.name, "Reporting-period contacts acquired from this original source.", sourceContactRows().filter((row) => row.originalSource === item.name))}/></Section>
              <Section title="Latest Traffic Source" description="HubSpot label: most recent tracked session." action={<DrilldownHint/>}><DonutChart data={data.latestSources} centerLabel="latest touch" onSelect={(item) => showContacts("Latest Traffic Source · " + item.name, "Reporting-period contacts with this latest source.", sourceContactRows().filter((row) => row.latestSource === item.name))}/></Section>
              <Section title="Record Source" description="How each CRM record was created." action={<DrilldownHint/>}><DonutChart data={data.recordSources} centerLabel="records" onSelect={(item) => showContacts("Record Source · " + item.name, "Reporting-period contacts created through this record source.", sourceContactRows().filter((row) => row.recordSource === item.name))}/></Section>
            </div>
            <div className="two-column">
              <Section title="Integration detail" description="Record Source Detail 1 for Integration-created contacts." action={<DrilldownHint/>}><HorizontalBars data={data.integrationSources} color="#087a50" onSelect={(item) => showContacts("Integration detail · " + item.name, "Integration-created contacts with the selected Record Source Detail 1.", sourceContactRows().filter((row) => pretty(row.recordSourceDetail) === item.name))}/></Section>
              <Section title="Lifecycle Stage" description="Current HubSpot display labels, never internal IDs." action={<DrilldownHint/>}><HorizontalBars data={data.lifecycleStages} color="#744bc4" onSelect={(item) => showContacts("Lifecycle Stage · " + item.name, "Contacts in the selected lifecycle stage.", data.priorityContacts.filter((row) => row.lifecycleStage === item.name))}/></Section>
            </div>
            <Section title="Source drill-down" description="Every value is shown using its HubSpot label; source details remain exactly as stored." action={<HubSpotLink href={data.meta.hubspotUrls.contacts}/>}><ContactTable rows={sourceContactRows().slice(0, 50)} attribution/></Section>
          </>}

          {activeTab === "activities" && <>
            <div className="activity-kpis">
              <MiniMetric label="Connected calls" value={data.kpis.connectedCalls} rate={data.kpis.connectionRate + "%"} icon={Phone} onClick={() => showActivities("Connected calls", "Calls with the Connected disposition.", activitiesOf("Call").filter((row) => row.status === "Connected"), data.meta.hubspotUrls.calls)}/>
              <MiniMetric label="Completed tasks" value={data.kpis.completedTasks} rate={data.kpis.openTasks + " open"} icon={CheckCircle2} onClick={() => showActivities("Completed tasks", "Tasks completed during the selected period.", activitiesOf("Task").filter((row) => !row.isOpen), data.meta.hubspotUrls.tasks)}/>
              <MiniMetric label="Completed meetings" value={data.kpis.completedMeetings} rate={data.kpis.meetingCompletionRate + "%"} icon={CalendarDays} onClick={() => showActivities("Completed meetings", "Meetings with the Completed outcome.", activitiesOf("Meeting").filter((row) => row.status === "Completed"), data.meta.hubspotUrls.meetings)}/>
              <MiniMetric label="Email replies" value={data.kpis.emailReplies} rate={data.kpis.emailReplyRate + "%"} icon={Mail} onClick={() => showActivities("Replied emails", "Outgoing emails with at least one reply.", activitiesOf("Email").filter((row) => row.replied), data.meta.hubspotUrls.emails)}/>
            </div>
            <Section title="Daily activity volume" description="Click a bar to inspect the records for that date." action={<DrilldownHint/>}><ResponsiveContainer width="100%" height={340}><BarChart data={data.dailyActivities}><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis dataKey="date" tickFormatter={(item) => item.slice(5)} tick={{ fill: TICK, fontSize: 11 }}/><YAxis tick={{ fill: TICK, fontSize: 11 }}/><Tooltip content={<ChartTooltip/>}/><Legend/><Bar dataKey="calls" fill="#087a50" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Call", entry, "Calls")}/><Bar dataKey="tasksCompleted" fill="#f1bd28" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Task", entry, "Completed tasks", (row) => !row.isOpen)}/><Bar dataKey="emailsSent" fill="#3a7de0" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Email", entry, "Emails sent")}/><Bar dataKey="meetingsBooked" fill="#744bc4" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Meeting", entry, "Meetings")}/></BarChart></ResponsiveContainer></Section>
            <Section title="Open task workload by due date" description="Click a due-date bucket to inspect its open tasks." action={<DrilldownHint/>}><HorizontalBars data={data.taskDueBuckets} color="#d98d25" onSelect={(item) => showActivities("Task workload · " + item.name, "Open tasks in the selected due-date bucket.", activitiesOf("Task").filter((row) => row.isOpen && row.dueBucket === item.name), data.meta.hubspotUrls.tasks)}/></Section>
            <div className="three-column">
              <Section title="Call outcomes" action={<DrilldownHint/>}><DonutChart data={data.callOutcomes} centerLabel="calls" onSelect={(item) => showActivities("Call outcome · " + item.name, "Calls with the selected disposition.", activitiesOf("Call").filter((row) => row.status === item.name || row.detail === item.name), data.meta.hubspotUrls.calls)}/></Section>
              <Section title="Task Status" action={<DrilldownHint/>}><DonutChart data={data.taskStatuses} centerLabel="tasks" onSelect={(item) => showActivities("Task Status · " + item.name, "Tasks with the selected HubSpot status.", activitiesOf("Task").filter((row) => row.status === item.name), data.meta.hubspotUrls.tasks)}/></Section>
              <Section title="Email engagement" action={<DrilldownHint/>}><HorizontalBars data={data.emailPerformance} color="#3a7de0" onSelect={(item) => showActivities("Email engagement · " + item.name, "Emails contributing to the selected engagement metric.", activitiesOf("Email").filter((row) => item.name === "Sent" || (item.name === "Opened" && row.opened) || (item.name === "Clicked" && row.clicked) || (item.name === "Replied" && row.replied)), data.meta.hubspotUrls.emails)}/></Section>
            </div>
            <div className="three-column">
              <Section title="Meeting Outcome" action={<DrilldownHint/>}><DonutChart data={data.meetingOutcomes} centerLabel="meetings" onSelect={(item) => showActivities("Meeting Outcome · " + item.name, "Meetings with the selected outcome.", activitiesOf("Meeting").filter((row) => row.status === item.name), data.meta.hubspotUrls.meetings)}/></Section>
              <Section title="Meeting assigned to" action={<DrilldownHint/>}><HorizontalBars data={data.meetingOwners} onSelect={(item) => showActivities("Meetings assigned to " + item.name, "Meetings assigned to the selected owner.", activitiesOf("Meeting").filter((row) => row.assignedTo === item.name), data.meta.hubspotUrls.meetings)}/></Section>
              <Section title="Meeting Source" action={<DrilldownHint/>}><HorizontalBars data={data.meetingSources} color="#d98d25" onSelect={(item) => showActivities("Meeting Source · " + item.name, "Meetings created through the selected source.", activitiesOf("Meeting").filter((row) => row.detail === item.name), data.meta.hubspotUrls.meetings)}/></Section>
            </div>
            <Section title="Recent activity records" description="Calls, meetings, tasks, and emails with their associated contact. HubSpot links open the contact timeline where the activity is stored." action={<HubSpotLink href={data.meta.hubspotUrls.calls} label="Open activities"/>}><ActivityTable rows={data.recentActivities.slice(0, 100)}/></Section>
          </>}

          {activeTab === "quality" && <>
            <div className="quality-grid">{data.quality.map((metric) => <button className="quality-card" key={metric.key} onClick={() => showContacts(metric.label + " · missing", "Contacts that do not meet this data-quality check.", data.priorityContacts.filter((row) => row.qualityIssues.includes(metric.key)))}><div><span>{metric.label}</span><b>{metric.rate}%</b></div><div className="progress"><i style={{ width: metric.rate + "%" }}/></div><small>{metric.complete} complete · {metric.total - metric.complete} missing</small></button>)}</div>
            <div className="two-column">
              <Section title="Data quality risks"><div className="alert-list">{data.alerts.filter((item) => ["wrong-phone", "missing-source", "high-icp", "untouched-24h", "no-next-activity", "response-time-missing"].includes(item.id)).slice(0, 6).map((alert) => <button key={alert.id} className={"alert-item " + alert.severity} onClick={() => openAlert(alert)}><span className="alert-icon"><AlertTriangle size={17}/></span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div><b>{alert.count}</b></button>)}</div></Section>
              <Section title="Recommended automation"><div className="recommendation-list"><div><Target/><span><strong>Source protection</strong>Keep Original Traffic Source intact; use Record Source Detail for Extensive-Lighter.</span></div><div><Phone/><span><strong>Phone recovery</strong>Wrong Number → SignalHire fallback → task with only new numbers.</span></div><div><CalendarDays/><span><strong>Meeting dedupe</strong>Merge sync and CRM activities by contact, date, and hour.</span></div><div><ShieldCheck/><span><strong>SLA alerts</strong>Tier A untouched after 24 hours creates a priority task.</span></div></div></Section>
            </div>
            <Section title="Records needing attention" action={<HubSpotLink href={data.meta.hubspotUrls.contacts}/>}><ContactTable rows={data.priorityContacts.slice(0, 50)}/></Section>
          </>}

          {activeTab === "companies" && <>
            <div className="three-column">
              <Section title="Companies by country" action={<DrilldownHint/>}><DonutChart data={data.countries} centerLabel="companies" onSelect={(item) => showCompanies("Companies · " + item.name, "Companies in the selected country.", data.companies.filter((row) => pretty(row.country) === item.name))}/></Section>
              <Section title="Top industries" action={<DrilldownHint/>}><HorizontalBars data={data.industries} color="#3a7de0" onSelect={(item) => showCompanies("Industry · " + item.name, "Companies in the selected industry.", data.companies.filter((row) => pretty(row.industry) === item.name))}/></Section>
              <Section title="Detected ATS" action={<DrilldownHint/>}><HorizontalBars data={data.atsPlatforms} onSelect={(item) => showCompanies("Detected ATS · " + item.name, "Companies with the selected detected ATS value.", data.companies.filter((row) => pretty(row.ats) === item.name))}/></Section>
            </div>
            <Section title="Account intelligence" description="Click any company name to open its HubSpot record." action={<HubSpotLink href={data.meta.hubspotUrls.companies} label={"View all " + data.companies.length}/>}><CompanyTable rows={data.companies}/></Section>
          </>}

          {activeTab === "pipeline" && <>
            <div className="activity-kpis">
              <MiniMetric label="Deals created" value={data.kpis.dealsCreated} rate="Selected period" icon={BriefcaseBusiness} onClick={() => showDeals("Deals created in period", "Associated deals created inside the selected date range.", data.deals.filter((row) => inPeriod(row.createdAt, data.meta.from, data.meta.to, data.meta.timezone)))}/>
              <MiniMetric label="Open deals" value={data.kpis.openDeals} rate="SDR-attributed" icon={Target} onClick={() => showDeals("Open deals", "Open deals associated with the SDR contact portfolio.", data.deals.filter((row) => row.isOpen))}/>
              <MiniMetric label="Pipeline value" value={data.kpis.pipelineValue} rate="USD" icon={CircleDollarSign} currency onClick={() => showDeals("Open pipeline", "Open deals contributing to the displayed pipeline value.", data.deals.filter((row) => row.isOpen))}/>
              <MiniMetric label="Meeting → deal" value={data.kpis.bookedMeetings ? Math.round((data.kpis.dealsCreated / data.kpis.bookedMeetings) * 1000) / 10 : 0} rate="% conversion" icon={ArrowUpRight} onClick={() => showDeals("Meeting to deal conversion", "Deals used in the meeting-to-deal conversion metric.", data.deals.filter((row) => inPeriod(row.createdAt, data.meta.from, data.meta.to, data.meta.timezone)))}/>
            </div>
            <div className="two-column">
              <Section title="Deal stage volume" action={<DrilldownHint/>}><HorizontalBars data={data.dealStages} color="#744bc4" onSelect={(item) => showDeals("Deal Stage · " + item.name, "Deals currently in the selected stage.", data.deals.filter((row) => row.stage === item.name))}/></Section>
              <Section title="Pipeline value by stage" action={<DrilldownHint/>}><HorizontalBars data={data.dealStages} amount onSelect={(item) => showDeals("Pipeline value · " + item.name, "Deals contributing value to the selected stage.", data.deals.filter((row) => row.stage === item.name))}/></Section>
            </div>
            <Section title="Attributed deals" description="Click a deal name to open the exact HubSpot record." action={<HubSpotLink href={data.meta.hubspotUrls.deals}/>}><DealTable rows={data.deals}/></Section>
          </>}
        </>}
        {loading && <div className="loading-overlay"><div className="loader"/><strong>Building live SDR intelligence…</strong><span>Loading HubSpot labels, contacts, activities, companies, and deals</span></div>}
      </div>
    </div>
    {drilldown && <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/>}
  </main>;
}

function FocusMetric({ label, value, helper, icon: Icon, tone, onClick }: { label: string; value: string; helper: string; icon: LucideIcon; tone: string; onClick: () => void }) {
  return <button className={"focus-metric tone-" + tone} onClick={onClick}><span><Icon size={17}/>{label}</span><strong>{value}</strong><small>{helper}<ListFilter size={12}/></small></button>;
}

function MiniMetric({ label, value, rate, icon: Icon, currency = false, onClick }: { label: string; value: number; rate: string; icon: LucideIcon; currency?: boolean; onClick: () => void }) {
  return <button className="mini-metric" onClick={onClick}><span><Icon size={17}/>{label}</span><strong>{currency ? formatCurrency(value) : formatNumber(value)}</strong><small>{rate}<ListFilter size={11}/></small></button>;
}

function ContactTable({ rows, attribution = false }: { rows: DashboardData["priorityContacts"]; attribution?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Priority</th><th>Contact</th><th>Company</th><th>Country</th>{attribution ? <><th>Original Traffic Source</th><th>Original Source Detail</th><th>Latest Traffic Source</th><th>Record Source</th><th>Record Source Detail 1</th><th>Lead Source</th></> : <><th>ICP Tier</th><th>Contact Priority</th><th>Lead Status</th><th>Phone Status</th><th>Next Activity Date</th></>}<th/></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className={"score " + (row.priorityScore >= 85 ? "high" : row.priorityScore >= 65 ? "medium" : "low")}>{row.priorityScore}</span></td><td><a className="record-link" href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong><small>{row.title || "No job title"}</small></a></td><td>{row.companyUrl ? <a className="text-link" href={row.companyUrl} target="_blank" rel="noreferrer">{row.company || "—"}</a> : row.company || "—"}</td><td>{row.country || "—"}</td>{attribution ? <><td>{row.originalSource}</td><td>{row.originalSourceDetail}</td><td>{row.latestSource}</td><td><span className="tag">{row.recordSource}</span></td><td><strong>{row.recordSourceDetail}</strong></td><td>{row.leadSource}</td></> : <><td><span className="tag">{row.tier}</span></td><td><span className="tag priority-tag">{row.contactPriority}</span></td><td>{row.leadStatus}</td><td>{row.phoneStatus}</td><td>{shortDate(row.nextActivity)}</td></>}<td><HubSpotLink href={row.url} label=""/></td></tr>)}</tbody></table></div>;
}

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Activity</th><th>Subject</th><th>Associated contact</th><th>Status / Outcome</th><th>Source / Detail</th><th>Assigned to</th><th>Date</th><th/></tr></thead><tbody>{rows.map((row) => <tr key={row.type + "-" + row.id}><td><span className={"activity-type type-" + row.type.toLowerCase()}>{row.type}</span></td><td><strong>{row.subject}</strong></td><td>{row.relatedContactUrl ? <a className="text-link" href={row.relatedContactUrl} target="_blank" rel="noreferrer">{row.relatedContactName}</a> : "Not associated"}</td><td>{row.status}</td><td>{row.detail}</td><td>{row.assignedTo}</td><td>{dateTime(row.occurredAt)}</td><td><HubSpotLink href={row.url} label={row.relatedContactUrl ? "Contact timeline" : "Activity list"}/></td></tr>)}</tbody></table></div>;
}

function CompanyTable({ rows }: { rows: CompanyRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Company</th><th>Country</th><th>Industry</th><th>Employees</th><th>Tier</th><th>ATS</th><th>Confidence</th><th>SDR Contacts</th><th/></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><a className="record-link" href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong><small>{row.domain || "No domain"}</small></a></td><td>{row.country || "—"}</td><td>{pretty(row.industry || "Unknown")}</td><td>{row.employees || "—"}</td><td><span className="tag">{row.tier || "—"}</span></td><td>{row.ats || "Unknown"}<small>{pretty(row.atsCategory)}</small></td><td>{pretty(row.atsConfidence || "Unknown")}</td><td>{row.associatedContacts}</td><td><HubSpotLink href={row.url} label=""/></td></tr>)}</tbody></table></div>;
}

function DealTable({ rows }: { rows: DealRow[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Deal</th><th>Deal Stage</th><th>Owner</th><th>Amount</th><th>Close Date</th><th/></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><a className="record-link" href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong></a></td><td><span className="tag">{row.stage}</span></td><td>{row.owner || "Unassigned"}</td><td>{formatCurrency(row.amount)}</td><td>{shortDate(row.closeDate)}</td><td><HubSpotLink href={row.url} label=""/></td></tr>)}</tbody></table></div>;
}
