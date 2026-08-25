"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  ExternalLink,
  Filter,
  Flame,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import styles from "./AccountIntelligence.module.css";

type MarketTier = "Core" | "Expansion A" | "Expansion B" | "Selective";
type AccountTier = "A" | "B" | "C" | "Watch";

type BuyingSignal = {
  key: string;
  label: string;
  strength: "strong" | "medium" | "supporting";
  evidence: string;
  score: number;
};

type AccountSource = {
  taskCount: number;
  contactCount: number;
  hubspotUrl: string;
  careerPageUrl: string;
  sourceUrl: string;
  lastCheckedAt: string;
  lastSuccessfulCheckAt: string;
  activeJobs: number;
  newJobs7d: number;
  newJobs30d: number;
  hiringStatus: string;
  trend: string;
  topDepartments: string[];
  topLocations: string[];
  employeeCount: number;
  industry: string;
  atsStatus: string;
  atsCategory: string;
  atsConfidence: string;
  hiringSignal: string;
  reasonToReachOut: string;
};

type Account = {
  companyId: string;
  name: string;
  domain: string;
  country: string;
  market: {
    canonicalCountry: string;
    tier: MarketTier;
    score: number;
    eligible: boolean;
  };
  score: number;
  tier: AccountTier;
  intentScore: number;
  intentLevel: "Very High" | "High" | "Medium" | "Low";
  fitScore: number;
  complexityScore: number;
  atsOpportunityScore: number;
  atsOpportunity: "Very High" | "High" | "Medium" | "Low";
  confidence: "high" | "medium" | "low";
  hiringVelocity: string;
  languageRoute: string;
  signals: BuyingSignal[];
  personas: {
    primary: string;
    secondary: string;
    economicBuyer: string;
    technicalInfluencer: string;
    reason: string;
  };
  competitorMotion: {
    family: string;
    currentSystem: string;
    displacementAngle: string;
    discoveryQuestion: string;
  };
  recommendedAngle: string;
  recommendedChannels: string[];
  reasons: string[];
  risks: string[];
  nextActions: string[];
  source: AccountSource | null;
};

type Payload = {
  meta: {
    generatedAt: string;
    scopeGeneratedAt: string;
    source: string;
    scope: {
      ownerId: string;
      sourceLabel: string;
      sourceDetail: string;
      taskCount: number;
      uniqueCompaniesBeforeMarketFilter: number;
      approvedMarketCompanies: number;
      paidEnrichment: string;
    };
    version: string;
  };
  summary: {
    totalScored: number;
    returned: number;
    tierCounts: Record<AccountTier, number>;
    marketCounts: Record<MarketTier, number>;
    highIntent: number;
    highAtsOpportunity: number;
    taOrHrisSignals: number;
    withHiringEvidence: number;
  };
  accounts: Account[];
  error?: string;
};

type AiBrief = {
  whyNow: string;
  openingLine: string;
  outreachAngle: string;
  discoveryQuestions: string[];
  validationRisk: string;
};

type AiPayload = {
  brief?: AiBrief | null;
  raw?: string;
  ai?: {
    model: string;
    mode: string;
    cached: boolean;
    usage?: Record<string, unknown>;
    today?: Record<string, unknown>;
    limits?: Record<string, unknown>;
  };
  error?: string;
};

const MARKET_ORDER: MarketTier[] = ["Core", "Expansion A", "Expansion B", "Selective"];
const COUNTRY_ORDER = [
  "Saudi Arabia",
  "United Arab Emirates",
  "Egypt",
  "South Africa",
  "Morocco",
  "Iraq",
  "Qatar",
  "Kuwait",
  "Jordan",
  "Oman",
  "Bahrain",
];

function fmt(value: number) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function tierClass(tier: AccountTier) {
  if (tier === "A") return styles.tierA;
  if (tier === "B") return styles.tierB;
  if (tier === "C") return styles.tierC;
  return styles.tierWatch;
}

function scoreClass(score: number) {
  if (score >= 75) return styles.scoreHot;
  if (score >= 55) return styles.scoreWarm;
  return styles.scoreCool;
}

function signalClass(strength: BuyingSignal["strength"]) {
  if (strength === "strong") return styles.signalStrong;
  if (strength === "medium") return styles.signalMedium;
  return styles.signalSupporting;
}

function marketClass(tier: MarketTier) {
  if (tier === "Core") return styles.marketCore;
  if (tier === "Expansion A") return styles.marketExpansionA;
  if (tier === "Expansion B") return styles.marketExpansionB;
  return styles.marketSelective;
}

function dateLabel(value: string) {
  if (!value) return "Not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not checked";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function track(feature: string, meta: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent("sdr:usage", { detail: { eventType: "action", feature, meta } }));
}

export function AccountIntelligence({ onBack }: { onBack?: () => void } = {}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<AccountTier | "">("");
  const [marketTier, setMarketTier] = useState<MarketTier | "">("");
  const [country, setCountry] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiBriefs, setAiBriefs] = useState<Record<string, AiPayload>>({});

  const load = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/account-intelligence?limit=2000${force ? "&refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error || "Unable to load Talentera Intelligence.");
      setPayload(data);
      setSelectedId((current) => current && data.accounts.some((account) => account.companyId === current) ? current : "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Talentera Intelligence.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const accounts = payload?.accounts || [];
  const countries = useMemo(() => {
    const present = new Set(accounts.map((account) => account.country).filter(Boolean));
    return COUNTRY_ORDER.filter((item) => present.has(item));
  }, [accounts]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (tier && account.tier !== tier) return false;
      if (marketTier && account.market.tier !== marketTier) return false;
      if (country && account.country !== country) return false;
      if (!search) return true;
      return [
        account.name,
        account.domain,
        account.country,
        account.market.tier,
        account.source?.industry,
        account.competitorMotion.currentSystem,
        account.personas.primary,
        account.recommendedAngle,
        ...account.signals.map((signal) => `${signal.label} ${signal.evidence}`),
      ].join(" ").toLowerCase().includes(search);
    });
  }, [accounts, country, marketTier, query, tier]);

  const selected = useMemo(
    () => accounts.find((account) => account.companyId === selectedId) || null,
    [accounts, selectedId],
  );
  const selectedAi = selected ? aiBriefs[selected.companyId] : undefined;
  const summary = payload?.summary;
  const scope = payload?.meta.scope;

  async function generateDeepBrief(account: Account) {
    if (!["A", "B"].includes(account.tier)) return;
    setAiBusy(true);
    setAiError("");
    try {
      const response = await fetch("/api/ai/account-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: account.companyId, mode: "deep" }),
      });
      const data = await response.json() as AiPayload;
      if (!response.ok) throw new Error(data.error || "Deep research failed.");
      setAiBriefs((current) => ({ ...current, [account.companyId]: data }));
      track("gtm-brain-deep-research", { companyId: account.companyId, tier: account.tier, cached: data.ai?.cached });
    } catch (requestError) {
      setAiError(requestError instanceof Error ? requestError.message : "Deep research failed.");
    } finally {
      setAiBusy(false);
    }
  }

  function clearFilters() {
    setQuery("");
    setTier("");
    setMarketTier("");
    setCountry("");
  }

  if (loading) {
    return <main className={styles.loadingPage}>
      <div className={styles.loadingMark}><BrainCircuit size={24}/></div>
      <LoaderCircle className={styles.spin} size={22}/>
      <strong>Building Marita&apos;s account intelligence…</strong>
      <span>Open Extensive-Lighter tasks only · company-level dedupe · approved markets</span>
    </main>;
  }

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.topbarLeft}>
        {onBack ? (
          <button className={styles.backButton} type="button" onClick={onBack} aria-label="Back to SDR dashboard"><ArrowLeft size={17}/></button>
        ) : (
          <Link className={styles.backButton} href="/" aria-label="Back to SDR dashboard"><ArrowLeft size={17}/></Link>
        )}
        <div className={styles.brandLockup}>
          <div className={styles.brandIcon}><BrainCircuit size={18}/></div>
          <div><strong>Talentera Intelligence</strong><span>SDR account decision workspace</span></div>
        </div>
      </div>
      <div className={styles.topbarActions}>
        <span className={styles.livePill}><i/>Deterministic first</span>
        <button className={styles.refreshButton} type="button" disabled={refreshing} onClick={() => void load(true)}>
          <RefreshCw className={refreshing ? styles.spin : ""} size={15}/>{refreshing ? "Refreshing" : "Refresh evidence"}
        </button>
      </div>
    </header>

    <section className={styles.hero}>
      <div className={styles.heroGlow}/>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>MARITA · EXTENSIVE-LIGHTER · TARGET ACCOUNTS</span>
        <h1>Know who to call first.<br/><em>Know exactly why.</em></h1>
        <p>One company-level view of market fit, hiring pressure, ATS opportunity and the right buying persona. Paid contact enrichment stays off until the account earns it.</p>
        <div className={styles.scopeRow}>
          <span><UsersRound size={13}/>Marita only</span>
          <span><Database size={13}/>Extensive-Lighter only</span>
          <span><ShieldCheck size={13}/>No paid enrichment</span>
          <span><Sparkles size={13}/>Deep AI: A/B only</span>
        </div>
      </div>
      <div className={styles.heroScore}>
        <span>OPEN TASK SCOPE</span>
        <strong>{fmt(scope?.taskCount || 0)}</strong>
        <small>{fmt(scope?.approvedMarketCompanies || 0)} approved-market companies after dedupe</small>
        <div className={styles.heroScoreLine}><span>Unique before market gate</span><b>{fmt(scope?.uniqueCompaniesBeforeMarketFilter || 0)}</b></div>
      </div>
    </section>

    {error ? <section className={styles.errorBanner}><CircleAlert size={18}/><div><strong>Intelligence could not load</strong><span>{error}</span></div><button type="button" onClick={() => void load(false)}>Retry</button></section> : null}

    <section className={styles.kpiGrid}>
      <article className={styles.kpiCard}>
        <div><span className={styles.kpiIcon}><Target size={17}/></span><small>Qualified priority</small></div>
        <strong>{fmt((summary?.tierCounts.A || 0) + (summary?.tierCounts.B || 0))}</strong>
        <p><b>{fmt(summary?.tierCounts.A || 0)}</b> Tier A · <b>{fmt(summary?.tierCounts.B || 0)}</b> Tier B</p>
      </article>
      <article className={styles.kpiCard}>
        <div><span className={styles.kpiIcon}><Flame size={17}/></span><small>Hiring evidence</small></div>
        <strong>{fmt(summary?.withHiringEvidence || 0)}</strong>
        <p>Accounts with current jobs or recent hiring movement</p>
      </article>
      <article className={styles.kpiCard}>
        <div><span className={styles.kpiIcon}><Zap size={17}/></span><small>ATS opportunity</small></div>
        <strong>{fmt(summary?.highAtsOpportunity || 0)}</strong>
        <p>High / very-high replacement or greenfield opportunity</p>
      </article>
      <article className={styles.kpiCard}>
        <div><span className={styles.kpiIcon}><UsersRound size={17}/></span><small>TA / HR systems</small></div>
        <strong>{fmt(summary?.taOrHrisSignals || 0)}</strong>
        <p>Accounts showing recruiting-team or HR-tech investment</p>
      </article>
    </section>

    <section className={styles.marketStrip}>
      <div className={styles.marketIntro}>
        <Globe2 size={18}/><div><strong>Approved territory</strong><span>Market weighting is part of the score, not a cosmetic filter.</span></div>
      </div>
      <div className={styles.marketButtons}>
        {MARKET_ORDER.map((item) => (
          <button
            key={item}
            type="button"
            className={`${styles.marketButton} ${marketClass(item)} ${marketTier === item ? styles.marketButtonActive : ""}`}
            onClick={() => setMarketTier((current) => current === item ? "" : item)}
          >
            <span>{item}</span><strong>{fmt(summary?.marketCounts[item] || 0)}</strong>
          </button>
        ))}
      </div>
    </section>

    <section className={styles.controlBar}>
      <label className={styles.searchBox}><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, industry, ATS, persona or signal…"/></label>
      <div className={styles.selectWrap}><Filter size={14}/><select value={tier} onChange={(event) => setTier(event.target.value as AccountTier | "")}><option value="">All priority</option><option value="A">Tier A</option><option value="B">Tier B</option><option value="C">Tier C</option><option value="Watch">Watch</option></select></div>
      <div className={styles.selectWrap}><Globe2 size={14}/><select value={country} onChange={(event) => setCountry(event.target.value)}><option value="">All markets</option>{countries.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
      {(query || tier || marketTier || country) ? <button className={styles.clearButton} type="button" onClick={clearFilters}><X size={14}/>Clear</button> : null}
      <span className={styles.resultCount}>{fmt(filtered.length)} accounts</span>
    </section>

    <section className={styles.workspace}>
      <div className={styles.tablePanel}>
        <div className={styles.tableHeader}>
          <div><strong>Priority queue</strong><span>Sorted by buying potential, not task age.</span></div>
          <span className={styles.evidenceBadge}><ShieldCheck size={13}/>Evidence-backed</span>
        </div>
        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th>Account</th><th>Priority</th><th>Hiring</th><th>ATS motion</th><th>Why now</th><th/></tr></thead>
            <tbody>
              {filtered.map((account) => {
                const source = account.source;
                const strongest = account.signals[0];
                return <tr key={account.companyId} className={selectedId === account.companyId ? styles.selectedRow : ""} onClick={() => { setSelectedId(account.companyId); setAiError(""); }}>
                  <td>
                    <div className={styles.accountCell}>
                      <span className={styles.companyAvatar}>{account.name.slice(0, 2).toUpperCase()}</span>
                      <div><strong>{account.name}</strong><span>{account.country} · {source?.industry || "Industry not set"}</span><small>{source?.taskCount || 0} tasks · {source?.contactCount || 0} contacts</small></div>
                    </div>
                  </td>
                  <td><div className={styles.priorityCell}><span className={`${styles.tierBadge} ${tierClass(account.tier)}`}>{account.tier}</span><strong className={scoreClass(account.score)}>{account.score}</strong><small>{account.market.tier}</small></div></td>
                  <td><div className={styles.metricCell}><strong>{fmt(source?.activeJobs || 0)}</strong><span>active jobs</span><small>{source?.newJobs30d ? `+${source.newJobs30d} / 30d` : account.hiringVelocity}</small></div></td>
                  <td><div className={styles.atsCell}><strong>{account.competitorMotion.currentSystem}</strong><span>{account.atsOpportunity} opportunity · {account.atsOpportunityScore}/100</span></div></td>
                  <td><div className={styles.signalCell}><span className={`${styles.signalDot} ${strongest ? signalClass(strongest.strength) : ""}`}/><div><strong>{strongest?.label || "Needs evidence"}</strong><span>{strongest?.evidence || "No strong live trigger yet."}</span></div></div></td>
                  <td><button className={styles.rowAction} type="button" aria-label={`Open ${account.name}`}><ChevronRight size={16}/></button></td>
                </tr>;
              })}
            </tbody>
          </table>
          {!filtered.length ? <div className={styles.emptyState}><Target size={25}/><strong>No accounts match these filters</strong><span>Clear a filter or refresh the evidence scope.</span></div> : null}
        </div>
      </div>
    </section>

    {selected ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId(""); }}>
      <aside className={styles.drawer}>
        <div className={styles.drawerTop}>
          <div className={styles.drawerAccount}>
            <span className={styles.drawerAvatar}>{selected.name.slice(0, 2).toUpperCase()}</span>
            <div><span className={styles.eyebrow}>{selected.market.tier} · {selected.country}</span><h2>{selected.name}</h2><p>{selected.source?.industry || selected.domain || "Account intelligence"}</p></div>
          </div>
          <button type="button" onClick={() => setSelectedId("")}><X size={17}/></button>
        </div>

        <div className={styles.drawerScoreBand}>
          <div className={styles.primaryScore}><span className={`${styles.tierBadge} ${tierClass(selected.tier)}`}>{selected.tier}</span><strong>{selected.score}</strong><small>PRIORITY</small></div>
          <div><strong>{selected.fitScore}</strong><span>Fit</span></div>
          <div><strong>{selected.intentScore}</strong><span>Intent</span></div>
          <div><strong>{selected.atsOpportunityScore}</strong><span>ATS opp.</span></div>
          <div><strong>{selected.complexityScore}</strong><span>Complexity</span></div>
        </div>

        <div className={styles.drawerBody}>
          <section className={styles.decisionCard}>
            <div className={styles.sectionTitle}><span className={styles.sectionIcon}><Zap size={15}/></span><div><strong>Call decision</strong><span>Deterministic recommendation</span></div></div>
            <h3>{selected.recommendedAngle}</h3>
            <div className={styles.decisionMeta}>
              <span><b>{selected.intentLevel}</b> intent</span><span><b>{selected.hiringVelocity}</b> hiring</span><span><b>{selected.confidence}</b> confidence</span>
            </div>
          </section>

          <section className={styles.detailSection}>
            <div className={styles.sectionTitle}><span className={styles.sectionIcon}><Flame size={15}/></span><div><strong>Verified signals</strong><span>Evidence used in scoring</span></div></div>
            <div className={styles.signalList}>
              {selected.signals.slice(0, 6).map((signal) => <article key={`${signal.key}-${signal.label}`}><span className={`${styles.signalStrength} ${signalClass(signal.strength)}`}>{signal.strength}</span><div><strong>{signal.label}</strong><p>{signal.evidence}</p></div></article>)}
            </div>
          </section>

          <section className={styles.splitGrid}>
            <article className={styles.infoCard}>
              <div className={styles.sectionTitle}><span className={styles.sectionIcon}><UsersRound size={15}/></span><div><strong>Buying committee</strong><span>Who Marita should reach</span></div></div>
              <dl><div><dt>Primary</dt><dd>{selected.personas.primary}</dd></div><div><dt>Secondary</dt><dd>{selected.personas.secondary}</dd></div><div><dt>Economic buyer</dt><dd>{selected.personas.economicBuyer}</dd></div><div><dt>Technical</dt><dd>{selected.personas.technicalInfluencer}</dd></div></dl>
              <p className={styles.mutedCopy}>{selected.personas.reason}</p>
            </article>
            <article className={styles.infoCard}>
              <div className={styles.sectionTitle}><span className={styles.sectionIcon}><Building2 size={15}/></span><div><strong>ATS motion</strong><span>{selected.atsOpportunity} · {selected.atsOpportunityScore}/100</span></div></div>
              <h4>{selected.competitorMotion.currentSystem}</h4>
              <p>{selected.competitorMotion.displacementAngle}</p>
              <blockquote>{selected.competitorMotion.discoveryQuestion}</blockquote>
            </article>
          </section>

          <section className={styles.factGrid}>
            <article><span>Employees</span><strong>{selected.source?.employeeCount ? fmt(selected.source.employeeCount) : "Unknown"}</strong></article>
            <article><span>Active jobs</span><strong>{fmt(selected.source?.activeJobs || 0)}</strong></article>
            <article><span>New / 30d</span><strong>{fmt(selected.source?.newJobs30d || 0)}</strong></article>
            <article><span>Tasks</span><strong>{fmt(selected.source?.taskCount || 0)}</strong></article>
            <article><span>Contacts</span><strong>{fmt(selected.source?.contactCount || 0)}</strong></article>
            <article><span>Last evidence</span><strong>{dateLabel(selected.source?.lastSuccessfulCheckAt || selected.source?.lastCheckedAt || "")}</strong></article>
          </section>

          <section className={styles.detailSection}>
            <div className={styles.sectionTitle}><span className={styles.sectionIcon}><CheckCircle2 size={15}/></span><div><strong>Next actions</strong><span>Cost-aware execution order</span></div></div>
            <ol className={styles.actionList}>{selected.nextActions.map((action, index) => <li key={action}><span>{index + 1}</span><p>{action}</p></li>)}</ol>
          </section>

          {selected.risks.length ? <section className={styles.riskCard}><div><CircleAlert size={16}/><strong>Validation risks</strong></div>{selected.risks.map((risk) => <p key={risk}>{risk}</p>)}</section> : null}

          <section className={styles.aiCard}>
            <div className={styles.aiHeader}>
              <div className={styles.sectionTitle}><span className={styles.aiIcon}><BrainCircuit size={16}/></span><div><strong>OpenRouter Deep Research</strong><span>Explicit only · cached · Tier A/B</span></div></div>
              {selectedAi?.ai?.cached ? <span className={styles.cachedBadge}>Cached</span> : null}
            </div>
            {selectedAi?.brief ? <div className={styles.aiResult}>
              <article><span>Why now</span><p>{selectedAi.brief.whyNow}</p></article>
              <article className={styles.openerCard}><span>Opening line</span><p>{selectedAi.brief.openingLine}</p></article>
              <article><span>Angle</span><p>{selectedAi.brief.outreachAngle}</p></article>
              <article><span>Discovery</span><ol>{selectedAi.brief.discoveryQuestions.map((question) => <li key={question}>{question}</li>)}</ol></article>
              {selectedAi.brief.validationRisk ? <article><span>Validate</span><p>{selectedAi.brief.validationRisk}</p></article> : null}
            </div> : <div className={styles.aiEmpty}><Sparkles size={20}/><div><strong>Use AI only after deterministic qualification.</strong><span>The model receives the verified account object; it cannot invent external facts.</span></div></div>}
            {aiError ? <p className={styles.aiError}>{aiError}</p> : null}
            <button className={styles.deepButton} type="button" disabled={aiBusy || !["A", "B"].includes(selected.tier)} onClick={() => void generateDeepBrief(selected)}>
              {aiBusy ? <LoaderCircle className={styles.spin} size={15}/> : <Sparkles size={15}/>}
              {!["A", "B"].includes(selected.tier) ? "Deep research unlocks at Tier A/B" : selectedAi?.brief ? "Refresh deep brief" : "Generate deep brief"}
            </button>
          </section>
        </div>

        <footer className={styles.drawerFooter}>
          {selected.source?.hubspotUrl ? <a className={styles.primaryLink} href={selected.source.hubspotUrl} target="_blank" rel="noreferrer">Open HubSpot <ArrowUpRight size={14}/></a> : null}
          {selected.source?.careerPageUrl ? <a className={styles.secondaryLink} href={selected.source.careerPageUrl} target="_blank" rel="noreferrer">Career page <ExternalLink size={13}/></a> : null}
          {selected.source?.sourceUrl && selected.source.sourceUrl !== selected.source.careerPageUrl ? <a className={styles.secondaryLink} href={selected.source.sourceUrl} target="_blank" rel="noreferrer">Evidence <ExternalLink size={13}/></a> : null}
        </footer>
      </aside>
    </div> : null}
  </main>;
}
