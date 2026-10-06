"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, BarChart3, Newspaper, Compass, RefreshCw, Target, Wrench } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { SDR_OWNERS } from "@/lib/sdr-owners";
import { readDashboardView } from "@/lib/dashboard-url-state";
import { dashboardToday } from "@/lib/dashboard-values";
import type { DashboardData } from "@/lib/types";
import type { DecisionInsights, SegmentInsight } from "@/lib/decision-insights";
import type { RecordSelection } from "@/lib/dashboard-records";
import type { Drilldown } from "@/components/DrilldownDrawer";
import { PerformanceCharts } from "./PerformanceCharts";
import { ReportingRange } from "./ReportingRange";
import { TalentMarketWatch } from "./TalentMarketWatch";
import { CallIntelligencePanel, CallSegmentTable } from "./CallIntelligencePanel";
import { ToolStudio } from "./ToolStudio";
import styles from "./DecisionStudio.module.css";

const DrilldownDrawer = dynamic(() => import("./DrilldownDrawer").then(module => module.DrilldownDrawer));
type Payload = { dashboard: DashboardData; insights: DecisionInsights; refreshing: boolean };
const cache = new Map<string, { data: Payload; at: number }>();
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

function Ranking({ title, rows, onInspect }: { title: string; rows: SegmentInsight[]; onInspect: (title: string, selection: RecordSelection) => void }) {
  return <section className={styles.panel}><header><div><span className={styles.kicker}>Evidence-ranked segments</span><h2>{title}</h2><p>Contacts with meetings ÷ contacts in this portfolio.</p></div></header>
    {rows.length ? <div className={styles.tableScroll}><table className={styles.ranking}><thead><tr><th>Segment · inspect records</th><th>Contacts</th><th>With meeting</th><th>Reach</th><th>Evidence</th></tr></thead><tbody>{rows.map(row => <tr key={row.name}><td><button type="button" onClick={() => onInspect(row.name, row.selection)}>{row.name}</button></td><td>{number(row.contacts)}</td><td>{row.meetings}</td><td>{row.meetingReach}%</td><td>{row.evidence}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No contacts match this scope.</p>}
  </section>;
}

export function DecisionStudio({ initialSearch }: { initialSearch: string }) {
  const params = new URLSearchParams(initialSearch);
  const ownerKey = params.get("analysisOwner") === "daniel" ? "daniel" : "marita";
  const owner = SDR_OWNERS[ownerKey];
  const active = ["markets", "agent", "tools"].includes(params.get("studio") || "") ? params.get("studio")! : "executive";
  const filters = useMemo(() => { const today = dashboardToday(); return readDashboardView(initialSearch, { from: today.slice(0, 7) + "-01", to: today, ownerId: owner.ownerId }).filters; }, [initialSearch, owner.ownerId]);
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]).toString();
  const [loaded, setLoaded] = useState<{ key: string; data: Payload } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const forceRef = useRef(false);
  const showAnalytics = active === "executive" || active === "markets";
  function refreshData() { forceRef.current = true; setRefresh(value => value + 1); }
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const payload = loaded?.key === query ? loaded.data : null;
  const data = payload?.dashboard;
  const insights = payload?.insights;

  useEffect(() => {
    if (!showAnalytics) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let force = forceRef.current; forceRef.current = false;
    const started = Date.now();
    const hit = cache.get(query);
    if (hit) setLoaded({ key: query, data: hit.data });
    async function load() {
      if (document.hidden) { timer = setTimeout(load, 30_000); return; }
      setBusy(true); setError("");
      try {
        const response = await fetch(`/api/dashboard/insights?${query}${force ? "&refresh=1" : ""}`, { signal: controller.signal });
        force = false;
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Analytics could not load.");
        if (controller.signal.aborted) return;
        cache.delete(query); cache.set(query, { data: result, at: Date.now() });
        while (cache.size > 12) cache.delete(cache.keys().next().value!);
        setLoaded({ key: query, data: result });
        timer = setTimeout(load, result.refreshing && Date.now() - started < 90_000 ? 3000 : 60_000);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Analytics unavailable"); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    if (!force && hit && Date.now() - hit.at < 30_000) timer = setTimeout(load, 30_000);
    else void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, refresh, showAnalytics]);

  function navigate(key: string, value: string) {
    const url = new URL(window.location.href); url.searchParams.set(key, value);
    window.history.pushState({}, "", url); window.dispatchEvent(new PopStateEvent("popstate"));
  }
  function inspect(title: string, selection: RecordSelection) {
    if (!data) return;
    const source = { filters, version: data.meta.generatedAt, selection };
    const hubspotUrl = data.meta.hubspotUrls[selection.kind === "activities" ? "calls" : selection.kind];
    setDrilldown({ kind: selection.kind, title, description: `Evidence for ${owner.name} · ${filters.from} to ${filters.to}`, rows: [], source, hubspotUrl } as Drilldown);
  }
  return <div className={styles.studio}>
    <header className={styles.hero}><div><span className={styles.kicker}>SDR Intelligence Studio</span><h1>From activity to decisions.</h1><p>See what is working, where momentum is fading, and which markets deserve the next conversation.</p></div><label className={styles.scope}>Reporting portfolio<select value={ownerKey} onChange={event => navigate("analysisOwner", event.target.value)}><option value="marita">Marita · Talentera</option><option value="daniel">Daniel · Evalufy</option></select></label></header>
    <nav className={styles.tabs} aria-label="Intelligence sections">{[
      ["executive", "Executive review", BarChart3], ["markets", "ICP & markets", Target], ["agent", "Talent market watch", Newspaper], ["tools", "Tool studio", Wrench],
    ].map(([key, label, Icon]) => { const Component = Icon as typeof BarChart3; return <button type="button" key={String(key)} aria-pressed={active === key} onClick={() => navigate("studio", String(key))}><Component size={16}/>{String(label)}</button>; })}</nav>
    {active === "tools" ? <ToolStudio ownerKey={ownerKey}/> : active === "agent" ? <TalentMarketWatch/> : <>
      <ReportingRange key={`${filters.from}:${filters.to}`} filters={filters}/>
      {error ? <div role="alert" className={styles.error}>{error} <button type="button" onClick={refreshData}>Retry</button></div> : null}
      {!data ? <div className={styles.loading} role="status"><BarChart3 size={30}/><strong>Preparing your decision workspace…</strong><span>Reading the existing HubSpot snapshot.</span></div> : null}
      {data && insights ? <>
        <div className={styles.freshness}><span>{data.meta.isDemo ? "DEMO DATA" : "HUBSPOT SNAPSHOT"} · {owner.brand} · {data.meta.timezone}</span><span>Updated {new Date(data.meta.generatedAt).toLocaleString("en-GB", { timeZone: data.meta.timezone })}</span><button type="button" disabled={busy || payload?.refreshing} onClick={refreshData}><RefreshCw size={12}/> {busy || payload?.refreshing ? "Updating…" : "Refresh data"}</button></div>
        {data.meta.warnings.length ? <div role="status" className={styles.notice}>Some sources are incomplete: {data.meta.warnings.join(" · ")}</div> : null}
        {active === "executive" ? <>
          <section className={styles.stats} aria-label="Executive metrics">{[
            ["Calls connected", `${data.kpis.connectionRate}%`, `${number(data.kpis.connectedCalls)} of ${number(data.kpis.calls)} calls`],
            ["Meetings booked", number(data.kpis.bookedMeetings), `${data.kpis.completedMeetings} completed`],
            ["Open opportunities", number(data.kpis.openDeals), "Associated deals · current state"],
            ["Response data coverage", `${data.kpis.leadResponseCoverage}%`, "Coverage, not response performance"],
          ].map(([label, value, helper]) => <article className={styles.stat} key={label}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>)}</section>
          <section className={styles.panel}><header><div><span className={styles.kicker}>Management brief</span><h2>Where to focus next</h2></div><Compass size={20}/></header><p>{insights.bestMarket ? `${insights.bestMarket.name} has the strongest eligible observed meeting reach: ${insights.bestMarket.meetings} contacts with meetings out of ${insights.bestMarket.contacts}. Treat this as a testable prioritization signal.` : "There is not enough evidence to name a winning market yet. Build a larger observed sample before shifting targeting."}</p><p>{insights.bestIcp ? `${insights.bestIcp.name} is the leading measurable ICP segment in this scope.` : `The calling audience below uses actual job titles and contact associations. ${insights.calling.titleKnownCalls} of ${insights.calling.calls} calls have a known job title; use these observed conversations to test your next ICP.`}</p></section>
          <div className={styles.actions}>{insights.actions.map((action, index) => <button key={action.id} type="button" onClick={() => inspect(action.title, action.selection)}><span>0{index + 1}</span><span><strong>{action.title}</strong><small>{action.reason}</small></span><b>{number(action.count)} <ArrowUpRight size={15}/></b></button>)}</div>
          <CallIntelligencePanel calling={insights.calling} timezone={data.meta.timezone} onInspect={inspect}/>
          <PerformanceCharts data={data} onInspect={inspect}/>
        </> : active === "markets" ? <>
          <CallSegmentTable title="Markets we actually call" rows={insights.calling.markets} onInspect={inspect}/>
          <div className={styles.chartGrid}><section className={styles.panel}><header><div><span className={styles.kicker}>Market opportunity map</span><h2>Scale × observed meeting reach</h2><p>Each point is a market. Larger bubbles mean more contacts with meetings.</p></div></header><div className={styles.chart}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 10, left: 0, bottom: 20, right: 15 }}><CartesianGrid stroke="var(--border)" strokeDasharray="4 4"/><XAxis type="number" dataKey="contacts" name="Contacts" tick={{ fontSize: 10 }} label={{ value: "Portfolio contacts", position: "bottom", fontSize: 11 }}/><YAxis type="number" dataKey="meetingReach" name="Meeting reach" unit="%" tick={{ fontSize: 10 }}/><ZAxis type="number" dataKey="meetings" range={[45, 300]} name="Contacts with meetings"/><Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active: show, payload: point }) => { const row = point?.[0]?.payload as SegmentInsight | undefined; return show && row ? <div className={styles.panel}><strong>{row.name}</strong><p>{row.meetings} / {row.contacts} contacts · {row.meetingReach}%</p><small>{row.evidence}</small></div> : null; }}/><Scatter isAnimationActive={false} data={insights.markets} fill="var(--green)"/></ScatterChart></ResponsiveContainer></div></section><section className={styles.panel}><span className={styles.kicker}>Can we trust the segments?</span><h2>Profile coverage</h2><p>Missing fields limit what the agent can conclude.</p><div className={styles.barList}>{[["Country", insights.quality.countryKnown], ["Persona", insights.quality.personaKnown], ["ICP tier", insights.quality.tierKnown]].map(([label, count]) => <div key={label}><p>{label}: <strong>{number(Number(count))} / {number(insights.quality.total)}</strong></p><meter min={0} max={Math.max(1, insights.quality.total)} value={Number(count)}/></div>)}</div><div className={styles.notice}>{insights.ranking}</div></section></div>
          <Ranking title="Target markets" rows={insights.markets} onInspect={inspect}/>
          <div className={styles.chartGrid}><Ranking title="ICP combinations" rows={insights.icps} onInspect={inspect}/><Ranking title="Buyer personas" rows={insights.personas} onInspect={inspect}/></div>
        </> : null}
        <details className={styles.evidence}><summary>Metric definitions & evidence boundaries</summary><p>{insights.definition}</p><p>{insights.ranking}</p><p>Pipeline is associated through the current owner portfolio. It is not incremental revenue attributed to the SDR.</p></details>
      </> : null}
    </>}
    {drilldown ? <DrilldownDrawer drilldown={drilldown} onClose={() => setDrilldown(null)}/> : null}
  </div>;
}
