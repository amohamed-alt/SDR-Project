"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  ListTodo,
  Mail,
  Phone,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Target,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DrilldownDrawer, type Drilldown } from "@/components/DrilldownDrawer";
import { WhatsAppQuickAction } from "@/components/WhatsAppQuickAction";
import type { ActivityRow, ContactRow, DashboardData, DailyActivityDatum } from "@/lib/types";
import styles from "@/components/SdrTeamCommandCenter.module.css";

type RepId = "marita" | "daniel";
type View = "management" | "workspace";
type QueueMode = "tasks" | "leads" | "calls" | "meetings";

type RepConfig = {
  id: RepId;
  ownerId: string;
  name: string;
  shortName: string;
  initials: string;
  product: string;
  lane: string;
};

type SnapshotMap = Record<RepId, DashboardData | null>;

type TeamDailyDatum = {
  date: string;
  maritaCalls: number;
  maritaConnected: number;
  danielCalls: number;
  danielConnected: number;
};

const SDRS: RepConfig[] = [
  {
    id: "marita",
    ownerId: "31644369",
    name: "Marita Chedid",
    shortName: "Marita",
    initials: "MC",
    product: "Talentera",
    lane: "ATS · Talent Acquisition",
  },
  {
    id: "daniel",
    ownerId: "37624223",
    name: "Daniel Beaini",
    shortName: "Daniel",
    initials: "DB",
    product: "Evalufy",
    lane: "Assessment · Evaluation",
  },
];

const defaultStart = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
const today = new Date().toISOString().slice(0, 10);

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function dateLabel(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function dateTime(value: string, timezone?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function zonedDay(value: string, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function activityTime(row: ActivityRow) {
  return row.metricAt || row.occurredAt || row.dueAt || "";
}

function activityTimestamp(row: ActivityRow) {
  const raw = activityTime(row);
  return raw ? new Date(raw).getTime() : 0;
}

function repConfig(id: RepId) {
  return SDRS.find((rep) => rep.id === id) ?? SDRS[0];
}

function metricHelper(data: DashboardData | null) {
  if (!data) return "Loading HubSpot data";
  return `${data.kpis.connectionRate}% connected · ${data.kpis.completedTasks} tasks completed`;
}

function queueRows(data: DashboardData, mode: QueueMode) {
  const now = new Date(data.meta.generatedAt).getTime();
  const localToday = zonedDay(data.meta.generatedAt, data.meta.timezone);

  if (mode === "tasks") {
    return data.recentActivities
      .filter((row) => row.type === "Task" && row.isOpen)
      .sort((left, right) => {
        if (left.isHighPriority !== right.isHighPriority) return left.isHighPriority ? -1 : 1;
        const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      });
  }

  if (mode === "calls") {
    return data.recentActivities
      .filter((row) => row.type === "Call" && zonedDay(row.metricAt || row.occurredAt, data.meta.timezone) === localToday)
      .sort((left, right) => activityTimestamp(right) - activityTimestamp(left));
  }

  if (mode === "meetings") {
    return data.recentActivities
      .filter((row) => row.type === "Meeting" && (!row.occurredAt || new Date(row.occurredAt).getTime() >= now))
      .sort((left, right) => new Date(left.occurredAt || left.metricAt).getTime() - new Date(right.occurredAt || right.metricAt).getTime());
  }

  return data.priorityContacts
    .filter((row) => row.leadStatus.trim().toLowerCase() !== "unqualified")
    .sort((left, right) => {
      const untouchedDelta = Number(Boolean(left.lastContacted)) - Number(Boolean(right.lastContacted));
      if (untouchedDelta) return untouchedDelta;
      return right.priorityScore - left.priorityScore;
    });
}

function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  helper: string;
  icon: typeof Gauge;
  onClick?: () => void;
}) {
  return <button type="button" className={styles.metricCard} onClick={onClick} disabled={!onClick}>
    <span className={styles.metricIcon}><Icon size={17}/></span>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{helper}</small>
  </button>;
}

function ActivityRowView({ row, timezone }: { row: ActivityRow; timezone: string }) {
  return <article className={styles.activityRow}>
    <span className={styles.activityType}>{row.type}</span>
    <div className={styles.activityMain}>
      <strong>{row.subject || `${row.type} activity`}</strong>
      <span>{row.relatedContactName || "No associated contact"}{row.status ? ` · ${row.status}` : ""}</span>
    </div>
    <span className={styles.activityWhen}>{dateTime(activityTime(row), timezone)}</span>
    <div className={styles.rowActions}>
      {row.relatedContactId && row.relatedContactHasPhone ? <WhatsAppQuickAction contactId={row.relatedContactId}/> : null}
      {row.url ? <a href={row.url} target="_blank" rel="noreferrer" aria-label="Open HubSpot activity"><ExternalLink size={13}/></a> : null}
    </div>
  </article>;
}

function ContactRowView({ row }: { row: ContactRow }) {
  return <article className={styles.contactRow}>
    <span className={styles.score}>{row.priorityScore}</span>
    <div className={styles.contactIdentity}>
      <strong>{row.name}</strong>
      <span>{row.title || "No title"}{row.company ? ` · ${row.company}` : ""}</span>
      <small>{row.lastContacted ? `Last contacted ${dateLabel(row.lastContacted.slice(0, 10))}` : "Not contacted yet"}</small>
    </div>
    <div className={styles.rowActions}>
      {row.phone ? <a href={`tel:${row.phone}`} aria-label={`Call ${row.name}`}><Phone size={13}/></a> : null}
      {row.email ? <a href={`mailto:${row.email}`} aria-label={`Email ${row.name}`}><Mail size={13}/></a> : null}
      {row.id && row.phone ? <WhatsAppQuickAction contactId={row.id}/> : null}
      {row.url ? <a href={row.url} target="_blank" rel="noreferrer" aria-label="Open HubSpot contact"><ExternalLink size={13}/></a> : null}
    </div>
  </article>;
}

export function SdrTeamCommandCenter({
  onOpenAnalytics,
}: {
  onOpenAnalytics: (ownerId: string) => void;
}) {
  const [view, setView] = useState<View>("management");
  const [selectedRep, setSelectedRep] = useState<RepId>("marita");
  const [queueMode, setQueueMode] = useState<QueueMode>("tasks");
  const [from, setFrom] = useState(defaultStart);
  const [to, setTo] = useState(today);
  const [appliedRange, setAppliedRange] = useState({ from: defaultStart, to: today });
  const [snapshots, setSnapshots] = useState<SnapshotMap>({ marita: null, daniel: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const pairs = await Promise.all(SDRS.map(async (rep) => {
        const query = new URLSearchParams({
          from: appliedRange.from,
          to: appliedRange.to,
          ownerId: rep.ownerId,
        });
        if (refreshKey) query.set("refresh", "1");
        const response = await fetch(`/api/dashboard?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.details || payload.error || `Could not load ${rep.name}`);
        return [rep.id, payload as DashboardData] as const;
      }));
      setSnapshots(Object.fromEntries(pairs) as SnapshotMap);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load SDR team data");
    } finally {
      setLoading(false);
    }
  }, [appliedRange, refreshKey]);

  useEffect(() => { void load(); }, [load]);

  const management = useMemo(() => {
    const available = SDRS.map((rep) => ({ rep, data: snapshots[rep.id] })).filter((entry): entry is { rep: RepConfig; data: DashboardData } => Boolean(entry.data));
    const totals = available.reduce((sum, { data }) => ({
      calls: sum.calls + data.kpis.calls,
      connected: sum.connected + data.kpis.connectedCalls,
      meetings: sum.meetings + data.kpis.bookedMeetings,
      completedTasks: sum.completedTasks + data.kpis.completedTasks,
      openTasks: sum.openTasks + data.kpis.openTasks,
      dueToday: sum.dueToday + data.kpis.dueToday,
      portfolio: sum.portfolio + data.kpis.portfolioContacts,
    }), { calls: 0, connected: 0, meetings: 0, completedTasks: 0, openTasks: 0, dueToday: 0, portfolio: 0 });

    const connectionRate = totals.calls ? Math.round((totals.connected / totals.calls) * 1000) / 10 : 0;
    const dailyMap = new Map<string, TeamDailyDatum>();
    for (const { rep, data } of available) {
      for (const point of data.dailyActivities) {
        const current = dailyMap.get(point.date) ?? {
          date: point.date,
          maritaCalls: 0,
          maritaConnected: 0,
          danielCalls: 0,
          danielConnected: 0,
        };
        if (rep.id === "marita") {
          current.maritaCalls = point.calls;
          current.maritaConnected = point.connected;
        } else {
          current.danielCalls = point.calls;
          current.danielConnected = point.connected;
        }
        dailyMap.set(point.date, current);
      }
    }

    const recent = available
      .flatMap(({ rep, data }) => data.recentActivities.map((row) => ({ rep, data, row })))
      .sort((left, right) => activityTimestamp(right.row) - activityTimestamp(left.row))
      .slice(0, 14);

    const alerts = available
      .flatMap(({ rep, data }) => data.alerts.filter((item) => item.severity !== "info").map((item) => ({ rep, data, item })))
      .sort((left, right) => {
        const rank = { critical: 0, warning: 1, info: 2 } as const;
        return rank[left.item.severity] - rank[right.item.severity] || right.item.count - left.item.count;
      })
      .slice(0, 8);

    return {
      totals,
      connectionRate,
      daily: [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
      recent,
      alerts,
    };
  }, [snapshots]);

  const selected = repConfig(selectedRep);
  const selectedData = snapshots[selectedRep];

  function applyPreset(days: number | "month") {
    const end = new Date();
    const start = new Date(end);
    if (days === "month") start.setUTCDate(1);
    else start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
    const next = { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
    setFrom(next.from);
    setTo(next.to);
    setAppliedRange(next);
  }

  function openRepWorkspace(rep: RepId) {
    setSelectedRep(rep);
    setQueueMode("tasks");
    setView("workspace");
    window.dispatchEvent(new CustomEvent("sdr:usage", { detail: { eventType: "feature_open", feature: `${rep}-workspace` } }));
  }

  function openActivities(data: DashboardData, title: string, description: string, rows: ActivityRow[]) {
    setDrilldown({ kind: "activities", title, description, rows, hubspotUrl: data.meta.hubspotUrls.calls });
  }

  function openContacts(data: DashboardData, title: string, description: string, rows: ContactRow[]) {
    setDrilldown({ kind: "contacts", title, description, rows, hubspotUrl: data.meta.hubspotUrls.contacts });
  }

  const queue = selectedData ? queueRows(selectedData, queueMode) : [];
  const selectedToday = selectedData ? zonedDay(selectedData.meta.generatedAt, selectedData.meta.timezone) : today;
  const todayCalls = selectedData?.recentActivities.filter((row) => row.type === "Call" && zonedDay(row.metricAt || row.occurredAt, selectedData.meta.timezone) === selectedToday) ?? [];
  const todayConnected = todayCalls.filter((row) => row.status === "Connected");
  const todayMeetings = selectedData?.recentActivities.filter((row) => row.type === "Meeting" && zonedDay(row.occurredAt || row.metricAt, selectedData.meta.timezone) === selectedToday) ?? [];
  const dueToday = selectedData?.recentActivities.filter((row) => row.type === "Task" && row.isOpen && row.dueBucket === "Due today") ?? [];
  const highPriority = selectedData?.recentActivities.filter((row) => row.type === "Task" && row.isOpen && row.isHighPriority) ?? [];

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div>
        <span className={styles.eyebrow}>SDR COMMAND CENTER · TALENTERA + EVALUFY</span>
        <h1>{view === "management" ? "SDR Team Command Center" : `${selected.shortName} Workspace`}</h1>
        <p>{view === "management" ? "Management view across both SDR lanes with live HubSpot execution, activity and workload." : `${selected.product} execution workspace · HubSpot owner ${selected.ownerId}`}</p>
      </div>
      <div className={styles.topActions}>
        <span className={styles.livePill}><i/>LIVE · HUBSPOT</span>
        <button type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""}/>Refresh</button>
      </div>
    </header>

    <section className={styles.controlBar}>
      <div className={styles.viewTabs}>
        <button className={view === "management" ? styles.activeTab : ""} onClick={() => setView("management")}><BarChart3 size={15}/>Management Overview</button>
        {SDRS.map((rep) => <button key={rep.id} className={view === "workspace" && selectedRep === rep.id ? styles.activeTab : ""} onClick={() => openRepWorkspace(rep.id)}><UserRound size={15}/>{rep.shortName} · {rep.product}</button>)}
      </div>
      <div className={styles.rangeControls}>
        <div className={styles.presets}><button onClick={() => applyPreset(1)}>Today</button><button onClick={() => applyPreset(7)}>7D</button><button onClick={() => applyPreset(30)}>30D</button><button onClick={() => applyPreset("month")}>MTD</button></div>
        <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
        <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
        <button className={styles.applyButton} disabled={!from || !to || from > to} onClick={() => setAppliedRange({ from, to })}>Apply</button>
      </div>
    </section>

    {error ? <div className={styles.error}><AlertTriangle size={18}/><div><strong>Could not load the team view</strong><span>{error}</span></div><button onClick={() => void load()}>Retry</button></div> : null}

    {view === "management" ? <>
      <section className={styles.managementHero}>
        <div>
          <span>MANAGEMENT · {dateLabel(appliedRange.from)} – {dateLabel(appliedRange.to)}</span>
          <h2>Two SDR lanes. One operating view.</h2>
          <p>Marita owns Talentera execution. Daniel owns Evalufy execution. HubSpot owner IDs remain the reporting source of truth.</p>
        </div>
        <div className={styles.managementStatus}><ShieldCheck size={18}/><div><strong>{loading ? "Refreshing team data" : "Both owner views loaded"}</strong><span>{management.totals.portfolio} owned contacts in the selected period scope</span></div></div>
      </section>

      <section className={styles.metricGrid}>
        <MetricCard label="Calls" value={formatNumber(management.totals.calls)} helper="Both SDRs" icon={PhoneCall} onClick={snapshots.marita && snapshots.daniel ? () => openActivities(snapshots.marita!, "Team calls", "Calls across Marita and Daniel for the selected period.", [...snapshots.marita!.recentActivities.filter((row) => row.type === "Call"), ...snapshots.daniel!.recentActivities.filter((row) => row.type === "Call")]) : undefined}/>
        <MetricCard label="Connected" value={formatNumber(management.totals.connected)} helper={`${management.connectionRate}% team connection rate`} icon={CheckCircle2}/>
        <MetricCard label="Meetings" value={formatNumber(management.totals.meetings)} helper="Booked in period" icon={CalendarDays}/>
        <MetricCard label="Completed tasks" value={formatNumber(management.totals.completedTasks)} helper="Execution completed" icon={ListTodo}/>
        <MetricCard label="Open tasks" value={formatNumber(management.totals.openTasks)} helper="Current owner workload" icon={Clock3}/>
        <MetricCard label="Due today" value={formatNumber(management.totals.dueToday)} helper="Needs same-day action" icon={AlertTriangle}/>
      </section>

      <section className={styles.repGrid}>
        {SDRS.map((rep) => {
          const data = snapshots[rep.id];
          return <article className={styles.repCard} key={rep.id}>
            <div className={styles.repCardHeader}>
              <span className={styles.repAvatar}>{rep.initials}</span>
              <div><span>{rep.product.toUpperCase()} · {rep.lane}</span><h3>{rep.name}</h3><p>{data?.meta.ownerName && data.meta.ownerName !== rep.name ? `HubSpot: ${data.meta.ownerName}` : `HubSpot owner ${rep.ownerId}`}</p></div>
              <span className={styles.ownerState}><i/>{data ? "Live" : loading ? "Loading" : "Unavailable"}</span>
            </div>
            <div className={styles.repStats}>
              <div><span>Calls</span><strong>{data ? data.kpis.calls : "—"}</strong></div>
              <div><span>Connected</span><strong>{data ? data.kpis.connectedCalls : "—"}</strong></div>
              <div><span>Meetings</span><strong>{data ? data.kpis.bookedMeetings : "—"}</strong></div>
              <div><span>Open tasks</span><strong>{data ? data.kpis.openTasks : "—"}</strong></div>
            </div>
            <div className={styles.repFooter}><span>{metricHelper(data)}</span><button type="button" onClick={() => openRepWorkspace(rep.id)}>Open workspace<ArrowRight size={14}/></button></div>
          </article>;
        })}
      </section>

      <section className={styles.managementGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}><div><span>EXECUTION TREND</span><h2>Calls & connected calls by SDR</h2><p>Same date range, same HubSpot definitions.</p></div><Gauge size={18}/></div>
          {management.daily.length ? <ResponsiveContainer width="100%" height={320}>
            <LineChart data={management.daily} margin={{ left: -12, right: 16, top: 12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 11 }}/>
              <YAxis tick={{ fontSize: 11 }}/>
              <Tooltip/>
              <Legend/>
              <Line type="monotone" dataKey="maritaCalls" name="Marita · Calls" strokeWidth={2.4} dot={false}/>
              <Line type="monotone" dataKey="maritaConnected" name="Marita · Connected" strokeWidth={2} dot={false}/>
              <Line type="monotone" dataKey="danielCalls" name="Daniel · Calls" strokeWidth={2.4} dot={false}/>
              <Line type="monotone" dataKey="danielConnected" name="Daniel · Connected" strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer> : <div className={styles.empty}>No activity trend is available for this period.</div>}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}><div><span>MANAGEMENT ATTENTION</span><h2>Operational alerts</h2><p>Highest-severity owner issues first.</p></div><AlertTriangle size={18}/></div>
          <div className={styles.alertList}>
            {management.alerts.length ? management.alerts.map(({ rep, data, item }) => <button key={`${rep.id}-${item.id}`} className={styles.alertRow} onClick={() => {
              const activities = data.recentActivities.filter((row) => row.type === "Task" && row.isOpen);
              openActivities(data, `${rep.shortName} · ${item.title}`, item.detail, activities);
            }}>
              <span className={item.severity === "critical" ? styles.criticalDot : styles.warningDot}/>
              <div><strong>{rep.shortName} · {item.title}</strong><span>{item.detail}</span></div><b>{item.count}</b>
            </button>) : <div className={styles.empty}>No warning or critical alerts for the selected period.</div>}
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><span>LIVE ACTIVITY FEED</span><h2>Latest SDR activity</h2><p>One combined stream with owner and product context.</p></div><Activity size={18}/></div>
        <div className={styles.teamFeed}>
          {management.recent.map(({ rep, data, row }) => <div className={styles.teamFeedRow} key={`${rep.id}-${row.type}-${row.id}`}>
            <span className={styles.feedOwner}>{rep.initials}</span>
            <div className={styles.feedIdentity}><strong>{rep.shortName}</strong><span>{rep.product}</span></div>
            <span className={styles.feedType}>{row.type}</span>
            <div className={styles.feedSubject}><strong>{row.subject || `${row.type} activity`}</strong><span>{row.relatedContactName || row.detail || "No associated contact"}</span></div>
            <span className={styles.feedStatus}>{row.status || (row.isOpen ? "Open" : "Completed")}</span>
            <span className={styles.feedWhen}>{dateTime(activityTime(row), data.meta.timezone)}</span>
            {row.url ? <a href={row.url} target="_blank" rel="noreferrer"><ExternalLink size={13}/></a> : null}
          </div>)}
          {!management.recent.length ? <div className={styles.empty}>No recent activity in this range.</div> : null}
        </div>
      </section>
    </> : <>
      <section className={styles.workspaceHero}>
        <div className={styles.workspaceIdentity}>
          <span className={styles.workspaceAvatar}>{selected.initials}</span>
          <div><span>{selected.product.toUpperCase()} · {selected.lane}</span><h2>{selected.shortName}&apos;s execution workspace</h2><p>Tasks, leads, calls, meetings and HubSpot actions for owner {selected.ownerId}.</p></div>
        </div>
        <div className={styles.workspaceActions}>
          <button type="button" onClick={() => onOpenAnalytics(selected.ownerId)}><BarChart3 size={15}/>Open deep analytics</button>
          {selectedData?.meta.hubspotUrls.contacts ? <a href={selectedData.meta.hubspotUrls.contacts} target="_blank" rel="noreferrer">Open HubSpot portfolio<ExternalLink size={14}/></a> : null}
        </div>
      </section>

      <section className={styles.metricGrid}>
        <MetricCard label="Tasks due today" value={String(dueToday.length)} helper={`${selectedData?.kpis.openTasks ?? 0} open tasks`} icon={ListTodo} onClick={selectedData ? () => openActivities(selectedData, `${selected.shortName} · Tasks due today`, "Open tasks due today for this SDR owner.", dueToday) : undefined}/>
        <MetricCard label="High priority" value={String(highPriority.length)} helper="Open priority queue" icon={Target} onClick={selectedData ? () => openActivities(selectedData, `${selected.shortName} · High-priority tasks`, "Open tasks marked High priority.", highPriority) : undefined}/>
        <MetricCard label="Calls today" value={String(todayCalls.length)} helper={`${todayConnected.length} connected`} icon={PhoneCall} onClick={selectedData ? () => openActivities(selectedData, `${selected.shortName} · Calls today`, "Calls logged today for this SDR owner.", todayCalls) : undefined}/>
        <MetricCard label="Meetings today" value={String(todayMeetings.length)} helper={`${selectedData?.kpis.bookedMeetings ?? 0} in selected period`} icon={CalendarDays} onClick={selectedData ? () => openActivities(selectedData, `${selected.shortName} · Meetings today`, "Meetings scheduled today for this SDR owner.", todayMeetings) : undefined}/>
        <MetricCard label="Portfolio" value={String(selectedData?.kpis.portfolioContacts ?? 0)} helper={`${selectedData?.kpis.untouchedOver24h ?? 0} untouched >24h`} icon={UsersRound} onClick={selectedData ? () => openContacts(selectedData, `${selected.shortName} · Portfolio`, "Contacts owned by this SDR in the current dashboard scope.", selectedData.priorityContacts) : undefined}/>
        <MetricCard label="Open deals" value={String(selectedData?.kpis.openDeals ?? 0)} helper={`${selectedData?.kpis.dealsCreated ?? 0} created in period`} icon={BriefcaseBusiness}/>
      </section>

      <section className={styles.workspaceGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}><div><span>MY DAY</span><h2>Execution queue</h2><p>Work the highest-value HubSpot records without losing context.</p></div><ListTodo size={18}/></div>
          <div className={styles.queueTabs}>
            <button className={queueMode === "tasks" ? styles.activeQueue : ""} onClick={() => setQueueMode("tasks")}>Tasks <b>{selectedData ? queueRows(selectedData, "tasks").length : 0}</b></button>
            <button className={queueMode === "leads" ? styles.activeQueue : ""} onClick={() => setQueueMode("leads")}>Leads <b>{selectedData ? Math.min(queueRows(selectedData, "leads").length, 99) : 0}</b></button>
            <button className={queueMode === "calls" ? styles.activeQueue : ""} onClick={() => setQueueMode("calls")}>Calls today <b>{todayCalls.length}</b></button>
            <button className={queueMode === "meetings" ? styles.activeQueue : ""} onClick={() => setQueueMode("meetings")}>Meetings <b>{selectedData ? queueRows(selectedData, "meetings").length : 0}</b></button>
          </div>
          <div className={styles.queueList}>
            {queueMode === "leads"
              ? (queue as ContactRow[]).slice(0, 12).map((row) => <ContactRowView key={row.id} row={row}/>)
              : (queue as ActivityRow[]).slice(0, 12).map((row) => <ActivityRowView key={`${row.type}-${row.id}`} row={row} timezone={selectedData?.meta.timezone ?? "Asia/Riyadh"}/>)}
            {!queue.length ? <div className={styles.empty}>No {queueMode} records in the current workspace scope.</div> : null}
          </div>
          {selectedData && queue.length ? <button className={styles.fullList} onClick={() => {
            if (queueMode === "leads") openContacts(selectedData, `${selected.shortName} · Lead queue`, "Current lead execution queue.", queue as ContactRow[]);
            else openActivities(selectedData, `${selected.shortName} · ${queueMode}`, `Current ${queueMode} execution queue.`, queue as ActivityRow[]);
          }}>Open full list <ArrowRight size={14}/></button> : null}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}><div><span>RECENT ACTIVITY</span><h2>{selected.shortName}&apos;s latest actions</h2><p>Newest owner activity across HubSpot.</p></div><Activity size={18}/></div>
          <div className={styles.activityList}>
            {selectedData?.recentActivities.slice().sort((left, right) => activityTimestamp(right) - activityTimestamp(left)).slice(0, 12).map((row) => <ActivityRowView key={`${row.type}-${row.id}`} row={row} timezone={selectedData.meta.timezone}/>) }
            {!selectedData?.recentActivities.length ? <div className={styles.empty}>{loading ? "Loading recent activity…" : "No recent activity found."}</div> : null}
          </div>
        </div>
      </section>
    </>}

    {drilldown ? <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/> : null}
  </main>;
}
