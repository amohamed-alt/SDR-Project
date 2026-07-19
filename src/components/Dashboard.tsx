"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, BarChart3, BriefcaseBusiness,
  Building2, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign, Database, ExternalLink,
  Filter, Gauge, Mail, Phone, RefreshCw, Search, ShieldCheck, Sparkles, Target, UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Legend,
  Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartDatum, DashboardData, DashboardFilters } from "@/lib/types";

type Tab = "overview" | "attribution" | "activities" | "quality" | "companies" | "pipeline";

const COLORS = ["#7c5cff", "#00c2a8", "#ffb547", "#4da3ff", "#ff6b8a", "#8ed081", "#a78bfa", "#5eead4"];
const defaultStart = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? new Date().toISOString().slice(0, 7) + "-01";
const today = new Date().toISOString().slice(0, 10);

const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "attribution", label: "Attribution", icon: Target },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "quality", label: "Data Quality", icon: ShieldCheck },
  { id: "companies", label: "Companies & ATS", icon: Building2 },
  { id: "pipeline", label: "Pipeline", icon: BriefcaseBusiness },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function pretty(value: string) {
  return value.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(value));
}

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyChart() {
  return <div className="empty-state"><BarChart3 size={28} /><span>No data for the selected filters</span></div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; payload?: ChartDatum }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label && <strong>{label}</strong>}
      {payload.map((item, index) => (
        <div key={`${item.name}-${index}`}><span style={{ background: item.color }} />{item.name}: <b>{formatNumber(item.value ?? 0)}</b></div>
      ))}
    </div>
  );
}

function DonutChart({ data, centerLabel }: { data: ChartDatum[]; centerLabel: string }) {
  if (!data.length) return <EmptyChart />;
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data.slice(0, 8)} dataKey="value" nameKey="name" innerRadius={64} outerRadius={94} paddingAngle={2} stroke="none">
            {data.slice(0, 8).map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center"><strong>{formatNumber(data.reduce((sum, item) => sum + item.value, 0))}</strong><span>{centerLabel}</span></div>
      <div className="legend-list">
        {data.slice(0, 6).map((item, index) => <div key={item.name}><i style={{ background: COLORS[index % COLORS.length] }} /><span>{item.name}</span><b>{item.value}</b></div>)}
      </div>
    </div>
  );
}

function HorizontalBars({ data, color = "#7c5cff", amount = false }: { data: ChartDatum[]; color?: string; amount?: boolean }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(250, Math.min(440, data.slice(0, 10).length * 40 + 50))}>
      <BarChart data={data.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#24314c" />
        <XAxis type="number" tick={{ fill: "#8b98b2", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={amount ? (value) => `$${Math.round(value / 1000)}k` : undefined} />
        <YAxis type="category" dataKey="name" width={118} tick={{ fill: "#c7d0e0", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey={amount ? "amount" : "value"} name={amount ? "Amount" : "Records"} fill={color} radius={[0, 7, 7, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function KpiCard({ label, value, helper, icon: Icon, tone = "purple", onClick }: { label: string; value: string; helper: string; icon: LucideIcon; tone?: string; onClick: () => void }) {
  return (
    <button className={`kpi-card tone-${tone}`} onClick={onClick}>
      <div className="kpi-top"><span>{label}</span><Icon size={18} /></div>
      <strong>{value}</strong>
      <small>{helper}<ChevronRight size={13} /></small>
    </button>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option} value={option}>{pretty(option)}</option>)}</select></label>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [draft, setDraft] = useState<DashboardFilters>({ from: defaultStart, to: today, ownerId: "31644369" });
  const [applied, setApplied] = useState<DashboardFilters>(draft);

  const loadDashboard = useCallback(async () => {
    setLoading(true); setError("");
    const query = new URLSearchParams();
    Object.entries(applied).forEach(([key, item]) => { if (item) query.set(key, item); });
    if (refreshKey) query.set("refresh", "1");
    try {
      const response = await fetch(`/api/dashboard?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Dashboard request failed");
      setData(payload as DashboardData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load dashboard");
    } finally { setLoading(false); }
  }, [applied, refreshKey]);

  // The effect intentionally starts the external dashboard synchronization whenever applied filters change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const kpis = useMemo(() => data ? [
    { label: "SDR portfolio", value: formatNumber(data.kpis.portfolioContacts), helper: `${data.kpis.newContacts} created in period`, icon: UsersRound, tone: "purple", tab: "overview" as Tab },
    { label: "Companies", value: formatNumber(data.kpis.companies), helper: "Distinct associated accounts", icon: Building2, tone: "blue", tab: "companies" as Tab },
    { label: "Calls", value: formatNumber(data.kpis.calls), helper: `${data.kpis.connectionRate}% connected`, icon: Phone, tone: "green", tab: "activities" as Tab },
    { label: "Meetings", value: formatNumber(data.kpis.bookedMeetings), helper: `${data.kpis.completedMeetings} completed`, icon: CalendarDays, tone: "amber", tab: "activities" as Tab },
    { label: "Open tasks", value: formatNumber(data.kpis.openTasks), helper: `${data.kpis.dueTomorrow} due tomorrow`, icon: CheckCircle2, tone: data.kpis.dueTomorrow > 75 ? "red" : "blue", tab: "activities" as Tab },
    { label: "Email reply rate", value: `${data.kpis.emailReplyRate}%`, helper: `${data.kpis.emailReplies} replies / ${data.kpis.emailsSent} sent`, icon: Mail, tone: "purple", tab: "activities" as Tab },
    { label: "Open deals", value: formatNumber(data.kpis.openDeals), helper: `${data.kpis.dealsCreated} created in period`, icon: BriefcaseBusiness, tone: "green", tab: "pipeline" as Tab },
    { label: "Open pipeline", value: formatCurrency(data.kpis.pipelineValue), helper: "Attributed through SDR contacts", icon: CircleDollarSign, tone: "amber", tab: "pipeline" as Tab },
  ] : [], [data]);

  function setPreset(preset: "today" | "week" | "month" | "sinceJuly") {
    const now = new Date(); let from = today;
    if (preset === "week") { const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); from = start.toISOString().slice(0, 10); }
    if (preset === "month") from = today.slice(0, 7) + "-01";
    if (preset === "sinceJuly") from = "2026-07-01";
    setDraft((current) => ({ ...current, from, to: today }));
  }

  function resetFilters() {
    const reset = { from: defaultStart, to: today, ownerId: "31644369" };
    setDraft(reset); setApplied(reset);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Sparkles size={20} /></div><div><strong>SDR Command Center</strong><span>HubSpot revenue intelligence</span></div></div>
        <div className="top-actions">
          <span className={`status-pill ${data?.meta.isDemo ? "demo" : "live"}`}><i />{data?.meta.isDemo ? "Demo data" : "Live HubSpot"}</span>
          <button className="icon-button" onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Toggle filters"><Filter size={18} /></button>
          <button className="refresh-button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />Refresh</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="owner-card"><div className="avatar">MC</div><div><span>SDR owner</span><strong>{data?.meta.ownerName ?? "Marita Chedid"}</strong></div><BadgeCheck size={17} /></div>
          <nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}><Icon size={17} /><span>{label}</span>{activeTab === id && <ChevronRight size={15} />}</button>)}</nav>
          <div className="sync-card"><Database size={18} /><div><strong>Last sync</strong><span>{data ? new Date(data.meta.generatedAt).toLocaleString("en-GB") : "Loading…"}</span></div></div>
        </aside>

        <div className="content">
          <div className="page-title"><div><span className="eyebrow">PERFORMANCE / {activeTab.toUpperCase()}</span><h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1><p>{data ? `${shortDate(data.meta.from)} – ${shortDate(data.meta.to)} · ${data.meta.timezone}` : "Loading dashboard data…"}</p></div></div>

          <div className={`filter-drawer ${filtersOpen ? "open" : ""}`}>
            <div className="preset-row"><span>Quick range</span><button onClick={() => setPreset("today")}>Today</button><button onClick={() => setPreset("week")}>This week</button><button onClick={() => setPreset("month")}>This month</button><button onClick={() => setPreset("sinceJuly")}>Since 1 July</button></div>
            <div className="filter-grid">
              <label className="filter-field"><span>From</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
              <label className="filter-field"><span>To</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
              <FilterSelect label="Country" value={draft.country ?? ""} options={data?.filterOptions.countries ?? []} onChange={(country) => setDraft({ ...draft, country })} />
              <FilterSelect label="Original source" value={draft.originalSource ?? ""} options={data?.filterOptions.originalSources ?? []} onChange={(originalSource) => setDraft({ ...draft, originalSource })} />
              <FilterSelect label="Latest source" value={draft.latestSource ?? ""} options={data?.filterOptions.latestSources ?? []} onChange={(latestSource) => setDraft({ ...draft, latestSource })} />
              <FilterSelect label="ICP tier" value={draft.tier ?? ""} options={data?.filterOptions.tiers ?? []} onChange={(tier) => setDraft({ ...draft, tier })} />
              <FilterSelect label="Persona" value={draft.persona ?? ""} options={data?.filterOptions.personas ?? []} onChange={(persona) => setDraft({ ...draft, persona })} />
              <div className="filter-actions"><button className="secondary-button" onClick={resetFilters}>Reset</button><button className="primary-button" onClick={() => setApplied(draft)}><Search size={15} />Apply filters</button></div>
            </div>
            <p className="filter-note">Country, source, tier, and persona filters are applied to the SDR contact cohort and associated CRM activities.</p>
          </div>

          {data?.meta.warnings.length ? <div className="warning-banner"><AlertTriangle size={17} /><div><strong>{data.meta.isDemo ? "Demo mode" : "Some HubSpot data sources were unavailable"}</strong><span>{data.meta.warnings.join(" · ")}</span></div></div> : null}
          {error && <div className="error-banner"><AlertTriangle size={20} /><div><strong>Dashboard failed to load</strong><span>{error}</span></div><button onClick={() => void loadDashboard()}>Try again</button></div>}

          {data && <>
            {activeTab === "overview" && <>
              <div className="kpi-grid">{kpis.map((card) => <KpiCard key={card.label} {...card} onClick={() => setActiveTab(card.tab)} />)}</div>
              <div className="two-column wide-left">
                <Section title="Daily SDR execution" description="Calls, connected calls, completed tasks, meetings, and emails by activity date.">
                  <ResponsiveContainer width="100%" height={340}><AreaChart data={data.dailyActivities} margin={{ left: -12, right: 10, top: 12 }}><defs><linearGradient id="calls" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c5cff" stopOpacity={0.45}/><stop offset="95%" stopColor="#7c5cff" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#24314c" /><XAxis dataKey="date" tickFormatter={(item) => item.slice(5)} tick={{ fill: "#8b98b2", fontSize: 11 }} axisLine={false}/><YAxis tick={{ fill: "#8b98b2", fontSize: 11 }} axisLine={false}/><Tooltip content={<ChartTooltip />} /><Legend /><Area type="monotone" dataKey="calls" stroke="#7c5cff" fill="url(#calls)" strokeWidth={2.5}/><Line type="monotone" dataKey="connected" stroke="#00c2a8" strokeWidth={2}/><Line type="monotone" dataKey="tasksCompleted" stroke="#ffb547" strokeWidth={2}/><Line type="monotone" dataKey="meetingsBooked" stroke="#4da3ff" strokeWidth={2}/></AreaChart></ResponsiveContainer>
                </Section>
                <Section title="SDR conversion funnel" description="Unique contacts where activity associations are available.">
                  {data.funnel.length ? <ResponsiveContainer width="100%" height={340}><FunnelChart><Tooltip content={<ChartTooltip />} /><Funnel dataKey="value" data={data.funnel} isAnimationActive><LabelList position="right" fill="#dce4f4" stroke="none" dataKey="name" />{data.funnel.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}</Funnel></FunnelChart></ResponsiveContainer> : <EmptyChart />}
                </Section>
              </div>
              <div className="two-column alerts-layout">
                <Section title="Operational alerts" description="Actionable issues ranked by urgency."><div className="alert-list">{data.alerts.map((alert) => <button key={alert.id} className={`alert-item ${alert.severity}`}><span className="alert-icon">{alert.severity === "critical" ? <AlertTriangle size={17}/> : <Activity size={17}/>}</span><div><strong>{alert.title}</strong><p>{alert.detail}</p><small>{alert.action}<ChevronRight size={12}/></small></div><b>{alert.count}</b></button>)}</div></Section>
                <Section title="Lead status mix" description="Current prospecting position across the SDR portfolio."><HorizontalBars data={data.leadStatuses} color="#00c2a8" /></Section>
              </div>
              <Section title="Priority leads" description="ICP strength plus untouched and missing-next-activity risk." action={<span className="table-count">Top {Math.min(15, data.priorityContacts.length)}</span>}><ContactTable rows={data.priorityContacts.slice(0, 15)} /></Section>
            </>}

            {activeTab === "attribution" && <>
              <div className="section-intro"><Target size={21}/><div><strong>Multi-touch source intelligence</strong><p>Original source explains first acquisition; latest source shows recent re-engagement; record source shows how the CRM record was created.</p></div></div>
              <div className="three-column"><Section title="Original traffic source" description="First known source plus drill-down fields in HubSpot."><DonutChart data={data.originalSources} centerLabel="first touch" /></Section><Section title="Latest traffic source" description="The most recent tracked session source."><DonutChart data={data.latestSources} centerLabel="latest touch" /></Section><Section title="Record source" description="Integration, import, form, CRM UI, or API creation."><DonutChart data={data.recordSources} centerLabel="records" /></Section></div>
              <div className="two-column"><Section title="Lead status by portfolio" description="Current sales outreach status."><HorizontalBars data={data.leadStatuses} color="#4da3ff" /></Section><Section title="Lifecycle stage" description="Lead-to-opportunity readiness."><HorizontalBars data={data.lifecycleStages} color="#a78bfa" /></Section></div>
              <Section title="Attribution drill-down" description="Priority contacts with original, latest, and record source."><ContactTable rows={data.priorityContacts.slice(0, 30)} attribution /></Section>
            </>}

            {activeTab === "activities" && <>
              <div className="activity-kpis"><MiniMetric label="Connected calls" value={data.kpis.connectedCalls} rate={`${data.kpis.connectionRate}%`} icon={Phone}/><MiniMetric label="Completed tasks" value={data.kpis.completedTasks} rate={`${data.kpis.openTasks} open`} icon={CheckCircle2}/><MiniMetric label="Completed meetings" value={data.kpis.completedMeetings} rate={`${data.kpis.meetingCompletionRate}%`} icon={CalendarDays}/><MiniMetric label="Email replies" value={data.kpis.emailReplies} rate={`${data.kpis.emailReplyRate}%`} icon={Mail}/></div>
              <Section title="Daily activity volume" description="Execution trend for the selected date range."><ResponsiveContainer width="100%" height={350}><BarChart data={data.dailyActivities}><CartesianGrid strokeDasharray="3 3" stroke="#24314c"/><XAxis dataKey="date" tickFormatter={(item) => item.slice(5)} tick={{ fill: "#8b98b2", fontSize: 11 }}/><YAxis tick={{ fill: "#8b98b2", fontSize: 11 }}/><Tooltip content={<ChartTooltip />}/><Legend/><Bar dataKey="calls" fill="#7c5cff" radius={[5,5,0,0]}/><Bar dataKey="tasksCompleted" fill="#ffb547" radius={[5,5,0,0]}/><Bar dataKey="emailsSent" fill="#4da3ff" radius={[5,5,0,0]}/><Bar dataKey="meetingsBooked" fill="#00c2a8" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></Section>
              <div className="three-column"><Section title="Call outcomes"><DonutChart data={data.callOutcomes} centerLabel="calls" /></Section><Section title="Task status"><DonutChart data={data.taskStatuses} centerLabel="tasks" /></Section><Section title="Email engagement"><HorizontalBars data={data.emailPerformance} color="#4da3ff" /></Section></div>
              <div className="three-column"><Section title="Meeting outcomes"><DonutChart data={data.meetingOutcomes} centerLabel="meetings" /></Section><Section title="Meeting assigned to"><HorizontalBars data={data.meetingOwners} color="#00c2a8" /></Section><Section title="Meeting source"><HorizontalBars data={data.meetingSources} color="#ffb547" /></Section></div>
            </>}

            {activeTab === "quality" && <>
              <div className="quality-grid">{data.quality.map((metric) => <div className="quality-card" key={metric.key}><div><span>{metric.label}</span><b>{metric.rate}%</b></div><div className="progress"><i style={{ width: `${metric.rate}%` }} /></div><small>{metric.complete} complete · {metric.total - metric.complete} missing</small></div>)}</div>
              <div className="two-column"><Section title="Data quality risks" description="Missing or invalid fields that block outreach."><div className="alert-list">{data.alerts.filter((item) => ["wrong-phone", "missing-source", "high-icp"].includes(item.id)).map((alert) => <div key={alert.id} className={`alert-item ${alert.severity}`}><span className="alert-icon"><AlertTriangle size={17}/></span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div><b>{alert.count}</b></div>)}</div></Section><Section title="Recommended automation" description="High-impact fixes for the n8n SDR workflow."><div className="recommendation-list"><div><Sparkles/><span><strong>Source normalization</strong> Preserve HubSpot original source and write outbound provider into GTM Source.</span></div><div><Phone/><span><strong>Phone recovery</strong> Wrong Number → SignalHire fallback → task with only new numbers.</span></div><div><CalendarDays/><span><strong>Meeting dedupe</strong> Merge calendar-sync and CRM outcome activities by contact, date, and hour.</span></div><div><Target/><span><strong>SLA alerts</strong> Tier A untouched after 24 hours triggers a high-priority task.</span></div></div></Section></div>
              <Section title="Records needing attention"><ContactTable rows={data.priorityContacts.slice(0, 40)} /></Section>
            </>}

            {activeTab === "companies" && <>
              <div className="three-column"><Section title="Companies by country"><DonutChart data={data.countries} centerLabel="companies" /></Section><Section title="Top industries"><HorizontalBars data={data.industries} color="#4da3ff" /></Section><Section title="Detected ATS"><HorizontalBars data={data.atsPlatforms} color="#00c2a8" /></Section></div>
              <Section title="Account intelligence" description="Company firmographics, ATS, and SDR contact coverage." action={<span className="table-count">{data.companies.length} accounts</span>}><CompanyTable data={data} /></Section>
            </>}

            {activeTab === "pipeline" && <>
              <div className="activity-kpis"><MiniMetric label="Deals created" value={data.kpis.dealsCreated} rate="Selected period" icon={BriefcaseBusiness}/><MiniMetric label="Open deals" value={data.kpis.openDeals} rate="SDR-attributed" icon={Target}/><MiniMetric label="Pipeline value" value={data.kpis.pipelineValue} rate="USD" icon={CircleDollarSign} currency/><MiniMetric label="Meeting → deal" value={data.kpis.bookedMeetings ? Math.round((data.kpis.dealsCreated / data.kpis.bookedMeetings) * 1000) / 10 : 0} rate="% conversion" icon={ArrowUpRight}/></div>
              <div className="two-column"><Section title="Deal stage volume" description="Deals associated with contacts in the selected SDR cohort."><HorizontalBars data={data.dealStages} color="#7c5cff" /></Section><Section title="Pipeline value by stage" description="Open and closed value where deal amounts are populated."><HorizontalBars data={data.dealStages} color="#00c2a8" amount /></Section></div>
              <Section title="Attributed deals" description="Click any deal to open the original HubSpot record."><DealTable data={data} /></Section>
            </>}
          </>}
          {loading && <div className="loading-overlay"><div className="loader"/><strong>Building live SDR intelligence…</strong><span>Contacts, activities, associations, companies, and deals</span></div>}
        </div>
      </div>
    </main>
  );
}

function MiniMetric({ label, value, rate, icon: Icon, currency = false }: { label: string; value: number; rate: string; icon: LucideIcon; currency?: boolean }) {
  return <div className="mini-metric"><span><Icon size={17}/>{label}</span><strong>{currency ? formatCurrency(value) : formatNumber(value)}</strong><small>{rate}</small></div>;
}

function ContactTable({ rows, attribution = false }: { rows: DashboardData["priorityContacts"]; attribution?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Priority</th><th>Contact</th><th>Company</th><th>Country</th>{attribution ? <><th>Original source</th><th>Latest source</th><th>Record source</th></> : <><th>Tier</th><th>Lead status</th><th>Phone</th><th>Next activity</th></>}<th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className={`score ${row.priorityScore >= 85 ? "high" : row.priorityScore >= 65 ? "medium" : "low"}`}>{row.priorityScore}</span></td><td><strong>{row.name}</strong><small>{row.title || "No job title"}</small></td><td>{row.company || "—"}</td><td>{row.country || "—"}</td>{attribution ? <><td>{row.originalSource}</td><td>{row.latestSource}</td><td>{row.recordSource}</td></> : <><td><span className="tag">{row.tier}</span></td><td>{row.leadStatus}</td><td>{row.phoneStatus}</td><td>{shortDate(row.nextActivity)}</td></>}<td><a href={row.url} target="_blank" rel="noreferrer" aria-label={`Open ${row.name} in HubSpot`}><ExternalLink size={15}/></a></td></tr>)}</tbody></table></div>;
}

function CompanyTable({ data }: { data: DashboardData }) {
  return <div className="table-wrap"><table><thead><tr><th>Company</th><th>Country</th><th>Industry</th><th>Employees</th><th>Tier</th><th>ATS</th><th>Confidence</th><th>Contacts</th><th /></tr></thead><tbody>{data.companies.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.domain || "No domain"}</small></td><td>{row.country || "—"}</td><td>{pretty(row.industry || "Unknown")}</td><td>{row.employees || "—"}</td><td><span className="tag">{row.tier || "—"}</span></td><td>{row.ats || "Unknown"}<small>{pretty(row.atsCategory)}</small></td><td>{pretty(row.atsConfidence || "Unknown")}</td><td>{row.associatedContacts}</td><td><a href={row.url} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a></td></tr>)}</tbody></table></div>;
}

function DealTable({ data }: { data: DashboardData }) {
  return <div className="table-wrap"><table><thead><tr><th>Deal</th><th>Stage</th><th>Owner</th><th>Amount</th><th>Close date</th><th /></tr></thead><tbody>{data.deals.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td><span className="tag">{row.stage}</span></td><td>{row.owner || "Unassigned"}</td><td>{formatCurrency(row.amount)}</td><td>{shortDate(row.closeDate)}</td><td><a href={row.url} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a></td></tr>)}</tbody></table></div>;
}
