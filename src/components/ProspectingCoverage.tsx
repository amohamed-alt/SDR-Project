"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, BadgeCheck, Building2, CheckCircle2, CircleAlert, Database,
  Layers3, Radar, Search, Server, ShieldCheck, Target, UsersRound,
} from "lucide-react";
import styles from "./ProspectingCoverage.module.css";
import { ZeroCreditReadyPanel } from "./ZeroCreditReadyPanel";

type CoverageAccount = {
  domain: string;
  name: string;
  country: string;
  employeeCount: number;
  industry: string;
  activeJobs: number;
  gtmScore: number;
  gtmTier: "A" | "B" | "C" | "Watch";
  exclusionStatus: "eligible" | "excluded" | "review";
  exclusionReason: string;
  hubspotCompanyId: string;
  status: string;
  primaryPersona: string;
  evidence: Record<string, unknown>;
};

type CountryRow = {
  country: string;
  stored: number;
  eligible: number;
  review: number;
  excluded: number;
  existingHubSpot: number;
  targetSectors: number;
};

type CoveragePayload = {
  generatedAt: string;
  storage: { database: string; mode: string; autoLoad: boolean; sourceOfTruth: string; paginated?: boolean };
  scope: {
    countries: string[];
    employeeRanges: string[];
    sweetPool: string;
    enterpriseExtension: string;
    governmentIncluded: boolean;
    unknownIndustryPolicy: string;
  };
  probe: {
    provider: string;
    probedAt: string;
    totalEntries: number;
    perPage: number;
    totalPages: number;
    initialCreditsUsed: number;
    completedPages: number[];
    completedPageCount: number;
    partialSpentPages?: number[];
    spentPageCount?: number;
    pageCoveragePercent: number;
    dataCoveragePercent?: number;
    spendCoveragePercent?: number;
    estimatedAdditionalSearchCreditsToFinish: number;
    note: string;
  };
  ledger: {
    stored: number;
    eligible: number;
    existingHubSpot: number;
    review: number;
    excluded: number;
    sweetPool: number;
    enterpriseExtension: number;
    domainPending?: number;
    ready?: number;
    needsPeople?: number;
    searchOnly?: number;
    pushed?: number;
  };
  pagination: { page: number; limit: number; filteredTotal: number; totalPages: number; returned: number };
  countries: CountryRow[];
  accounts: CoverageAccount[];
  error?: string;
};

type StatusFilter = "all" | "net-new" | "hubspot" | "review" | "excluded";

function fmt(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function accountStatus(account: CoverageAccount) {
  if (account.status === "existing_hubspot" || account.hubspotCompanyId) return "Already covered";
  if (account.exclusionStatus === "review") return "Review";
  if (account.exclusionStatus === "eligible") return "Net-new";
  return "Excluded";
}

function headcountLabel(account: CoverageAccount) {
  if (account.employeeCount > 0) return `${fmt(account.employeeCount)} employees`;
  const raw = String(account.evidence?.employeeCoverageTier || "");
  if (raw === "sweet_pool") return "251–5,000 pool";
  if (raw === "enterprise_extension") return "5,001–50,000 extension";
  return "Size pending";
}

export function ProspectingCoverage({ onBack }: { onBack: () => void }) {
  const [payload, setPayload] = useState<CoveragePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "100", status });
      if (country) params.set("country", country);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/acquisition/coverage-status?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as CoveragePayload;
      if (!response.ok) throw new Error(data.error || "Unable to load market coverage.");
      setPayload(data);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load market coverage.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [country, page, query, status]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(false), 120);
    const interval = window.setInterval(() => void load(true), 30_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const refreshFocus = () => void load(true);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshFocus);
    };
  }, [load]);

  const probe = payload?.probe;
  const ledger = payload?.ledger;
  const pagination = payload?.pagination;
  const accounts = payload?.accounts || [];
  const from = pagination?.filteredTotal ? ((pagination.page - 1) * pagination.limit) + 1 : 0;
  const to = pagination ? Math.min(pagination.filteredTotal, from + pagination.returned - 1) : 0;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={15}/> Dashboard</button>
        <div>
          <span className={styles.eyebrow}><Radar size={13}/> TALENTERA MARKET COVERAGE</span>
          <h1>Prospecting Coverage</h1>
          <p>Persistent GCC + Egypt account universe · HubSpot dedupe · Postgres ledger · SignalHire-ready personas</p>
        </div>
      </div>
      <div className={styles.headerRight}>
        <span className={styles.live}><i/><Server size={13}/> AUTO-SYNCED</span>
        <small>{payload?.generatedAt ? `Last read ${new Date(payload.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Loading persistent state…"}</small>
      </div>
    </header>

    {error ? <div className={styles.error}><CircleAlert size={17}/><div><strong>Coverage state could not refresh</strong><span>{error}</span></div></div> : null}

    <section className={styles.hero}>
      <div className={styles.heroMain}>
        <span><Database size={14}/> PERSISTENT COVERAGE LEDGER</span>
        <h2>{probe ? fmt(probe.totalEntries) : "—"} companies in the Apollo search universe.</h2>
        <p>All authorized Apollo page calls are accounted for. Every stored company remains searchable after deploys and browser refreshes.</p>
        <div className={styles.heroBadges}>
          <span><ShieldCheck size={12}/> Government + semi-government included</span>
          <span><Target size={12}/> 251–5,000 sweet pool</span>
          <span><Layers3 size={12}/> 5,001–50,000 enterprise extension</span>
          <span><ShieldCheck size={12}/> SignalHire paid enrichment blocked automatically</span>
        </div>
      </div>
      <div className={styles.coverageRing}>
        <strong>{probe ? `${probe.spentPageCount || probe.completedPageCount}/${probe.totalPages}` : "—"}</strong>
        <span>Apollo page calls accounted</span>
        <small>{probe ? `${probe.spendCoveragePercent ?? probe.pageCoveragePercent}% spend coverage` : "Loading…"}</small>
      </div>
      <div className={styles.heroSide}>
        <div><span>Fully persisted pages</span><strong>{fmt(probe?.completedPageCount || 0)}</strong></div>
        <div><span>Partial spent pages</span><strong>{fmt(probe?.partialSpentPages?.length || 0)}</strong></div>
        <div><span>Additional Apollo credits required</span><strong>{fmt(probe?.estimatedAdditionalSearchCreditsToFinish || 0)}</strong></div>
        <small>SignalHire contact credits are never spent automatically.</small>
      </div>
    </section>

    <section className={styles.metrics}>
      <article><div><Database size={15}/><span>Stored ledger</span></div><strong>{fmt(ledger?.stored || 0)}</strong><small>Persistent Postgres account records</small></article>
      <article className={styles.hot}><div><Target size={15}/><span>Net-new</span></div><strong>{fmt(ledger?.eligible || 0)}</strong><small>In-scope and targetable</small></article>
      <article><div><BadgeCheck size={15}/><span>HubSpot covered</span></div><strong>{fmt(ledger?.existingHubSpot || 0)}</strong><small>Blocked from duplicate creation</small></article>
      <article><div><CircleAlert size={15}/><span>Review</span></div><strong>{fmt(ledger?.review || 0)}</strong><small>Domain pending or explicit guardrail review</small></article>
      <article><div><UsersRound size={15}/><span>Sweet pool stored</span></div><strong>{fmt(ledger?.sweetPool || 0)}</strong><small>251–5,000 employee accounts</small></article>
      <article><div><Building2 size={15}/><span>Enterprise stored</span></div><strong>{fmt(ledger?.enterpriseExtension || 0)}</strong><small>5,001–50,000 employee accounts</small></article>
    </section>

    <ZeroCreditReadyPanel />

    <section className={styles.countries}>
      <div className={styles.sectionTitle}><div><span>COUNTRY COVERAGE</span><h3>Seven markets, one persistent universe</h3></div><small>Country totals come from the full Postgres ledger, not only the visible page.</small></div>
      <div className={styles.countryGrid}>
        {(payload?.countries || []).map((row) => <button type="button" key={row.country} className={country === row.country ? styles.countryActive : ""} onClick={() => { setCountry((current) => current === row.country ? "" : row.country); setPage(1); }}>
          <span>{row.country}</span>
          <strong>{fmt(row.stored)}</strong>
          <small>{row.targetSectors} target sectors · {fmt(row.eligible)} net-new · {fmt(row.existingHubSpot)} HubSpot</small>
        </button>)}
      </div>
    </section>

    <section className={styles.ledgerPanel}>
      <div className={styles.ledgerHead}>
        <div><span>ACCOUNT LEDGER</span><h3>Saved companies</h3></div>
        <Link href="/best-accounts" className={styles.bestAccounts}>Open Best Accounts →</Link>
      </div>
      <div className={styles.toolbar}>
        <label><Search size={15}/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search company, domain, industry, persona…"/></label>
        <select value={country} onChange={(event) => { setCountry(event.target.value); setPage(1); }}><option value="">All 7 markets</option>{(payload?.scope.countries || []).map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}><option value="all">All statuses</option><option value="net-new">Net-new</option><option value="hubspot">Already covered</option><option value="review">Review</option><option value="excluded">Excluded</option></select>
      </div>

      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Company</th><th>Market</th><th>Headcount</th><th>Industry</th><th>GTM</th><th>Best persona</th><th>Status</th></tr></thead>
          <tbody>
            {accounts.map((account) => <tr key={account.domain}>
              <td><strong>{account.name}</strong><small>{account.domain.endsWith(".invalid") ? "Domain resolution pending" : account.domain}</small></td>
              <td>{account.country || "In-scope · country pending"}</td>
              <td>{headcountLabel(account)}</td>
              <td>{account.industry || String(account.evidence?.coverageSector || "Sector unmapped")}</td>
              <td><span className={styles.tier}>Tier {account.gtmTier}</span><b>{account.gtmScore}</b></td>
              <td>{account.primaryPersona || "TA / HR leadership"}</td>
              <td><span className={`${styles.status} ${accountStatus(account) === "Net-new" ? styles.netNew : accountStatus(account) === "Already covered" ? styles.covered : accountStatus(account) === "Review" ? styles.review : styles.excluded}`}>{accountStatus(account)}</span></td>
            </tr>)}
            {!loading && !accounts.length ? <tr><td colSpan={7}><div className={styles.empty}><Database size={22}/><strong>No stored accounts in this filter</strong><span>Change the filters or search query; the persistent ledger is unchanged.</span></div></td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className={styles.toolbar}>
        <span>{pagination ? `Showing ${fmt(from)}–${fmt(to)} of ${fmt(pagination.filteredTotal)}` : "Loading…"}</span>
        <button type="button" className={styles.bestAccounts} disabled={!pagination || pagination.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Previous</button>
        <span>{pagination ? `Page ${pagination.page} / ${pagination.totalPages}` : ""}</span>
        <button type="button" className={styles.bestAccounts} disabled={!pagination || pagination.page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next →</button>
      </div>
    </section>

    <footer className={styles.footer}>
      <CheckCircle2 size={14}/>
      <span>{payload?.storage.sourceOfTruth || "Postgres acquisition ledger + HubSpot dedupe"}</span>
      <small>Server-paginated full ledger · auto-refresh · SignalHire paid enrichment never runs automatically</small>
    </footer>
  </main>;
}
