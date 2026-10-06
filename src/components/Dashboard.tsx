"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { dashboardToday } from "@/lib/dashboard-values";
import type { RecordSelection, DashboardRecordSource, RecordCondition } from "@/lib/dashboard-records";
import { AnimatePresence } from "motion/react";
import { SDR_OWNERS, type SdrDashboardProps } from "@/lib/sdr-owners";
import { useDashboard } from "@/hooks/use-dashboard";

import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, BriefcaseBusiness,
  Building2, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Database,
  Filter, Gauge, ListFilter, ListTodo, Mail, Phone, PhoneIncoming,
  RefreshCw, Search, ShieldCheck, Target, UsersRound, type LucideIcon,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList,
  Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Drilldown } from "@/components/DrilldownDrawer";
const DrilldownDrawer = dynamic(() => import("@/components/DrilldownDrawer").then(module => module.DrilldownDrawer));
const DashboardRecordsTable = dynamic(() => import("@/components/DashboardRecordsTable").then(module => module.DashboardRecordsTable));
const MaritaWorkspace = dynamic(() => import("@/components/MaritaWorkspace").then(module => module.MaritaWorkspace));
import {
  ChartTooltip,
  EmptyChart,
  DonutChart,
  DrilldownHint,
  FilterSelect,
  HorizontalBars,
  HubSpotLink,
  KpiCard,
  Section,
  formatCurrency,
  formatNumber,
  selectedDatum,
  selectedPoint,
  shortDate,
} from "@/components/dashboard/DashboardPrimitives";
import { ShareViewButton } from "@/components/ShareViewButton";
import { readDashboardView, syncDashboardView } from "@/lib/dashboard-url-state";
import {
  calendarOrganizerId,
  type CalendarOrganizerId,
} from "@/lib/calendar-organizers";
import type {
  ActivityRow, DashboardData, DashboardFilters,
} from "@/lib/types";

type Tab = "overview" | "attribution" | "activities" | "quality" | "companies" | "pipeline";
type PageMode = "analytics" | "workspace";

const COLORS = ["var(--green)", "#f1bd28", "var(--blue)", "var(--purple)", "#e85d4a", "var(--teal)", "#d98d25", "#6a7d75"];
const GRID = "#dce7e2";
const TICK = "#667a71";


const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "attribution", label: "Lead Sources", icon: Target },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "quality", label: "Data Quality", icon: ShieldCheck },
  { id: "companies", label: "Companies & ATS", icon: Building2 },
  { id: "pipeline", label: "Pipeline", icon: BriefcaseBusiness },
];

export function Dashboard({
  sdr = "marita",
  active = true,
  initialSearch = "",
  onOpenMotion,
  onOpenMaqsam,
  sidebarTools,
  workspaceNavigation,
}: SdrDashboardProps & {
  initialSearch?: string;
  onOpenMotion?: () => void;
  onOpenMaqsam?: () => void;
  sidebarTools?: ReactNode;
  workspaceNavigation?: ReactNode;
}) {
  const owner = SDR_OWNERS[sdr];
  const today = dashboardToday();
  const defaultStart = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? today.slice(0, 7) + "-01";
  const defaults: DashboardFilters = { from: defaultStart, to: today, ownerId: owner.ownerId };
  const initialView = readDashboardView(initialSearch, defaults);
  const [activeTab, setActiveTab] = useState<Tab>(initialView.tab);
  const [pageMode, setPageMode] = useState<PageMode>(initialView.mode);
  const [organizerId, setOrganizerId] = useState<CalendarOrganizerId>(() => calendarOrganizerId(new URLSearchParams(initialSearch).get("organizer")));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [draft, setDraft] = useState<DashboardFilters>(initialView.filters);
  const [applied, setApplied] = useState<DashboardFilters>(draft);

  // Restore a shareable dashboard view while preserving Google organizer/OAuth parameters.
  useEffect(() => {
    const defaults: DashboardFilters = { from: defaultStart, to: today, ownerId: owner.ownerId };
    const view = readDashboardView(window.location.search, defaults);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(view.filters);
    setApplied(view.filters);
    setActiveTab(view.tab);
    setPageMode(view.mode);
    const query = new URLSearchParams(window.location.search);
    setOrganizerId(calendarOrganizerId(query.get("organizer")));
    syncDashboardView(view.filters, view.mode, view.tab);
  }, [owner.ownerId, today, defaultStart]);

  const { data, loading, error, requesting, refreshing } = useDashboard(applied, refreshKey, active, pageMode === "workspace" ? "instant" : "summary");
  const refreshBusy = requesting || refreshing;

  function recordSource(selection: RecordSelection): DashboardRecordSource {
    return { filters: applied, version: data!.meta.generatedAt, selection };
  }

  function showContacts(title: string, description: string, selection: Omit<RecordSelection, "kind"> = {}) {
    if (!data) return;
    setDrilldown({ kind: "contacts", title, description, rows: [], source: recordSource({ kind: "contacts", ...selection }), hubspotUrl: data.meta.hubspotUrls.contacts });
  }
  function showActivities(title: string, description: string, selection: Omit<RecordSelection, "kind">, hubspotUrl?: string) {
    if (!data) return;
    setDrilldown({ kind: "activities", title, description, rows: [], source: recordSource({ kind: "activities", ...selection }), hubspotUrl: hubspotUrl ?? data.meta.hubspotUrls.calls });
  }
  function showCompanies(title: string, description: string, selection: Omit<RecordSelection, "kind"> = {}) {
    if (!data) return;
    setDrilldown({ kind: "companies", title, description, rows: [], source: recordSource({ kind: "companies", ...selection }), hubspotUrl: data.meta.hubspotUrls.companies });
  }
  function showDeals(title: string, description: string, selection: Omit<RecordSelection, "kind"> = {}) {
    if (!data) return;
    setDrilldown({ kind: "deals", title, description, rows: [], source: recordSource({ kind: "deals", ...selection }), hubspotUrl: data.meta.hubspotUrls.deals });
  }
  function activitiesOf(type: ActivityRow["type"], where: RecordCondition[] = [], extra: Omit<RecordSelection, "kind" | "where"> = {}): Omit<RecordSelection, "kind"> {
    return { where: [{ field: "type", value: type }, ...where], ...extra };
  }

  function activityHubSpotUrl(type: ActivityRow["type"]) {
    if (!data) return "#";
    if (type === "Task") return data.meta.hubspotUrls.tasks;
    if (type === "Meeting") return data.meta.hubspotUrls.meetings;
    if (type === "Email") return data.meta.hubspotUrls.emails;
    if (type === "WhatsApp") return data.meta.hubspotUrls.communications;
    return data.meta.hubspotUrls.calls;
  }

  function openDailyActivity(type: ActivityRow["type"], entry: unknown, label: string, where: RecordCondition[] = []) {
    if (!data) return;
    const point = selectedPoint(entry);
    if (!point) return;
    showActivities(label + " · " + shortDate(point.date), "Records behind the selected chart point.", activitiesOf(type, where, { day: point.date }), activityHubSpotUrl(type));
  }

  function openAlert(alert: DashboardData["alerts"][number]) {
    if (!data) return;
    if (["due-today", "due-tomorrow", "due", "overdue", "high-priority-tasks"].includes(alert.id)) return showActivities(alert.title, alert.detail, { alert: alert.id }, data.meta.hubspotUrls.tasks);
    if (["meeting-outcomes", "outcomes"].includes(alert.id)) return showActivities(alert.title, alert.detail, { alert: alert.id }, data.meta.hubspotUrls.meetings);
    showContacts(alert.title, alert.detail, { alert: alert.id, ...(alert.id === "response-time-missing" ? { scope: "source" } : {}) });
  }

  function setPreset(preset: "today" | "week" | "month" | "sinceJuly") {
    const now = new Date(`${today}T12:00:00Z`);
    let from = today;
    if (preset === "week") {
      const start = new Date(now);
      start.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
      from = start.toISOString().slice(0, 10);
    }
    if (preset === "month") from = today.slice(0, 7) + "-01";
    if (preset === "sinceJuly") from = "2026-07-01";
    setDraft((current) => ({ ...current, from, to: today }));
  }

  function resetFilters() {
    const reset: DashboardFilters = { from: defaultStart, to: today, ownerId: owner.ownerId };
    setDraft(reset);
    setApplied(reset);
    syncDashboardView(reset, pageMode, activeTab);
  }

  function applyFilters() {
    setApplied(draft);
    syncDashboardView(draft, pageMode, activeTab);
  }

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setPageMode("analytics");
    syncDashboardView(applied, "analytics", tab);
  }

  function selectPageMode(mode: PageMode) {
    setPageMode(mode);
    if (mode === "workspace") setFiltersOpen(false);
    syncDashboardView(applied, mode, activeTab);
  }

  const kpis = data ? [
    { label: "SDR portfolio", value: formatNumber(data.kpis.portfolioContacts), helper: data.kpis.newContacts + " created in period", icon: UsersRound, tone: "green", onClick: () => showContacts("SDR portfolio", "All contacts owned by the selected SDR and dashboard filters.", {}) },
    { label: "Companies", value: formatNumber(data.kpis.companies), helper: "Distinct associated accounts", icon: Building2, tone: "blue", onClick: () => showCompanies("Associated companies", "Companies associated with the selected SDR contact portfolio.", {}) },
    { label: "Calls", value: formatNumber(data.kpis.calls), helper: data.kpis.connectionRate + "% connected", icon: Phone, tone: "teal", onClick: () => showActivities("Calls", "Calls logged in the selected reporting period.", activitiesOf("Call"), data.meta.hubspotUrls.calls) },
    { label: "Meetings", value: formatNumber(data.kpis.bookedMeetings), helper: data.kpis.completedMeetings + " completed", icon: CalendarDays, tone: "amber", onClick: () => showActivities("Meetings", "Deduplicated meetings created in the selected reporting period.", activitiesOf("Meeting"), data.meta.hubspotUrls.meetings) },
    { label: "Open tasks", value: formatNumber(data.kpis.openTasks), helper: data.kpis.dueToday + " due today", icon: CheckCircle2, tone: data.kpis.dueToday > 75 ? "red" : "blue", onClick: () => showActivities("Open tasks", "All current open tasks for the selected SDR.", activitiesOf("Task", [{ field: "isOpen", value: true }]), data.meta.hubspotUrls.tasks) },
    { label: "Email reply rate", value: data.kpis.emailReplyRate + "%", helper: data.kpis.emailReplies + " replies / " + data.kpis.emailsSent + " sent", icon: Mail, tone: "purple", onClick: () => showActivities("Sales emails", "Outgoing email activities in the selected reporting period.", activitiesOf("Email"), data.meta.hubspotUrls.emails) },
    { label: "Open deals", value: formatNumber(data.kpis.openDeals), helper: data.kpis.dealsCreated + " created in period", icon: BriefcaseBusiness, tone: "green", onClick: () => showDeals("Open deals", "Open deals associated with contacts in the SDR portfolio.", { where: [{ field: "isOpen", value: true }] }) },
    { label: "Open pipeline", value: formatCurrency(data.kpis.pipelineValue), helper: "Attributed through SDR contacts", icon: CircleDollarSign, tone: "amber", onClick: () => showDeals("Open pipeline", "Open deal records contributing to the displayed pipeline value.", { where: [{ field: "isOpen", value: true }] }) },
  ] : [];
  const intelligenceMetrics = data ? [
    { label: "Stale deals", value: formatNumber(data.intelligence.staleDeals.count), helper: "Open deals inactive 21+ days", icon: BriefcaseBusiness, tone: "red", onClick: () => showDeals("Stale deals", "Open deals whose latest known contact activity is at least 21 days old.", { signal: "staleDeals" }) },
    { label: "No future deal activity", value: formatNumber(data.intelligence.dealsWithoutFutureActivity.count), helper: "Open deals without a next date", icon: CalendarDays, tone: "amber", onClick: () => showDeals("Deals with no future activity", "Open deals with no deal-level next activity scheduled.", { signal: "dealsWithoutFutureActivity" }) },
    { label: "Overdue close dates", value: formatNumber(data.intelligence.dealsWithOverdueCloseDate.count), helper: "Open deals past close date", icon: AlertTriangle, tone: "red", onClick: () => showDeals("Deals with overdue close date", "Open deals with a close date in the past.", { signal: "dealsWithOverdueCloseDate" }) },
    { label: "Meetings without follow-up", value: formatNumber(data.intelligence.meetingsWithoutFollowUp.count), helper: "Completed / no-show past 24h", icon: Clock3, tone: "amber", onClick: () => showActivities("Meetings without follow-up", "Meetings past the follow-up SLA with no later logged contact activity.", activitiesOf("Meeting", [], { signal: "meetingsWithoutFollowUp" }), data.meta.hubspotUrls.meetings) },
    { label: "Completed, no progression", value: formatNumber(data.intelligence.completedMeetingsWithoutProgression.count), helper: "No deal or next step after 7d", icon: Activity, tone: "red", onClick: () => showActivities("Completed meetings without progression", "Completed meetings older than seven days with neither a post-meeting deal nor a next activity.", activitiesOf("Meeting", [], { signal: "completedMeetingsWithoutProgression" }), data.meta.hubspotUrls.meetings) },
    { label: "No-show meetings", value: formatNumber(data.intelligence.noShowMeetings.count), helper: "Past meetings marked no-show", icon: CalendarDays, tone: "purple", onClick: () => showActivities("No-show meetings", "Past meetings explicitly marked No show.", activitiesOf("Meeting", [], { signal: "noShowMeetings" }), data.meta.hubspotUrls.meetings) },
    { label: "High engagement, no meeting", value: formatNumber(data.intelligence.highEngagementAccountsWithoutMeeting.count), helper: "Account score 60+", icon: Gauge, tone: "teal", onClick: () => showCompanies("High-engagement accounts without a meeting", "Accounts with an explicit engagement score of 60 or above and no associated meeting.", { signal: "highEngagementAccountsWithoutMeeting" }) },
    { label: "Connected, no meeting", value: formatNumber(data.intelligence.contactsWithConnectedCallsWithoutMeeting.count), helper: "Contacts ready for a next step", icon: Phone, tone: "green", onClick: () => showContacts("Connected calls without a meeting", "Contacts with a connected call and no associated deduplicated meeting.", { signal: "contactsWithConnectedCallsWithoutMeeting" }) },
    { label: "Meeting → deal", value: data.intelligence.meetingToDealConversion.rate + "%", helper: `${data.intelligence.meetingToDealConversion.numerator} deals / ${data.intelligence.meetingToDealConversion.denominator} meetings`, icon: ArrowUpRight, tone: "green", onClick: () => showDeals("Meeting to deal conversion", "Deals created in the selected reporting period.", { scope: "created" }) },
    { label: "Connected call → meeting", value: data.intelligence.connectedCallToMeetingConversion.rate + "%", helper: `${data.intelligence.connectedCallToMeetingConversion.numerator} meetings / ${data.intelligence.connectedCallToMeetingConversion.denominator} calls`, icon: ArrowUpRight, tone: "blue", onClick: () => showActivities("Connected calls", "Connected calls in the selected reporting period.", activitiesOf("Call", [{ field: "status", value: "Connected" }]), data.meta.hubspotUrls.calls) },
    { label: "Response SLA met", value: data.intelligence.leadResponseSla.rate + "%", helper: `${data.intelligence.leadResponseSla.met} of ${data.intelligence.leadResponseSla.eligible} within 24h`, icon: ShieldCheck, tone: "blue", onClick: () => showContacts("Lead response SLA not met", "Reporting-period contacts missing first-response timing or above the 24-hour SLA.", { signal: "response-overdue" }) },
    { label: "Missing contact info", value: formatNumber(data.intelligence.missingContactInfo.missingAny.count), helper: `${data.intelligence.missingContactInfo.missingPhone.count} phone · ${data.intelligence.missingContactInfo.missingEmail.count} email · ${data.intelligence.missingContactInfo.missingLinkedIn.count} LinkedIn`, icon: ShieldCheck, tone: "purple", onClick: () => showContacts("Missing contact information", "Contacts missing phone, email, or LinkedIn information.", { signal: "missing-contact-info" }) },
  ] : [];

  return <main className="app-shell">
    <header className="topbar"><div className="top-title"><strong>SDR Command Center</strong><span>Live HubSpot performance & attribution</span></div><div className="top-actions"><span className={"status-pill " + (data?.meta.isDemo ? "demo" : "live")}><i/>{data?.meta.isDemo ? "Demo data" : refreshBusy ? "UPDATING · HUBSPOT" : "HUBSPOT SNAPSHOT"}</span><ShareViewButton/>{pageMode === "analytics" && <button className="icon-button" onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Toggle filters"><Filter size={18}/></button>}<button className="refresh-button" onClick={() => setRefreshKey((key) => key + 1)} disabled={refreshBusy}><RefreshCw size={16} className={refreshBusy ? "spin" : ""}/>{refreshBusy ? "Refreshing…" : "Refresh data"}</button></div></header>

    <div className="workspace">
      <aside className="sidebar"><div className="brand">{sdr === "daniel" ? <span className="evalufy-brand-mark"><Image src="/evalufy-transparent.png" alt="Evalufy" width={2048} height={688} className="evalufy-logo" priority/><Image src="/evalufy-transparent.png" alt="" aria-hidden="true" width={2048} height={688} className="evalufy-logo evalufy-symbol" priority/></span> : <div className="brand-logo" role="img" aria-label="Talentera ATS"/>}<span className="brand-subtitle">SDR Intelligence</span></div><div className="nav-label">MAIN</div><nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={pageMode === "analytics" && activeTab === id ? "active" : ""} onClick={() => selectTab(id)}><Icon size={17}/><span>{label}</span>{pageMode === "analytics" && activeTab === id && <ChevronRight size={15}/>}</button>)}</nav>{onOpenMotion ? <><div className="nav-label">ANALYSIS</div><nav><button type="button" onClick={onOpenMotion}><PhoneIncoming size={17}/><span>Inbound vs Outbound</span></button>{onOpenMaqsam ? <button type="button" onClick={onOpenMaqsam}><Phone size={17}/><span>Maqsam Calls</span></button> : null}</nav></> : null}{workspaceNavigation}<div className="nav-label owner-label">SDR OWNER</div><div className="owner-card"><div className="avatar">{owner.initials}</div><div><span>Reporting for</span><strong>{data?.meta.ownerName ?? owner.name}</strong></div><BadgeCheck size={17}/></div>{sidebarTools}<div className="sync-card"><Database size={18}/><div><strong>Last sync</strong><span>{data ? new Date(data.meta.generatedAt).toLocaleString("en-GB") : "Loading…"}</span></div></div></aside>

      <div className="content"><div className="page-title"><div><span className="eyebrow">{owner.brand.toUpperCase()} · SDR PERFORMANCE</span><h1>{pageMode === "workspace" ? `${owner.shortName} Workspace` : tabs.find((tab) => tab.id === activeTab)?.label}</h1><p>{data ? pageMode === "workspace" ? "Daily execution center · Live HubSpot data" : shortDate(data.meta.from) + " – " + shortDate(data.meta.to) + " · " + data.meta.timezone : "Loading dashboard data…"}</p></div></div>

        <div className="page-mode-tabs"><button className={pageMode === "analytics" ? "active" : ""} onClick={() => selectPageMode("analytics")}><Gauge size={15}/><span>Analytics Dashboard</span></button><button className={pageMode === "workspace" ? "active" : ""} onClick={() => selectPageMode("workspace")}><UsersRound size={15}/><span>{owner.shortName} Workspace</span></button></div>

        {pageMode === "analytics" && <div className={"filter-drawer " + (filtersOpen ? "open" : "")}><div className="preset-row"><span>Quick range</span><button onClick={() => setPreset("today")}>Today</button><button onClick={() => setPreset("week")}>This week</button><button onClick={() => setPreset("month")}>This month</button><button onClick={() => setPreset("sinceJuly")}>Since 1 July</button></div><div className="filter-grid"><label className="filter-field"><span>From</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })}/></label><label className="filter-field"><span>To</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })}/></label><FilterSelect label="Country" value={draft.country ?? ""} options={data?.filterOptions.countries ?? []} onChange={(country) => setDraft({ ...draft, country })}/><FilterSelect label="Original Traffic Source" value={draft.originalSource ?? ""} options={data?.filterOptions.originalSources ?? []} onChange={(originalSource) => setDraft({ ...draft, originalSource })}/><FilterSelect label="Latest Traffic Source" value={draft.latestSource ?? ""} options={data?.filterOptions.latestSources ?? []} onChange={(latestSource) => setDraft({ ...draft, latestSource })}/><FilterSelect label="ICP Tier" value={draft.tier ?? ""} options={data?.filterOptions.tiers ?? []} onChange={(tier) => setDraft({ ...draft, tier })}/><FilterSelect label="Persona" value={draft.persona ?? ""} options={data?.filterOptions.personas ?? []} onChange={(persona) => setDraft({ ...draft, persona })}/><div className="filter-actions"><button className="secondary-button" onClick={resetFilters}>Reset</button><button className="primary-button" onClick={applyFilters}><Search size={15}/>Apply</button></div></div><p className="filter-note">Labels are loaded from HubSpot. Internal values are used only behind the scenes for filtering.</p></div>}

        {data?.meta.warnings.length ? <div className="warning-banner"><AlertTriangle size={17}/><div><strong>{data.meta.isDemo ? "Demo mode" : "Some HubSpot data sources were unavailable"}</strong><span>{data.meta.warnings.join(" · ")}</span></div></div> : null}
        {error && <div className="error-banner"><AlertTriangle size={20}/><div><strong>Dashboard failed to load</strong><span>{error}</span></div><button onClick={() => setRefreshKey(key => key + 1)}>Try again</button></div>}

        {data && pageMode === "workspace" && <MaritaWorkspace data={data} onOpen={setDrilldown} organizerId={organizerId}/>}
        {data && pageMode === "analytics" && <>
          {activeTab === "overview" && <>
            <div className="kpi-grid">{kpis.map((card) => <KpiCard key={card.label} {...card}/>)}</div>
            <section className="execution-focus"><div className="focus-heading"><div><span>TODAY&apos;S EXECUTION FOCUS</span><strong>What needs attention now</strong></div><DrilldownHint/></div><div className="focus-grid">
              <FocusMetric label="Untouched over 24h" value={formatNumber(data.kpis.untouchedOver24h)} helper={data.kpis.untouchedContacts + " untouched total"} icon={Clock3} tone="red" onClick={() => showContacts("Untouched over 24 hours", "Contacts created more than 24 hours ago with no logged contact.", { alert: "untouched-24h" })}/>
              <FocusMetric label="No next activity" value={formatNumber(data.kpis.noNextActivity)} helper={data.kpis.nextActivityCoverage + "% coverage"} icon={CalendarDays} tone="amber" onClick={() => showContacts("No next activity", "Contacts with no next activity date scheduled.", { alert: "no-next-activity" })}/>
              <FocusMetric label="Tasks due today" value={formatNumber(data.kpis.dueToday)} helper={data.kpis.openTasks + " open tasks"} icon={ListTodo} tone="green" onClick={() => showActivities("Tasks due today", "Open tasks due today in HubSpot.", { alert: "due-today" }, data.meta.hubspotUrls.tasks)}/>
              <FocusMetric label="High-priority tasks" value={formatNumber(data.kpis.highPriorityOpenTasks)} helper="Open High priority queue" icon={AlertTriangle} tone="purple" onClick={() => showActivities("High-priority open tasks", "Open tasks marked High priority.", { alert: "high-priority-tasks" }, data.meta.hubspotUrls.tasks)}/>
              <FocusMetric label="Response time coverage" value={data.kpis.leadResponseCoverage + "%"} helper="Click to inspect missing values" icon={ShieldCheck} tone="blue" onClick={() => showContacts("Missing lead response time", "Reporting-cohort contacts without Lead response time.", { scope: "source", alert: "response-time-missing" })}/>
              <FocusMetric label="Median response time" value={data.kpis.leadResponseCoverage ? data.kpis.medianLeadResponseHours + "h" : "—"} helper="Contacts with a populated value" icon={Gauge} tone="teal" onClick={() => showContacts("Lead response time details", "Reporting-cohort contacts with a populated response time.", { scope: "source", alert: "response-time-known" })}/>
            </div></section>
            <Section title="GTM intelligence signals" description="Risk, conversion, engagement, response SLA, and data-completeness signals calculated from the current HubSpot snapshot."><div className="focus-grid">{intelligenceMetrics.map((metric) => <FocusMetric key={metric.label} {...metric}/>)}</div></Section>
            <div className="two-column wide-left">
              <Section title="Daily SDR execution" description="Click any series point to inspect its records." action={<DrilldownHint/>}><ResponsiveContainer width="100%" height={330}><AreaChart data={data.dailyActivities} margin={{ left: -12, right: 10, top: 12 }}><defs><linearGradient id={`calls-${sdr}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--green)" stopOpacity={0.28}/><stop offset="95%" stopColor="var(--green)" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis dataKey="date" tickFormatter={(item) => item.slice(5)} tick={{ fill: TICK, fontSize: 11 }} axisLine={false}/><YAxis tick={{ fill: TICK, fontSize: 11 }} axisLine={false}/><Tooltip content={<ChartTooltip/>}/><Legend/><Area type="monotone" dataKey="calls" name="Calls" stroke="var(--green)" fill={`url(#calls-${sdr})`} strokeWidth={2.5} cursor="pointer" onClick={(entry) => openDailyActivity("Call", entry, "Calls")}/><Line type="monotone" dataKey="connected" name="Connected calls" stroke="var(--blue)" strokeWidth={2} cursor="pointer" onClick={(entry) => openDailyActivity("Call", entry, "Connected calls", [{ field: "status", value: "Connected" }])}/><Line type="monotone" dataKey="tasksCompleted" name="Completed tasks" stroke="#d98d25" strokeWidth={2} cursor="pointer" onClick={(entry) => openDailyActivity("Task", entry, "Completed tasks", [{ field: "isOpen", value: false }])}/><Line type="monotone" dataKey="meetingsBooked" name="Meetings" stroke="var(--purple)" strokeWidth={2} cursor="pointer" onClick={(entry) => openDailyActivity("Meeting", entry, "Meetings")}/><Line type="monotone" dataKey="whatsAppMessages" name="WhatsApp messages" stroke="var(--chart-whatsapp, #25D366)" strokeWidth={2.5} cursor="pointer" onClick={(entry) => openDailyActivity("WhatsApp", entry, "WhatsApp messages")}/></AreaChart></ResponsiveContainer></Section>
              <Section title="SDR conversion funnel" description="Click a funnel stage to inspect its contacts or deals." action={<DrilldownHint/>}>{data.funnel.length ? <ResponsiveContainer width="100%" height={330}><FunnelChart><Tooltip content={<ChartTooltip/>}/><Funnel dataKey="value" data={data.funnel} isAnimationActive cursor="pointer" onClick={(entry) => { const item = selectedDatum(entry); if (item.name === "Deal") showDeals("Deals in funnel", "Deals associated with the selected SDR portfolio.", {}); else if (item.name === "Open Deal") showDeals("Open deals in funnel", "Open deals associated with the selected SDR portfolio.", { where: [{ field: "isOpen", value: true }] }); else showContacts(item.name + " contacts", "Contacts contributing to this funnel stage.", { funnel: item.name }); }}><LabelList position="right" fill="#213b30" stroke="none" dataKey="name"/>{data.funnel.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]}/>)}</Funnel></FunnelChart></ResponsiveContainer> : <EmptyChart/>}</Section>
            </div>
            <div className="two-column alerts-layout">
              <Section title="Operational alerts" description="Click an alert to inspect the affected records."><div className="alert-list">{data.alerts.slice(0, 7).map((alert) => <button key={alert.id} className={"alert-item " + alert.severity} onClick={() => openAlert(alert)}><span className="alert-icon">{alert.severity === "critical" ? <AlertTriangle size={17}/> : <Activity size={17}/>}</span><div><strong>{alert.title}</strong><p>{alert.detail}</p><small>{alert.action}<ListFilter size={12}/></small></div><b>{alert.count}</b></button>)}</div></Section>
              <Section title="Lead Status" description="HubSpot display labels across the SDR portfolio." action={<DrilldownHint/>}><HorizontalBars data={data.leadStatuses} onSelect={(item) => showContacts("Lead Status · " + item.name, "Contacts with the selected HubSpot Lead Status.", { where: [{ field: "leadStatus", value: item.name }] })}/></Section>
            </div>
            <Section title="Priority leads" description="The table links open exact HubSpot records; KPI and chart clicks open internal lists first." action={<HubSpotLink href={data.meta.hubspotUrls.contacts} label={"View all " + data.kpis.portfolioContacts}/>}><DashboardRecordsTable key={JSON.stringify(applied)} source={recordSource({ kind: "contacts" })} variant="priority" lazy/></Section>
          </>}

          {activeTab === "attribution" && <>
            <div className="source-audit">
              <button onClick={() => showContacts("Record Source · Integration", "Reporting-period contacts created by an integration.", { scope: "source", where: [{ field: "recordSource", value: "Integration" }] })}><span>Record Source: Integration</span><strong>{data.sourceAudit.integrationRecords}</strong><small>{data.sourceAudit.apiShare}% of contacts in source period</small></button>
              <button className="featured" onClick={() => showContacts("Integration · Extensive-Lighter", "Reporting-period contacts created by the Extensive-Lighter API integration.", { scope: "source", where: [{ field: "recordSource", value: "Integration" }, { field: "recordSourceDetail", op: "pretty", value: "Extensive Lighter" }] })}><span>Record Source Detail 1</span><strong>{data.sourceAudit.extensiveLighterRecords}</strong><small>Extensive-Lighter API records</small></button>
              <button onClick={() => showContacts("Record Source · Forms", "Reporting-period contacts created by HubSpot forms.", { scope: "source", where: [{ field: "recordSource", value: "Forms" }] })}><span>Record Source: Forms</span><strong>{data.sourceAudit.formRecords}</strong><small>HubSpot form-created records</small></button>
            </div>
            <div className="section-intro"><Target size={21}/><div><strong>HubSpot source audit</strong><p>Original Traffic Source describes acquisition. Record Source identifies how the contact was created. Extensive-Lighter is correctly captured as Integration → Record source detail 1.</p></div></div>
            <div className="three-column">
              <Section title="Original Traffic Source" description="HubSpot label: first known acquisition channel." action={<DrilldownHint/>}><DonutChart data={data.originalSources} centerLabel="first touch" onSelect={(item) => showContacts("Original Traffic Source · " + item.name, "Reporting-period contacts acquired from this original source.", { scope: "source", where: [{ field: "originalSource", value: item.name }] })}/></Section>
              <Section title="Latest Traffic Source" description="HubSpot label: most recent tracked session." action={<DrilldownHint/>}><DonutChart data={data.latestSources} centerLabel="latest touch" onSelect={(item) => showContacts("Latest Traffic Source · " + item.name, "Reporting-period contacts with this latest source.", { scope: "source", where: [{ field: "latestSource", value: item.name }] })}/></Section>
              <Section title="Record Source" description="How each CRM record was created." action={<DrilldownHint/>}><DonutChart data={data.recordSources} centerLabel="records" onSelect={(item) => showContacts("Record Source · " + item.name, "Reporting-period contacts created through this record source.", { scope: "source", where: [{ field: "recordSource", value: item.name }] })}/></Section>
            </div>
            <div className="two-column">
              <Section title="Integration detail" description="Record Source Detail 1 for Integration-created contacts." action={<DrilldownHint/>}><HorizontalBars data={data.integrationSources} color="var(--green)" onSelect={(item) => showContacts("Integration detail · " + item.name, "Integration-created contacts with the selected Record Source Detail 1.", { scope: "source", where: [{ field: "recordSource", value: "Integration" }, { field: "recordSourceDetail", op: "pretty", value: item.name }] })}/></Section>
              <Section title="Lifecycle Stage" description="Current HubSpot display labels, never internal IDs." action={<DrilldownHint/>}><HorizontalBars data={data.lifecycleStages} color="var(--purple)" onSelect={(item) => showContacts("Lifecycle Stage · " + item.name, "Contacts in the selected lifecycle stage.", { where: [{ field: "lifecycleStage", value: item.name }] })}/></Section>
            </div>
            <Section title="Source drill-down" description="Every value is shown using its HubSpot label; source details remain exactly as stored." action={<HubSpotLink href={data.meta.hubspotUrls.contacts}/>}><DashboardRecordsTable key={JSON.stringify(applied)} source={recordSource({ kind: "contacts", scope: "source" })} variant="attribution" lazy/></Section>
          </>}

          {activeTab === "activities" && <>
            <div className="activity-kpis">
              <MiniMetric label="Connected calls" value={data.kpis.connectedCalls} rate={data.kpis.connectionRate + "%"} icon={Phone} onClick={() => showActivities("Connected calls", "Calls with the Connected disposition.", activitiesOf("Call", [{ field: "status", value: "Connected" }]), data.meta.hubspotUrls.calls)}/>
              <MiniMetric label="Completed tasks" value={data.kpis.completedTasks} rate={data.kpis.openTasks + " open"} icon={CheckCircle2} onClick={() => showActivities("Completed tasks", "Tasks completed during the selected period.", activitiesOf("Task", [{ field: "isOpen", value: false }], { scope: "activity-period" }), data.meta.hubspotUrls.tasks)}/>
              <MiniMetric label="Completed meetings" value={data.kpis.completedMeetings} rate={data.kpis.meetingCompletionRate + "%"} icon={CalendarDays} onClick={() => showActivities("Completed meetings", "Meetings with the Completed outcome.", activitiesOf("Meeting", [{ field: "status", value: "Completed" }]), data.meta.hubspotUrls.meetings)}/>
              <MiniMetric label="Email replies" value={data.kpis.emailReplies} rate={data.kpis.emailReplyRate + "%"} icon={Mail} onClick={() => showActivities("Replied emails", "Outgoing emails with at least one reply.", activitiesOf("Email", [{ field: "replied", value: true }]), data.meta.hubspotUrls.emails)}/>
            </div>
            <Section title="Daily activity volume" description="Click a bar to inspect the records for that date." action={<DrilldownHint/>}><ResponsiveContainer width="100%" height={340}><BarChart data={data.dailyActivities}><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis dataKey="date" tickFormatter={(item) => item.slice(5)} tick={{ fill: TICK, fontSize: 11 }}/><YAxis tick={{ fill: TICK, fontSize: 11 }}/><Tooltip content={<ChartTooltip/>}/><Legend/><Bar dataKey="calls" name="Calls" fill="var(--green)" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Call", entry, "Calls")}/><Bar dataKey="tasksCompleted" name="Completed tasks" fill="#f1bd28" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Task", entry, "Completed tasks", [{ field: "isOpen", value: false }])}/><Bar dataKey="emailsSent" name="Emails sent" fill="var(--blue)" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Email", entry, "Emails sent")}/><Bar dataKey="meetingsBooked" name="Meetings" fill="var(--purple)" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("Meeting", entry, "Meetings")}/><Bar dataKey="whatsAppMessages" name="WhatsApp messages" fill="var(--chart-whatsapp, #25D366)" radius={[5,5,0,0]} cursor="pointer" onClick={(entry) => openDailyActivity("WhatsApp", entry, "WhatsApp messages")}/></BarChart></ResponsiveContainer></Section>
            <Section title="Open task workload by due date" description="Click a due-date bucket to inspect its open tasks." action={<DrilldownHint/>}><HorizontalBars data={data.taskDueBuckets} color="#d98d25" onSelect={(item) => showActivities("Task workload · " + item.name, "Open tasks in the selected due-date bucket.", activitiesOf("Task", [{ field: "isOpen", value: true }, { field: "dueBucket", value: item.name }]), data.meta.hubspotUrls.tasks)}/></Section>
            <div className="three-column">
              <Section title="Call outcomes" action={<DrilldownHint/>}><DonutChart data={data.callOutcomes} centerLabel="calls" onSelect={(item) => showActivities("Call outcome · " + item.name, "Calls with the selected disposition.", activitiesOf("Call", [], { outcome: item.name }), data.meta.hubspotUrls.calls)}/></Section>
              <Section title="Task Status" action={<DrilldownHint/>}><DonutChart data={data.taskStatuses} centerLabel="tasks" onSelect={(item) => showActivities("Task Status · " + item.name, "Tasks with the selected HubSpot status.", activitiesOf("Task", [{ field: "status", value: item.name }], { scope: "task-status" }), data.meta.hubspotUrls.tasks)}/></Section>
              <Section title="Email engagement" action={<DrilldownHint/>}><HorizontalBars data={data.emailPerformance} color="var(--blue)" onSelect={(item) => showActivities("Email engagement · " + item.name, "Emails contributing to the selected engagement metric.", activitiesOf("Email", [], { emailEngagement: item.name }), data.meta.hubspotUrls.emails)}/></Section>
            </div>
            <div className="three-column">
              <Section title="Meeting Outcome" action={<DrilldownHint/>}><DonutChart data={data.meetingOutcomes} centerLabel="meetings" onSelect={(item) => showActivities("Meeting Outcome · " + item.name, "Meetings with the selected outcome.", activitiesOf("Meeting", [{ field: "status", value: item.name }]), data.meta.hubspotUrls.meetings)}/></Section>
              <Section title="Meeting assigned to" action={<DrilldownHint/>}><HorizontalBars data={data.meetingOwners} onSelect={(item) => showActivities("Meetings assigned to " + item.name, "Meetings assigned to the selected owner.", activitiesOf("Meeting", [{ field: "assignedTo", value: item.name }]), data.meta.hubspotUrls.meetings)}/></Section>
              <Section title="Meeting Source" action={<DrilldownHint/>}><HorizontalBars data={data.meetingSources} color="#d98d25" onSelect={(item) => showActivities("Meeting Source · " + item.name, "Meetings created through the selected source.", activitiesOf("Meeting", [{ field: "detail", value: item.name }]), data.meta.hubspotUrls.meetings)}/></Section>
            </div>
            <Section title="Recent activity records" description="Calls, meetings, tasks, emails, and WhatsApp messages with their associated contact. HubSpot links open the contact timeline where the activity is stored." action={<HubSpotLink href={data.meta.hubspotUrls.communications} label="Open communications"/>}><DashboardRecordsTable key={JSON.stringify(applied)} source={recordSource({ kind: "activities" })} lazy/></Section>
          </>}

          {activeTab === "quality" && <>
            <div className="quality-grid">{data.quality.map((metric) => <button className="quality-card" key={metric.key} onClick={() => showContacts(metric.label + " · missing", "Contacts that do not meet this data-quality check.", { ...(metric.key === "hs_time_to_first_engagement" ? { scope: "source" as const } : {}), where: [{ field: "qualityIssues", op: "contains", value: metric.key }] })}><div><span>{metric.label}</span><b>{metric.rate}%</b></div><div className="progress"><i style={{ width: metric.rate + "%" }}/></div><small>{metric.complete} complete · {metric.total - metric.complete} missing</small></button>)}</div>
            <div className="two-column">
              <Section title="Data quality risks"><div className="alert-list">{data.alerts.filter((item) => ["wrong-phone", "missing-source", "high-icp", "untouched-24h", "no-next-activity", "response-time-missing"].includes(item.id)).slice(0, 6).map((alert) => <button key={alert.id} className={"alert-item " + alert.severity} onClick={() => openAlert(alert)}><span className="alert-icon"><AlertTriangle size={17}/></span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div><b>{alert.count}</b></button>)}</div></Section>
              <Section title="Recommended automation"><div className="recommendation-list"><div><Target/><span><strong>Source protection</strong>Keep Original Traffic Source intact; use Record Source Detail for Extensive-Lighter.</span></div><div><Phone/><span><strong>Phone recovery</strong>Wrong Number → SignalHire fallback → task with only new numbers.</span></div><div><CalendarDays/><span><strong>Meeting dedupe</strong>Merge sync and CRM activities by contact, date, and hour.</span></div><div><ShieldCheck/><span><strong>SLA alerts</strong>Tier A untouched after 24 hours creates a priority task.</span></div></div></Section>
            </div>
            <Section title="Records needing attention" action={<HubSpotLink href={data.meta.hubspotUrls.contacts}/>}><DashboardRecordsTable key={JSON.stringify(applied)} source={recordSource({ kind: "contacts" })} variant="priority" lazy/></Section>
          </>}

          {activeTab === "companies" && <>
            <div className="three-column">
              <Section title="Companies by country" action={<DrilldownHint/>}><DonutChart data={data.countries} centerLabel="companies" onSelect={(item) => showCompanies("Companies · " + item.name, "Companies in the selected country.", { where: [{ field: "country", op: "pretty", value: item.name }] })}/></Section>
              <Section title="Top industries" action={<DrilldownHint/>}><HorizontalBars data={data.industries} color="var(--blue)" onSelect={(item) => showCompanies("Industry · " + item.name, "Companies in the selected industry.", { where: [{ field: "industry", op: "pretty", value: item.name }] })}/></Section>
              <Section title="Detected ATS" action={<DrilldownHint/>}><HorizontalBars data={data.atsPlatforms} onSelect={(item) => showCompanies("Detected ATS · " + item.name, "Companies with the selected detected ATS value.", { where: [{ field: "ats", op: "pretty", value: item.name }] })}/></Section>
            </div>
            <Section title="Account intelligence" description="Click any company name to open its HubSpot record." action={<HubSpotLink href={data.meta.hubspotUrls.companies} label={"View all " + data.kpis.companies}/>}><DashboardRecordsTable key={JSON.stringify(applied)} source={recordSource({ kind: "companies" })} variant="accounts" lazy/></Section>
          </>}

          {activeTab === "pipeline" && <>
            <div className="activity-kpis">
              <MiniMetric label="Deals created" value={data.kpis.dealsCreated} rate="Selected period" icon={BriefcaseBusiness} onClick={() => showDeals("Deals created in period", "Associated deals created inside the selected date range.", { scope: "created" })}/>
              <MiniMetric label="Open deals" value={data.kpis.openDeals} rate="SDR-attributed" icon={Target} onClick={() => showDeals("Open deals", "Open deals associated with the SDR contact portfolio.", { where: [{ field: "isOpen", value: true }] })}/>
              <MiniMetric label="Pipeline value" value={data.kpis.pipelineValue} rate="USD" icon={CircleDollarSign} currency onClick={() => showDeals("Open pipeline", "Open deals contributing to the displayed pipeline value.", { where: [{ field: "isOpen", value: true }] })}/>
              <MiniMetric label="Meeting → deal" value={data.kpis.bookedMeetings ? Math.round((data.kpis.dealsCreated / data.kpis.bookedMeetings) * 1000) / 10 : 0} rate="% conversion" icon={ArrowUpRight} onClick={() => showDeals("Meeting to deal conversion", "Deals used in the meeting-to-deal conversion metric.", { scope: "created" })}/>
            </div>
            <div className="two-column">
              <Section title="Deal stage volume" action={<DrilldownHint/>}><HorizontalBars data={data.dealStages} color="var(--purple)" onSelect={(item) => showDeals("Deal Stage · " + item.name, "Deals currently in the selected stage.", { where: [{ field: "stage", value: item.name }] })}/></Section>
              <Section title="Pipeline value by stage" action={<DrilldownHint/>}><HorizontalBars data={data.dealStages} amount onSelect={(item) => showDeals("Pipeline value · " + item.name, "Deals contributing value to the selected stage.", { where: [{ field: "stage", value: item.name }] })}/></Section>
            </div>
            <Section title="Attributed deals" description="Click a deal name to open the exact HubSpot record." action={<HubSpotLink href={data.meta.hubspotUrls.deals}/>}><DashboardRecordsTable key={JSON.stringify(applied)} source={recordSource({ kind: "deals" })} lazy/></Section>
          </>}
        </>}
        {loading && !data && <div className="loading-overlay"><div className="loader"/><strong>Building live SDR intelligence…</strong><span>Loading HubSpot labels, contacts, activities, companies, and deals</span></div>}
      </div>
    </div>
    <AnimatePresence>
      {drilldown && <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/>}
    </AnimatePresence>
  </main>;
}

function FocusMetric({ label, value, helper, icon: Icon, tone, onClick }: { label: string; value: string; helper: string; icon: LucideIcon; tone: string; onClick: () => void }) {
  return <button className={"focus-metric tone-" + tone} onClick={onClick}><span><Icon size={17}/>{label}</span><strong>{value}</strong><small>{helper}<ListFilter size={12}/></small></button>;
}

function MiniMetric({ label, value, rate, icon: Icon, currency = false, onClick }: { label: string; value: number; rate: string; icon: LucideIcon; currency?: boolean; onClick: () => void }) {
  return <button className="mini-metric" onClick={onClick}><span><Icon size={17}/>{label}</span><strong>{currency ? formatCurrency(value) : formatNumber(value)}</strong><small>{rate}<ListFilter size={11}/></small></button>;
}
