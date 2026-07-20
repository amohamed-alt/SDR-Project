"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Filter,
  ListFilter,
  ListTodo,
  Phone,
  Search,
  Target,
  UsersRound,
} from "lucide-react";
import type { Drilldown } from "@/components/DrilldownDrawer";
import styles from "@/components/AcquisitionDashboard.module.css";
import type {
  AcquisitionFilters,
  AcquisitionPeriodKey,
  AcquisitionRecordKind,
  AcquisitionSummaryResponse,
} from "@/lib/acquisition-summary";
import type { ActivityRow, ContactRow, DealRow } from "@/lib/types";

const DEFAULT_FILTERS: AcquisitionFilters = {
  ownerId: "all",
  period: "mtd",
  country: "all",
  rank: "all",
  source: "all",
  stage: "all",
};

const PERIOD_LABELS: Record<AcquisitionPeriodKey, string> = {
  yesterday: "Yesterday",
  mtd: "Month to Date",
  ytd: "Year to Date",
};

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

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function queryFor(filters: AcquisitionFilters, extra: Record<string, string> = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== "all") query.set(key, value);
  });
  Object.entries(extra).forEach(([key, value]) => {
    if (value && value !== "all") query.set(key, value);
    else query.delete(key);
  });
  return query;
}

export function AcquisitionDashboard({ refreshKey, onOpen }: { refreshKey: number; onOpen: (drilldown: Drilldown) => void }) {
  const [summary, setSummary] = useState<AcquisitionSummaryResponse | null>(null);
  const [draft, setDraft] = useState<AcquisitionFilters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<AcquisitionFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState("");
  const [pollKey, setPollKey] = useState(0);
  const lastRefreshKey = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const forceRefresh = refreshKey > lastRefreshKey.current;
    if (forceRefresh) lastRefreshKey.current = refreshKey;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const query = queryFor(applied, forceRefresh ? { refresh: "1" } : {});
        const response = await fetch(`/api/acquisition/summary?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.details || payload.error || "Acquisition summary request failed");
        if (cancelled) return;
        setSummary(payload as AcquisitionSummaryResponse);

        const refreshState = response.headers.get("x-acquisition-refresh");
        if (refreshState === "started" || refreshState === "running") {
          pollTimer.current = setTimeout(() => setPollKey((current) => current + 1), 8_000);
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Unable to load Acquisition dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [applied, pollKey, refreshKey]);

  async function openRecords(
    kind: AcquisitionRecordKind,
    view: string,
    title: string,
    description: string,
    overrides: Partial<AcquisitionFilters> = {},
  ) {
    if (!summary) return;
    setRecordsLoading(true);
    try {
      const filters = { ...applied, ...overrides };
      const query = queryFor(filters, { kind, view, limit: "1000" });
      const response = await fetch(`/api/acquisition/records?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load records");

      if (kind === "contacts") {
        onOpen({
          kind: "contacts",
          title,
          description: `${description} · ${payload.total} matching records`,
          rows: payload.rows as ContactRow[],
          hubspotUrl: summary.meta.hubspotUrls.contacts,
        });
      } else if (kind === "activities") {
        const hubspotUrl = view.startsWith("meeting")
          ? summary.meta.hubspotUrls.meetings
          : view.startsWith("task")
            ? summary.meta.hubspotUrls.tasks
            : summary.meta.hubspotUrls.calls;
        onOpen({
          kind: "activities",
          title,
          description: `${description} · ${payload.total} matching records`,
          rows: payload.rows as ActivityRow[],
          hubspotUrl,
        });
      } else {
        onOpen({
          kind: "deals",
          title,
          description: `${description} · ${payload.total} matching records`,
          rows: payload.rows as DealRow[],
          hubspotUrl: summary.meta.hubspotUrls.deals,
        });
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load drill-down records");
    } finally {
      setRecordsLoading(false);
    }
  }

  function chooseOwner(ownerId: string) {
    const next = { ...applied, ownerId };
    const rep = summary?.reps.find((item) => item.ownerId === ownerId);
    if (rep?.mode === "deal_only") {
      next.country = "all";
      next.rank = "all";
      next.source = "all";
    }
    setApplied(next);
    setDraft(next);
  }

  function setPeriod(period: AcquisitionPeriodKey) {
    const next = { ...applied, period };
    setApplied(next);
    setDraft(next);
  }

  function resetFilters() {
    const next = { ...DEFAULT_FILTERS, ownerId: applied.ownerId, period: applied.period };
    setDraft(next);
    setApplied(next);
  }

  if (error && !summary) {
    return <div className="acquisition-error"><AlertTriangle size={22}/><div><strong>Acquisition dashboard failed to load</strong><span>{error}</span></div><button onClick={() => setPollKey((current) => current + 1)}>Try again</button></div>;
  }

  if (!summary) {
    return <div className="acquisition-loading"><div className="loader"/><strong>Loading compact Acquisition summary…</strong><span>Large record lists will load only when selected</span></div>;
  }

  const dealOnly = summary.selected.mode === "deal_only";
  const periodLabel = PERIOD_LABELS[summary.meta.period];
  const metrics = dealOnly
    ? [
      { key: "deals", label: "New deals", value: formatNumber(summary.periodMetrics.dealsCreated), kind: "deals" as const, view: "period_created" },
      { key: "won", label: "Won", value: formatNumber(summary.periodMetrics.dealsWon), kind: "deals" as const, view: "period_won" },
      { key: "lost", label: "Lost", value: formatNumber(summary.periodMetrics.dealsLost), kind: "deals" as const, view: "period_lost" },
      { key: "pipeline", label: "Pipeline created", value: formatCurrency(summary.periodMetrics.pipelineCreated), kind: "deals" as const, view: "period_created" },
    ]
    : [
      { key: "calls", label: "Calls", value: formatNumber(summary.periodMetrics.calls), kind: "activities" as const, view: "calls" },
      { key: "connected", label: "Connected", value: formatNumber(summary.periodMetrics.connectedCalls), kind: "activities" as const, view: "connected" },
      { key: "booked", label: "Meetings booked", value: formatNumber(summary.periodMetrics.meetingsBooked), kind: "activities" as const, view: "meetings_booked" },
      { key: "completed", label: "Meetings completed", value: formatNumber(summary.periodMetrics.meetingsCompleted), kind: "activities" as const, view: "meetings_completed" },
      { key: "leads", label: "New leads", value: formatNumber(summary.periodMetrics.contacts), kind: "contacts" as const, view: "period_leads" },
      { key: "tasks", label: "Tasks completed", value: formatNumber(summary.periodMetrics.tasksCompleted), kind: "activities" as const, view: "tasks_completed" },
      { key: "deals", label: "New deals", value: formatNumber(summary.periodMetrics.dealsCreated), kind: "deals" as const, view: "period_created" },
      { key: "won", label: "Won", value: formatNumber(summary.periodMetrics.dealsWon), kind: "deals" as const, view: "period_won" },
      { key: "lost", label: "Lost", value: formatNumber(summary.periodMetrics.dealsLost), kind: "deals" as const, view: "period_lost" },
      { key: "pipeline", label: "Pipeline created", value: formatCurrency(summary.periodMetrics.pipelineCreated), kind: "deals" as const, view: "period_created" },
    ];

  const maxStageAmount = Math.max(...summary.dealStages.map((stage) => stage.amount), 1);
  const maxSource = Math.max(...summary.leadSources.map((source) => source.value), 1);

  return <div className="acquisition-dashboard">
    <section className="acquisition-owner-strip">
      <button className={applied.ownerId === "all" ? "active" : ""} onClick={() => chooseOwner("all")}><span className="rep-dot team">TM</span><strong>Team Overview</strong></button>
      {summary.reps.map((rep) => <button key={rep.ownerId} className={applied.ownerId === rep.ownerId ? "active" : ""} onClick={() => chooseOwner(rep.ownerId)}><span className="rep-dot" style={{ background: rep.color }}>{rep.initials}</span><strong>{rep.name}</strong></button>)}
    </section>

    <section className={styles.toolbar}>
      <div className={styles.periodSwitch}>
        {(Object.keys(PERIOD_LABELS) as AcquisitionPeriodKey[]).map((period) => <button key={period} className={applied.period === period ? styles.active : ""} onClick={() => setPeriod(period)}>{PERIOD_LABELS[period]}</button>)}
      </div>
      <label className={styles.filterField}><span>Country</span><select disabled={dealOnly} value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}><option value="all">All countries</option>{summary.options.countries.map((country) => <option key={country} value={country}>{country}</option>)}</select></label>
      <label className={styles.filterField}><span>Company Rank</span><select disabled={dealOnly} value={draft.rank} onChange={(event) => setDraft({ ...draft, rank: event.target.value as AcquisitionFilters["rank"] })}><option value="all">Rank A + B + Unranked</option><option value="A">Rank A</option><option value="B">Rank B</option></select></label>
      <label className={styles.filterField}><span>Lead Source</span><select disabled={dealOnly} value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as AcquisitionFilters["source"] })}><option value="all">Online + Offline</option><option value="online">Online / inbound</option><option value="offline">Offline / outbound</option></select></label>
      <label className={styles.filterField}><span>Deal Stage</span><select value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value })}><option value="all">All stages</option>{summary.options.stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
      <div className={styles.filterActions}><button className={styles.reset} onClick={resetFilters}>Reset</button><button className={styles.apply} onClick={() => setApplied(draft)}><Filter size={13}/>Apply</button></div>
    </section>

    {summary.meta.warnings.length > 0 && <div className="warning-banner"><AlertTriangle size={17}/><div><strong>Some HubSpot data was unavailable</strong><span>{summary.meta.warnings.join(" · ")}</span></div></div>}
    {error && <div className="error-banner"><AlertTriangle size={17}/><div><strong>Latest action failed</strong><span>{error}</span></div><button onClick={() => setError("")}>Dismiss</button></div>}

    <section className="acquisition-focus">
      <div className="acquisition-section-heading"><div><span>{dealOnly ? "DEALS-ONLY VIEW" : "TODAY'S EXECUTIVE FOCUS"}</span><h2>{summary.selected.name}</h2></div><small><ListFilter size={12}/>Filtered summary · records load on click</small></div>
      <div className="acquisition-focus-grid">
        {dealOnly ? <>
          <FocusCard tone="blue" icon={BriefcaseBusiness} label="Open deals" value={summary.focus.openDeals} helper="Current Acquisition portfolio" onClick={() => void openRecords("deals", "open", "Open deals", `${summary.selected.name} open Acquisition deals.`)}/>
          <FocusCard tone="red" icon={Clock3} label="Deals at risk" value={summary.focus.dealsAtRisk} helper="Overdue close or no next step" onClick={() => void openRecords("deals", "at_risk", "Deals at risk", "Open deals with an overdue close date or no next activity.")}/>
          <FocusCard tone="green" icon={CircleDollarSign} label="Open pipeline" value={formatCurrency(summary.focus.openPipeline)} helper={`${summary.focus.openDeals} open deals`} onClick={() => void openRecords("deals", "open", "Open pipeline", `${summary.selected.name} open pipeline records.`)}/>
          <FocusCard tone="purple" icon={CheckCircle2} label={`${periodLabel} won`} value={summary.periodMetrics.dealsWon} helper="Closed-won deals in period" onClick={() => void openRecords("deals", "period_won", `${periodLabel} won deals`, "Deals closed won in the selected period.")}/>
        </> : <>
          <FocusCard tone="red" icon={Clock3} label="Leads need contact" value={summary.focus.leadsNeedContact} helper={`${summary.focus.eligibleLeads} filtered leads`} onClick={() => void openRecords("contacts", "need_contact", "Leads needing contact", "Contacts with no logged Last Contacted value.")}/>
          <FocusCard tone="amber" icon={Target} label="Rank A/B untouched" value={summary.focus.rankABUntouched} helper={`Company property · ${summary.meta.rankProperty || "rank"}`} onClick={() => void openRecords("contacts", "rank_untouched", "Rank A/B untouched", "One representative contact per untouched Rank A/B company.")}/>
          <FocusCard tone="purple" icon={BriefcaseBusiness} label="Deals at risk" value={summary.focus.dealsAtRisk} helper="Overdue close or no next step" onClick={() => void openRecords("deals", "at_risk", "Deals at risk", "Open deals with an overdue close date or no next activity.")}/>
          <FocusCard tone="green" icon={CheckCircle2} label="Contact rate" value={`${summary.focus.contactRate}%`} helper={`${summary.focus.contactedLeads}/${summary.focus.eligibleLeads} contacted`} onClick={() => void openRecords("contacts", "all", "Contact coverage", "Contacts behind the displayed contact rate.")}/>
        </>}
      </div>
    </section>

    <section className={styles.performance}>
      <div className="acquisition-section-heading"><div><span>{periodLabel.toUpperCase()}</span><h2>{dealOnly ? "Deal performance" : "Execution and sales outcomes"}</h2></div><small>{shortDate(summary.meta.periodFrom)} – {shortDate(summary.meta.periodTo)}{!dealOnly ? ` · ${summary.periodMetrics.connectionRate}% connected` : ""}</small></div>
      <div className={styles.metricGrid}>{metrics.map((metric) => <button key={metric.key} className={styles.metricButton} onClick={() => void openRecords(metric.kind, metric.view, `${periodLabel} · ${metric.label}`, `Records contributing to ${metric.label.toLowerCase()} in the selected period.`)}><strong>{metric.value}</strong><span>{metric.label}</span></button>)}</div>
    </section>

    {applied.ownerId === "all" && <section className={styles.scoreboard}>
      <div className="acquisition-section-heading"><div><span>TEAM SCOREBOARD</span><h2>{periodLabel} performance by owner</h2></div><small><UsersRound size={12}/>Click a rep to open their workspace</small></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Owner</th><th>Calls</th><th>Connected</th><th>Conn. rate</th><th>Meetings</th><th>Leads</th><th>New deals</th><th>Won</th><th>Lost</th><th>Pipeline created</th><th>Open pipeline</th><th>At risk</th></tr></thead><tbody>{summary.scoreboard.map((row) => <tr key={row.ownerId}><td><button className={styles.ownerButton} onClick={() => chooseOwner(row.ownerId)}><span className="rep-dot" style={{ background: row.color }}>{row.initials}</span><div><strong>{row.name}</strong><small>{row.mode === "deal_only" ? "Deals-only view" : "Full Acquisition execution"}</small></div></button></td><td>{row.mode === "deal_only" ? "—" : formatNumber(row.calls)}</td><td>{row.mode === "deal_only" ? "—" : formatNumber(row.connected)}</td><td className={styles.rate}>{row.mode === "deal_only" ? "—" : `${row.connectionRate}%`}</td><td>{row.mode === "deal_only" ? "—" : formatNumber(row.meetingsCompleted)}</td><td>{row.mode === "deal_only" ? "—" : formatNumber(row.leads)}</td><td>{formatNumber(row.newDeals)}</td><td>{formatNumber(row.won)}</td><td>{formatNumber(row.lost)}</td><td className={styles.money}>{formatCurrency(row.pipelineCreated)}</td><td className={styles.money}>{formatCurrency(row.openPipeline)}</td><td className={row.dealsAtRisk ? styles.danger : ""}>{formatNumber(row.dealsAtRisk)}</td></tr>)}</tbody></table></div>
    </section>}

    <div className={styles.twoColumn}>
      {!dealOnly && <section className={styles.rankPanel}>
        <div className="acquisition-section-heading"><div><span>COMPANY INTELLIGENCE</span><h2>Rank A/B coverage by country</h2></div><small>{summary.rankCoverage.countries.length} countries</small></div>
        <div className={styles.rankTotals}>
          <RankStat value={summary.rankCoverage.aTotal} label="Rank A total"/>
          <RankStat value={summary.rankCoverage.aContacted} label="A contacted"/>
          <RankStat value={summary.rankCoverage.aMeetings} label="A completed meetings"/>
          <RankStat value={summary.rankCoverage.aUntouched} label="A untouched"/>
          <RankStat value={summary.rankCoverage.bTotal} label="Rank B total"/>
          <RankStat value={summary.rankCoverage.bContacted} label="B contacted"/>
          <RankStat value={summary.rankCoverage.bMeetings} label="B completed meetings"/>
          <RankStat value={summary.rankCoverage.bUntouched} label="B untouched"/>
        </div>
        <div className={styles.tableWrap}><table className={styles.rankTable}><thead><tr><th>Country</th><th>A total</th><th>A contacted</th><th>A meetings</th><th>A untouched</th><th>B total</th><th>B contacted</th><th>B meetings</th><th>B untouched</th></tr></thead><tbody>{summary.rankCoverage.countries.slice(0, 12).map((row) => <tr key={row.country}><td><button onClick={() => { setDraft({ ...draft, country: row.country }); setApplied({ ...applied, country: row.country }); }}>{row.country}</button></td><td>{row.aTotal}</td><td>{row.aContacted}</td><td>{row.aMeetings}</td><td><button onClick={() => void openRecords("contacts", "rank_untouched", `Rank A untouched · ${row.country}`, "Untouched Rank A companies in the selected country.", { country: row.country, rank: "A" })}>{row.aUntouched}</button></td><td>{row.bTotal}</td><td>{row.bContacted}</td><td>{row.bMeetings}</td><td><button onClick={() => void openRecords("contacts", "rank_untouched", `Rank B untouched · ${row.country}`, "Untouched Rank B companies in the selected country.", { country: row.country, rank: "B" })}>{row.bUntouched}</button></td></tr>)}</tbody></table></div>
      </section>}

      <section className={styles.dealsPanel}>
        <div className="acquisition-section-heading"><div><span>DEALS WORKSPACE</span><h2>Pipeline movement and risk</h2></div><small><BriefcaseBusiness size={12}/>Lazy-loaded records</small></div>
        <div className={styles.dealBuckets}>{summary.dealBuckets.map((bucket) => <button key={bucket.key} className={styles.dealBucket} onClick={() => void openRecords("deals", bucket.key, `${bucket.label} deals`, `${summary.selected.name} ${bucket.label.toLowerCase()} deals.`)}><strong>{formatNumber(bucket.count)}</strong><span>{bucket.label} deals</span><small>{formatCurrency(bucket.amount)}</small></button>)}</div>
        <div className={styles.stageList}>{summary.dealStages.slice(0, 8).map((stage) => <button key={stage.name} className={styles.stageButton} onClick={() => void openRecords("deals", "open", `Open deals · ${stage.name}`, "Open deals in the selected HubSpot stage.", { stage: stage.name })}><span>{stage.name}<small>{stage.value} deals</small></span><i><b style={{ width: `${Math.max(4, (stage.amount / maxStageAmount) * 100)}%` }}/></i><em>{formatCurrency(stage.amount)}</em></button>)}{!summary.dealStages.length && <div className={styles.empty}>No open deals for the current filters</div>}</div>
      </section>
    </div>

    {!dealOnly && <div className="acquisition-insight-grid">
      <section className="acquisition-ranked"><div><span>LEAD ACQUISITION</span><h3>Original Traffic Sources</h3><p>{periodLabel} · filtered leads only</p></div><div className={styles.sourceList}>{summary.leadSources.map((source) => <div key={source.name} className={styles.sourceRow}><span>{source.name}</span><i><b style={{ width: `${Math.max(4, (source.value / maxSource) * 100)}%` }}/></i><strong>{formatNumber(source.value)}</strong></div>)}{!summary.leadSources.length && <div className={styles.empty}>No lead source data for this selection</div>}</div></section>
      <section className="acquisition-ranked"><div><span>FILTER STATUS</span><h3>Current selection</h3><p>Applied server-side before aggregation</p></div><div className={styles.sourceList}><FilterRow label="Owner" value={summary.selected.name}/><FilterRow label="Period" value={periodLabel}/><FilterRow label="Country" value={applied.country === "all" ? "All countries" : applied.country}/><FilterRow label="Company Rank" value={applied.rank === "all" ? "All ranks" : `Rank ${applied.rank}`}/><FilterRow label="Source" value={applied.source === "all" ? "Online + Offline" : applied.source}/><FilterRow label="Deal Stage" value={applied.stage === "all" ? "All stages" : applied.stage}/></div></section>
    </div>}

    {!dealOnly && <section className="acquisition-priority-list">
      <div className="acquisition-section-heading"><div><span>PRIORITY LEADS</span><h2>Highest-priority filtered records</h2></div><button onClick={() => void openRecords("contacts", "all", "Priority leads", `${summary.selected.name} filtered contacts ordered by execution priority.`)}>View all<ArrowRight size={13}/></button></div>
      <div className="acquisition-lead-table"><div className="acquisition-lead-head"><span>Lead</span><span>Owner</span><span>Country</span><span>Rank / ICP</span><span>Status</span><span>Next activity</span><span/></div>{summary.priorityContacts.map((row) => <div className="acquisition-lead-row" key={row.id}><span><strong>{row.name}</strong><small>{row.company || row.title || "No company"}</small></span><span>{row.ownerName || "—"}</span><span>{row.country || "—"}</span><span><i>{row.companyRank ? `Rank ${row.companyRank}` : row.tier}</i></span><span>{row.leadStatus}</span><span>{row.nextActivity ? row.nextActivity.slice(0, 10) : "No next step"}</span><a href={row.url} target="_blank" rel="noreferrer" aria-label={`Open ${row.name} in HubSpot`}><ExternalLink size={14}/></a></div>)}</div>
    </section>}

    {(loading || recordsLoading) && <div className={styles.loadingOverlay}><span className={styles.spinner}/>{recordsLoading ? "Loading selected records…" : "Refreshing compact summary…"}</div>}
  </div>;
}

function FocusCard({ tone, icon: Icon, label, value, helper, onClick }: { tone: string; icon: typeof Target; label: string; value: number | string; helper: string; onClick: () => void }) {
  return <button className={`acquisition-focus-card tone-${tone}`} onClick={onClick}><span><Icon size={17}/>{label}</span><strong>{typeof value === "number" ? formatNumber(value) : value}</strong><small>{helper}<ListFilter size={11}/></small></button>;
}

function RankStat({ value, label }: { value: number; label: string }) {
  return <article className={styles.rankStat}><strong>{formatNumber(value)}</strong><span>{label}</span></article>;
}

function FilterRow({ label, value }: { label: string; value: string }) {
  return <div className={styles.sourceRow}><span>{label}</span><i><b style={{ width: "100%" }}/></i><strong>{value}</strong></div>;
}
