"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BadgeCheck, Building2, CheckCircle2, CircleAlert, Database,
  Layers3, Radar, Search, Server, ShieldCheck, Target, UsersRound,
} from "lucide-react";
import styles from "./ProspectingCoverage.module.css";

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
  existingHubSpot: number;
  targetSectors: number;
};

type CoveragePayload = {
  generatedAt: string;
  storage: {
    database: string;
    mode: string;
    autoLoad: boolean;
    sourceOfTruth: string;
  };
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
    pageCoveragePercent: number;
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
  };
  countries: CountryRow[];
  accounts: CoverageAccount[];
  error?: string;
};

type StatusFilter = "all" | "net-new" | "hubspot" | "review";

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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/acquisition/coverage-status", { cache: "no-store" });
      const data = await response.json() as CoveragePayload;
      if (!response.ok) throw new Error(data.error || "Unable to load market coverage.");
      setPayload(data);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load market coverage.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const interval = window.setInterval(() => void load(true), 30_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const refreshFocus = () => void load(true);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshFocus);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (payload?.accounts || []).filter((account) => {
      if (country && account.country !== country) return false;
      if (status === "net-new" && account.exclusionStatus !== "eligible") return false;
      if (status === "hubspot" && !(account.status === "existing_hubspot" || account.hubspotCompanyId)) return false;
      if (status === "review" && account.exclusionStatus !== "review") return false;
      if (!text) return true;
      return [account.name, account.domain, account.country, account.industry, account.primaryPersona]
        .join(" ").toLowerCase().includes(text);
    }).sort((a, b) => {
      const aExisting = Number(Boolean(a.hubspotCompanyId));
      const bExisting = Number(Boolean(b.hubspotCompanyId));
      if (aExisting !== bExisting) return aExisting - bExisting;
      return b.gtmScore - a.gtmScore || a.name.localeCompare(b.name);
    });
  }, [country, payload, query, status]);

  const probe = payload?.probe;
  const ledger = payload?.ledger;

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
        <h2>{probe ? fmt(probe.totalEntries) : "—"} target companies in the current Apollo universe.</h2>
        <p>Every discovered company is kept as Net-new, Already covered in HubSpot, Review, or Excluded. Deploys and browser sessions do not reset the ledger.</p>
        <div className={styles.heroBadges}>
          <span><ShieldCheck size={12}/> Government + semi-government included</span>
          <span><Target size={12}/> 251–5,000 sweet pool</span>
          <span><Layers3 size={12}/> 5,001–50,000 enterprise extension</span>
        </div>
      </div>
      <div className={styles.coverageRing}>
        <strong>{probe ? `${probe.completedPageCount}/${probe.totalPages}` : "—"}</strong>
        <span>Apollo pages captured</span>
        <small>{probe ? `${probe.pageCoveragePercent}% search-page coverage` : "Loading…"}</small>
      </div>
      <div className={styles.heroSide}>
        <div><span>Search credits used</span><strong>{fmt(probe?.completedPageCount || 0)}</strong></div>
        <div><span>Additional pages not yet authorized</span><strong>{fmt(probe?.estimatedAdditionalSearchCreditsToFinish || 0)}</strong></div>
        <small>No additional Apollo search is run from this screen.</small>
      </div>
    </section>

    <section className={styles.metrics}>
      <article><div><Database size={15}/><span>Stored ledger</span></div><strong>{fmt(ledger?.stored || 0)}</strong><small>Persistent Postgres account records</small></article>
      <article className={styles.hot}><div><Target size={15}/><span>Net-new</span></div><strong>{fmt(ledger?.eligible || 0)}</strong><small>Eligible for persona discovery</small></article>
      <article><div><BadgeCheck size={15}/><span>HubSpot covered</span></div><strong>{fmt(ledger?.existingHubSpot || 0)}</strong><small>Known CRM companies kept out of duplicate creation</small></article>
      <article><div><CircleAlert size={15}/><span>Review</span></div><strong>{fmt(ledger?.review || 0)}</strong><small>Unknown / ambiguous industry retained</small></article>
      <article><div><UsersRound size={15}/><span>Sweet pool stored</span></div><strong>{fmt(ledger?.sweetPool || 0)}</strong><small>251–5,000 employee accounts</small></article>
      <article><div><Building2 size={15}/><span>Enterprise stored</span></div><strong>{fmt(ledger?.enterpriseExtension || 0)}</strong><small>5,001–50,000 employee accounts</small></article>
    </section>

    <section className={styles.countries}>
      <div className={styles.sectionTitle}><div><span>COUNTRY COVERAGE</span><h3>Seven markets, one persistent universe</h3></div><small>Target sector matrix stays visible even before every page is discovered.</small></div>
      <div className={styles.countryGrid}>
        {(payload?.countries || []).map((row) => <button type="button" key={row.country} className={country === row.country ? styles.countryActive : ""} onClick={() => setCountry((current) => current === row.country ? "" : row.country)}>
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
        <label><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, domain, industry, persona…"/></label>
        <select value={country} onChange={(event) => setCountry(event.target.value)}><option value="">All 7 markets</option>{(payload?.scope.countries || []).map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="net-new">Net-new</option><option value="hubspot">Already covered</option><option value="review">Review</option></select>
      </div>

      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Company</th><th>Market</th><th>Headcount</th><th>Industry</th><th>GTM</th><th>Best persona</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map((account) => <tr key={account.domain}>
              <td><strong>{account.name}</strong><small>{account.domain}</small></td>
              <td>{account.country || "Unknown"}</td>
              <td>{headcountLabel(account)}</td>
              <td>{account.industry || String(account.evidence?.coverageSector || "Review")}</td>
              <td><span className={styles.tier}>Tier {account.gtmTier}</span><b>{account.gtmScore}</b></td>
              <td>{account.primaryPersona || "TA / HR leadership"}</td>
              <td><span className={`${styles.status} ${accountStatus(account) === "Net-new" ? styles.netNew : accountStatus(account) === "Already covered" ? styles.covered : accountStatus(account) === "Review" ? styles.review : styles.excluded}`}>{accountStatus(account)}</span></td>
            </tr>)}
            {!loading && !filtered.length ? <tr><td colSpan={7}><div className={styles.empty}><Database size={22}/><strong>No stored accounts in this filter yet</strong><span>The coverage state is still preserved; future approved Apollo pages append here automatically.</span></div></td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>

    <footer className={styles.footer}>
      <CheckCircle2 size={14}/>
      <span>{payload?.storage.sourceOfTruth || "Postgres acquisition ledger + HubSpot dedupe"}</span>
      <small>Auto-load on open · refreshes every 30 seconds · refreshes again when this tab regains focus</small>
    </footer>
  </main>;
}
