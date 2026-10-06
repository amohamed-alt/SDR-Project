"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Gauge,
  ListFilter,
  ListTodo,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
const SdrComparison = dynamic(() => import("@/components/SdrComparison").then(module => module.SdrComparison));
import { SDR_OWNERS, type SdrKey } from "@/lib/sdr-owners";
import { ReportingRange } from "./ReportingRange";
import studioStyles from "./DecisionStudio.module.css";
const PerformanceCharts = dynamic(() => import("./PerformanceCharts").then(module => module.PerformanceCharts));
const DecisionStudio = dynamic(() => import("./DecisionStudio").then(module => module.DecisionStudio));
const SalesHandoffDashboard = dynamic(() => import("./SalesHandoffDashboard").then(module => module.SalesHandoffDashboard));
import { AcquisitionDailyPulse } from "@/components/AcquisitionDailyPulse";
import { Dashboard as ExistingDashboard } from "@/components/DashboardShell";
import type { Drilldown } from "@/components/DrilldownDrawer";
const DrilldownDrawer = dynamic(() => import("@/components/DrilldownDrawer").then(module => module.DrilldownDrawer));
import { useDashboard } from "@/hooks/use-dashboard";
import { readDashboardView } from "@/lib/dashboard-url-state";
import { dashboardToday } from "@/lib/dashboard-values";
import type { RecordSelection, RecordCondition } from "@/lib/dashboard-records";
import type { ActivityRow } from "@/lib/types";

type AcquisitionOwnerKey = SdrKey | "comparison" | "intelligence";
type RepOwnerKey = "ursula" | "zein";

type AcquisitionOwner = {
  key: AcquisitionOwnerKey;
  name: string;
  ownerId: string;
  initials: string;
};

type MetricCard = {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: "green" | "blue" | "teal" | "amber" | "purple" | "red";
  onClick: () => void;
};

const ACQUISITION_OWNERS: Record<AcquisitionOwnerKey, AcquisitionOwner> = {
  intelligence: { key: "intelligence", name: "Intelligence Studio", ownerId: "", initials: "IS" },
  marita: { ...SDR_OWNERS.marita },
  daniel: { ...SDR_OWNERS.daniel },
  comparison: { key: "comparison", name: "SDR Comparison", ownerId: "", initials: "SDR" },
  ursula: { ...SDR_OWNERS.ursula },
  zein: { ...SDR_OWNERS.zein },
};

function acquisitionOwnerFromUrl(): AcquisitionOwnerKey {
  if (typeof window === "undefined") return "marita";
  const value = new URLSearchParams(window.location.search).get("acq");
  return value === "ursula" || value === "zein" || value === "daniel" || value === "comparison" || value === "intelligence" ? value : "marita";
}


function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function AcquisitionNav({
  activeOwner,
  onSelect,
}: {
  activeOwner: AcquisitionOwnerKey;
  onSelect: (owner: AcquisitionOwnerKey) => void;
}) {
  return <>
    <div className="nav-label">TEAM WORKSPACES</div>
    <nav>
      {(Object.values(ACQUISITION_OWNERS) as AcquisitionOwner[]).map((owner) => (
        <button
          key={owner.key}
          type="button"
          className={activeOwner === owner.key ? "active" : ""}
          aria-label={owner.key === "comparison" || owner.key === "intelligence" ? owner.name : `${owner.name.split(" ")[0]} ${SDR_OWNERS[owner.key].brand}`}
          title={owner.name}
          onClick={() => onSelect(owner.key)}
        >
          <UsersRound size={17}/>
          <span>{owner.key === "comparison" || owner.key === "intelligence" ? owner.name : owner.name.split(" ")[0]}{owner.key !== "comparison" && owner.key !== "intelligence" ? <small className="sdr-nav-brand">{SDR_OWNERS[owner.key].brand}</small> : null}</span>
          {activeOwner === owner.key && <ChevronRight size={15}/>} 
        </button>
      ))}
    </nav>
  </>;
}

function ComparisonWorkspace({ onSelect, initialSearch }: { onSelect: (owner: AcquisitionOwnerKey) => void; initialSearch: string }) {
  return <main className="app-shell">
    <header className="topbar">
      <div className="top-title"><strong>SDR Command Center</strong><span>Team performance comparison</span></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand"><div className="brand-logo" role="img" aria-label="Talentera ATS"/><span className="brand-subtitle">SDR Intelligence</span></div>
        <AcquisitionNav activeOwner="comparison" onSelect={onSelect}/>
      </aside>
      <div className="content"><SdrComparison onSelect={onSelect} initialSearch={initialSearch}/></div>
    </div>
  </main>;
}

// Animates a formatted-number string from its previous value to the new one.
// Falls back to an instant swap for non-numeric values or reduced-motion users.
function useCountUp(target: string, durationMs = 650) {
  const [display, setDisplay] = useState(target);
  const previousRef = useRef<number | null>(null);

  useEffect(() => {
    const numericTarget = Number(target.replace(/,/g, ""));
    if (Number.isNaN(numericTarget)) { setDisplay(target); return; }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = previousRef.current ?? numericTarget;
    if (reduceMotion || from === numericTarget) {
      previousRef.current = numericTarget;
      setDisplay(target);
      return;
    }

    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(formatNumber(Math.round(from + (numericTarget - from) * eased)));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previousRef.current = numericTarget;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}

function MetricButton({ label, value, helper, icon: Icon, tone, onClick }: MetricCard) {
  const display = useCountUp(value);
  return <button type="button" className={`kpi-card tone-${tone}`} onClick={onClick}>
    <div className="kpi-top"><span>{label}</span><Icon size={18}/></div>
    <strong>{display}</strong>
    <small>{helper}<ListFilter size={13}/></small>
  </button>;
}

// Matches the real kpi-grid shape (see globals.css .kpi-grid) so there is no
// layout shift when live cards replace these placeholders.
function KpiSkeleton({ count = 17 }: { count?: number }) {
  return <div className="kpi-grid" aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="kpi-card kpi-card-skeleton">
        <div className="kpi-top"><span className="skeleton-bar skeleton-bar-label"/><span className="skeleton-dot"/></div>
        <strong className="skeleton-bar skeleton-bar-value"/>
        <small className="skeleton-bar skeleton-bar-helper"/>
      </div>
    ))}
  </div>;
}

function RepKpiDashboard({
  ownerKey,
  initialSearch,
  onSelectOwner,
}: {
  ownerKey: RepOwnerKey;
  initialSearch: string;
  onSelectOwner: (owner: AcquisitionOwnerKey) => void;
}) {
  const owner = ACQUISITION_OWNERS[ownerKey];
  const [repView, setRepView] = useState<"performance" | "handoff">("performance");
  const today = dashboardToday();
  const filters = readDashboardView(initialSearch, { from: process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? today.slice(0, 7) + "-01", to: today, ownerId: owner.ownerId }).filters;
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, refreshing, requesting, error } = useDashboard(filters, refreshKey, repView === "performance", "summary");
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  function activities(type: ActivityRow["type"], where: RecordCondition[] = [], extra: Omit<RecordSelection, "kind" | "where"> = {}): Omit<RecordSelection, "kind"> {
    return { where: [{ field: "type", value: type }, ...where], ...extra };
  }

  const whatsAppCount = useMemo(() => {
    return data?.dailyActivities.reduce((sum, item) => sum + item.whatsAppMessages, 0) ?? 0;
  }, [data]);

  function recordSource(selection: RecordSelection) { return { filters, version: data!.meta.generatedAt, selection }; }
  function showActivities(title: string, description: string, selection: Omit<RecordSelection, "kind">, hubspotUrl: string) {
    if (!data) return;
    setDrilldown({ kind: "activities", title, description, rows: [], source: recordSource({ kind: "activities", ...selection }), hubspotUrl });
  }
  function showDeals(title: string, description: string, selection: Omit<RecordSelection, "kind">) {
    if (!data) return;
    setDrilldown({ kind: "deals", title, description, rows: [], source: recordSource({ kind: "deals", ...selection }), hubspotUrl: data.meta.hubspotUrls.deals });
  }
  function showCompanies(title: string, description: string, selection: Omit<RecordSelection, "kind">) {
    if (!data) return;
    setDrilldown({ kind: "companies", title, description, rows: [], source: recordSource({ kind: "companies", ...selection }), hubspotUrl: data.meta.hubspotUrls.companies });
  }
  function showContacts(title: string, description: string, selection: Omit<RecordSelection, "kind">) {
    if (!data) return;
    setDrilldown({ kind: "contacts", title, description, rows: [], source: recordSource({ kind: "contacts", ...selection }), hubspotUrl: data.meta.hubspotUrls.contacts });
  }

  const cards: MetricCard[] = data ? [
    {
      label: "Calls",
      value: formatNumber(data.kpis.calls),
      helper: `${data.kpis.connectionRate}% connection rate`,
      icon: Phone,
      tone: "teal",
      onClick: () => showActivities(
        `${owner.name} · Calls`,
        "Calls logged for this acquisition owner in the selected reporting period.",
        activities("Call"),
        data.meta.hubspotUrls.calls,
      ),
    },
    {
      label: "Connected calls",
      value: formatNumber(data.kpis.connectedCalls),
      helper: `${data.kpis.calls} total calls`,
      icon: CheckCircle2,
      tone: "blue",
      onClick: () => showActivities(
        `${owner.name} · Connected calls`,
        "Connected call records available in the current HubSpot dashboard snapshot.",
        activities("Call", [{ field: "status", value: "Connected" }]),
        data.meta.hubspotUrls.calls,
      ),
    },
    {
      label: "Meetings",
      value: formatNumber(data.kpis.bookedMeetings),
      helper: `${data.kpis.completedMeetings} completed`,
      icon: CalendarDays,
      tone: "amber",
      onClick: () => showActivities(
        `${owner.name} · Meetings`,
        "Meetings attributed to this acquisition owner in the selected reporting period.",
        activities("Meeting"),
        data.meta.hubspotUrls.meetings,
      ),
    },
    {
      label: "WhatsApp",
      value: formatNumber(whatsAppCount),
      helper: "Messages in selected period",
      icon: MessageCircle,
      tone: "green",
      onClick: () => showActivities(
        `${owner.name} · WhatsApp`,
        "WhatsApp communication records behind this KPI.",
        activities("WhatsApp"),
        data.meta.hubspotUrls.communications,
      ),
    },
    {
      label: "Open tasks",
      value: formatNumber(data.kpis.openTasks),
      helper: `${data.kpis.dueToday} due today`,
      icon: ListTodo,
      tone: "purple",
      onClick: () => showActivities(
        `${owner.name} · Open tasks`,
        "Current open HubSpot tasks assigned to this acquisition owner.",
        activities("Task", [{ field: "isOpen", value: true }]),
        data.meta.hubspotUrls.tasks,
      ),
    },
    {
      label: "Overdue tasks",
      value: formatNumber(data.kpis.overdueTasks),
      helper: "Open and past due",
      icon: AlertTriangle,
      tone: "red",
      onClick: () => showActivities(
        `${owner.name} · Overdue tasks`,
        "Open tasks with a due date earlier than now.",
        { alert: "overdue" },
        data.meta.hubspotUrls.tasks,
      ),
    },
    {
      label: "Stale deals",
      value: formatNumber(data.intelligence.staleDeals.count),
      helper: "Open deals inactive 21+ days",
      icon: BriefcaseBusiness,
      tone: "red",
      onClick: () => showDeals(`${owner.name} · Stale deals`, "Open deals whose latest known contact activity is at least 21 days old.", { signal: "staleDeals" }),
    },
    {
      label: "No future deal activity",
      value: formatNumber(data.intelligence.dealsWithoutFutureActivity.count),
      helper: "Open deals without a next date",
      icon: CalendarDays,
      tone: "amber",
      onClick: () => showDeals(`${owner.name} · No future activity`, "Open deals with no deal-level next activity scheduled.", { signal: "dealsWithoutFutureActivity" }),
    },
    {
      label: "Overdue close dates",
      value: formatNumber(data.intelligence.dealsWithOverdueCloseDate.count),
      helper: "Open deals past close date",
      icon: AlertTriangle,
      tone: "red",
      onClick: () => showDeals(`${owner.name} · Overdue close date`, "Open deals with a close date in the past.", { signal: "dealsWithOverdueCloseDate" }),
    },
    {
      label: "Meetings without follow-up",
      value: formatNumber(data.intelligence.meetingsWithoutFollowUp.count),
      helper: "Completed / no-show past 24h",
      icon: Clock3,
      tone: "amber",
      onClick: () => showActivities(`${owner.name} · No follow-up`, "Meetings past the follow-up SLA with no later logged contact activity.", activities("Meeting", [], { signal: "meetingsWithoutFollowUp" }), data.meta.hubspotUrls.meetings),
    },
    {
      label: "High engagement, no meeting",
      value: formatNumber(data.intelligence.highEngagementAccountsWithoutMeeting.count),
      helper: "Account score 60+",
      icon: Gauge,
      tone: "teal",
      onClick: () => showCompanies(`${owner.name} · High engagement, no meeting`, "Accounts with an explicit engagement score of 60 or above and no associated meeting.", { signal: "highEngagementAccountsWithoutMeeting" }),
    },
    {
      label: "Connected, no meeting",
      value: formatNumber(data.intelligence.contactsWithConnectedCallsWithoutMeeting.count),
      helper: "Contacts ready for a next step",
      icon: Phone,
      tone: "green",
      onClick: () => showContacts(`${owner.name} · Connected, no meeting`, "Contacts with a connected call and no associated deduplicated meeting.", { signal: "contactsWithConnectedCallsWithoutMeeting" }),
    },
    {
      label: "Response SLA met",
      value: data.intelligence.leadResponseSla.rate + "%",
      helper: `${data.intelligence.leadResponseSla.met} of ${data.intelligence.leadResponseSla.eligible} within 24h`,
      icon: ShieldCheck,
      tone: "blue",
      onClick: () => showContacts(`${owner.name} · SLA not met`, "Reporting-period contacts missing first-response timing or above the 24-hour SLA.", { signal: "response-overdue" }),
    },
    {
      label: "Missing contact info",
      value: formatNumber(data.intelligence.missingContactInfo.missingAny.count),
      helper: `${data.intelligence.missingContactInfo.missingPhone.count} phone · ${data.intelligence.missingContactInfo.missingEmail.count} email`,
      icon: ShieldCheck,
      tone: "purple",
      onClick: () => showContacts(`${owner.name} · Missing info`, "Contacts missing phone, email, or LinkedIn information.", { signal: "missing-contact-info" }),
    },
    {
      label: "Meeting → deal",
      value: data.intelligence.meetingToDealConversion.rate + "%",
      helper: `${data.intelligence.meetingToDealConversion.numerator} deals / ${data.intelligence.meetingToDealConversion.denominator} meetings`,
      icon: ArrowUpRight,
      tone: "green",
      onClick: () => showDeals(`${owner.name} · Meeting to deal`, "Deals created in the selected reporting period.", { scope: "created" }),
    },
  ] : [];

  return <main className="app-shell rm-analytics-shell">
    <header className="topbar">
      <div className="top-title"><strong>Acquisition intelligence</strong><span>Live HubSpot performance</span></div>
      <div className="top-actions">
        <span className={`status-pill ${data?.meta.isDemo ? "demo" : "live"}`}><i/>{data?.meta.isDemo ? "Demo data" : refreshing || requesting ? "UPDATING · HUBSPOT" : "HUBSPOT SNAPSHOT"}</span>
        <button className="refresh-button" type="button" onClick={() => setRefreshKey(value => value + 1)} disabled={loading || refreshing || requesting}>
          <RefreshCw size={16} className={refreshing || requesting ? "spin" : ""}/>{refreshing || requesting ? "Refreshing…" : "Refresh data"}
        </button>
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="brand"><div className="brand-logo" role="img" aria-label="Talentera ATS"/><span className="brand-subtitle">SDR Intelligence</span></div>
        <AcquisitionNav activeOwner={ownerKey} onSelect={onSelectOwner}/>
        <div className="nav-label owner-label">SDR OWNER</div>
        <div className="owner-card">
          <div className="avatar">{owner.initials}</div>
          <div><span>Reporting for</span><strong>{data?.meta.ownerName || owner.name}</strong></div>
          <BadgeCheck size={17}/>
        </div>
        <div className="sync-card"><Database size={18}/><div><strong>Last sync</strong><span>{data ? new Date(data.meta.generatedAt).toLocaleString("en-GB") : "Loading…"}</span></div></div>
      </aside>

      <div className="content">
        <div className="page-title">
          <div>
            <span className="eyebrow">TALENTERA · ACQUISITION</span>
            <h1>{owner.name.split(" ")[0]} KPIs</h1>
            <p>{data ? `${shortDate(data.meta.from)} – ${shortDate(data.meta.to)} · ${data.meta.timezone}` : "Loading live HubSpot KPIs…"}</p>
          </div>
        </div>

        <nav className={studioStyles.tabs} aria-label="RM analytics sections"><button type="button" aria-pressed={repView === "performance"} onClick={() => setRepView("performance")}>Performance & trends</button><button type="button" aria-pressed={repView === "handoff"} onClick={() => setRepView("handoff")}>SDR meeting handoff</button></nav>
        {repView === "handoff" ? <SalesHandoffDashboard key={ownerKey} initialSearch={initialSearch} initialSalesRepId={owner.ownerId} embedded onBack={() => setRepView("performance")}/> : <>
        <ReportingRange key={`${filters.from}:${filters.to}`} filters={filters}/>
        <p className={studioStyles.freshness}>Owner activity scope · use SDR meeting handoff for meetings booked by Marita or Daniel.</p>
        {data?.meta.warnings.length ? <div className="warning-banner"><AlertTriangle size={17}/><div><strong>{data.meta.isDemo ? "Demo mode" : "Some HubSpot data sources were unavailable"}</strong><span>{data.meta.warnings.join(" · ")}</span></div></div> : null}
        {error ? <div className="error-banner"><AlertTriangle size={20}/><div><strong>{data ? "Refresh failed — showing the last loaded data" : "KPI dashboard failed to load"}</strong><span>{error}</span></div><button type="button" onClick={() => setRefreshKey(value => value + 1)}>Try again</button></div> : null}

        {data
          ? <><div className="kpi-grid">{cards.slice(0, 6).map((card) => <MetricButton key={card.label} {...card}/>)}</div><PerformanceCharts data={data} onInspect={(title, selection) => { setDrilldown({ kind: selection.kind, title, description: "Records from the selected owner snapshot.", rows: [], source: recordSource(selection), hubspotUrl: data.meta.hubspotUrls[selection.kind === "activities" ? "calls" : selection.kind] } as Drilldown); }}/><details className={studioStyles.evidence}><summary>More risk, conversion and data-quality metrics</summary><div className="kpi-grid">{cards.slice(6).map(card => <MetricButton key={card.label} {...card}/>)}</div></details></>
          : (loading ? <KpiSkeleton/> : null)}
        {data ? <AcquisitionDailyPulse filters={filters} data={data} ownerName={owner.name} onOpen={setDrilldown}/> : null}
        </>}
      </div>
    </div>

    <AnimatePresence>
      {drilldown ? <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/> : null}
    </AnimatePresence>
  </main>;
}

export function AcquisitionDashboard({ initialOwner, initialSearch }: { initialOwner: AcquisitionOwnerKey; initialSearch: string }) {
  const [activeOwner, setActiveOwner] = useState<AcquisitionOwnerKey>(initialOwner);
  const [activeSearch, setActiveSearch] = useState(initialSearch);

  useLayoutEffect(() => {
    const resetScroll = () => window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    resetScroll();
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      resetScroll();
      secondFrame = window.requestAnimationFrame(resetScroll);
    });
    const settledLayoutTimer = window.setTimeout(resetScroll, 100);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settledLayoutTimer);
    };
  }, [activeOwner]);

  useEffect(() => {
    const syncFromUrl = () => {
      const owner = acquisitionOwnerFromUrl();
      setActiveOwner(owner);
      setActiveSearch(window.location.search);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  function selectOwner(owner: AcquisitionOwnerKey) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const url = new URL(window.location.href);
    if (owner === "marita") url.searchParams.delete("acq");
    else url.searchParams.set("acq", owner);
    for (const parameter of ["tab", "workspace", "view"]) {
      url.searchParams.delete(parameter);
    }
    window.history.pushState({}, "", url);
    setActiveOwner(owner);
    setActiveSearch(url.search);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  if (activeOwner === "marita") return <div className="sdr-tab-panel" data-sdr-host="marita">
      <ExistingDashboard key="marita" active={activeOwner === "marita"} initialSearch={activeSearch} workspaceNavigation={<AcquisitionNav activeOwner="marita" onSelect={selectOwner}/>}/>
    </div>;

  if (activeOwner === "daniel") return <div className="sdr-tab-panel" data-sdr-host="daniel" data-brand="evalufy">
      <ExistingDashboard key="daniel" sdr="daniel" active initialSearch={activeSearch} workspaceNavigation={<AcquisitionNav activeOwner="daniel" onSelect={selectOwner}/>}/>
    </div>;

  if (activeOwner === "intelligence") return <main className="app-shell intelligence-shell"><header className="topbar"><div className="top-title"><strong>SDR Command Center</strong><span>Intelligence & decision workspace</span></div></header><div className="workspace"><aside className="sidebar"><div className="brand"><div className="brand-logo" role="img" aria-label="Talentera ATS"/><span className="brand-subtitle">SDR Intelligence</span></div><AcquisitionNav activeOwner="intelligence" onSelect={selectOwner}/></aside><div className="content"><DecisionStudio initialSearch={activeSearch}/></div></div></main>;

  if (activeOwner === "comparison") return <div className="sdr-tab-panel"><ComparisonWorkspace onSelect={selectOwner} initialSearch={activeSearch}/></div>;

  if (activeOwner === "ursula") return <div className="sdr-tab-panel">
      <RepKpiDashboard key="ursula" ownerKey="ursula" initialSearch={activeSearch} onSelectOwner={selectOwner}/>
    </div>;

  return <div className="sdr-tab-panel">
      <RepKpiDashboard key="zein" ownerKey="zein" initialSearch={activeSearch} onSelectOwner={selectOwner}/>
    </div>;
}
