"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { SDR_OWNERS } from "@/lib/sdr-owners";
import { AcquisitionDailyPulse } from "@/components/AcquisitionDailyPulse";
import { Dashboard as ExistingDashboard } from "@/components/DashboardShell";
import { DrilldownDrawer, type Drilldown } from "@/components/DrilldownDrawer";
import type { ActivityRow, CompanyRow, ContactRow, DealRow, DashboardData } from "@/lib/types";

type AcquisitionOwnerKey = "marita" | "daniel" | "comparison" | "ursula" | "zein";
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

type RepClientCacheEntry = {
  data: DashboardData;
  loadedAt: number;
};

const DEFAULT_START = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? new Date().toISOString().slice(0, 7) + "-01";
const TODAY = new Date().toISOString().slice(0, 10);
const REP_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const repClientCache = new Map<string, RepClientCacheEntry>();

const ACQUISITION_OWNERS: Record<AcquisitionOwnerKey, AcquisitionOwner> = {
  marita: {
    key: "marita",
    name: "Marita Chedid",
    ownerId: "31644369",
    initials: "MC",
  },
  daniel: { ...SDR_OWNERS.daniel },
  comparison: { key: "comparison", name: "SDR Comparison", ownerId: "", initials: "SDR" },
  ursula: {
    key: "ursula",
    name: "Ursula Waked",
    ownerId: "76369997",
    initials: "UW",
  },
  zein: {
    key: "zein",
    name: "Zein Fares",
    ownerId: "31558980",
    initials: "ZF",
  },
};

function acquisitionOwnerFromUrl(): AcquisitionOwnerKey {
  if (typeof window === "undefined") return "marita";
  const value = new URLSearchParams(window.location.search).get("acq");
  return value === "ursula" || value === "zein" || value === "daniel" || value === "comparison" ? value : "marita";
}

function repClientCacheKey(ownerId: string) {
  return `${ownerId}:${DEFAULT_START}:${TODAY}`;
}

function cachedRepData(ownerId: string) {
  return repClientCache.get(repClientCacheKey(ownerId));
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
          onClick={() => onSelect(owner.key)}
        >
          <UsersRound size={17}/>
          <span>{owner.key === "comparison" ? "SDR Comparison" : owner.name.split(" ")[0]}{(owner.key === "marita" || owner.key === "daniel") && <small className="sdr-nav-brand">{SDR_OWNERS[owner.key].brand}</small>}</span>
          {activeOwner === owner.key && <ChevronRight size={15}/>} 
        </button>
      ))}
    </nav>
  </>;
}

function SidebarAcquisitionPortal({ onSelect, ownerKey = "marita" }: { onSelect: (owner: AcquisitionOwnerKey) => void; ownerKey?: "marita" | "daniel" }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    let host: HTMLDivElement | null = null;

    const attach = () => {
      const sidebar = document.querySelector<HTMLElement>(`[data-sdr-host="${ownerKey}"] .sidebar`);
      if (!sidebar) {
        attempts += 1;
        if (attempts < 120) frame = window.requestAnimationFrame(attach);
        return;
      }

      const existing = sidebar.querySelector<HTMLDivElement>("[data-acquisition-tabs-host]");
      if (existing) {
        setTarget(existing);
        return;
      }

      host = document.createElement("div");
      host.dataset.acquisitionTabsHost = "true";
      const ownerLabel = sidebar.querySelector(".owner-label");
      if (ownerLabel) sidebar.insertBefore(host, ownerLabel);
      else sidebar.appendChild(host);
      setTarget(host);
    };

    attach();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (host?.isConnected) host.remove();
    };
  }, [ownerKey]);

  if (!target) return null;
  return createPortal(<AcquisitionNav activeOwner={ownerKey} onSelect={onSelect}/>, target);
}

function ComparisonWorkspace({ onSelect }: { onSelect: (owner: AcquisitionOwnerKey) => void }) {
  return <main className="app-shell">
    <header className="topbar">
      <div className="top-title"><strong>SDR Command Center</strong><span>Team performance comparison</span></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand"><div className="brand-logo" role="img" aria-label="Talentera ATS"/><span className="brand-subtitle">SDR Intelligence</span></div>
        <AcquisitionNav activeOwner="comparison" onSelect={onSelect}/>
      </aside>
      <div className="content"><SdrComparison onSelect={onSelect}/></div>
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
  onSelectOwner,
}: {
  ownerKey: RepOwnerKey;
  onSelectOwner: (owner: AcquisitionOwnerKey) => void;
}) {
  const owner = ACQUISITION_OWNERS[ownerKey];
  const initialCache = cachedRepData(owner.ownerId);
  const [data, setData] = useState<DashboardData | null>(() => initialCache?.data ?? null);
  const [loading, setLoading] = useState(() => !initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const loadData = useCallback(async (forceRefresh = false, pollRefresh = false) => {
    const cacheKey = repClientCacheKey(owner.ownerId);
    const cached = repClientCache.get(cacheKey);
    const cacheIsFresh = cached && Date.now() - cached.loadedAt < REP_CLIENT_CACHE_TTL_MS;

    if (!forceRefresh && !pollRefresh && cacheIsFresh) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    if (!data) setLoading(true);
    setRequesting(true);
    if (forceRefresh) setRefreshing(true);
    setError("");

    const query = new URLSearchParams({
      from: DEFAULT_START,
      to: TODAY,
      ownerId: owner.ownerId,
    });
    if (forceRefresh) query.set("refresh", "1");

    try {
      const response = await fetch(`/api/dashboard?${query.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Dashboard request failed");
      const nextData = payload as DashboardData;
      repClientCache.set(cacheKey, { data: nextData, loadedAt: Date.now() });
      setData(nextData);
      setRefreshing(response.headers.get("X-Dashboard-Refreshing") === "1");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load KPI data");
    } finally {
      setLoading(false);
      setRequesting(false);
    }
  }, [data, owner.ownerId]);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useEffect(() => {
    if (!refreshing || requesting) return;
    const timer = window.setTimeout(() => void loadData(false, true), 3_000);
    return () => window.clearTimeout(timer);
  }, [loadData, refreshing, requesting]);

  const activities = useCallback((type: ActivityRow["type"]) => {
    return data?.recentActivities.filter((row) => row.type === type) ?? [];
  }, [data]);

  const whatsAppCount = useMemo(() => {
    return data?.dailyActivities.reduce((sum, item) => sum + item.whatsAppMessages, 0) ?? 0;
  }, [data]);

  function showActivities(title: string, description: string, rows: ActivityRow[], hubspotUrl: string) {
    setDrilldown({ kind: "activities", title, description, rows, hubspotUrl });
  }

  function showDeals(title: string, description: string, rows: DealRow[]) {
    if (!data) return;
    setDrilldown({ kind: "deals", title, description, rows, hubspotUrl: data.meta.hubspotUrls.deals });
  }

  function showCompanies(title: string, description: string, rows: CompanyRow[]) {
    if (!data) return;
    setDrilldown({ kind: "companies", title, description, rows, hubspotUrl: data.meta.hubspotUrls.companies });
  }

  function showContacts(title: string, description: string, rows: ContactRow[]) {
    if (!data) return;
    setDrilldown({ kind: "contacts", title, description, rows, hubspotUrl: data.meta.hubspotUrls.contacts });
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
        activities("Call").filter((row) => /connect|answer|complete/i.test(`${row.status} ${row.detail}`)),
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
        activities("Task").filter((row) => row.isOpen),
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
        activities("Task").filter((row) => row.isOpen && row.dueAt && new Date(row.dueAt).getTime() < Date.now()),
        data.meta.hubspotUrls.tasks,
      ),
    },
    {
      label: "Stale deals",
      value: formatNumber(data.intelligence.staleDeals.count),
      helper: "Open deals inactive 21+ days",
      icon: BriefcaseBusiness,
      tone: "red",
      onClick: () => showDeals(`${owner.name} · Stale deals`, "Open deals whose latest known contact activity is at least 21 days old.", data.deals.filter((row) => data.intelligence.staleDeals.ids.includes(row.id))),
    },
    {
      label: "No future deal activity",
      value: formatNumber(data.intelligence.dealsWithoutFutureActivity.count),
      helper: "Open deals without a next date",
      icon: CalendarDays,
      tone: "amber",
      onClick: () => showDeals(`${owner.name} · No future activity`, "Open deals with no deal-level next activity scheduled.", data.deals.filter((row) => data.intelligence.dealsWithoutFutureActivity.ids.includes(row.id))),
    },
    {
      label: "Overdue close dates",
      value: formatNumber(data.intelligence.dealsWithOverdueCloseDate.count),
      helper: "Open deals past close date",
      icon: AlertTriangle,
      tone: "red",
      onClick: () => showDeals(`${owner.name} · Overdue close date`, "Open deals with a close date in the past.", data.deals.filter((row) => data.intelligence.dealsWithOverdueCloseDate.ids.includes(row.id))),
    },
    {
      label: "Meetings without follow-up",
      value: formatNumber(data.intelligence.meetingsWithoutFollowUp.count),
      helper: "Completed / no-show past 24h",
      icon: Clock3,
      tone: "amber",
      onClick: () => showActivities(`${owner.name} · No follow-up`, "Meetings past the follow-up SLA with no later logged contact activity.", activities("Meeting").filter((row) => data.intelligence.meetingsWithoutFollowUp.ids.includes(row.id)), data.meta.hubspotUrls.meetings),
    },
    {
      label: "High engagement, no meeting",
      value: formatNumber(data.intelligence.highEngagementAccountsWithoutMeeting.count),
      helper: "Account score 60+",
      icon: Gauge,
      tone: "teal",
      onClick: () => showCompanies(`${owner.name} · High engagement, no meeting`, "Accounts with an explicit engagement score of 60 or above and no associated meeting.", data.companies.filter((row) => data.intelligence.highEngagementAccountsWithoutMeeting.ids.includes(row.id))),
    },
    {
      label: "Connected, no meeting",
      value: formatNumber(data.intelligence.contactsWithConnectedCallsWithoutMeeting.count),
      helper: "Contacts ready for a next step",
      icon: Phone,
      tone: "green",
      onClick: () => showContacts(`${owner.name} · Connected, no meeting`, "Contacts with a connected call and no associated deduplicated meeting.", data.priorityContacts.filter((row) => data.intelligence.contactsWithConnectedCallsWithoutMeeting.ids.includes(row.id))),
    },
    {
      label: "Response SLA met",
      value: data.intelligence.leadResponseSla.rate + "%",
      helper: `${data.intelligence.leadResponseSla.met} of ${data.intelligence.leadResponseSla.eligible} within 24h`,
      icon: ShieldCheck,
      tone: "blue",
      onClick: () => showContacts(`${owner.name} · SLA not met`, "Reporting-period contacts missing first-response timing or above the 24-hour SLA.", data.priorityContacts.filter((row) => data.intelligence.leadResponseSla.overdueIds.includes(row.id))),
    },
    {
      label: "Missing contact info",
      value: formatNumber(data.intelligence.missingContactInfo.missingAny.count),
      helper: `${data.intelligence.missingContactInfo.missingPhone.count} phone · ${data.intelligence.missingContactInfo.missingEmail.count} email`,
      icon: ShieldCheck,
      tone: "purple",
      onClick: () => showContacts(`${owner.name} · Missing info`, "Contacts missing phone, email, or LinkedIn information.", data.priorityContacts.filter((row) => data.intelligence.missingContactInfo.missingAny.ids.includes(row.id))),
    },
    {
      label: "Meeting → deal",
      value: data.intelligence.meetingToDealConversion.rate + "%",
      helper: `${data.intelligence.meetingToDealConversion.numerator} deals / ${data.intelligence.meetingToDealConversion.denominator} meetings`,
      icon: ArrowUpRight,
      tone: "green",
      onClick: () => showDeals(`${owner.name} · Meeting to deal`, "Deals created in the selected reporting period.", data.deals),
    },
  ] : [];

  return <main className="app-shell">
    <header className="topbar">
      <div className="top-title"><strong>Acquisition KPIs</strong><span>Live HubSpot performance</span></div>
      <div className="top-actions">
        <span className={`status-pill ${data?.meta.isDemo ? "demo" : "live"}`}><i/>{data?.meta.isDemo ? "Demo data" : refreshing || requesting ? "UPDATING · HUBSPOT" : "HUBSPOT SNAPSHOT"}</span>
        <button className="refresh-button" type="button" onClick={() => void loadData(true)} disabled={loading || refreshing || requesting}>
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

        {data?.meta.warnings.length ? <div className="warning-banner"><AlertTriangle size={17}/><div><strong>{data.meta.isDemo ? "Demo mode" : "Some HubSpot data sources were unavailable"}</strong><span>{data.meta.warnings.join(" · ")}</span></div></div> : null}
        {error ? <div className="error-banner"><AlertTriangle size={20}/><div><strong>{data ? "Refresh failed — showing the last loaded data" : "KPI dashboard failed to load"}</strong><span>{error}</span></div><button type="button" onClick={() => void loadData(false)}>Try again</button></div> : null}

        {data
          ? <div className="kpi-grid">{cards.map((card) => <MetricButton key={card.label} {...card}/>)}</div>
          : (loading ? <KpiSkeleton/> : null)}
        {data ? <AcquisitionDailyPulse data={data} ownerName={owner.name} onOpen={setDrilldown}/> : null}
      </div>
    </div>

    {drilldown ? <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/> : null}
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
    for (const parameter of ["tab", "workspace", "view", "country", "originalSource", "latestSource", "tier", "persona"]) {
      url.searchParams.delete(parameter);
    }
    window.history.pushState({}, "", url);
    setActiveOwner(owner);
    setActiveSearch(url.search);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  if (activeOwner === "marita") return <div className="sdr-tab-panel" data-sdr-host="marita">
      <ExistingDashboard active={activeOwner === "marita"} initialSearch={activeSearch}/>
      <SidebarAcquisitionPortal onSelect={selectOwner}/>
    </div>;

  if (activeOwner === "daniel") return <div className="sdr-tab-panel" data-sdr-host="daniel" data-brand="evalufy">
      <ExistingDashboard sdr="daniel" active initialSearch={activeSearch}/>
      <SidebarAcquisitionPortal ownerKey="daniel" onSelect={selectOwner}/>
    </div>;

  if (activeOwner === "comparison") return <div className="sdr-tab-panel"><ComparisonWorkspace onSelect={selectOwner}/></div>;

  if (activeOwner === "ursula") return <div className="sdr-tab-panel">
      <RepKpiDashboard ownerKey="ursula" onSelectOwner={selectOwner}/>
    </div>;

  return <div className="sdr-tab-panel">
      <RepKpiDashboard ownerKey="zein" onSelectOwner={selectOwner}/>
    </div>;
}
