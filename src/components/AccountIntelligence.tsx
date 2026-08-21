"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clipboard,
  ExternalLink,
  Filter,
  Flame,
  Gauge,
  Globe2,
  Languages,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  scoreTalenteraPortfolio,
  type TalenteraAccountIntelligence,
  type TalenteraAccountTier,
} from "@/lib/talentera-intelligence";
import styles from "./AccountIntelligence.module.css";

type HiringJob = {
  title: string;
  location: string;
  department: string;
  postedAt: string;
};

type HiringCompany = {
  companyId: string;
  name: string;
  domain: string;
  country: string;
  careerPageUrl: string;
  ats: string;
  hubspotUrl: string;
  sourceUrl: string;
  activeJobs: number;
  previousActiveJobs: number;
  newJobs7d: number;
  newJobs30d: number;
  closedJobs7d: number;
  hiringScore: number;
  hiringStatus: string;
  trend: string;
  topDepartments: string[];
  topLocations: string[];
  lastCheckedAt: string;
  jobs: HiringJob[];
};

type HiringPayload = {
  meta?: {
    generatedAt?: string;
    refreshCadenceHours?: number;
    run?: {
      scanned?: number;
      eligibleCompanies?: number;
      completedAt?: string;
    };
  };
  summary?: {
    monitoredCompanies?: number;
    checkedCompanies?: number;
  };
  companies: HiringCompany[];
};

type EnrichedAccount = TalenteraAccountIntelligence & { source: HiringCompany };
type TierFilter = "" | TalenteraAccountTier;

type MetricProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  helper: string;
  emphasis?: boolean;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string) {
  if (!value) return "Not scanned yet";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function scoreTone(score: number) {
  if (score >= 78) return styles.scoreA;
  if (score >= 62) return styles.scoreB;
  if (score >= 45) return styles.scoreC;
  return styles.scoreWatch;
}

function signalTone(strength: "strong" | "medium" | "supporting") {
  if (strength === "strong") return styles.signalStrong;
  if (strength === "medium") return styles.signalMedium;
  return styles.signalSupporting;
}

function MetricCard({ icon, label, value, helper, emphasis = false }: MetricProps) {
  return (
    <div className={`${styles.metricCard} ${emphasis ? styles.metricEmphasis : ""}`}>
      <div className={styles.metricHeader}><span>{label}</span>{icon}</div>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function intelligenceText(account: EnrichedAccount) {
  return [
    `TALENTERA ACCOUNT INTELLIGENCE — ${account.name}`,
    "",
    `Priority: Tier ${account.tier} · ${account.score}/100`,
    `Fit: ${account.fitScore}/100`,
    `Intent: ${account.intentScore}/100 (${account.intentLevel})`,
    `Recruitment complexity: ${account.complexityScore}/100`,
    `ATS opportunity: ${account.atsOpportunityScore}/100 (${account.atsOpportunity})`,
    `Hiring velocity: ${account.hiringVelocity}`,
    `Market: ${account.country || "Unknown"}`,
    `ATS: ${account.competitorMotion.currentSystem}`,
    "",
    "BUYING SIGNALS",
    ...account.signals.map((signal) => `• ${signal.label}: ${signal.evidence}`),
    "",
    "BUYING COMMITTEE",
    `Primary: ${account.personas.primary}`,
    `Secondary: ${account.personas.secondary}`,
    `Economic buyer: ${account.personas.economicBuyer}`,
    `Technical influencer: ${account.personas.technicalInfluencer}`,
    "",
    "RECOMMENDED ANGLE",
    account.recommendedAngle,
    "",
    "COMPETITOR MOTION",
    account.competitorMotion.displacementAngle,
    `Discovery: ${account.competitorMotion.discoveryQuestion}`,
    "",
    `Language: ${account.languageRoute}`,
    `Channels: ${account.recommendedChannels.join(" → ")}`,
    "",
    "NEXT ACTIONS",
    ...account.nextActions.map((action) => `• ${action}`),
    ...(account.risks.length ? ["", "RISKS / VALIDATION", ...account.risks.map((risk) => `• ${risk}`)] : []),
  ].join("\n");
}

export function AccountIntelligence() {
  const [data, setData] = useState<HiringPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<TierFilter>("");
  const [country, setCountry] = useState("");
  const [highIntentOnly, setHighIntentOnly] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/hiring", { cache: "no-store" });
      const payload = await response.json() as HiringPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to load hiring intelligence.");
      setData(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load account intelligence.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const accounts = useMemo<EnrichedAccount[]>(() => {
    const companies = data?.companies ?? [];
    const scored = scoreTalenteraPortfolio(companies.map((company) => ({
      companyId: company.companyId,
      name: company.name,
      domain: company.domain,
      country: company.country,
      careerPageUrl: company.careerPageUrl,
      ats: company.ats,
      activeJobs: company.activeJobs,
      previousActiveJobs: company.previousActiveJobs,
      newJobs7d: company.newJobs7d,
      newJobs30d: company.newJobs30d,
      closedJobs7d: company.closedJobs7d,
      hiringScore: company.hiringScore,
      topDepartments: company.topDepartments,
      topLocations: company.topLocations,
      jobs: company.jobs,
    })));
    const byId = new Map(companies.map((company) => [company.companyId, company]));
    const enriched: EnrichedAccount[] = [];
    for (const account of scored) {
      const source = byId.get(account.companyId);
      if (source) enriched.push({ ...account, source });
    }
    return enriched;
  }, [data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (query) {
        const haystack = [
          account.name,
          account.domain,
          account.country,
          account.competitorMotion.currentSystem,
          ...account.source.topDepartments,
          ...account.source.topLocations,
          ...account.signals.map((signal) => signal.label),
        ].join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (tier && account.tier !== tier) return false;
      if (country && account.country !== country) return false;
      if (highIntentOnly && account.intentScore < 65) return false;
      return true;
    });
  }, [accounts, country, highIntentOnly, search, tier]);

  const selected = accounts.find((account) => account.companyId === selectedId) ?? null;
  const countries = [...new Set(accounts.map((account) => account.country).filter(Boolean))].sort();
  const tierA = accounts.filter((account) => account.tier === "A").length;
  const highIntent = accounts.filter((account) => account.intentScore >= 65).length;
  const highAtsOpportunity = accounts.filter((account) => account.atsOpportunityScore >= 60).length;
  const taSignals = accounts.filter((account) => account.signals.some((signal) => ["ta-team", "hr-systems"].includes(signal.key))).length;
  const scanned = data?.meta?.run?.scanned ?? data?.summary?.checkedCompanies ?? 0;
  const eligible = data?.meta?.run?.eligibleCompanies ?? data?.summary?.monitoredCompanies ?? 0;

  async function copySelected() {
    if (!selected) return;
    await navigator.clipboard.writeText(intelligenceText(selected));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Link className={styles.backButton} href="/"><ArrowLeft size={16}/> SDR Dashboard</Link>
          <div className={styles.topbarMeta}>
            <span><ShieldCheck size={13}/> Deterministic scoring</span>
            <span><RefreshCw size={13}/> Hiring feed: {scanned}/{eligible || "—"}</span>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}><BrainCircuit size={17}/> Talentera GTM Brain</div>
            <h1>Which accounts should Talentera pursue now?</h1>
            <p>One operating view that combines market fit, hiring intent, ATS displacement opportunity, recruitment complexity, buying committee and the next best outreach motion.</p>
            <div className={styles.heroMeta}>
              <span><Globe2 size={14}/> KSA / UAE first</span>
              <span><Target size={14}/> Fit + intent + ATS opportunity</span>
              <span><Languages size={14}/> Regional language routing</span>
            </div>
          </div>
          <div className={styles.heroScore}>
            <Sparkles size={22}/>
            <strong>{tierA}</strong>
            <span>Tier A accounts</span>
          </div>
        </section>

        {error ? (
          <div className={styles.errorBanner}>
            <CircleAlert size={18}/>
            <div><strong>GTM Brain could not load the hiring feed</strong><span>{error}</span></div>
            <button type="button" onClick={() => void load()}><RefreshCw size={15}/> Retry</button>
          </div>
        ) : null}

        <section className={styles.metrics}>
          <MetricCard icon={<Building2 size={18}/>} label="Scored Accounts" value={formatNumber(accounts.length)} helper="Eligible monitored companies with current evidence"/>
          <MetricCard icon={<Flame size={18}/>} label="Tier A" value={formatNumber(tierA)} helper="Best combined fit + timing" emphasis/>
          <MetricCard icon={<Zap size={18}/>} label="High Intent" value={formatNumber(highIntent)} helper="Intent score 65+" emphasis/>
          <MetricCard icon={<Gauge size={18}/>} label="ATS Opportunity" value={formatNumber(highAtsOpportunity)} helper="Replacement / modernization score 60+"/>
          <MetricCard icon={<Users size={18}/>} label="TA / HRIS Signal" value={formatNumber(taSignals)} helper="Recruiting-team or HR-systems investment detected"/>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <div className={styles.panelEyebrow}>PRIORITIZED ACCOUNT QUEUE</div>
              <h2>Best accounts first</h2>
              <p>Scores only use available evidence; missing company size or ATS data is surfaced as a validation risk rather than invented.</p>
            </div>
            <button className={styles.refreshButton} type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? styles.spin : ""} size={16}/> Refresh
            </button>
          </div>

          <div className={styles.filters}>
            <label className={styles.searchBox}>
              <Search size={16}/>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, ATS, signal, location..."/>
            </label>
            <label>
              <Filter size={14}/>
              <select value={tier} onChange={(event) => setTier(event.target.value as TierFilter)}>
                <option value="">All tiers</option>
                <option value="A">Tier A</option>
                <option value="B">Tier B</option>
                <option value="C">Tier C</option>
                <option value="Watch">Watch</option>
              </select>
            </label>
            <label>
              <Globe2 size={14}/>
              <select value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="">All markets</option>
                {countries.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className={styles.toggleLabel}>
              <input type="checkbox" checked={highIntentOnly} onChange={(event) => setHighIntentOnly(event.target.checked)}/>
              High intent only
            </label>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Priority</th>
                  <th>Intent</th>
                  <th>Hiring</th>
                  <th>ATS</th>
                  <th>Best persona</th>
                  <th>Strongest signal</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => {
                  const strongest = account.signals[0];
                  return (
                    <tr key={account.companyId || account.domain || account.name}>
                      <td>
                        <button className={styles.accountButton} type="button" onClick={() => setSelectedId(account.companyId)}>
                          <span className={styles.companyIcon}><Building2 size={15}/></span>
                          <span><strong>{account.name}</strong><small>{account.country} · {account.domain || "No domain"}</small></span>
                        </button>
                      </td>
                      <td><span className={`${styles.scorePill} ${scoreTone(account.score)}`}>Tier {account.tier} · {account.score}</span></td>
                      <td><strong>{account.intentScore}</strong><small className={styles.cellSub}>{account.intentLevel}</small></td>
                      <td><strong>{account.source.activeJobs}</strong><small className={styles.cellSub}>{account.hiringVelocity} · +{account.source.newJobs30d}/30d</small></td>
                      <td><span className={styles.atsName}>{account.source.ats || "Unknown"}</span><small className={styles.cellSub}>{account.atsOpportunity} opportunity</small></td>
                      <td><span className={styles.personaCell}>{account.personas.primary}</span></td>
                      <td>{strongest ? <span className={`${styles.signalPill} ${signalTone(strongest.strength)}`}>{strongest.label}</span> : <span className={styles.muted}>No strong trigger yet</span>}</td>
                      <td><button className={styles.openButton} type="button" onClick={() => setSelectedId(account.companyId)}>Open <ArrowUpRight size={14}/></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && filtered.length === 0 ? <div className={styles.empty}>No accounts match the current filters.</div> : null}
            {loading && !data ? <div className={styles.empty}><RefreshCw className={styles.spin} size={20}/> Loading current hiring intelligence...</div> : null}
          </div>
        </section>
      </div>

      {selected ? (
        <div className={styles.drawerBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setSelectedId("")}>
          <aside className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div>
                <div className={styles.drawerEyebrow}>ACCOUNT INTELLIGENCE</div>
                <h2>{selected.name}</h2>
                <p>{selected.country} · {selected.domain || "No domain"}</p>
              </div>
              <button className={styles.closeButton} type="button" onClick={() => setSelectedId("")} aria-label="Close"><X size={18}/></button>
            </div>

            <div className={styles.drawerScores}>
              <div className={`${styles.bigScore} ${scoreTone(selected.score)}`}><span>Priority</span><strong>{selected.score}</strong><small>Tier {selected.tier}</small></div>
              <div><span>Fit</span><strong>{selected.fitScore}</strong><small>/100</small></div>
              <div><span>Intent</span><strong>{selected.intentScore}</strong><small>{selected.intentLevel}</small></div>
              <div><span>ATS Opp.</span><strong>{selected.atsOpportunityScore}</strong><small>{selected.atsOpportunity}</small></div>
            </div>

            <section className={styles.drawerSection}>
              <div className={styles.sectionTitle}><Flame size={15}/> Buying signals</div>
              <div className={styles.signalList}>
                {selected.signals.length ? selected.signals.map((signal) => (
                  <div key={signal.key} className={styles.signalCard}>
                    <span className={`${styles.signalDot} ${signalTone(signal.strength)}`}/>
                    <div><strong>{signal.label}</strong><p>{signal.evidence}</p></div>
                  </div>
                )) : <p className={styles.muted}>No high-confidence buying signal yet.</p>}
              </div>
            </section>

            <section className={styles.drawerSection}>
              <div className={styles.sectionTitle}><Users size={15}/> Buying committee</div>
              <div className={styles.personaGrid}>
                <div><span>Primary</span><strong>{selected.personas.primary}</strong></div>
                <div><span>Secondary</span><strong>{selected.personas.secondary}</strong></div>
                <div><span>Economic buyer</span><strong>{selected.personas.economicBuyer}</strong></div>
                <div><span>Technical influence</span><strong>{selected.personas.technicalInfluencer}</strong></div>
              </div>
              <p className={styles.sectionCopy}>{selected.personas.reason}</p>
            </section>

            <section className={styles.drawerSection}>
              <div className={styles.sectionTitle}><Target size={15}/> Recommended angle</div>
              <p className={styles.angle}>{selected.recommendedAngle}</p>
              <div className={styles.routeRow}><Languages size={14}/><strong>{selected.languageRoute}</strong><span>{selected.recommendedChannels.join(" → ")}</span></div>
            </section>

            <section className={styles.drawerSection}>
              <div className={styles.sectionTitle}><BrainCircuit size={15}/> ATS / competitor motion</div>
              <div className={styles.systemLine}><span>Current system</span><strong>{selected.competitorMotion.currentSystem}</strong></div>
              <p className={styles.sectionCopy}>{selected.competitorMotion.displacementAngle}</p>
              <div className={styles.discovery}><Sparkles size={14}/><div><span>Best discovery question</span><strong>{selected.competitorMotion.discoveryQuestion}</strong></div></div>
            </section>

            <section className={styles.drawerSection}>
              <div className={styles.sectionTitle}><CheckCircle2 size={15}/> Next actions</div>
              <ol className={styles.actionList}>{selected.nextActions.map((action) => <li key={action}>{action}</li>)}</ol>
            </section>

            {selected.risks.length ? (
              <section className={styles.drawerSection}>
                <div className={styles.sectionTitle}><CircleAlert size={15}/> Validate before outreach</div>
                <ul className={styles.riskList}>{selected.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
              </section>
            ) : null}

            <div className={styles.drawerActions}>
              <button type="button" className={styles.copyButton} onClick={() => void copySelected()}><Clipboard size={15}/>{copied ? "Copied brief" : "Copy account brief"}</button>
              {selected.source.hubspotUrl ? <a href={selected.source.hubspotUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> HubSpot</a> : null}
              {selected.source.careerPageUrl ? <a href={selected.source.careerPageUrl} target="_blank" rel="noreferrer"><BriefcaseBusiness size={15}/> Career page</a> : null}
            </div>

            <div className={styles.drawerFooter}>Hiring data last checked {formatDate(selected.source.lastCheckedAt)}.</div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
