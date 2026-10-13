"use client";

import { SDR_OWNERS, type SdrKey } from "@/lib/sdr-owners";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Gauge,
  ListFilter,
  MousePointerClick,
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
import { DrilldownDrawer, type Drilldown } from "@/components/DrilldownDrawer";
import styles from "@/components/DashboardMotion.module.css";
import type { ActivityRow, ChartDatum } from "@/lib/types";
import type { Motion, MotionMetrics, MotionDailyDatum, MotionDashboardData } from "@/lib/dashboard-motion";
import type { RecordSelection } from "@/lib/dashboard-records";

type MetricButtonProps = {
  label: string;
  value: number | string;
  helper: string;
  onClick: () => void;
};

const defaultStart = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? new Date().toISOString().slice(0, 7) + "-01";
const today = new Date().toISOString().slice(0, 10);
const MAX_REFRESH_WAIT_MS = 90_000;

const GRID = "#dce7e2";
const TICK = "#667a71";
const INBOUND_COLORS = ["var(--green)", "var(--brand-bright, #14956a)", "var(--teal)", "var(--blue)", "var(--chart-light, #5d9ce8)", "var(--chart-pale, #8ab9ee)"];
const OUTBOUND_COLORS = ["#744bc4", "#8b64cf", "#a07ed8", "#d98d25", "#e6a84f", "#edbd78"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function displayDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
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

export function MotionDashboard({ onBack, sdr, initialSearch = "" }: { onBack: () => void; sdr: SdrKey; initialSearch?: string }) {
  const initial = new URLSearchParams(initialSearch);
  const [data, setData] = useState<MotionDashboardData | null>(null);
  const [from, setFrom] = useState(initial.get("from") || defaultStart);
  const [to, setTo] = useState(initial.get("to") || today);
  const [appliedRange, setAppliedRange] = useState({ from: initial.get("from") || defaultStart, to: initial.get("to") || today });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const refreshStartedAtRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async (forceRefresh = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (forceRefresh) {
      refreshStartedAtRef.current = Date.now();
      setRefreshing(true);
    }
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        from: appliedRange.from,
        to: appliedRange.to,
        ownerId: SDR_OWNERS[sdr].ownerId,
        profile: "motion",
      });
      if (forceRefresh) query.set("refresh", "1");
      const response = await fetch(`/api/dashboard?${query.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
      });
      const payload = await response.json();
      if (controller.signal.aborted || requestRef.current !== controller) return;
      if (!response.ok) throw new Error(payload.details || payload.error || "Dashboard request failed");
      const nextData = payload as MotionDashboardData;
      if (nextData.meta.ownerId !== SDR_OWNERS[sdr].ownerId) throw new Error("Dashboard returned data for a different SDR owner");
      setData(nextData);
      const serverRefreshing = response.headers.get("X-Dashboard-Refreshing") === "1";
      if (serverRefreshing && !refreshStartedAtRef.current) refreshStartedAtRef.current = Date.now();
      const timedOut = serverRefreshing && Date.now() - refreshStartedAtRef.current >= MAX_REFRESH_WAIT_MS;
      setRefreshing(serverRefreshing && !timedOut);
      if (timedOut) setError("The live refresh is taking longer than expected. The last complete snapshot remains visible; you can retry.");
    } catch (requestError) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setError(requestError instanceof Error ? requestError.message : "Unable to load inbound and outbound analytics");
      setRefreshing(false);
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) setLoading(false);
    }
  }, [appliedRange, sdr, setData]);

  useEffect(() => {
    refreshStartedAtRef.current = 0;
    void loadData(false);
    return () => requestRef.current?.abort();
  }, [loadData]);

  useEffect(() => {
    if (!refreshing || loading) return;
    const timer = window.setTimeout(() => void loadData(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [loadData, loading, refreshing]);

  const model = data?.motion;

  function showRecords(title: string, description: string, selection: RecordSelection, type: ActivityRow["type"] = "Call") {
    if (!data) return;
    const source = { filters: { from: data.meta.from, to: data.meta.to, ownerId: data.meta.ownerId }, version: data.meta.generatedAt, selection };
    const url = type === "Task" ? data.meta.hubspotUrls.tasks : type === "Meeting" ? data.meta.hubspotUrls.meetings : type === "Email" ? data.meta.hubspotUrls.emails : type === "WhatsApp" ? data.meta.hubspotUrls.communications : data.meta.hubspotUrls.calls;
    if (selection.kind === "contacts") setDrilldown({ kind: "contacts", title, description, rows: [], source, hubspotUrl: data.meta.hubspotUrls.contacts });
    else setDrilldown({ kind: "activities", title, description, rows: [], source, hubspotUrl: url });
  }

  function openMotionMetric(motion: Motion, metric: keyof MotionMetrics) {
    const prefix = `${motion} · `;
    if (metric === "contacts" || metric === "dealContacts" || metric === "openDealContacts") {
      const funnel = metric === "dealContacts" ? "Deal" : metric === "openDealContacts" ? "Open Deal" : "Portfolio";
      return showRecords(`${prefix}${funnel.toLowerCase()} contacts`, `${motion} contacts in the complete current portfolio.`, { kind: "contacts", motion, funnel });
    }
    const type: ActivityRow["type"] = metric === "meetings" ? "Meeting" : metric === "completedTasks" ? "Task" : metric === "emails" ? "Email" : metric === "whatsApp" ? "WhatsApp" : "Call";
    showRecords(`${prefix}${metric === "connected" ? "connected calls" : type + " activities"}`, `${motion} execution in the selected reporting period.`, { kind: "activities", motion, where: [{ field: "type", value: type }, ...(metric === "connected" ? [{ field: "status", value: "Connected" }] : [])] }, type);
  }

  function funnelContacts(motion: Motion, stage: string) {
    showRecords(`${motion} funnel · ${stage}`, `${motion} contacts contributing to the ${stage} stage.`, { kind: "contacts", motion, funnel: stage });
  }

  function openDailyCalls(entry: unknown, motion: Motion, connectedOnly: boolean) {
    const point = selectedPoint(entry);
    if (!point) return;
    showRecords(`${motion} ${connectedOnly ? "connected calls" : "calls"} · ${displayDate(point.date)}`, "Calls behind the selected chart point.", { kind: "activities", motion, day: point.date, where: [{ field: "type", value: "Call" }, ...(connectedOnly ? [{ field: "status", value: "Connected" }] : [])] });
  }

  function openDailyActivities(entry: unknown, motion: Motion) {
    const point = selectedPoint(entry);
    if (!point) return;
    showRecords(`${motion} activities · ${displayDate(point.date)}`, "Period calls, booked meetings, completed tasks, emails, and WhatsApp activities.", { kind: "activities", motion, day: point.date });
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
        <div className={styles.titleText}><strong>Inbound vs Outbound Performance</strong><span>HubSpot activity attribution for {SDR_OWNERS[sdr].shortName}</span></div>
      </div>
      <div className={styles.topActions}>
        <label className={styles.dateField}><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
        <label className={styles.dateField}><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
        <button type="button" className={styles.backButton} onClick={() => setAppliedRange({ from, to })}>Apply range</button>
        <button type="button" className={styles.refreshButton} disabled={loading || refreshing} onClick={() => void loadData(true)}><RefreshCw size={14} className={loading || refreshing ? styles.spin : ""}/>{loading || refreshing ? "Refreshing…" : "Refresh data"}</button>
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
                <Line type="monotone" dataKey="inboundCalls" name="Inbound calls" stroke="var(--green)" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Inbound", false)}/>
                <Line type="monotone" dataKey="inboundConnected" name="Inbound connected" stroke="var(--teal)" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Inbound", true)}/>
                <Line type="monotone" dataKey="outboundCalls" name="Outbound calls" stroke="#744bc4" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Outbound", false)}/>
                <Line type="monotone" dataKey="outboundConnected" name="Outbound connected" stroke="#e85d4a" strokeWidth={2.4} dot={false} cursor="pointer" onClick={(entry) => openDailyCalls(entry, "Outbound", true)}/>
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Motion data quality</h2><p>Records that could not be confidently classified.</p></div></div>
            <div className={styles.unknownGrid}>
              <button type="button" className={styles.unknownCard} onClick={() => showRecords("Unknown-motion contacts", "Contacts with no reliable inbound or outbound classification.", { kind: "contacts", motion: "Unknown" })}><span><UsersRound size={12}/>Unknown contacts</span><strong>{model.unknownMetrics.contacts}</strong><small>Review Contact Source</small></button>
              <button type="button" className={styles.unknownCard} onClick={() => showRecords("Unknown-motion activities", "Execution in the selected period with no classified contact or tracker motion.", { kind: "activities", motion: "Unknown" })}><span><AlertTriangle size={12}/>Unknown period activities</span><strong>{model.unknownActivities}</strong><small>Review associations</small></button>
            </div>
            <div className={styles.coverageNote}><strong>{model.classificationCoverage === null ? "N/A" : `${model.classificationCoverage}%`} classification coverage.</strong> Click either card to clean the records that remain outside inbound and outbound reporting.</div>
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
                <Bar dataKey="inboundActivities" name="Inbound activities" stackId="activities" fill="var(--green)" radius={[5, 5, 0, 0]} cursor="pointer" onClick={(entry) => openDailyActivities(entry, "Inbound")}/>
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

    <AnimatePresence>
      {drilldown && <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/>}
    </AnimatePresence>
  </main>;
}
