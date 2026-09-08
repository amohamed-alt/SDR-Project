"use client";

import { useCallback, useEffect, useMemo, useState, type LucideIcon } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  ListTodo,
  Mail,
  MessageCircle,
  Phone,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
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
import type { ActivityRow, ContactRow, DashboardData } from "@/lib/types";
import styles from "@/components/SdrTeamCommandCenter.module.css";

export type SdrTeamView = "management" | "daniel";
type QueueMode = "tasks" | "leads" | "calls" | "meetings" | "whatsapp";

type TeamPayload = {
  marita: DashboardData;
  daniel: DashboardData;
  meta: {
    from: string;
    to: string;
    generatedAt: string;
    refreshing: boolean;
    oldestSnapshotAgeSeconds: number;
    cache: { marita: string; daniel: string };
  };
};

type TeamDailyPoint = {
  date: string;
  maritaCalls: number;
  maritaConnected: number;
  maritaWhatsApp: number;
  danielCalls: number;
  danielConnected: number;
  danielWhatsApp: number;
};

type MetricProps = {
  label: string;
  value: string | number;
  helper: string;
  icon: LucideIcon;
  tone: "green" | "blue" | "purple" | "amber" | "slate";
  onClick?: () => void;
};

const MARITA_OWNER_ID = "31644369";
const DANIEL_OWNER_ID = "37624223";
const DEFAULT_START = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
const TODAY = new Date().toISOString().slice(0, 10);
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const teamClientCache = new Map<string, { data: TeamPayload; loadedAt: number }>();
const inflightTeamLoads = new Map<string, Promise<TeamPayload>>();

function cacheKey(from: string, to: string) {
  return `${from}:${to}`;
}

async function requestTeamData(from: string, to: string, forceRefresh = false) {
  const key = cacheKey(from, to);
  const cached = teamClientCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.loadedAt < CLIENT_CACHE_TTL_MS) return cached.data;

  const existing = inflightTeamLoads.get(key);
  if (existing && !forceRefresh) return existing;

  const request = (async () => {
    const params = new URLSearchParams({ from, to });
    if (forceRefresh) params.set("refresh", "1");
    const response = await fetch(`/api/dashboard/team?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json() as TeamPayload & { error?: string; details?: string };
    if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load SDR team data");
    teamClientCache.set(key, { data: payload, loadedAt: Date.now() });
    return payload;
  })().finally(() => inflightTeamLoads.delete(key));

  inflightTeamLoads.set(key, request);
  return request;
}

export function preloadSdrTeamData() {
  return requestTeamData(DEFAULT_START, TODAY).catch(() => undefined);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function dateTime(value: string, timezone: string) {
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
  const value = activityTime(row);
  return value ? new Date(value).getTime() : 0;
}

function whatsappCount(data: DashboardData) {
  return data.dailyActivities.reduce((sum, point) => sum + point.whatsAppMessages, 0);
}

function MetricCard({ label, value, helper, icon: Icon, tone, onClick }: MetricProps) {
  const Component = onClick ? "button" : "div";
  return <Component className={`${styles.metricCard} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`} onClick={onClick}>
    <div className={styles.metricTop}><span>{label}</span><span className={styles.metricIcon}><Icon size={17}/></span></div>
    <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    <small>{helper}{onClick ? <ArrowRight size={12}/> : null}</small>
  </Component>;
}

function ActivityIcon({ type }: { type: ActivityRow["type"] }) {
  if (type === "Call") return <PhoneCall size={15}/>;
  if (type === "Meeting") return <CalendarDays size={15}/>;
  if (type === "Task") return <ListTodo size={15}/>;
  if (type === "WhatsApp") return <MessageCircle size={15}/>;
  if (type === "Email") return <Mail size={15}/>;
  return <Activity size={15}/>;
}

function ActivityLine({ row, timezone, ownerLabel }: { row: ActivityRow; timezone: string; ownerLabel?: string }) {
  return <article className={styles.activityLine}>
    <span className={`${styles.activityBadge} ${styles[`activity${row.type}`]}`}><ActivityIcon type={row.type}/></span>
    <div className={styles.activityCopy}>
      <strong>{row.subject || `${row.type} activity`}</strong>
      <span>{ownerLabel ? `${ownerLabel} · ` : ""}{row.relatedContactName || row.detail || "No associated contact"}</span>
    </div>
    <span className={styles.activityStatus}>{row.status || (row.isOpen ? "Open" : "Completed")}</span>
    <time>{dateTime(activityTime(row), timezone)}</time>
    <div className={styles.quickActions}>
      {row.relatedContactId && row.relatedContactHasPhone ? <WhatsAppQuickAction contactId={row.relatedContactId}/> : null}
      {row.url ? <a href={row.url} target="_blank" rel="noreferrer" aria-label="Open in HubSpot"><ExternalLink size={13}/></a> : null}
    </div>
  </article>;
}

function LeadLine({ row }: { row: ContactRow }) {
  return <article className={styles.leadLine}>
    <span className={styles.leadAvatar}>{row.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
    <div className={styles.leadCopy}>
      <strong>{row.name}</strong>
      <span>{row.title || "No job title"}{row.company ? ` · ${row.company}` : ""}</span>
      <small>{row.lastContacted ? `Last contacted ${shortDate(row.lastContacted)}` : "Not contacted yet"}</small>
    </div>
    <span className={styles.score}>{row.priorityScore}</span>
    <div className={styles.quickActions}>
      {row.phone ? <a href={`tel:${row.phone}`} aria-label={`Call ${row.name}`}><Phone size={13}/></a> : null}
      {row.phone ? <WhatsAppQuickAction contactId={row.id}/> : null}
      {row.email ? <a href={`mailto:${row.email}`} aria-label={`Email ${row.name}`}><Mail size={13}/></a> : null}
      {row.url ? <a href={row.url} target="_blank" rel="noreferrer" aria-label="Open HubSpot contact"><ExternalLink size={13}/></a> : null}
    </div>
  </article>;
}

function queueFor(data: DashboardData, mode: QueueMode) {
  const today = zonedDay(data.meta.generatedAt, data.meta.timezone);
  if (mode === "leads") {
    return data.priorityContacts
      .filter((row) => row.leadStatus.trim().toLowerCase() !== "unqualified")
      .sort((left, right) => {
        const untouched = Number(Boolean(left.lastContacted)) - Number(Boolean(right.lastContacted));
        return untouched || right.priorityScore - left.priorityScore;
      });
  }
  if (mode === "tasks") {
    return data.recentActivities
      .filter((row) => row.type === "Task" && row.isOpen)
      .sort((left, right) => Number(right.isHighPriority) - Number(left.isHighPriority) || activityTimestamp(left) - activityTimestamp(right));
  }
  if (mode === "calls") {
    return data.recentActivities.filter((row) => row.type === "Call" && zonedDay(activityTime(row), data.meta.timezone) === today)
      .sort((left, right) => activityTimestamp(right) - activityTimestamp(left));
  }
  if (mode === "meetings") {
    return data.recentActivities.filter((row) => row.type === "Meeting")
      .sort((left, right) => activityTimestamp(right) - activityTimestamp(left));
  }
  return data.recentActivities.filter((row) => row.type === "WhatsApp")
    .sort((left, right) => activityTimestamp(right) - activityTimestamp(left));
}

export function SdrTeamCommandCenter({
  view,
  onOpenMarita,
}: {
  view: SdrTeamView;
  onOpenMarita: () => void;
}) {
  const initial = teamClientCache.get(cacheKey(DEFAULT_START, TODAY))?.data ?? null;
  const [data, setData] = useState<TeamPayload | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(DEFAULT_START);
  const [to, setTo] = useState(TODAY);
  const [appliedRange, setAppliedRange] = useState({ from: DEFAULT_START, to: TODAY });
  const [queueMode, setQueueMode] = useState<QueueMode>("tasks");
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    const cached = teamClientCache.get(cacheKey(appliedRange.from, appliedRange.to));
    if (cached && !forceRefresh) setData(cached.data);
    setLoading(!cached || forceRefresh);
    setError("");
    try {
      setData(await requestTeamData(appliedRange.from, appliedRange.to, forceRefresh));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load SDR team data");
    } finally {
      setLoading(false);
    }
  }, [appliedRange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (view === "daniel") setQueueMode("tasks");
  }, [view]);

  const management = useMemo(() => {
    if (!data) return null;
    const maritaWhatsApp = whatsappCount(data.marita);
    const danielWhatsApp = whatsappCount(data.daniel);
    const totals = {
      calls: data.marita.kpis.calls + data.daniel.kpis.calls,
      connected: data.marita.kpis.connectedCalls + data.daniel.kpis.connectedCalls,
      meetings: data.marita.kpis.bookedMeetings + data.daniel.kpis.bookedMeetings,
      completedTasks: data.marita.kpis.completedTasks + data.daniel.kpis.completedTasks,
      openTasks: data.marita.kpis.openTasks + data.daniel.kpis.openTasks,
      dueToday: data.marita.kpis.dueToday + data.daniel.kpis.dueToday,
      whatsApp: maritaWhatsApp + danielWhatsApp,
    };
    const connectionRate = totals.calls ? Math.round((totals.connected / totals.calls) * 1000) / 10 : 0;
    const daily = new Map<string, TeamDailyPoint>();
    for (const point of data.marita.dailyActivities) {
      daily.set(point.date, {
        date: point.date,
        maritaCalls: point.calls,
        maritaConnected: point.connected,
        maritaWhatsApp: point.whatsAppMessages,
        danielCalls: 0,
        danielConnected: 0,
        danielWhatsApp: 0,
      });
    }
    for (const point of data.daniel.dailyActivities) {
      const current = daily.get(point.date) ?? {
        date: point.date,
        maritaCalls: 0,
        maritaConnected: 0,
        maritaWhatsApp: 0,
        danielCalls: 0,
        danielConnected: 0,
        danielWhatsApp: 0,
      };
      current.danielCalls = point.calls;
      current.danielConnected = point.connected;
      current.danielWhatsApp = point.whatsAppMessages;
      daily.set(point.date, current);
    }
    const feed = [
      ...data.marita.recentActivities.map((row) => ({ owner: "Marita", product: "Talentera", data: data.marita, row })),
      ...data.daniel.recentActivities.map((row) => ({ owner: "Daniel", product: "Evalufy", data: data.daniel, row })),
    ].sort((left, right) => activityTimestamp(right.row) - activityTimestamp(left.row)).slice(0, 14);
    return {
      totals,
      connectionRate,
      maritaWhatsApp,
      danielWhatsApp,
      daily: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)),
      feed,
    };
  }, [data]);

  const daniel = data?.daniel ?? null;
  const danielToday = daniel ? zonedDay(daniel.meta.generatedAt, daniel.meta.timezone) : TODAY;
  const danielTasks = daniel?.recentActivities.filter((row) => row.type === "Task" && row.isOpen) ?? [];
  const danielDueToday = danielTasks.filter((row) => row.dueBucket === "Due today");
  const danielHighPriority = danielTasks.filter((row) => row.isHighPriority);
  const danielCallsToday = daniel?.recentActivities.filter((row) => row.type === "Call" && zonedDay(activityTime(row), daniel.meta.timezone) === danielToday) ?? [];
  const danielConnectedToday = danielCallsToday.filter((row) => row.status === "Connected");
  const danielMeetingsToday = daniel?.recentActivities.filter((row) => row.type === "Meeting" && zonedDay(activityTime(row), daniel.meta.timezone) === danielToday) ?? [];
  const danielWhatsApp = daniel ? whatsappCount(daniel) : 0;
  const danielQueue = daniel ? queueFor(daniel, queueMode) : [];

  function openActivities(ownerData: DashboardData, title: string, description: string, rows: ActivityRow[]) {
    const type = rows[0]?.type;
    const hubspotUrl = type === "Task"
      ? ownerData.meta.hubspotUrls.tasks
      : type === "Meeting"
        ? ownerData.meta.hubspotUrls.meetings
        : type === "Email"
          ? ownerData.meta.hubspotUrls.emails
          : type === "WhatsApp"
            ? ownerData.meta.hubspotUrls.communications
            : ownerData.meta.hubspotUrls.calls;
    setDrilldown({ kind: "activities", title, description, rows, hubspotUrl });
  }

  function openContacts(ownerData: DashboardData, title: string, description: string, rows: ContactRow[]) {
    setDrilldown({ kind: "contacts", title, description, rows, hubspotUrl: ownerData.meta.hubspotUrls.contacts });
  }

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

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>{view === "management" ? "MANAGEMENT OVERVIEW" : "DANIEL · EVALUFY"}</span>
        <h1>{view === "management" ? "SDR operating view" : "Daniel Workspace"}</h1>
        <p>{view === "management" ? "Marita and Daniel in one live operating layer, while Marita keeps the production dashboard experience unchanged." : "Evalufy execution, activity, queue and follow-up actions using Daniel's HubSpot owner data."}</p>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.liveBadge}><i/>LIVE · HUBSPOT</span>
        <button type="button" onClick={() => void load(true)} disabled={loading}><RefreshCw size={14} className={loading ? styles.spin : ""}/>Refresh</button>
      </div>
    </header>

    <section className={styles.rangeBar}>
      <div className={styles.presets}>
        <button onClick={() => applyPreset(1)}>Today</button>
        <button onClick={() => applyPreset(7)}>7D</button>
        <button onClick={() => applyPreset(30)}>30D</button>
        <button onClick={() => applyPreset("month")}>MTD</button>
      </div>
      <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
      <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
      <button className={styles.applyButton} disabled={!from || !to || from > to} onClick={() => setAppliedRange({ from, to })}>Apply</button>
      <span className={styles.cacheState}><ShieldCheck size={13}/>{data ? `${data.meta.oldestSnapshotAgeSeconds}s snapshot age` : "Loading cached snapshot"}</span>
    </section>

    {error ? <div className={styles.error}><AlertTriangle size={17}/><div><strong>Dashboard data unavailable</strong><span>{error}</span></div><button onClick={() => void load(false)}>Retry</button></div> : null}

    {view === "management" ? <>
      <section className={styles.hero}>
        <div><span><Sparkles size={13}/>SDR COMMAND CENTER</span><h2>Keep the working dashboard. Add the second lane cleanly.</h2><p>Talentera stays with Marita. Evalufy is isolated to Daniel. Management gets one comparison layer without changing either SDR's execution flow.</p></div>
        <div className={styles.heroStatus}><Gauge size={18}/><div><strong>{loading ? "Refreshing snapshots" : "Both SDR lanes ready"}</strong><span>{shortDate(appliedRange.from)} – {shortDate(appliedRange.to)}</span></div></div>
      </section>

      <section className={styles.metricGrid}>
        <MetricCard label="Calls" value={management?.totals.calls ?? 0} helper="Both SDRs" icon={PhoneCall} tone="green"/>
        <MetricCard label="Connected" value={management?.totals.connected ?? 0} helper={`${management?.connectionRate ?? 0}% connection rate`} icon={CheckCircle2} tone="blue"/>
        <MetricCard label="Meetings" value={management?.totals.meetings ?? 0} helper="Booked in period" icon={CalendarDays} tone="purple"/>
        <MetricCard label="WhatsApp" value={management?.totals.whatsApp ?? 0} helper="Logged messages" icon={MessageCircle} tone="green"/>
        <MetricCard label="Completed tasks" value={management?.totals.completedTasks ?? 0} helper="Execution completed" icon={ListTodo} tone="slate"/>
        <MetricCard label="Open tasks" value={management?.totals.openTasks ?? 0} helper={`${management?.totals.dueToday ?? 0} due today`} icon={Clock3} tone="amber"/>
      </section>

      <section className={styles.repGrid}>
        <article className={styles.repCard}>
          <div className={styles.repHeading}><span className={styles.avatar}>MC</span><div><span>TALENTERA · ATS</span><h3>Marita Chedid</h3><p>Production workspace stays exactly where it is.</p></div><span className={styles.repLive}><i/>Live</span></div>
          <div className={styles.repStats}>
            <div><span>Calls</span><strong>{data?.marita.kpis.calls ?? "—"}</strong></div>
            <div><span>Connected</span><strong>{data?.marita.kpis.connectedCalls ?? "—"}</strong></div>
            <div><span>Meetings</span><strong>{data?.marita.kpis.bookedMeetings ?? "—"}</strong></div>
            <div><span>WhatsApp</span><strong>{management?.maritaWhatsApp ?? "—"}</strong></div>
          </div>
          <button className={styles.repAction} type="button" onClick={onOpenMarita}>Open Marita dashboard<ArrowRight size={14}/></button>
        </article>

        <article className={styles.repCard}>
          <div className={styles.repHeading}><span className={`${styles.avatar} ${styles.danielAvatar}`}>DB</span><div><span>EVALUFY · ASSESSMENT</span><h3>Daniel Beaini</h3><p>Separate execution lane using owner {DANIEL_OWNER_ID}.</p></div><span className={styles.repLive}><i/>Live</span></div>
          <div className={styles.repStats}>
            <div><span>Calls</span><strong>{data?.daniel.kpis.calls ?? "—"}</strong></div>
            <div><span>Connected</span><strong>{data?.daniel.kpis.connectedCalls ?? "—"}</strong></div>
            <div><span>Meetings</span><strong>{data?.daniel.kpis.bookedMeetings ?? "—"}</strong></div>
            <div><span>WhatsApp</span><strong>{management?.danielWhatsApp ?? "—"}</strong></div>
          </div>
          <div className={styles.repFootnote}><span><Target size={13}/>Evalufy queue · HubSpot owner {DANIEL_OWNER_ID}</span></div>
        </article>
      </section>

      <section className={styles.managementGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeading}><div><span>EXECUTION TREND</span><h2>Calls, connected calls & WhatsApp</h2><p>Side-by-side owner activity using the same reporting window.</p></div><BarChart3 size={18}/></div>
          {management?.daily.length ? <ResponsiveContainer width="100%" height={320}>
            <LineChart data={management.daily} margin={{ left: -12, right: 14, top: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 11 }}/>
              <YAxis tick={{ fontSize: 11 }}/>
              <Tooltip/>
              <Legend/>
              <Line type="monotone" dataKey="maritaCalls" name="Marita · Calls" stroke="#087a50" strokeWidth={2.4} dot={false}/>
              <Line type="monotone" dataKey="maritaConnected" name="Marita · Connected" stroke="#3a7de0" strokeWidth={2} dot={false}/>
              <Line type="monotone" dataKey="danielCalls" name="Daniel · Calls" stroke="#744bc4" strokeWidth={2.4} dot={false}/>
              <Line type="monotone" dataKey="danielConnected" name="Daniel · Connected" stroke="#d98d25" strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer> : <div className={styles.empty}>No trend data for this period.</div>}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeading}><div><span>OPERATING HEALTH</span><h2>What needs attention</h2><p>Owner-specific execution pressure without mixing the two products.</p></div><AlertTriangle size={18}/></div>
          <div className={styles.healthList}>
            {[{ name: "Marita", product: "Talentera", data: data?.marita }, { name: "Daniel", product: "Evalufy", data: data?.daniel }].map((item) => <div className={styles.healthRow} key={item.name}>
              <span className={styles.healthInitial}>{item.name.slice(0, 1)}</span>
              <div><strong>{item.name} · {item.product}</strong><span>{item.data ? `${item.data.kpis.openTasks} open tasks · ${item.data.kpis.dueToday} due today · ${item.data.kpis.untouchedOver24h} untouched >24h` : "Loading owner data"}</span></div>
              <b>{item.data?.alerts.filter((alert) => alert.severity !== "info").length ?? 0}</b>
            </div>)}
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span>LIVE ACTIVITY</span><h2>Latest activity across both SDRs</h2><p>Calls, tasks, meetings, emails and WhatsApp in one chronological stream.</p></div><Activity size={18}/></div>
        <div className={styles.activityList}>
          {management?.feed.map((item) => <ActivityLine key={`${item.owner}-${item.row.type}-${item.row.id}`} row={item.row} timezone={item.data.meta.timezone} ownerLabel={`${item.owner} · ${item.product}`}/>) }
          {!management?.feed.length ? <div className={styles.empty}>No recent activity in this period.</div> : null}
        </div>
      </section>
    </> : <>
      <section className={styles.danielHero}>
        <div className={styles.danielIdentity}><span className={`${styles.avatar} ${styles.danielAvatar}`}>DB</span><div><span>EVALUFY · DANIEL WORKSPACE</span><h2>Good morning, Daniel</h2><p>Today's tasks, strongest leads, calls, meetings and WhatsApp follow-up — without leaving the dashboard.</p></div></div>
        <div className={styles.ownerChip}><UserRound size={16}/><div><strong>Daniel Beaini</strong><span>HubSpot owner {DANIEL_OWNER_ID}</span></div></div>
      </section>

      <section className={styles.metricGrid}>
        <MetricCard label="Tasks due today" value={danielDueToday.length} helper={`${daniel?.kpis.openTasks ?? 0} open tasks`} icon={ListTodo} tone="green" onClick={daniel ? () => openActivities(daniel, "Daniel · Tasks due today", "Open tasks due today for Daniel.", danielDueToday) : undefined}/>
        <MetricCard label="High priority" value={danielHighPriority.length} helper="Open priority queue" icon={Target} tone="purple" onClick={daniel ? () => openActivities(daniel, "Daniel · High-priority tasks", "Open tasks marked High priority.", danielHighPriority) : undefined}/>
        <MetricCard label="Calls today" value={danielCallsToday.length} helper={`${danielConnectedToday.length} connected`} icon={PhoneCall} tone="blue" onClick={daniel ? () => openActivities(daniel, "Daniel · Calls today", "Calls logged today.", danielCallsToday) : undefined}/>
        <MetricCard label="Meetings today" value={danielMeetingsToday.length} helper={`${daniel?.kpis.bookedMeetings ?? 0} in period`} icon={CalendarDays} tone="amber" onClick={daniel ? () => openActivities(daniel, "Daniel · Meetings today", "Meetings logged today.", danielMeetingsToday) : undefined}/>
        <MetricCard label="WhatsApp" value={danielWhatsApp} helper="Logged in selected period" icon={MessageCircle} tone="green" onClick={daniel ? () => openActivities(daniel, "Daniel · WhatsApp", "WhatsApp activities in the selected period.", daniel.recentActivities.filter((row) => row.type === "WhatsApp")) : undefined}/>
        <MetricCard label="Portfolio" value={daniel?.kpis.portfolioContacts ?? 0} helper={`${daniel?.kpis.untouchedOver24h ?? 0} untouched >24h`} icon={UsersRound} tone="slate" onClick={daniel ? () => openContacts(daniel, "Daniel · Portfolio", "Current Daniel-owned contact portfolio.", daniel.priorityContacts) : undefined}/>
      </section>

      <section className={styles.workspaceGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeading}><div><span>MY DAY</span><h2>Execution queue</h2><p>Everything needed for today's follow-up, including WhatsApp actions.</p></div><ListTodo size={18}/></div>
          <div className={styles.queueTabs}>
            <button className={queueMode === "tasks" ? styles.activeQueue : ""} onClick={() => setQueueMode("tasks")}>Tasks <b>{daniel ? queueFor(daniel, "tasks").length : 0}</b></button>
            <button className={queueMode === "leads" ? styles.activeQueue : ""} onClick={() => setQueueMode("leads")}>Leads <b>{daniel ? Math.min(queueFor(daniel, "leads").length, 99) : 0}</b></button>
            <button className={queueMode === "calls" ? styles.activeQueue : ""} onClick={() => setQueueMode("calls")}>Calls <b>{danielCallsToday.length}</b></button>
            <button className={queueMode === "meetings" ? styles.activeQueue : ""} onClick={() => setQueueMode("meetings")}>Meetings <b>{daniel ? queueFor(daniel, "meetings").length : 0}</b></button>
            <button className={queueMode === "whatsapp" ? styles.activeQueue : ""} onClick={() => setQueueMode("whatsapp")}>WhatsApp <b>{daniel ? queueFor(daniel, "whatsapp").length : 0}</b></button>
          </div>
          <div className={styles.queueList}>
            {queueMode === "leads"
              ? (danielQueue as ContactRow[]).slice(0, 10).map((row) => <LeadLine key={row.id} row={row}/>)
              : (danielQueue as ActivityRow[]).slice(0, 10).map((row) => <ActivityLine key={`${row.type}-${row.id}`} row={row} timezone={daniel?.meta.timezone ?? "Asia/Riyadh"}/>) }
            {!danielQueue.length ? <div className={styles.empty}>No {queueMode} records in the current scope.</div> : null}
          </div>
          {daniel && danielQueue.length ? <button className={styles.viewAll} onClick={() => {
            if (queueMode === "leads") openContacts(daniel, "Daniel · Lead queue", "Current Evalufy lead queue.", danielQueue as ContactRow[]);
            else openActivities(daniel, `Daniel · ${queueMode}`, `Current ${queueMode} queue.`, danielQueue as ActivityRow[]);
          }}>View full list<ArrowRight size={14}/></button> : null}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeading}><div><span>ACTIVITY PULSE</span><h2>Daniel's execution trend</h2><p>Calls, connected calls and WhatsApp activity by day.</p></div><Gauge size={18}/></div>
          {daniel?.dailyActivities.length ? <ResponsiveContainer width="100%" height={300}>
            <LineChart data={daniel.dailyActivities} margin={{ left: -12, right: 14, top: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 11 }}/>
              <YAxis tick={{ fontSize: 11 }}/>
              <Tooltip/>
              <Legend/>
              <Line type="monotone" dataKey="calls" name="Calls" stroke="#087a50" strokeWidth={2.4} dot={false}/>
              <Line type="monotone" dataKey="connected" name="Connected" stroke="#3a7de0" strokeWidth={2.2} dot={false}/>
              <Line type="monotone" dataKey="whatsAppMessages" name="WhatsApp" stroke="#744bc4" strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer> : <div className={styles.empty}>No trend data for this period.</div>}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span>RECENT ACTIVITY</span><h2>Daniel's latest actions</h2><p>Newest HubSpot activity, with direct WhatsApp and record actions when available.</p></div><Activity size={18}/></div>
        <div className={styles.activityList}>
          {daniel?.recentActivities.slice().sort((left, right) => activityTimestamp(right) - activityTimestamp(left)).slice(0, 14).map((row) => <ActivityLine key={`${row.type}-${row.id}`} row={row} timezone={daniel.meta.timezone}/>) }
          {!daniel?.recentActivities.length ? <div className={styles.empty}>{loading ? "Loading cached activity…" : "No recent activity found."}</div> : null}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span>PRIORITY CONTACTS</span><h2>Best next Evalufy conversations</h2><p>Highest-scoring contacts first, with call, WhatsApp, email and HubSpot actions.</p></div><Target size={18}/></div>
        <div className={styles.priorityGrid}>
          {daniel?.priorityContacts.filter((row) => row.leadStatus.trim().toLowerCase() !== "unqualified").slice(0, 8).map((row) => <LeadLine key={row.id} row={row}/>) }
        </div>
      </section>
    </>}

    {drilldown ? <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/> : null}
  </main>;
}

export const SDR_OWNER_IDS = { marita: MARITA_OWNER_ID, daniel: DANIEL_OWNER_ID } as const;
