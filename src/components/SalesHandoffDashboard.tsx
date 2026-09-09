"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "@/components/SalesHandoffDashboard.module.css";

type FollowUpStatus = "Within 24h" | "24–48h" | "48h+" | "No follow-up";
type AttentionLevel = "critical" | "warning" | "ok";
type FollowUpType = "Call" | "Email" | "WhatsApp" | "Meeting";

type HandoffDeal = {
  id: string;
  name: string;
  stage: string;
  owner: string;
  amount: number;
  createdAt: string;
  closeDate: string;
  nextActivity: string;
  isOpen: boolean;
  isClosedWon: boolean;
  url: string;
};

type HandoffRow = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  meetingEnd: string;
  outcome: string;
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    url: string;
  }>;
  company: {
    id: string;
    name: string;
    domain: string;
    url: string;
  } | null;
  followUp: {
    status: FollowUpStatus;
    hours: number | null;
    type: FollowUpType | null;
    at: string;
    detail: string;
  };
  lastSalesActivity: string;
  nextActivity: string;
  deal: HandoffDeal | null;
  dealCreatedAfterMeeting: boolean;
  attention: {
    level: AttentionLevel;
    reason: string;
  };
  recordUrl: string;
};

type HandoffPayload = {
  meta: {
    generatedAt: string;
    from: string;
    to: string;
    timezone: string;
    sdr: { id: string; name: string };
    salesRep: { id: string; name: string };
    salesReps: Array<{ id: string; name: string }>;
    followUpDays: number;
    cache: "hit" | "miss";
  };
  kpis: {
    meetings: number;
    completed: number;
    followedUp: number;
    followUpRate: number;
    deals: number;
    openDeals: number;
    closedWon: number;
    pipelineValue: number;
    needsAttention: number;
  };
  rows: HandoffRow[];
};

type ClientFilters = {
  outcome: string;
  followUp: string;
  dealStage: string;
  attention: string;
  search: string;
};

const DEFAULT_SALES_REP_ID = "76369997";
const COLORS = ["#087a50", "#3d7fd6", "#8b5fc7", "#d99b28", "#d85845", "#4b9e91"];
const EMPTY_FILTERS: ClientFilters = { outcome: "", followUp: "", dealStage: "", attention: "", search: "" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function pretty(raw: string) {
  if (!raw) return "Unknown";
  return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(raw: string) {
  if (!raw) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(raw));
}

function shortDate(raw: string) {
  if (!raw) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(raw));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusClass(status: FollowUpStatus) {
  if (status === "Within 24h") return styles.good;
  if (status === "No follow-up") return styles.critical;
  return styles.warning;
}

function attentionClass(level: AttentionLevel) {
  if (level === "critical") return styles.critical;
  if (level === "warning") return styles.warning;
  return styles.good;
}

export function SalesHandoffDashboard({ onBack }: { onBack: () => void }) {
  const initial = { from: monthStart(), to: today(), salesRepId: DEFAULT_SALES_REP_ID };
  const [draft, setDraft] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [filters, setFilters] = useState<ClientFilters>(EMPTY_FILTERS);
  const [data, setData] = useState<HandoffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const load = useCallback(async (force = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(applied);
      if (force) query.set("refresh", "1");
      const response = await fetch(`/api/dashboard/sales-handoff?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json() as HandoffPayload & { error?: string; details?: string };
      if (!response.ok) throw new Error(payload.error || payload.details || "Unable to load Sales Handoff");
      if (sequence !== requestSequence.current) return;
      setData(payload);
    } catch (loadError) {
      if (sequence !== requestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load Sales Handoff");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(false), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const options = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      outcomes: [...new Set(rows.map((row) => row.outcome).filter(Boolean))].sort(),
      followUps: [...new Set(rows.map((row) => row.followUp.status))].sort(),
      dealStages: [...new Set(rows.map((row) => row.deal?.stage).filter((value): value is string => Boolean(value)))].sort(),
    };
  }, [data]);

  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      if (filters.outcome && row.outcome !== filters.outcome) return false;
      if (filters.followUp && row.followUp.status !== filters.followUp) return false;
      if (filters.dealStage && row.deal?.stage !== filters.dealStage) return false;
      if (filters.attention === "needs" && row.attention.level === "ok") return false;
      if (filters.attention === "critical" && row.attention.level !== "critical") return false;
      if (search) {
        const haystack = [
          row.company?.name,
          row.company?.domain,
          row.meetingTitle,
          row.deal?.name,
          ...row.contacts.flatMap((contact) => [contact.name, contact.email, contact.phone]),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [data, filters]);

  const computed = useMemo(() => {
    const uniqueDeals = [...new Map(
      filteredRows.flatMap((row) => row.deal ? [[row.deal.id, row.deal] as const] : []),
    ).values()];
    const followedUp = filteredRows.filter((row) => row.followUp.status !== "No follow-up").length;
    return {
      meetings: filteredRows.length,
      completed: filteredRows.filter((row) => row.outcome === "COMPLETED").length,
      followedUp,
      followUpRate: filteredRows.length ? Math.round((followedUp / filteredRows.length) * 1000) / 10 : 0,
      deals: uniqueDeals.length,
      openDeals: uniqueDeals.filter((deal) => deal.isOpen).length,
      closedWon: uniqueDeals.filter((deal) => deal.isClosedWon).length,
      pipelineValue: uniqueDeals.filter((deal) => deal.isOpen).reduce((sum, deal) => sum + deal.amount, 0),
      needsAttention: filteredRows.filter((row) => row.attention.level !== "ok").length,
    };
  }, [filteredRows]);

  const funnel = useMemo(() => [
    { name: "Meetings booked", value: computed.meetings },
    { name: "Completed", value: computed.completed },
    { name: "Sales follow-up", value: computed.followedUp },
    { name: "Associated deal", value: filteredRows.filter((row) => Boolean(row.deal)).length },
    { name: "Open deal", value: filteredRows.filter((row) => row.deal?.isOpen).length },
    { name: "Closed won", value: filteredRows.filter((row) => row.deal?.isClosedWon).length },
  ], [computed, filteredRows]);

  const sla = useMemo(() => {
    const order: FollowUpStatus[] = ["Within 24h", "24–48h", "48h+", "No follow-up"];
    return order.map((name) => ({
      name,
      value: filteredRows.filter((row) => row.followUp.status === name).length,
    })).filter((item) => item.value > 0);
  }, [filteredRows]);

  const dealStages = useMemo(() => {
    const uniqueDeals = [...new Map(
      filteredRows.flatMap((row) => row.deal ? [[row.deal.id, row.deal] as const] : []),
    ).values()];
    const counts = new Map<string, number>();
    for (const deal of uniqueDeals) counts.set(deal.stage || "Unknown", (counts.get(deal.stage || "Unknown") ?? 0) + 1);
    return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredRows]);

  const trend = useMemo(() => {
    const byDay = new Map<string, { date: string; meetings: number; followedUp: number; deals: number }>();
    for (const row of filteredRows) {
      const date = row.meetingDate.slice(0, 10);
      const item = byDay.get(date) ?? { date, meetings: 0, followedUp: 0, deals: 0 };
      item.meetings += 1;
      if (row.followUp.status !== "No follow-up") item.followedUp += 1;
      if (row.deal) item.deals += 1;
      byDay.set(date, item);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRows]);

  const metrics = [
    { label: "Marita meetings", value: formatNumber(computed.meetings), helper: `${computed.completed} completed`, icon: CalendarDays },
    { label: "Sales follow-up", value: `${computed.followUpRate}%`, helper: `${computed.followedUp} meetings followed up`, icon: Activity },
    { label: "Associated deals", value: formatNumber(computed.deals), helper: `${computed.openDeals} currently open`, icon: BriefcaseBusiness },
    { label: "Open pipeline", value: formatCurrency(computed.pipelineValue), helper: "Unique open deals", icon: CircleDollarSign },
    { label: "Closed won", value: formatNumber(computed.closedWon), helper: "Unique won deals", icon: CheckCircle2 },
    { label: "Needs attention", value: formatNumber(computed.needsAttention), helper: "Follow-up / stale deal risks", icon: AlertTriangle, critical: computed.needsAttention > 0 },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back to SDR dashboard"><ArrowLeft size={18}/></button>
          <div>
            <span className={styles.eyebrow}>MARITA → SALES · POST-MEETING INTELLIGENCE</span>
            <h1>Sales Handoff</h1>
            <p>Track what happens after Marita books a meeting: Sales follow-up speed, deal creation, stage movement, pipeline and accounts that need action.</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.health}><i/>{data ? `${data.meta.salesRep.name} · live HubSpot` : "HubSpot"}</span>
          {data ? <span className={styles.cacheBadge}>{data.meta.cache === "hit" ? "Fast cache" : "Fresh build"} · {shortDate(data.meta.generatedAt)}</span> : null}
          <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spinning : ""}/>{loading ? "Updating" : "Refresh"}</button>
        </div>
      </header>

      <section className={styles.filters}>
        <label className={styles.field}><span>From</span><input type="date" max={draft.to} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })}/></label>
        <label className={styles.field}><span>To</span><input type="date" min={draft.from} max={today()} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })}/></label>
        <label className={`${styles.field} ${styles.fieldWide}`}><span>Sales Rep</span><select value={draft.salesRepId} onChange={(event) => setDraft({ ...draft, salesRepId: event.target.value })}>{(data?.meta.salesReps ?? [{ id: DEFAULT_SALES_REP_ID, name: "Ursula Waked · Orsla 1" }]).map((rep) => <option key={rep.id} value={rep.id}>{rep.id === DEFAULT_SALES_REP_ID ? `Orsla 1 · ${rep.name}` : rep.name}</option>)}</select></label>
        <label className={styles.field}><span>Meeting outcome</span><select value={filters.outcome} onChange={(event) => setFilters({ ...filters, outcome: event.target.value })}><option value="">All</option>{options.outcomes.map((item) => <option key={item} value={item}>{pretty(item)}</option>)}</select></label>
        <label className={styles.field}><span>Follow-up SLA</span><select value={filters.followUp} onChange={(event) => setFilters({ ...filters, followUp: event.target.value })}><option value="">All</option>{options.followUps.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className={styles.field}><span>Deal stage</span><select value={filters.dealStage} onChange={(event) => setFilters({ ...filters, dealStage: event.target.value })}><option value="">All</option>{options.dealStages.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className={styles.field}><span>Attention</span><select value={filters.attention} onChange={(event) => setFilters({ ...filters, attention: event.target.value })}><option value="">All</option><option value="needs">Needs attention</option><option value="critical">Critical only</option></select></label>
        <label className={`${styles.field} ${styles.fieldWide}`}><span>Search company / contact</span><input type="search" placeholder="Company, contact, deal..." value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })}/></label>
        <div className={styles.filterActions}><button type="button" className={styles.reset} onClick={() => setFilters(EMPTY_FILTERS)}>Clear view filters</button><button type="button" className={styles.apply} onClick={() => setApplied({ ...draft })}><Search size={14}/> Apply dates</button></div>
      </section>

      {error ? <div className={styles.error}><AlertTriangle size={18}/><div><strong>Sales Handoff could not load</strong><div>{error}</div></div></div> : null}

      {loading && !data ? <div className={styles.loading}><RefreshCw size={24} className={styles.spinning}/><strong>Loading post-meeting intelligence…</strong><span>The main SDR dashboard stays untouched while this view loads independently.</span></div> : null}

      {data ? <>
        <section className={styles.metrics}>
          {metrics.map(({ label, value, helper, icon: Icon, critical }) => <article className={`${styles.metric} ${critical ? styles.metricCritical : ""}`} key={label}><div className={styles.metricTop}><span>{label}</span><span className={styles.metricIcon}><Icon size={16}/></span></div><strong>{value}</strong><small>{helper}</small></article>)}
        </section>

        <div className={styles.charts}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span>HANDOFF FUNNEL</span><h2>Meeting → follow-up → deal</h2></div><small>{computed.meetings} meetings</small></div>
            <ResponsiveContainer width="100%" height={300}><BarChart data={funnel} layout="vertical" margin={{ left: 18, right: 18 }}><CartesianGrid horizontal={false} stroke="#e5ece8"/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }}/><Tooltip/><Bar dataKey="value" name="Records" fill="#087a50" radius={[0, 6, 6, 0]}/></BarChart></ResponsiveContainer>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span>FOLLOW-UP SLA</span><h2>How fast Sales moved</h2></div><small>{computed.followUpRate}% coverage</small></div>
            {sla.length ? <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={sla} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={3}>{sla.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer> : <div className={styles.empty}>No SLA data for these filters.</div>}
            <div className={styles.legend}>{sla.map((item, index) => <span key={item.name}><i style={{ background: COLORS[index % COLORS.length] }}/>{item.name}: <strong>{item.value}</strong></span>)}</div>
          </section>
        </div>

        <div className={`${styles.charts} ${styles.chartsSecond}`}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span>DEAL HEALTH</span><h2>Current deal stages</h2></div><small>{computed.deals} unique deals</small></div>
            {dealStages.length ? <ResponsiveContainer width="100%" height={280}><BarChart data={dealStages}><CartesianGrid vertical={false} stroke="#e5ece8"/><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} height={54}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="value" name="Deals" fill="#8b5fc7" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer> : <div className={styles.empty}>No associated deals for these filters.</div>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span>TREND</span><h2>Meetings vs follow-up vs deals</h2></div><small>{data.meta.from} → {data.meta.to}</small></div>
            {trend.length ? <ResponsiveContainer width="100%" height={280}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke="#e5ece8"/><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 10 }}/><YAxis allowDecimals={false}/><Tooltip/><Legend/><Line type="monotone" dataKey="meetings" name="Meetings" stroke="#087a50" strokeWidth={2}/><Line type="monotone" dataKey="followedUp" name="Follow-up" stroke="#3d7fd6" strokeWidth={2}/><Line type="monotone" dataKey="deals" name="Deals" stroke="#8b5fc7" strokeWidth={2}/></LineChart></ResponsiveContainer> : <div className={styles.empty}>No trend data for these filters.</div>}
          </section>
        </div>

        <section className={`${styles.panel} ${styles.tablePanel}`}>
          <div className={styles.tableToolbar}><div><h2>Post-meeting detail</h2><p>Every row is a Marita-booked meeting for the selected Sales Rep. Follow-up is measured after the meeting ends.</p></div><span className={styles.count}>{filteredRows.length} records</span></div>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Company / Contact</th><th>Meeting</th><th>Outcome</th><th>First follow-up</th><th>Last Sales activity</th><th>Deal / Stage</th><th>Amount</th><th>Next activity</th><th>Attention</th></tr></thead>
              <tbody>
                {filteredRows.length ? filteredRows.map((row) => {
                  const contact = row.contacts[0];
                  return <tr key={row.id}>
                    <td>{row.company?.url ? <a className={styles.recordLink} href={row.company.url} target="_blank" rel="noreferrer"><span className={styles.primary}>{row.company.name}</span><span className={styles.secondary}>{contact?.name || "No associated contact"}{row.contacts.length > 1 ? ` +${row.contacts.length - 1}` : ""}</span></a> : <><span className={styles.primary}>{row.company?.name || "Unknown company"}</span><span className={styles.secondary}>{contact?.name || "No associated contact"}</span></>}</td>
                    <td>{row.recordUrl ? <a className={styles.recordLink} href={row.recordUrl} target="_blank" rel="noreferrer"><span className={styles.primary}>{dateTime(row.meetingDate)}</span><span className={styles.secondary}>{row.meetingTitle}</span></a> : <><span className={styles.primary}>{dateTime(row.meetingDate)}</span><span className={styles.secondary}>{row.meetingTitle}</span></>}</td>
                    <td><span className={styles.badge}>{pretty(row.outcome)}</span></td>
                    <td><span className={`${styles.badge} ${statusClass(row.followUp.status)}`}>{row.followUp.status}</span><span className={styles.secondary}>{row.followUp.at ? `${row.followUp.type} · ${row.followUp.hours ?? 0}h · ${dateTime(row.followUp.at)}` : "No Sales activity found"}</span></td>
                    <td><span className={styles.primary}>{dateTime(row.lastSalesActivity)}</span></td>
                    <td>{row.deal ? <a className={styles.recordLink} href={row.deal.url} target="_blank" rel="noreferrer"><span className={styles.primary}>{row.deal.name}</span><span className={styles.secondary}>{row.deal.stage} · {row.deal.owner}</span></a> : <span className={styles.noDeal}>No associated deal</span>}</td>
                    <td>{row.deal ? <span className={styles.primary}>{formatCurrency(row.deal.amount)}</span> : "—"}</td>
                    <td><span className={styles.primary}>{shortDate(row.nextActivity)}</span></td>
                    <td><span className={`${styles.badge} ${attentionClass(row.attention.level)}`}>{row.attention.reason}</span></td>
                  </tr>;
                }) : <tr><td colSpan={9}><div className={styles.empty}><Target size={22}/><span>No meetings match the selected filters.</span></div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </> : null}
    </main>
  );
}
