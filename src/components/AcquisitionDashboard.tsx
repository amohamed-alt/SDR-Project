"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Database,
  ListFilter,
  ListTodo,
  MessageCircle,
  Phone,
  RefreshCw,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Dashboard as ExistingDashboard } from "@/components/DashboardShell";
import { DrilldownDrawer, type Drilldown } from "@/components/DrilldownDrawer";
import type { ActivityRow, DashboardData } from "@/lib/types";

type AcquisitionOwnerKey = "marita" | "ursula" | "zein";
type RepOwnerKey = Exclude<AcquisitionOwnerKey, "marita">;

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

const DEFAULT_START = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? new Date().toISOString().slice(0, 7) + "-01";
const TODAY = new Date().toISOString().slice(0, 10);

const ACQUISITION_OWNERS: Record<AcquisitionOwnerKey, AcquisitionOwner> = {
  marita: {
    key: "marita",
    name: "Marita Chedid",
    ownerId: "31644369",
    initials: "MC",
  },
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
  return value === "ursula" || value === "zein" ? value : "marita";
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
    <div className="nav-label">ACQUISITION</div>
    <nav>
      {(Object.values(ACQUISITION_OWNERS) as AcquisitionOwner[]).map((owner) => (
        <button
          key={owner.key}
          type="button"
          className={activeOwner === owner.key ? "active" : ""}
          onClick={() => onSelect(owner.key)}
        >
          <UsersRound size={17}/>
          <span>{owner.name.split(" ")[0]}</span>
          {activeOwner === owner.key && <ChevronRight size={15}/>} 
        </button>
      ))}
    </nav>
  </>;
}

function SidebarAcquisitionPortal({ onSelect }: { onSelect: (owner: AcquisitionOwnerKey) => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    let host: HTMLDivElement | null = null;

    const attach = () => {
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
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
  }, []);

  if (!target) return null;
  return createPortal(<AcquisitionNav activeOwner="marita" onSelect={onSelect}/>, target);
}

function MetricButton({ label, value, helper, icon: Icon, tone, onClick }: MetricCard) {
  return <button type="button" className={`kpi-card tone-${tone}`} onClick={onClick}>
    <div className="kpi-top"><span>{label}</span><Icon size={18}/></div>
    <strong>{value}</strong>
    <small>{helper}<ListFilter size={13}/></small>
  </button>;
}

function RepKpiDashboard({
  ownerKey,
  onSelectOwner,
}: {
  ownerKey: RepOwnerKey;
  onSelectOwner: (owner: AcquisitionOwnerKey) => void;
}) {
  const owner = ACQUISITION_OWNERS[ownerKey];
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    setDrilldown(null);

    const query = new URLSearchParams({
      from: DEFAULT_START,
      to: TODAY,
      ownerId: owner.ownerId,
    });
    if (refreshKey) query.set("refresh", "1");

    try {
      const response = await fetch(`/api/dashboard?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Dashboard request failed");
      setData(payload as DashboardData);
    } catch (requestError) {
      setData(null);
      setError(requestError instanceof Error ? requestError.message : "Unable to load KPI data");
    } finally {
      setLoading(false);
    }
  }, [owner.ownerId, refreshKey]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activities = useCallback((type: ActivityRow["type"]) => {
    return data?.recentActivities.filter((row) => row.type === type) ?? [];
  }, [data]);

  const whatsAppCount = useMemo(() => {
    return data?.dailyActivities.reduce((sum, item) => sum + item.whatsAppMessages, 0) ?? 0;
  }, [data]);

  function showActivities(title: string, description: string, rows: ActivityRow[], hubspotUrl: string) {
    setDrilldown({ kind: "activities", title, description, rows, hubspotUrl });
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
  ] : [];

  return <main className="app-shell">
    <header className="topbar">
      <div className="top-title"><strong>Acquisition KPIs</strong><span>Live HubSpot performance</span></div>
      <div className="top-actions">
        <span className={`status-pill ${data?.meta.isDemo ? "demo" : "live"}`}><i/>{data?.meta.isDemo ? "Demo data" : "LIVE · HUBSPOT"}</span>
        <button className="refresh-button" type="button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""}/>Refresh data
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
        {error ? <div className="error-banner"><AlertTriangle size={20}/><div><strong>KPI dashboard failed to load</strong><span>{error}</span></div><button type="button" onClick={() => void loadData()}>Try again</button></div> : null}

        {data ? <div className="kpi-grid">{cards.map((card) => <MetricButton key={card.label} {...card}/>)}</div> : null}

        {loading ? <div className="loading-overlay"><div className="loader"/><strong>Loading {owner.name.split(" ")[0]} KPIs…</strong><span>Calls, meetings, WhatsApp, and task execution</span></div> : null}
      </div>
    </div>

    {drilldown ? <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/> : null}
  </main>;
}

export function AcquisitionDashboard() {
  const [activeOwner, setActiveOwner] = useState<AcquisitionOwnerKey>("marita");

  useEffect(() => {
    const syncFromUrl = () => setActiveOwner(acquisitionOwnerFromUrl());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  function selectOwner(owner: AcquisitionOwnerKey) {
    const url = new URL(window.location.href);
    if (owner === "marita") url.searchParams.delete("acq");
    else url.searchParams.set("acq", owner);
    window.history.pushState({}, "", url);
    setActiveOwner(owner);
  }

  if (activeOwner === "ursula" || activeOwner === "zein") {
    return <RepKpiDashboard ownerKey={activeOwner} onSelectOwner={selectOwner}/>;
  }

  return <>
    <ExistingDashboard/>
    <SidebarAcquisitionPortal onSelect={selectOwner}/>
  </>;
}
