"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  ExternalLink,
  Gauge,
  Globe2,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  ShieldCheck,
  UploadCloud,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import styles from "@/components/CareerIntelligence.module.css";

type CareerStatus =
  | "needs_research"
  | "processing"
  | "found_verified"
  | "no_public_career_page"
  | "needs_manual_review"
  | "website_domain_invalid"
  | "insufficient_company_data";

interface CareerCompany {
  companyId: string;
  companyName: string;
  domain: string;
  website: string;
  careerPageUrl: string;
  detectedAts: string;
  atsStatus: string;
  atsConfidence: string;
  status: CareerStatus;
  confidenceScore: number;
  verificationReason: string;
  verificationSource: string;
  evidenceUrl: string;
  detectionMethod: string;
  pagesChecked: number;
  staticPagesChecked: number;
  browserPagesChecked: number;
  cacheHit: boolean;
  playwrightUsed: boolean;
  lastCheckedAt: string;
  hubspotUrl: string;
  hubspotPushStatus: "" | "pushed" | "skipped" | "error";
  hubspotPushedAt: string;
  engineDurationMs: number;
}

interface CareerSummary {
  total: number;
  completed: number;
  remaining: number;
  foundVerified: number;
  noPublicCareer: number;
  manualReview: number;
  invalidDomain: number;
  insufficientData: number;
  processing: number;
  staticResolved: number;
  browserResolved: number;
  cacheResolved: number;
  coverageRate: number;
  browserUsageRate: number;
}

interface CareerPayload {
  generatedAt: string;
  summary: CareerSummary;
  pagination: { page: number; pageSize: number; total: number; pages: number };
  companies: CareerCompany[];
}

const STATUS_OPTIONS: Array<{ value: "" | CareerStatus; label: string }> = [
  { value: "", label: "All companies" },
  { value: "needs_research", label: "Needs research" },
  { value: "found_verified", label: "Found & verified" },
  { value: "no_public_career_page", label: "No public career" },
  { value: "needs_manual_review", label: "Manual review" },
  { value: "website_domain_invalid", label: "Invalid domain" },
  { value: "insufficient_company_data", label: "Insufficient data" },
];

function statusLabel(status: CareerStatus) {
  if (status === "found_verified") return "Found & Verified";
  if (status === "no_public_career_page") return "No Public Career";
  if (status === "needs_manual_review") return "Manual Review";
  if (status === "website_domain_invalid") return "Invalid Domain";
  if (status === "insufficient_company_data") return "Insufficient Data";
  if (status === "processing") return "Processing";
  return "Needs Research";
}

function formatDate(value: string) {
  if (!value) return "Not checked";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDuration(value: number) {
  if (!value) return "—";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function statusIcon(status: CareerStatus) {
  if (status === "found_verified") return <CheckCircle2 size={14}/>;
  if (status === "no_public_career_page") return <Ban size={14}/>;
  if (status === "needs_manual_review") return <CircleAlert size={14}/>;
  if (status === "website_domain_invalid" || status === "insufficient_company_data") return <XCircle size={14}/>;
  if (status === "processing") return <RefreshCw size={14} className={styles.spin}/>;
  return <Search size={14}/>;
}

function MetricCard({ icon, label, value, helper, accent = false }: { icon: React.ReactNode; label: string; value: string; helper: string; accent?: boolean }) {
  return <div className={`${styles.metricCard} ${accent ? styles.metricAccent : ""}`}>
    <div className={styles.metricHeader}><span>{label}</span>{icon}</div>
    <strong>{value}</strong>
    <small>{helper}</small>
  </div>;
}

export function CareerIntelligence({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<CareerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | CareerStatus>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CareerCompany | null>(null);
  const [running, setRunning] = useState<"" | "25" | "100" | "all" | "single">("");
  const [runMessage, setRunMessage] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  const load = useCallback(async (force = false) => {
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (search.trim()) params.set("q", search.trim());
    if (status) params.set("status", status);
    if (force) params.set("refresh", "1");
    try {
      const response = await fetch(`/api/career-intelligence?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load Career Intelligence");
      setData(payload as CareerPayload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Career Intelligence");
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (running) return;
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load, running]);

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  useEffect(() => {
    setManualUrl(selected?.careerPageUrl || selected?.evidenceUrl || "");
  }, [selected]);

  const summary = data?.summary;
  const efficiency = useMemo(() => {
    if (!summary?.completed) return { staticRate: 0, browserRate: 0, cacheRate: 0 };
    const divisor = summary.completed;
    return {
      staticRate: Math.round((summary.staticResolved / divisor) * 100),
      browserRate: Math.round((summary.browserResolved / divisor) * 100),
      cacheRate: Math.round((summary.cacheResolved / divisor) * 100),
    };
  }, [summary]);

  async function runWave(limit: number, companyIds?: string[], forceRefresh = false) {
    const response = await fetch("/api/career-intelligence/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit, companyIds, forceRefresh }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Career scan failed");
    return payload as { remainingEligible: number; processed: CareerCompany[]; summary: CareerSummary };
  }

  async function runBatch(mode: "25" | "100" | "all") {
    if (running) return;
    setRunning(mode);
    setError("");
    setRunMessage(mode === "all" ? "Starting continuous scan…" : `Scanning up to ${mode} companies…`);
    try {
      if (mode !== "all") {
        const result = await runWave(Number(mode));
        setRunMessage(`Processed ${result.processed.length} companies. ${result.remainingEligible} still waiting.`);
      } else {
        let remaining = summary?.remaining ?? 1;
        let processed = 0;
        let waves = 0;
        while (remaining > 0 && waves < 100) {
          const result = await runWave(100);
          processed += result.processed.length;
          remaining = result.remainingEligible;
          waves += 1;
          setRunMessage(`Run All: ${processed} processed in this session · ${remaining} waiting`);
          if (!result.processed.length) break;
        }
      }
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Career scan failed");
    } finally {
      setRunning("");
    }
  }

  async function recheck(company: CareerCompany) {
    if (running) return;
    setRunning("single");
    setError("");
    try {
      const result = await runWave(1, [company.companyId], true);
      if (result.processed[0]) setSelected(result.processed[0]);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recheck failed");
    } finally {
      setRunning("");
    }
  }

  async function action(company: CareerCompany, kind: "approve" | "reject" | "push") {
    setError("");
    try {
      const response = await fetch("/api/career-intelligence/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.companyId, action: kind, careerPageUrl: kind === "approve" ? manualUrl : undefined }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Action failed");
      setSelected(payload.company as CareerCompany);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Action failed");
    }
  }

  return <main className={styles.page}>
    <div className={styles.topbar}>
      <button className={styles.backButton} type="button" onClick={onBack}><ArrowLeft size={17}/>SDR Dashboard</button>
      <div className={styles.topPills}>
        <span><ShieldCheck size={12}/>Strict verification</span>
        <span><Database size={12}/>HubSpot synced</span>
        <span><Zap size={12}/>Static-first</span>
      </div>
    </div>

    <section className={styles.hero}>
      <div>
        <div className={styles.eyebrow}><Globe2 size={16}/>Talentera GTM Data Operations</div>
        <h1>Career Intelligence</h1>
        <p>Discover, verify and review official employer Career Pages with the ATS engine, then safely push approved results back to HubSpot.</p>
      </div>
      <div className={styles.runPanel}>
        <div><span>Portfolio progress</span><strong>{summary?.coverageRate ?? 0}%</strong></div>
        <div className={styles.progressTrack}><i style={{ width: `${summary?.coverageRate ?? 0}%` }}/></div>
        <div className={styles.runButtons}>
          <button type="button" disabled={Boolean(running)} onClick={() => void runBatch("25")}><Play size={14}/>Run 25</button>
          <button type="button" disabled={Boolean(running)} onClick={() => void runBatch("100")}><Play size={14}/>Run 100</button>
          <button className={styles.runAll} type="button" disabled={Boolean(running)} onClick={() => void runBatch("all")}><Zap size={14}/>{running === "all" ? "Running…" : "Run All"}</button>
        </div>
        {runMessage && <small>{runMessage}</small>}
      </div>
    </section>

    {error && <div className={styles.errorBanner}><CircleAlert size={16}/><span>{error}</span><button type="button" onClick={() => setError("")}><X size={14}/></button></div>}

    <section className={styles.metrics}>
      <MetricCard icon={<Database size={18}/>} label="Total Portfolio" value={String(summary?.total ?? 0)} helper={`${summary?.remaining ?? 0} still unresolved`}/>
      <MetricCard icon={<CheckCircle2 size={18}/>} label="Found & Verified" value={String(summary?.foundVerified ?? 0)} helper="Safe Career Page candidates" accent/>
      <MetricCard icon={<Ban size={18}/>} label="No Public Career" value={String(summary?.noPublicCareer ?? 0)} helper="Evidence-backed negative result"/>
      <MetricCard icon={<CircleAlert size={18}/>} label="Manual Review" value={String(summary?.manualReview ?? 0)} helper="Blocked or ambiguous cases"/>
      <MetricCard icon={<XCircle size={18}/>} label="Data / Domain Issues" value={String((summary?.invalidDomain ?? 0) + (summary?.insufficientData ?? 0))} helper="Invalid or insufficient input"/>
    </section>

    <section className={styles.engineStrip}>
      <div className={styles.engineHeading}><Gauge size={17}/><div><strong>Engine Efficiency</strong><span>Keep browser usage low and resolve the portfolio with free/static methods first.</span></div></div>
      <div className={styles.engineStats}>
        <span><Server size={14}/><b>{efficiency.staticRate}%</b> Static</span>
        <span><Bot size={14}/><b>{efficiency.browserRate}%</b> Browser</span>
        <span><Database size={14}/><b>{efficiency.cacheRate}%</b> Cache</span>
      </div>
    </section>

    <section className={styles.workspace}>
      <div className={styles.toolbar}>
        <label className={styles.searchBox}><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, domain, ATS or reason…"/></label>
        <select value={status} onChange={(event) => setStatus(event.target.value as "" | CareerStatus)}>
          {STATUS_OPTIONS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <button className={styles.refreshButton} type="button" onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""}/>Refresh</button>
      </div>

      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Company</th><th>Career Page</th><th>ATS</th><th>Status</th><th>Confidence</th><th>Method</th><th>Checked</th><th/></tr></thead>
          <tbody>
            {data?.companies.map((company) => <tr key={company.companyId} onClick={() => setSelected(company)}>
              <td><strong>{company.companyName}</strong><small>{company.domain || "No domain"}</small></td>
              <td>{company.careerPageUrl ? <a href={company.careerPageUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{company.careerPageUrl.replace(/^https?:\/\//, "").slice(0, 38)}<ExternalLink size={11}/></a> : <span className={styles.muted}>—</span>}</td>
              <td>{company.detectedAts || <span className={styles.muted}>Not detected</span>}</td>
              <td><span className={`${styles.statusBadge} ${styles[company.status]}`}>{statusIcon(company.status)}{statusLabel(company.status)}</span></td>
              <td><div className={styles.confidence}><i style={{ width: `${company.confidenceScore}%` }}/><span>{company.confidenceScore ? `${company.confidenceScore}%` : "—"}</span></div></td>
              <td><span className={styles.method}>{company.cacheHit ? "Cache" : company.playwrightUsed ? "Browser" : company.detectionMethod ? "Static" : "—"}</span></td>
              <td>{formatDate(company.lastCheckedAt)}</td>
              <td><button className={styles.rowButton} type="button">View</button></td>
            </tr>)}
            {!loading && !data?.companies.length && <tr><td colSpan={8} className={styles.empty}>No companies match this view.</td></tr>}
            {loading && !data && <tr><td colSpan={8} className={styles.empty}>Loading Career Intelligence…</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <span>{data?.pagination.total ?? 0} matching companies</span>
        <div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15}/></button><span>Page {data?.pagination.page ?? page} / {data?.pagination.pages ?? 1}</span><button type="button" disabled={page >= (data?.pagination.pages ?? 1)} onClick={() => setPage((current) => current + 1)}><ChevronRight size={15}/></button></div>
      </div>
    </section>

    {selected && <div className={styles.drawerBackdrop} onMouseDown={() => setSelected(null)}>
      <aside className={styles.drawer} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div><span>{statusLabel(selected.status)}</span><h2>{selected.companyName}</h2><p>{selected.domain || "No domain"}</p></div>
          <button type="button" onClick={() => setSelected(null)}><X size={18}/></button>
        </div>

        <div className={styles.drawerActions}>
          {selected.website && <a href={selected.website} target="_blank" rel="noreferrer"><Globe2 size={14}/>Website</a>}
          {selected.hubspotUrl !== "#" && <a href={selected.hubspotUrl} target="_blank" rel="noreferrer"><Database size={14}/>HubSpot</a>}
          <button type="button" disabled={Boolean(running)} onClick={() => void recheck(selected)}><RotateCw size={14}/>Force recheck</button>
        </div>

        <div className={styles.detailGrid}>
          <div><span>Career Page</span><strong>{selected.careerPageUrl || "Not found"}</strong></div>
          <div><span>ATS</span><strong>{selected.detectedAts || "Not detected"}</strong></div>
          <div><span>Confidence</span><strong>{selected.confidenceScore ? `${selected.confidenceScore}%` : "—"}</strong></div>
          <div><span>Pages checked</span><strong>{selected.pagesChecked}</strong></div>
          <div><span>Static / Browser</span><strong>{selected.staticPagesChecked} / {selected.browserPagesChecked}</strong></div>
          <div><span>Engine time</span><strong>{formatDuration(selected.engineDurationMs)}</strong></div>
          <div><span>Detection method</span><strong>{selected.detectionMethod || "—"}</strong></div>
          <div><span>Last checked</span><strong>{formatDate(selected.lastCheckedAt)}</strong></div>
        </div>

        <div className={styles.reasonBox}><span>Verification reason</span><p>{selected.verificationReason || "No evidence note yet."}</p>{selected.evidenceUrl && <a href={selected.evidenceUrl} target="_blank" rel="noreferrer">Open evidence <ExternalLink size={12}/></a>}</div>

        {(selected.status === "needs_manual_review" || selected.status === "found_verified") && <div className={styles.reviewBox}>
          <label>Career Page URL<input value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://company.com/careers"/></label>
          <div>
            <button className={styles.approveButton} type="button" onClick={() => void action(selected, "approve")}><Check size={14}/>Approve</button>
            <button className={styles.rejectButton} type="button" onClick={() => void action(selected, "reject")}><Ban size={14}/>No Career Page</button>
          </div>
        </div>}

        {selected.status === "found_verified" && <div className={styles.pushBox}>
          <div><UploadCloud size={18}/><span><strong>HubSpot update</strong><small>{selected.hubspotPushStatus === "pushed" ? `Pushed ${formatDate(selected.hubspotPushedAt)}` : "Re-reads the company first and never overwrites a different existing Career Page."}</small></span></div>
          <button type="button" disabled={selected.hubspotPushStatus === "pushed"} onClick={() => void action(selected, "push")}><UploadCloud size={14}/>{selected.hubspotPushStatus === "pushed" ? "Pushed" : "Push to HubSpot"}</button>
        </div>}
      </aside>
    </div>}
  </main>;
}
