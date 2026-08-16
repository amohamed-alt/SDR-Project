"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Flame,
  Gauge,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import styles from "@/components/HiringIntelligence.module.css";

interface HiringJob {
  externalId: string;
  title: string;
  location: string;
  department: string;
  url: string;
  postedAt: string;
  firstSeenAt: string;
}

interface SnapshotPoint {
  checkedAt: string;
  activeJobs: number;
  newJobs7d: number;
  score: number;
}

interface HiringCompany {
  companyId: string;
  name: string;
  domain: string;
  country: "Saudi Arabia" | "United Arab Emirates";
  careerPageUrl: string;
  ats: string;
  hubspotUrl: string;
  sourceKind: "greenhouse" | "lever" | "smartrecruiters" | "generic";
  sourceConfidence: "high" | "medium" | "low";
  sourceUrl: string;
  activeJobs: number;
  previousActiveJobs: number;
  newJobs7d: number;
  newJobs30d: number;
  closedJobs7d: number;
  hiringScore: number;
  hiringStatus: "No Signal" | "Hiring" | "Active Hiring" | "Strong Hiring" | "Hiring Surge";
  trend: "New hiring" | "Surging" | "Growing" | "Stable" | "Cooling" | "No active hiring";
  topDepartments: string[];
  topLocations: string[];
  lastCheckedAt: string;
  lastSuccessfulCheckAt: string;
  scanStatus: "success" | "inconclusive" | "error" | "pending";
  error: string;
  jobs: HiringJob[];
  snapshots: SnapshotPoint[];
}

interface HiringPayload {
  meta: {
    generatedAt: string;
    refreshCadenceHours: number;
    countries: string[];
    run: {
      startedAt: string;
      completedAt: string;
      scanned: number;
      succeeded: number;
      inconclusive: number;
      failed: number;
      eligibleCompanies: number;
      scanLimit: number;
    };
  };
  summary: {
    monitoredCompanies: number;
    checkedCompanies: number;
    coverageRate: number;
    hiringNow: number;
    strongHiring: number;
    hiringSurges: number;
    newJobs7d: number;
  };
  companies: HiringCompany[];
}

type StatusFilter = "" | HiringCompany["hiringStatus"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ageLabel(value: string) {
  if (!value) return "Pending first scan";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function statusTone(status: HiringCompany["hiringStatus"]) {
  if (status === "Hiring Surge") return styles.surge;
  if (status === "Strong Hiring") return styles.strong;
  if (status === "Active Hiring") return styles.active;
  if (status === "Hiring") return styles.hiring;
  return styles.quiet;
}

function sourceLabel(source: HiringCompany["sourceKind"]) {
  if (source === "greenhouse") return "Greenhouse API";
  if (source === "lever") return "Lever API";
  if (source === "smartrecruiters") return "SmartRecruiters API";
  return "Career Page";
}

function TrendIcon({ trend }: { trend: HiringCompany["trend"] }) {
  if (["Surging", "Growing", "New hiring"].includes(trend)) return <TrendingUp size={15}/>;
  if (trend === "Cooling") return <TrendingDown size={15}/>;
  return <ArrowUpRight size={15}/>;
}

function MetricCard({ icon, label, value, helper, emphasis = false }: { icon: React.ReactNode; label: string; value: string; helper: string; emphasis?: boolean }) {
  return <div className={`${styles.metricCard} ${emphasis ? styles.metricEmphasis : ""}`}>
    <div className={styles.metricHeader}><span>{label}</span>{icon}</div>
    <strong>{value}</strong>
    <small>{helper}</small>
  </div>;
}

export function HiringIntelligence({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<HiringPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [ats, setAts] = useState("");
  const [selected, setSelected] = useState<HiringCompany | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/hiring", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load hiring intelligence");
        if (!cancelled) setData(payload as HiringPayload);
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Unable to load hiring intelligence");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const atsOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.companies.map((company) => company.ats || sourceLabel(company.sourceKind)).filter(Boolean))].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.companies.filter((company) => {
      if (query && ![company.name, company.domain, company.ats, ...company.topDepartments, ...company.topLocations].join(" ").toLowerCase().includes(query)) return false;
      if (country && company.country !== country) return false;
      if (status && company.hiringStatus !== status) return false;
      if (ats && (company.ats || sourceLabel(company.sourceKind)) !== ats) return false;
      return true;
    });
  }, [ats, country, data, search, status]);

  const initialized = Boolean(data?.meta.generatedAt);

  return <main className={styles.page}>
    <div className={styles.topbar}>
      <button className={styles.backButton} type="button" onClick={onBack}><ArrowLeft size={17}/>SDR Dashboard</button>
      <div className={styles.scopePills}><span>🇸🇦 KSA</span><span>🇦🇪 UAE</span><span><RefreshCw size={12}/>Every {data?.meta.refreshCadenceHours ?? 6}h</span></div>
    </div>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <div className={styles.eyebrow}><Flame size={16}/>Talentera Buying Intent</div>
        <h1>Hiring Intelligence</h1>
        <p>Live hiring signals from public ATS feeds and company career pages, scored for SDR outreach priority.</p>
        <div className={styles.heroMeta}>
          <span><Clock3 size={14}/>{initialized ? `Updated ${ageLabel(data?.meta.generatedAt ?? "")}` : "Waiting for first scan"}</span>
          <span><ShieldCheck size={14}/>Public hiring data only</span>
          <span><Gauge size={14}/>{data?.summary.coverageRate ?? 0}% scan coverage</span>
        </div>
      </div>
      <div className={styles.heroBadge}><Sparkles size={22}/><strong>{data?.summary.hiringSurges ?? 0}</strong><span>Hiring Surges</span></div>
    </section>

    {error && <div className={styles.errorBanner}><CircleAlert size={18}/><div><strong>Hiring intelligence unavailable</strong><span>{error}</span></div></div>}

    <section className={styles.metrics}>
      <MetricCard icon={<Building2 size={18}/>} label="Monitored Companies" value={formatNumber(data?.summary.monitoredCompanies ?? 0)} helper={`${data?.summary.checkedCompanies ?? 0} checked successfully`}/>
      <MetricCard icon={<BriefcaseBusiness size={18}/>} label="Hiring Now" value={formatNumber(data?.summary.hiringNow ?? 0)} helper="Companies with active vacancies"/>
      <MetricCard icon={<Flame size={18}/>} label="Strong Intent" value={formatNumber(data?.summary.strongHiring ?? 0)} helper="Hiring Score 60+" emphasis/>
      <MetricCard icon={<TrendingUp size={18}/>} label="New Jobs · 7d" value={formatNumber(data?.summary.newJobs7d ?? 0)} helper="New vacancies first detected this week"/>
      <MetricCard icon={<Sparkles size={18}/>} label="Hiring Surges" value={formatNumber(data?.summary.hiringSurges ?? 0)} helper="Hiring Score 80+" emphasis/>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div><h2>Companies to contact</h2><p>Highest-intent KSA and UAE accounts first. Open a company to see the actual job evidence.</p></div>
        <div className={styles.runMeta}>
          {data?.meta.run.completedAt ? <><CheckCircle2 size={14}/><span>Last run: {data.meta.run.succeeded}/{data.meta.run.scanned} successful</span></> : <><Clock3 size={14}/><span>Initial scan pending</span></>}
        </div>
      </div>

      <div className={styles.filters}>
        <label className={styles.searchField}><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, ATS, department, location…"/></label>
        <select value={country} onChange={(event) => setCountry(event.target.value)}><option value="">All countries</option><option value="Saudi Arabia">Saudi Arabia</option><option value="United Arab Emirates">United Arab Emirates</option></select>
        <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="">All signals</option><option>Hiring Surge</option><option>Strong Hiring</option><option>Active Hiring</option><option>Hiring</option><option>No Signal</option></select>
        <select value={ats} onChange={(event) => setAts(event.target.value)}><option value="">All ATS</option>{atsOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <span className={styles.resultCount}>{filtered.length} companies</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Company</th><th>Signal</th><th>Score</th><th>Active Jobs</th><th>New 7d</th><th>Trend</th><th>Top Hiring</th><th>Source</th><th>Checked</th><th/></tr></thead>
          <tbody>
            {filtered.map((company) => <tr key={company.companyId}>
              <td><button className={styles.companyButton} type="button" onClick={() => setSelected(company)}><strong>{company.name}</strong><small><MapPin size={11}/>{company.country === "Saudi Arabia" ? "KSA" : "UAE"}{company.domain ? ` · ${company.domain}` : ""}</small></button></td>
              <td><span className={`${styles.statusPill} ${statusTone(company.hiringStatus)}`}>{company.hiringStatus}</span>{company.scanStatus !== "success" && <small className={styles.scanNote}>{company.scanStatus}</small>}</td>
              <td><span className={`${styles.score} ${company.hiringScore >= 80 ? styles.scoreHot : company.hiringScore >= 60 ? styles.scoreStrong : ""}`}>{company.hiringScore}</span></td>
              <td><strong>{company.activeJobs}</strong></td>
              <td><strong className={company.newJobs7d > 0 ? styles.positive : ""}>{company.newJobs7d > 0 ? `+${company.newJobs7d}` : "0"}</strong></td>
              <td><span className={`${styles.trend} ${company.trend === "Cooling" ? styles.cooling : ""}`}><TrendIcon trend={company.trend}/>{company.trend}</span></td>
              <td><div className={styles.tags}>{company.topDepartments.slice(0, 2).map((item) => <span key={item}>{item}</span>)}{!company.topDepartments.length && <span>—</span>}</div></td>
              <td><strong className={styles.source}>{company.ats || sourceLabel(company.sourceKind)}</strong><small className={styles.confidence}>{company.sourceConfidence} confidence</small></td>
              <td><span>{ageLabel(company.lastCheckedAt)}</span></td>
              <td><button className={styles.detailButton} type="button" onClick={() => setSelected(company)} aria-label={`Open ${company.name}`}><ChevronRight size={17}/></button></td>
            </tr>)}
            {!loading && !filtered.length && <tr><td colSpan={10}><div className={styles.empty}><BriefcaseBusiness size={26}/><strong>No companies match these filters</strong><span>Clear one or more filters to widen the queue.</span></div></td></tr>}
          </tbody>
        </table>
      </div>
      {loading && <div className={styles.loading}><RefreshCw size={18}/><span>Loading hiring intelligence…</span></div>}
    </section>

    {selected && <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
      <aside className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <div><span className={`${styles.statusPill} ${statusTone(selected.hiringStatus)}`}>{selected.hiringStatus}</span><h2>{selected.name}</h2><p>{selected.country} · {selected.domain || "No domain"}</p></div>
          <button type="button" onClick={() => setSelected(null)}><X size={19}/></button>
        </div>

        <div className={styles.drawerScore}>
          <div><span>Hiring Score</span><strong>{selected.hiringScore}<small>/100</small></strong></div>
          <div><span>Active Jobs</span><strong>{selected.activeJobs}</strong></div>
          <div><span>New · 7d</span><strong className={selected.newJobs7d ? styles.positive : ""}>{selected.newJobs7d ? `+${selected.newJobs7d}` : "0"}</strong></div>
          <div><span>Trend</span><strong className={styles.drawerTrend}><TrendIcon trend={selected.trend}/>{selected.trend}</strong></div>
        </div>

        <div className={styles.drawerSection}>
          <h3>Signal evidence</h3>
          <div className={styles.evidenceGrid}>
            <div><span>ATS / Source</span><strong>{selected.ats || sourceLabel(selected.sourceKind)}</strong></div>
            <div><span>Collector</span><strong>{sourceLabel(selected.sourceKind)}</strong></div>
            <div><span>Confidence</span><strong>{selected.sourceConfidence}</strong></div>
            <div><span>Last checked</span><strong>{formatDate(selected.lastCheckedAt)}</strong></div>
          </div>
          {selected.error && <div className={styles.drawerWarning}><CircleAlert size={15}/>{selected.error}</div>}
        </div>

        <div className={styles.drawerSection}>
          <h3>Where they are hiring</h3>
          <div className={styles.tagsLarge}>{selected.topDepartments.map((item) => <span key={item}>{item}</span>)}{selected.topLocations.map((item) => <span key={item}><MapPin size={11}/>{item}</span>)}{!selected.topDepartments.length && !selected.topLocations.length && <span>No structured department/location data yet</span>}</div>
        </div>

        <div className={styles.drawerSection}>
          <div className={styles.sectionTitle}><h3>Latest active jobs</h3><span>{selected.jobs.length ? `Showing ${selected.jobs.length}` : "No job rows yet"}</span></div>
          <div className={styles.jobList}>{selected.jobs.map((job) => <a key={job.externalId} href={job.url || selected.careerPageUrl} target="_blank" rel="noreferrer"><div><strong>{job.title}</strong><span>{[job.department, job.location].filter(Boolean).join(" · ") || "Job details"}</span></div><ExternalLink size={14}/></a>)}{!selected.jobs.length && <div className={styles.noJobs}>The company is still monitored. A structured job list has not been captured yet.</div>}</div>
        </div>

        <div className={styles.drawerActions}>
          <a href={selected.hubspotUrl} target="_blank" rel="noreferrer"><Building2 size={15}/>Open in HubSpot<ExternalLink size={13}/></a>
          <a href={selected.careerPageUrl || selected.sourceUrl} target="_blank" rel="noreferrer"><BriefcaseBusiness size={15}/>Career Page<ExternalLink size={13}/></a>
        </div>
      </aside>
    </div>}
  </main>;
}
