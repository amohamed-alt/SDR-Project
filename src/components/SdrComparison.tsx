"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, CalendarDays, RefreshCw, UsersRound } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SDR_OWNERS, SDR_COMPARISON_KEYS, type SdrKey } from "@/lib/sdr-owners";
import type { SdrSummary } from "@/lib/sdr-comparison";
import type { DashboardKpis } from "@/lib/types";
import styles from "./SdrComparison.module.css";

type Entry = { key: SdrKey; data: SdrSummary | null; refreshing: boolean; ageSeconds: number | null; error: string | null };
const previous = new Map<string, Entry[]>();
const metrics: { label: string; key: keyof DashboardKpis; percent?: boolean }[] = [
  { label: "Calls", key: "calls" }, { label: "Connected calls", key: "connectedCalls" },
  { label: "Connection rate", key: "connectionRate", percent: true },
  { label: "Meetings booked", key: "bookedMeetings" }, { label: "Completed meetings", key: "completedMeetings" },
  { label: "Tasks completed", key: "completedTasks" }, { label: "Open tasks · current", key: "openTasks" },
  { label: "Overdue tasks · current", key: "overdueTasks" }, { label: "Contacts · current", key: "portfolioContacts" },
];
const owners = SDR_COMPARISON_KEYS.map(key => SDR_OWNERS[key]);

export function SdrComparison({ onSelect }: { onSelect: (key: SdrKey) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState({ from: today.slice(0, 7) + "-01", to: today });
  const [range, setRange] = useState(draft);
  const key = `${range.from}:${range.to}`;
  const [state, setState] = useState<{ key: string; entries: Entry[] }>({ key, entries: previous.get(key) || [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load(force = false) {
      if (document.hidden) { timer = setTimeout(() => void load(), 30_000); return; }
      setBusy(true);
      let delay = 30_000;
      try {
        const query = new URLSearchParams(range);
        if (force) query.set("refresh", "1");
        const response = await fetch(`/api/dashboard/team?${query}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load comparison");
        if (controller.signal.aborted) return;
        previous.set(key, payload.results);
        while (previous.size > 6) previous.delete(previous.keys().next().value!);
        setState({ key, entries: payload.results });
        setError("");
        if (payload.results.some((entry: Entry) => entry.refreshing)) delay = 3_000;
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to refresh comparison");
      } finally {
        if (!controller.signal.aborted) { setBusy(false); timer = setTimeout(() => void load(), delay); }
      }
    }
    void load(refresh > 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [range, key, refresh]);
  const entries = state.key === key ? state.entries : previous.get(key) || [];
  const dataFor = (sdr: SdrKey) => entries.find(entry => entry.key === sdr);
  const format = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
  const chart = metrics.filter(metric => ["calls", "connectedCalls", "bookedMeetings", "completedTasks"].includes(metric.key)).map(metric => {
    const row: Record<string, string | number | null> = { name: metric.label };
    owners.forEach(owner => { row[owner.shortName] = dataFor(owner.key)?.data?.kpis[metric.key] ?? null; });
    return row;
  });
  return <div className={styles.page}>
    <header className={styles.header}><button onClick={() => onSelect("marita")}><ArrowLeft size={16}/>Workspaces</button><span><UsersRound size={16}/>SDR TEAM</span><button disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} className={busy ? "spin" : ""}/>{busy ? "Updating" : "Refresh"}</button></header>
    <section className={styles.title}><div><p>MANAGEMENT OVERVIEW</p><h1>SDR performance</h1><span>{owners.map(owner => `${owner.shortName} · ${owner.brand}`).join("  /  ")}</span></div><form onSubmit={event => { event.preventDefault(); setRange({ ...draft }); }}><CalendarDays size={18}/><label>From<input aria-label="Reporting start" type="date" required value={draft.from} max={draft.to} onChange={event => setDraft({ ...draft, from: event.target.value })}/></label><label>To<input aria-label="Reporting end" type="date" required min={draft.from} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })}/></label><button>Apply</button></form></section>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.owners}>{owners.map(owner => {
      const entry = dataFor(owner.key);
      return <section className={styles.owner} key={owner.key} style={{ borderTopColor: owner.color }}><div className={styles.identity}><span style={{ background: owner.color }}>{owner.initials}</span><div><h2>{owner.name}</h2><p>{owner.brand}</p></div><button aria-label={`Open ${owner.shortName} workspace`} onClick={() => onSelect(owner.key)}><ArrowUpRight size={20}/></button></div>
        <div className={styles.numbers}><div><span>Meetings booked</span><strong>{entry?.data ? format(entry.data.kpis.bookedMeetings) : "—"}</strong></div><div><span>Connection rate</span><strong>{entry?.data ? `${format(entry.data.kpis.connectionRate)}%` : "—"}</strong></div><div><span>Tasks completed</span><strong>{entry?.data ? format(entry.data.kpis.completedTasks) : "—"}</strong></div></div>
        <p className={styles.freshness}>{entry?.error || (entry?.data ? `${entry.data.meta.isDemo ? "Demo · " : ""}Synced ${new Date(entry.data.meta.generatedAt).toLocaleString("en-GB")}${entry.refreshing ? " · Updating in background" : ""}` : "Loading HubSpot snapshot…")}</p>
        {entry?.data?.meta.warnings.map(warning => <p key={warning} className={styles.error}>{warning}</p>)}
      </section>;
    })}</div>
    <div className={styles.detail}><section className={styles.panel}><h2>Activity comparison</h2><p>Same reporting period · recorded HubSpot activity</p><ResponsiveContainer width="100%" height={320}><BarChart data={chart} margin={{ top: 20, right: 12, left: -15, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e8ebef"/><XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} height={55}/><YAxis allowDecimals={false}/><Tooltip/><Legend/>{owners.map(owner => <Bar key={owner.key} dataKey={owner.shortName} fill={owner.color} radius={[4,4,0,0]} isAnimationActive={false}/>)}</BarChart></ResponsiveContainer></section>
    <section className={styles.panel}><h2>Numbers at a glance</h2><div className={styles.tableWrap}><table><caption className={styles.caption}>Activity dates: {range.from} – {range.to}. Workload and portfolio are current snapshots.</caption><thead><tr><th scope="col">Metric</th>{owners.map(owner => <th scope="col" key={owner.key}>{owner.shortName}</th>)}</tr></thead><tbody>{metrics.map(metric => <tr key={metric.key}><th scope="row">{metric.label}</th>{owners.map(owner => <td key={owner.key}>{dataFor(owner.key)?.data ? `${format(dataFor(owner.key)!.data!.kpis[metric.key])}${metric.percent ? "%" : ""}` : "—"}</td>)}</tr>)}</tbody></table></div></section></div>
    <p className={styles.note}>Performance is grouped by SDR ownership. Talentera and Evalufy labels identify each workspace; these are not product-filtered revenue totals. Compare activity alongside portfolio size and time in role.</p>
  </div>;
}
