"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Gauge,
  ListFilter,
  Mail,
  MessageCircle,
  MousePointerClick,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Dashboard as OriginalDashboard } from "./Dashboard";
import { DrilldownDrawer, type Drilldown } from "@/components/DrilldownDrawer";
import styles from "@/components/DashboardMotion.module.css";
import type { ActivityRow, ChartDatum, ContactRow, DashboardData } from "@/lib/types";

type ViewMode = "core" | "motion";
type Motion = "Inbound" | "Outbound" | "Unknown";
type MotionMetrics = {
  contacts: number;
  calls: number;
  connected: number;
  connectionRate: number;
  meetings: number;
  completedTasks: number;
  emails: number;
  whatsApp: number;
  dealContacts: number;
  openDealContacts: number;
};
type MotionDailyDatum = {
  date: string;
  inboundCalls: number;
  outboundCalls: number;
  inboundConnected: number;
  outboundConnected: number;
  inboundActivities: number;
  outboundActivities: number;
};

type MetricButtonProps = {
  label: string;
  value: number | string;
  helper: string;
  onClick: () => void;
};

const defaultStart = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? new Date().toISOString().slice(0, 7) + "-01";
const today = new Date().toISOString().slice(0, 10);
const MARITA_OWNER_ID = "31644369";
const GRID = "#dce7e2";
const TICK = "#667a71";
const INBOUND_COLORS = ["#087a50", "#14956a", "#1aa6a0", "#3a7de0", "#5d9ce8", "#8ab9ee"];
const OUTBOUND_COLORS = ["#744bc4", "#8b64cf", "#a07ed8", "#d98d25", "#e6a84f", "#edbd78"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
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

function displayDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function eachDay(from: string, to: string) {
  const days: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end && days.length < 370) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function contactMotion(row: ContactRow): Motion {
  const contactSource = row.contactSource.trim().toLowerCase();
  const leadSource = row.leadSource.trim().toLowerCase();
  const explicit = `${contactSource} ${leadSource}`;

  if (/inbound|marketing/.test(explicit)) return "Inbound";
  if (/outbound|sales generated|prospecting|sdr/.test(explicit)) return "Outbound";

  const originalSource = row.originalSource.trim().toLowerCase();
  if (!originalSource || originalSource === "unknown") return "Unknown";
  if (originalSource === "offline sources") return "Outbound";
  return "Inbound";
}

function selectedDatum(entry: unknown) {
  const candidate = entry as ChartDatum & { payload?: ChartDatum };
  return candidate.payload ?? candidate;
}

function selectedPoint(entry: unknown) {
  const candidate = entry as MotionDailyDatum & { payload?: MotionDailyDatum };
  return candidate.payload ?? (candidate.date ? candidate : undefined);
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip">
    {label && <strong>{label}</strong>}
    {payload.map((item, index) => <div key={`${item.name ?? "value"}-${index}`}><span style={{ background: item.color }}/>{item.name}: <b>{formatNumber(item.value ?? 0)}</b></div>)}
  </div>;
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className={styles.panel}>
    <div className={styles.panelHeading}>
      <div><h2>{title}</h2><p>{description}</p></div>
      <span className={styles.clickHint}><MousePointerClick size={12}/>Click a value</span>
    </div>
    {children}
  </section>;
}

function MetricButton({ label, value, helper, onClick }: MetricButtonProps) {
  return <button type="button" className={styles.metricButton} onClick={onClick}>
    <span>{label}</span>
    <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    <small>{helper}<ListFilter size={10}/></small>
  </button>;
}

function MotionPanel({
  motion,
  icon: Icon,
  metrics,
  onMetric,
}: {
  motion: "Inbound" | "Outbound";
  icon: LucideIcon;
  metrics: MotionMetrics;
  onMetric: (metric: keyof MotionMetrics) => void;
}) {
  return <section className={styles.motionPanel} data-motion={motion}>
    <div className={styles.motionHeading}>
      <div className={styles.motionIdentity}>
        <span className={styles.motionIcon}><Icon size={18}/></span>
        <div><strong>{motion}</strong><span>{motion === "Inbound" ? "Marketing and online-acquired demand" : "SDR, sales-generated, and offline demand"}</span></div>
      </div>
      <div className={styles.rateBadge}><strong>{metrics.connectionRate}%</strong><span>connection rate</span></div>
    </div>
    <div className={styles.metricGrid}>
      <MetricButton label="Portfolio contacts" value={metrics.contacts} helper="Open contacts" onClick={() => onMetric("contacts")}/>
      <MetricButton label="Calls" value={metrics.calls} helper="Open calls" onClick={() => onMetric("calls")}/>
      <MetricButton label="Connected calls" value={metrics.connected} helper="Open connected" onClick={() => onMetric("connected")}/>
      <MetricButton label="Meetings" value={metrics.meetings} helper="Open meetings" onClick={() => onMetric("meetings")}/>
      <MetricButton label="Completed tasks" value={metrics.completedTasks} helper="Open tasks" onClick={() => onMetric("completedTasks")}/>
      <MetricButton label="Emails sent" value={metrics.emails} helper="Open emails" onClick={() => onMetric("emails")}/>
      <MetricButton label="WhatsApp messages" value={metrics.whatsApp} helper="Open messages" onClick={() => onMetric("whatsApp")}/>
      <MetricButton label="Open-deal contacts" value={metrics.openDealContacts} helper="Open contacts" onClick={() => onMetric("openDealContacts")}/>
    </div>
  </section>;
}

function FunnelPanel({
  motion,
  funnel,
  onSelect,
}: {
  motion: "Inbound" | "Outbound";
  funnel: ChartDatum[];
  onSelect: (stage: string) => void;
}) {
  const colors = motion === "Inbound" ? INBOUND_COLORS : OUTBOUND_COLORS;
  return <section className={styles.funnelPanel} data-motion={motion}>
    <div className={styles.panelHeading}>
      <div><h2>{motion} conversion funnel</h2><p>Portfolio → contacted → connected → meeting → deal → open deal.</p></div>
      <span className={styles.clickHint}><MousePointerClick size={12}/>Click a stage</span>
    </div>
    {funnel.some((item) => item.value > 0)
      ? <ResponsiveContainer width="100%" height={330}>
          <FunnelChart>
            <Tooltip content={<ChartTooltip/>}/>
            <Funnel
              dataKey="value"
              data={funnel}
              isAnimationActive
              cursor="pointer"
              onClick={(entry) => onSelect(selectedDatum(entry).name)}
            >
              <LabelList position="right" fill="#213b30" stroke="none" dataKey="name"/>
              {funnel.map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]}/>) }
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      : <div className={styles.empty}><BarChart3 size={27}/><span>No {motion.toLowerCase()} funnel data for this period</span></div>}
  </section>;
}

export function Dashboard() {
  const [view, setView] = useState<ViewMode>("core");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("view") === "motion") setView("motion");
  }, []);

  function changeView(nextView: ViewMode) {
    setView(nextView);
    const url = new URL(window.location.href);
    if (nextView === "motion") url.searchParams.set("view", "motion");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", url);
  }

  if (view === "motion") return <MotionDashboard onBack={() => changeView("core")}/>;

  return <div className={styles.coreWrapper}>
    <OriginalDashboard/>
    <button type="button" className={styles.motionLauncher} onClick={() => changeView("motion")}>
      <PhoneIncoming size={17}/>Inbound vs Outbound
    </button>
  </div>;
}

function MotionDashboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [from, setFrom] = useState(defaultStart);
  const [to, setTo] = useState(today);
  const [appliedRange, setAppliedRange] = useState({ from: defaultStart, to: today });
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        from: appliedRange.from,
        to: appliedRange.to,
        ownerId: MARITA_OWNER_ID,
      });
      if (refreshKey) query.set("refresh", "1");
      const response = await fetch(`/api/dashboard?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Dashboard request failed");
      setData(payload as DashboardData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load inbound and outbound analytics");
    } finally {
      setLoading(false);
    }
  }, [appliedRange, refreshKey]);

  useEffect(() => { void loadData(); }, [loadData]);

  const model = useMemo(() => {
    if (!data) return null;

    const contactMotionMap = new Map(data.priorityContacts.map((row) => [row.id, contactMotion(row)]));
    const contactsByMotion: Record<Motion, ContactRow[]> = { Inbound: [], Outbound: [], Unknown: [] };
    for (const contact of data.priorityContacts) contactsByMotion[contactMotion(contact)].push(contact);

    const activityMotion = (row: ActivityRow): Motion => {
      if (!row.relatedContactId) return "Unknown";
      return contactMotionMap.get(row.relatedContactId) ?? "Unknown";
    };

    const activitiesByMotion: Record<Motion, ActivityRow[]> = { Inbound: [], Outbound: [], Unknown: [] };
    for (const activity of data.recentActivities) activitiesByMotion[activityMotion(activity)].push(activity);

    const metricsFor = (motion: Motion): MotionMetrics => {
      const contacts = contactsByMotion[motion];
      const activities = activitiesByMotion[motion];
      const calls = activities.filter((row) => row.type === "Call");
      const connected = calls.filter((row) => row.status === "Connected");
      return {
        contacts: contacts.length,
        calls: calls.length,
        connected: connected.length,
        connectionRate: calls.length ? Math.round((connected.length / calls.length) * 1000) / 10 : 0,
        meetings: activities.filter((row) => row.type === "Meeting").length,
        completedTasks: activities.filter((row) => row.type === "Task" && !row.isOpen).length,
        emails: activities.filter((row) => row.type === "Email").length,
        whatsApp: activities.filter((row) => row.type === "WhatsApp").length,
        dealContacts: contacts.filter((row) => row.hasDeal).length,
        openDealContacts: contacts.filter((row) => row.hasOpenDeal).length,
      };
    };

    const funnelFor = (motion: Motion): ChartDatum[] => {
      const contacts = contactsByMotion[motion];
      return [
        { name: "Portfolio", value: contacts.length },
        { name: "Contacted", value: contacts.filter((row) => Boolean(row.lastContacted)).length },
        { name: "Connected", value: contacts.filter((row) => row.hasConnectedCall).length },
        { name: "Meeting", value: contacts.filter((row) => row.hasMeeting).length },
        { name: "Deal", value: contacts.filter((row) => row.hasDeal).length },
        { name: "Open Deal", value: contacts.filter((row) => row.hasOpenDeal).length },
      ];
    };

    const dailyMap = new Map<string, MotionDailyDatum>(eachDay(data.meta.from, data.meta.to).map((date) => [date, {
      date,
      inboundCalls: 0,
      outboundCalls: 0,
      inboundConnected: 0,
      outboundConnected: 0,
      inboundActivities: 0,
      outboundActivities: 0,
    }]));

    for (const activity of data.recentActivities) {
      if (!activity.metricAt) continue;
      if (activity.type === "Task" && activity.isOpen) continue;
      const day = zonedDay(activity.metricAt, data.meta.timezone);
      const point = dailyMap.get(day);
      if (!point) continue;
      const motion = activityMotion(activity);
      if (motion === "Unknown") continue;
      if (motion === "Inbound") point.inboundActivities += 1;
      if (motion === "Outbound") point.outboundActivities += 1;
      if (activity.type === "Call") {
        if (motion === "Inbound") {
          point.inboundCalls += 1;
          if (activity.status === "Connected") point.inboundConnected += 1;
        } else {
          point.outboundCalls += 1;
          if (activity.status === "Connected") point.outboundConnected += 1;
        }
      }
    }

    return {
      contactsByMotion,
      activitiesByMotion,
      activityMotion,
      inboundMetrics: metricsFor("Inbound"),
      outboundMetrics: metricsFor("Outbound"),
      unknownMetrics: metricsFor("Unknown"),
      inboundFunnel: funnelFor("Inbound"),
      outboundFunnel: funnelFor("Outbound"),
      daily: [...dailyMap.values()],
    };
  }, [data]);

  function showContacts(title: string, description: string, rows: ContactRow[]) {
    if (!data) return;
    setDrilldown({ kind: "contacts", title, description, rows, hubspotUrl: data.meta.hubspotUrls.contacts });
  }

  function activityUrl(type: ActivityRow["type"]) {
    if (!data) return "#";
    if (type === "Task") return data.meta.hubspotUrls.tasks;
    if (type === "Meeting") return data.meta.hubspotUrls.meetings;
    if (type === "Email") return data.meta.hubspotUrls.emails;
    if (type === "WhatsApp") return data.meta.hubspotUrls.communications;
    return data.meta.hubspotUrls.calls;
  }

  function showActivities(title: string, description: string, rows: ActivityRow[], type: ActivityRow["type"] = "Call") {
    if (!data) return;
    setDrilldown({ kind: "activities", title, description, rows, hubspotUrl: activityUrl(type) });
  }

  function openMotionMetric(motion: "Inbound" | "Outbound", metric: keyof MotionMetrics) {
    if (!model) return;
    const contacts = model.contactsByMotion[motion];
    const activities = model.activitiesByMotion[motion];
    const prefix = `${motion} · `;

    if (metric === "contacts") return showContacts(`${prefix}portfolio contacts`, `Contacts classified as ${motion.toLowerCase()}.`, contacts);
    if (metric === "calls") return showActivities(`${prefix}calls`, `${motion} calls in the selected period.`, activities.filter((row) => row.type === "Call"), "Call");
    if (metric === "connected") return showActivities(`${prefix}connected calls`, `${motion} calls with the Connected disposition.`, activities.filter((row) => row.type === "Call" && row.status === "Connected"), "Call");
    if (metric === "meetings") return showActivities(`${prefix}meetings`, `${motion} meetings in the selected period.`, activities.filter((row) => row.type === "Meeting"), "Meeting");
    if (metric === "completedTasks") return showActivities(`${prefix}completed tasks`, `${motion} tasks completed in the selected period.`, activities.filter((row) => row.type === "Task" && !row.isOpen), "Task");
    if (metric === "emails") return showActivities(`${prefix}emails`, `${motion} outgoing email activities.`, activities.filter((row) => row.type === "Email"), "Email");
    if (metric === "whatsApp") return showActivities(`${prefix}WhatsApp messages`, `${motion} WhatsApp communications.`, activities.filter((row) => row.type === "WhatsApp"), "WhatsApp");
    if (metric === "dealContacts") return showContacts(`${prefix}deal contacts`, `${motion} contacts associated with a deal.`, contacts.filter((row) => row.hasDeal));
    if (metric === "openDealContacts") return showContacts(`${prefix}open-deal contacts`, `${motion} contacts associated with an open deal.`, contacts.filter((row) => row.hasOpenDeal));
  }

  function funnelContacts(motion: "Inbound" | "Outbound", stage: string) {
    if (!model) return;
    const contacts = model.contactsByMotion[motion].filter((row) =>
      stage === "Portfolio"
      || (stage === "Contacted" && Boolean(row.lastContacted))
      || (stage === "Connected" && row.hasConnectedCall)
      || (stage === "Meeting" && row.hasMeeting)
      || (stage === "Deal" && row.hasDeal)
      || (stage === "Open Deal" && row.hasOpenDeal),
    );
    showContacts(`${motion} funnel · ${stage}`, `${motion} contacts contributing to the ${stage} stage.`, contacts);
  }

  function openDailyCalls(entry: unknown, motion: "Inbound" | "Outbound", connectedOnly: boolean) {
    if (!data || !model) return;
    const point = selectedPoint(entry);
    if (!point) return;
    const rows = model.activitiesByMotion[motion].filter((row) =>
      row.type === "Call"
      && zonedDay(row.metricAt, data.meta.timezone) === point.date
      && (!connectedOnly || row.status === "Connected"),
    );
    showActivities(`${motion} ${connectedOnly ? "connected calls" : "calls"} · ${displayDate(point.date)}`, "Calls behind the selected chart point.", rows, "Call");
  }

  function openDailyActivities(entry: unknown, motion: "Inbound" | "Outbound") {
    if (!data || !model) return;
    const point = selectedPoint(entry);
    if (!point) return;
    const rows = model.activitiesByMotion[motion].filter((row) =>
      row.metricAt
      && zonedDay(row.metricAt, data.meta.timezone) === point.date
      && !(row.type === "Task" && row.isOpen),
    );
    showActivities(`${motion} activities · ${displayDate(point.date)}`, "Calls, meetings, completed tasks, emails, and WhatsApp activities behind the selected bar.", rows);
  }

  const summaryRows = model ? [
    ["Portfolio contacts", model.inboundMetrics.contacts, model.outboundMetrics.contacts, model.unknownMetrics.contacts],
    ["Calls", model.inboundMetrics.calls, model.outboundMetrics.calls, model.unknownMetrics.calls],
    ["Connected calls", model.inboundMetrics.connected, model.outboundMetrics.connected, model.unknownMetrics.connected],
    ["Meetings", model.inboundMetrics.meetings, model.outboundMetrics.meetings, model.unknownMetrics.meetings],
    ["Completed tasks", model.inboundMetrics.completedTasks, model.outboundMetrics.completedTasks, model.unknownMetrics.completedTasks],
    ["Emails sent", model.inboundMetrics.emails, model.outboundMetrics.emails, model.unknownMetrics.emails],
    ["WhatsApp messages", model.inboundMetrics.whatsApp, model.outboundMetrics.whatsApp, model.unknownMetrics.whatsApp],
    ["Open-deal contacts", model.inboundMetrics.openDealContacts, model.outboundMetrics.openDealContacts, model.unknownMetrics.openDealContacts],
  ] as const : [];

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.titleGroup}>
        <button type="button" className={styles.backButton} onClick={onBack}><ArrowLeft size={15}/>Analytics Dashboard</button>
        <div className={styles.titleText}><strong>Inbound vs Outbound Performance</strong><span>Live HubSpot activity attribution for Marita</span></div>
      </div>
      <div className={styles.topActions}>
        <label className={styles.dateField}><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
        <label className={styles.dateField}><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
        <button type="button" className={styles.backButton} onClick={() => setAppliedRange({ from, to })}>Apply range</button>
        <button type="button" className={styles.refreshButton} disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={14} className={loading ? styles.spin : ""}/>Refresh data</button>
      </div>
    </header>

    <div className={styles.content}>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <span className={styles.eyebrow}><Gauge size={14}/>GTM MOTION INTELLIGENCE</span>
          <h1>See inbound and outbound as two separate revenue engines.</h1>
          <p>Connected calls, daily execution, activities, and conversion funnels are separated by acquisition motion so performance differences are immediately visible.</p>
        </div>
        <aside className={styles.ruleCard}>
          <span>CLASSIFICATION LOGIC</span>
          <h2>How the dashboard separates motions</h2>
          <div className={styles.ruleList}>
            <div><b>1</b><span><strong>Contact Source</strong> is the primary truth: Inbound Marketing vs SDR Outbound / Sales Generated.</span></div>
            <div><b>2</b><span>When Contact Source is missing, online Original Traffic Sources are treated as inbound and Offline Sources as outbound.</span></div>
            <div><b>3</b><span>Unclassified contacts and activities remain visible under Unknown and are never silently dropped.</span></div>
          </div>
        </aside>
      </section>

      {error && <div className={styles.errorBanner}><AlertTriangle size={16}/>{error}</div>}
      {data?.meta.warnings.length ? <div className={styles.warningBanner}><AlertTriangle size={16}/>{data.meta.warnings.join(" · ")}</div> : null}

      {loading && !data && <div className={styles.loadingOverlay}><div className={styles.loader}/><strong>Building inbound and outbound intelligence…</strong><span>Classifying contacts and associated HubSpot activities</span></div>}

      {data && model && <>
        <div className={styles.motionGrid}>
          <MotionPanel motion="Inbound" icon={PhoneIncoming} metrics={model.inboundMetrics} onMetric={(metric) => openMotionMetric("Inbound", metric)}/>
          <MotionPanel motion="Outbound" icon={PhoneOutgoing} metrics={model.outboundMetrics} onMetric={(metric) => openMotionMetric("Outbound", metric)}/>
        </div>

        <div className={styles.sectionGrid}>
          <Panel title="Daily calls and connected calls" description="Four separate lines make inbound and outbound call performance easy to compare.">
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={model.daily} margin={{ left: -10, right: 12, top: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fill: TICK, fontSize: 10 }} axisLine={false}/>
                <YAxis tick={{ fill: TICK, fontSize: 10 }} axisLine={false}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Legend/>
                <Line type="monotone" dataKey="inboundCalls" name="Inbound calls" stroke="#087a50" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Inbound", false)}/>
                <Line type="monotone" dataKey="inboundConnected" name="Inbound connected" stroke="#1aa6a0" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Inbound", true)}/>
                <Line type="monotone" dataKey="outboundCalls" name="Outbound calls" stroke="#744bc4" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Outbound", false)}/>
                <Line type="monotone" dataKey="outboundConnected" name="Outbound connected" stroke="#e85d4a" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Outbound", true)}/>
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Motion data quality</h2><p>Records that could not be confidently classified.</p></div></div>
            <div className={styles.unknownGrid}>
              <button type="button" className={styles.unknownCard} onClick={() => showContacts("Unknown-motion contacts", "Contacts with no reliable inbound or outbound classification.", model.contactsByMotion.Unknown)}><span><UsersRound size={12}/>Unknown contacts</span><strong>{model.unknownMetrics.contacts}</strong><small>Review Contact Source</small></button>
              <button type="button" className={styles.unknownCard} onClick={() => showActivities("Unknown-motion activities", "Activities with no associated classified contact.", model.activitiesByMotion.Unknown)}><span><AlertTriangle size={12}/>Unknown activities</span><strong>{model.activitiesByMotion.Unknown.length}</strong><small>Review associations</small></button>
            </div>
            <div className={styles.coverageNote}><strong>{data.kpis.portfolioContacts ? Math.round(((model.inboundMetrics.contacts + model.outboundMetrics.contacts) / data.kpis.portfolioContacts) * 1000) / 10 : 0}% classification coverage.</strong> Click either card to clean the records that remain outside inbound and outbound reporting.</div>
          </section>
        </div>

        <div className={styles.funnelGrid}>
          <FunnelPanel motion="Inbound" funnel={model.inboundFunnel} onSelect={(stage) => funnelContacts("Inbound", stage)}/>
          <FunnelPanel motion="Outbound" funnel={model.outboundFunnel} onSelect={(stage) => funnelContacts("Outbound", stage)}/>
        </div>

        <div className={styles.comparisonGrid}>
          <Panel title="Daily total execution by motion" description="Calls, meetings, completed tasks, emails, and WhatsApp activities combined.">
            <ResponsiveContainer width="100%" height={330}>
              <BarChart data={model.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fill: TICK, fontSize: 10 }}/>
                <YAxis tick={{ fill: TICK, fontSize: 10 }}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Legend/>
                <Bar dataKey="inboundActivities" name="Inbound activities" stackId="activities" fill="#087a50" radius={[5, 5, 0, 0]} cursor="pointer" onClick={(entry) => openDailyActivities(entry, "Inbound")}/>
                <Bar dataKey="outboundActivities" name="Outbound activities" stackId="activities" fill="#744bc4" radius={[5, 5, 0, 0]} cursor="pointer" onClick={(entry) => openDailyActivities(entry, "Outbound")}/>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Inbound vs outbound summary</h2><p>Every key execution metric in one comparison table.</p></div></div>
            <table className={styles.summaryTable}>
              <thead><tr><th>Metric</th><th>Inbound</th><th>Outbound</th><th>Unknown</th></tr></thead>
              <tbody>{summaryRows.map(([label, inbound, outbound, unknown]) => <tr key={label}><td><strong>{label}</strong></td><td>{formatNumber(inbound)}</td><td>{formatNumber(outbound)}</td><td>{formatNumber(unknown)}</td></tr>)}</tbody>
            </table>
          </section>
        </div>
      </>}
    </div>

    {drilldown && <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/>} 
  </main>;
}
