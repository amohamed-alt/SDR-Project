"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, BrainCircuit, CheckCircle2, ChevronRight,
  CircleAlert, Database, ExternalLink, Filter, Flame, KeyRound, LoaderCircle,
  Phone, Radar, RefreshCw, Search, ShieldCheck, Sparkles, Target,
  UsersRound, X, Zap,
} from "lucide-react";
import styles from "./BestAccounts.module.css";

type AiBrief = {
  whyNow: string;
  opener: string;
  risk: string;
  nextStep: string;
  model: string;
  cached: boolean;
  generatedAt: string;
};

type BestAccount = {
  domain: string;
  name: string;
  source: string;
  sourceId: string;
  country: string;
  employeeCount: number;
  industry: string;
  activeJobs: number;
  headcountGrowth: number;
  hrHeadcount: number;
  careerPageUrl: string;
  detectedAts: string;
  gtmScore: number;
  gtmTier: "A" | "B" | "C" | "Watch";
  fitScore: number;
  intentScore: number;
  atsOpportunityScore: number;
  exclusionStatus: "eligible" | "excluded" | "review";
  exclusionReason: string;
  hubspotCompanyId: string;
  status: string;
  primaryPersona: string;
  secondaryPersona: string;
  economicBuyer: string;
  technicalInfluencer: string;
  strongestSignal: string;
  recommendedAngle: string;
  assignedOwnerId: string;
  assignedOwnerName: string;
  evidence: Record<string, unknown>;
  peopleCount: number;
  enrichedCount: number;
  phoneReadyCount: number;
  pushCount: number;
  priorityScore: number;
  priorityTier: "A+" | "A" | "B" | "C";
  recommendation: string;
  evidenceChips: string[];
  researched: boolean;
  researchConfidence: "high" | "medium" | "low";
  aiBrief: AiBrief | null;
};

type OpenRouterStatus = {
  configured: boolean;
  fastModel: string;
  policy: string;
  today: {
    fastRequests: number;
    estimatedCostUsd: number;
    reportedCostUsd: number;
  };
  limits: { fastDaily: number };
};

type Payload = {
  generatedAt: string;
  accounts: BestAccount[];
  summary: {
    total: number;
    eligible: number;
    aPlus: number;
    tierA: number;
    hiringNow: number;
    phoneReady: number;
    researched: number;
  };
  configuration: {
    openRouterConfigured: boolean;
    openRouterModel: string;
    openRouterPolicy: string;
    openRouter: OpenRouterStatus | null;
    researchLimit: number;
  };
  error?: string;
};

type Mode = "best" | "call" | "unresearched" | "all";
type Country = "" | "Saudi Arabia" | "United Arab Emirates";

const OWNER_STORAGE_KEY = "sdr-acquisition-owner-token";

function savedOwnerToken() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(OWNER_STORAGE_KEY) || "";
}

function fmt(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function percent(value: number) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || !n) return "";
  const normalized = Math.abs(n) <= 2 ? n * 100 : n;
  return `${normalized > 0 ? "+" : ""}${Math.round(normalized)}%`;
}

function track(feature: string, meta: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent("sdr:usage", { detail: { eventType: "action", feature, meta } }));
}

function tierClass(tier: BestAccount["priorityTier"]) {
  if (tier === "A+") return styles.tierPlus;
  if (tier === "A") return styles.tierA;
  if (tier === "B") return styles.tierB;
  return styles.tierC;
}

function confidenceLabel(account: BestAccount) {
  if (!account.researched) return "Unresearched";
  return `${account.researchConfidence[0].toUpperCase()}${account.researchConfidence.slice(1)} confidence`;
}

export function BestAccounts({ onBack }: { onBack: () => void }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("best");
  const [country, setCountry] = useState<Country>("");
  const [query, setQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [ownerToken, setOwnerToken] = useState(savedOwnerToken);
  const [ownerDraft, setOwnerDraft] = useState(savedOwnerToken);
  const [researchLimit, setResearchLimit] = useState(6);
  const [discoveryPages, setDiscoveryPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/best-accounts", { cache: "no-store" });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error || "Unable to load Best Accounts.");
      setPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Best Accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const eligible = useMemo(
    () => (payload?.accounts || []).filter((account) => account.exclusionStatus === "eligible"),
    [payload],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return eligible.filter((account) => {
      if (country && account.country !== country) return false;
      if (mode === "best" && !["A+", "A", "B"].includes(account.priorityTier)) return false;
      if (mode === "call" && account.phoneReadyCount < 1) return false;
      if (mode === "unresearched" && account.researched) return false;
      if (!search) return true;
      return [
        account.name, account.domain, account.country, account.industry, account.detectedAts,
        account.primaryPersona, account.strongestSignal, account.aiBrief?.whyNow,
      ].join(" ").toLowerCase().includes(search);
    });
  }, [country, eligible, mode, query]);

  const selected = useMemo(
    () => payload?.accounts.find((account) => account.domain === selectedDomain) || null,
    [payload, selectedDomain],
  );

  const spotlights = useMemo(() => eligible.slice(0, 3), [eligible]);
  const config = payload?.configuration;
  const summary = payload?.summary;
  const openRouter = config?.openRouter;

  function saveOwnerKey() {
    const value = ownerDraft.trim();
    setOwnerToken(value);
    if (value) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
    setNotice(value ? "Private actions unlocked for this browser session." : "Owner key cleared.");
  }

  async function bestAction(body: Record<string, unknown>) {
    if (!ownerToken) throw new Error("Enter the Owner key first.");
    const response = await fetch("/api/best-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken },
      body: JSON.stringify(body),
    });
    const data = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error || "Best Accounts action failed.");
    return data;
  }

  async function researchAccount(account: BestAccount) {
    setBusy(`research:${account.domain}`);
    setError("");
    setNotice("");
    try {
      const result = await bestAction({ action: "research", domain: account.domain });
      const updated = result.account as BestAccount | undefined;
      setNotice(`${account.name} refreshed · ATS, hiring evidence and AI brief updated.`);
      if (updated?.domain) setSelectedDomain(updated.domain);
      track("best-accounts-research-one", { domain: account.domain });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Account research failed.");
    } finally {
      setBusy("");
    }
  }

  async function researchTop() {
    const approved = window.confirm(`Deep-research the top ${researchLimit} accounts? The system uses the existing Career/ATS engine first and OpenRouter Nano only for concise evidence summaries.`);
    if (!approved) return;
    setBusy("research-top");
    setError("");
    setNotice("");
    try {
      const result = await bestAction({ action: "research_top", limit: researchLimit });
      const skipped = Number(result.skippedFresh || 0);
      setNotice(`Research complete · ${String(result.completed || 0)} refreshed · ${String(result.failed || 0)} need review${skipped ? ` · ${skipped} already fresh` : ""}.`);
      track("best-accounts-research-top", { limit: researchLimit, completed: result.completed });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Top-account research failed.");
    } finally {
      setBusy("");
    }
  }

  async function discover() {
    if (!ownerToken) { setError("Enter the Owner key first."); return; }
    const approved = window.confirm(`Discover up to ${discoveryPages * 100} fresh KSA/UAE accounts from Apollo? This can use up to ${discoveryPages} Apollo credit${discoveryPages === 1 ? "" : "s"}.`);
    if (!approved) return;
    setBusy("discover");
    setError("");
    try {
      const response = await fetch("/api/acquisition", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken },
        body: JSON.stringify({ action: "discover", pages: discoveryPages, confirmCredits: true }),
      });
      const result = await response.json() as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(result.error || "Apollo discovery failed.");
      setNotice(`Discovery complete · ${String(result.fetched || 0)} fetched · ${String(result.eligible || 0)} eligible.`);
      track("best-accounts-discover", { pages: discoveryPages, eligible: result.eligible });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Apollo discovery failed.");
    } finally {
      setBusy("");
    }
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={15}/> Dashboard</button>
          <div>
            <span className={styles.eyebrow}><Radar size={13}/> ACCOUNT PRIORITY ENGINE</span>
            <h1>Best Accounts</h1>
            <p>Evidence-first ranking for Talentera · deterministic score · AI explanation · human-controlled execution</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.systemPill} data-ok={Boolean(config?.openRouterConfigured)}><BrainCircuit size={13}/>{config?.openRouterConfigured ? "AI analyst online" : "AI optional"}</span>
          <button type="button" className={styles.iconButton} onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} size={15}/> Refresh</button>
        </div>
      </header>

      <section className={styles.commandHero}>
        <div className={styles.heroGlow}/>
        <div className={styles.heroCopy}>
          <span><Sparkles size={14}/> TODAY&apos;S PRIORITY</span>
          <h2>Start with the accounts showing real recruiting pressure.</h2>
          <p>Hiring volume, market fit, ATS opportunity, growth and reachability decide the rank. OpenRouter only turns verified evidence into a sharp SDR brief.</p>
          <div className={styles.heroBadges}>
            <span><ShieldCheck size={12}/> HubSpot exclusions</span>
            <span><Flame size={12}/> Hiring signals</span>
            <span><Target size={12}/> Talentera ICP</span>
          </div>
        </div>
        <div className={styles.heroScore}>
          <small>A+ ACCOUNTS</small>
          <strong>{fmt(summary?.aPlus || 0)}</strong>
          <span>{fmt(summary?.eligible || 0)} eligible in queue</span>
        </div>
        <div className={styles.heroActions}>
          <label><span>Deep research</span><select value={researchLimit} onChange={(event) => setResearchLimit(Number(event.target.value))}>{[3,6,8].map((value) => <option key={value} value={value}>Top {value}</option>)}</select></label>
          <button type="button" onClick={() => void researchTop()} disabled={busy === "research-top" || !ownerToken}>
            {busy === "research-top" ? <LoaderCircle className={styles.spin} size={15}/> : <Sparkles size={15}/>} Research best accounts
          </button>
        </div>
      </section>

      {error ? <div className={styles.error}><CircleAlert size={16}/><span>{error}</span><button onClick={() => setError("")}><X size={13}/></button></div> : null}
      {notice ? <div className={styles.notice}><CheckCircle2 size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={13}/></button></div> : null}

      <section className={styles.metrics}>
        <article><div><Target size={15}/><span>A+ / A</span></div><strong>{fmt((summary?.aPlus || 0) + (summary?.tierA || 0))}</strong><small>Accounts to prioritize first</small></article>
        <article><div><Flame size={15}/><span>Hiring now</span></div><strong>{fmt(summary?.hiringNow || 0)}</strong><small>Live recruiting demand</small></article>
        <article><div><Phone size={15}/><span>Call ready</span></div><strong>{fmt(summary?.phoneReady || 0)}</strong><small>Verified phone already available</small></article>
        <article><div><BrainCircuit size={15}/><span>Deep researched</span></div><strong>{fmt(summary?.researched || 0)}</strong><small>ATS + careers + AI brief checked</small></article>
      </section>

      {spotlights.length ? <section className={styles.spotlights}>
        <div className={styles.sectionHeading}><div><span>TOP PICKS</span><h3>Highest-priority accounts right now</h3></div><small>Click any account to inspect the evidence</small></div>
        <div className={styles.spotlightGrid}>
          {spotlights.map((account, index) => <button type="button" key={account.domain} className={styles.spotlightCard} onClick={() => setSelectedDomain(account.domain)}>
            <div className={styles.spotlightTop}><span className={styles.rank}>0{index + 1}</span><span className={`${styles.tier} ${tierClass(account.priorityTier)}`}>{account.priorityTier}</span></div>
            <div className={styles.companyIdentity}><span className={styles.companyMark}>{account.name.slice(0, 2).toUpperCase()}</span><div><strong>{account.name}</strong><small>{account.country || "Market unknown"} · {account.employeeCount ? `${fmt(account.employeeCount)} employees` : "Size pending"}</small></div></div>
            <p>{account.aiBrief?.whyNow || account.strongestSignal || account.recommendedAngle}</p>
            <div className={styles.chips}>{account.evidenceChips.slice(0, 3).map((chip) => <span key={chip}>{chip}</span>)}</div>
            <div className={styles.spotlightFoot}><div><small>Priority</small><strong>{account.priorityScore}</strong></div><span>{account.recommendation}<ChevronRight size={13}/></span></div>
          </button>)}
        </div>
      </section> : null}

      <div className={styles.workspace}>
        <section className={styles.accountPanel}>
          <div className={styles.panelTop}>
            <div className={styles.modeTabs}>
              <button data-active={mode === "best"} onClick={() => setMode("best")}>Best fit</button>
              <button data-active={mode === "call"} onClick={() => setMode("call")}>Call ready</button>
              <button data-active={mode === "unresearched"} onClick={() => setMode("unresearched")}>Needs research</button>
              <button data-active={mode === "all"} onClick={() => setMode("all")}>All eligible</button>
            </div>
            <div className={styles.filters}>
              <label><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, ATS, industry, signal..."/></label>
              <label><Filter size={13}/><select value={country} onChange={(event) => setCountry(event.target.value as Country)}><option value="">KSA + UAE</option><option value="Saudi Arabia">Saudi Arabia</option><option value="United Arab Emirates">United Arab Emirates</option></select></label>
            </div>
          </div>

          <div className={styles.listHead}><span>{filtered.length} accounts</span><small>Sorted by actionability + Talentera GTM score</small></div>
          <div className={styles.accountList}>
            {filtered.map((account, index) => <button type="button" key={account.domain} className={styles.accountRow} onClick={() => setSelectedDomain(account.domain)}>
              <div className={styles.rowRank}>{index + 1}</div>
              <div className={styles.rowCompany}><span className={styles.companyMark}>{account.name.slice(0, 2).toUpperCase()}</span><div><strong>{account.name}</strong><small>{account.domain} · {account.country || "Market unknown"}</small></div></div>
              <div className={styles.rowWhy}><span>{account.aiBrief ? <><BrainCircuit size={11}/> AI BRIEF</> : <><Flame size={11}/> WHY NOW</>}</span><strong>{account.aiBrief?.whyNow || account.strongestSignal || "Hiring signal available"}</strong><div className={styles.chips}>{account.evidenceChips.slice(0, 4).map((chip) => <em key={chip}>{chip}</em>)}</div></div>
              <div className={styles.rowSignal}><span>Hiring</span><strong>{fmt(account.activeJobs)}</strong><small>active jobs</small></div>
              <div className={styles.rowSignal}><span>ATS</span><strong>{account.detectedAts || "Verify"}</strong><small>{account.atsOpportunityScore}/100 opportunity</small></div>
              <div className={styles.rowScore}><span className={`${styles.tier} ${tierClass(account.priorityTier)}`}>{account.priorityTier}</span><strong>{account.priorityScore}</strong><small>{account.recommendation}</small></div>
              <ChevronRight className={styles.rowChevron} size={16}/>
            </button>)}
            {!loading && !filtered.length ? <div className={styles.empty}><Database size={24}/><strong>No accounts match this view</strong><span>Change the filters or discover fresh accounts.</span></div> : null}
            {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={19}/> Ranking accounts…</div> : null}
          </div>
        </section>

        <aside className={styles.sidePanel}>
          <div className={styles.aiCard}>
            <div className={styles.aiHeader}><span className={styles.aiIcon}><BrainCircuit size={17}/></span><div><span>OPENROUTER ANALYST</span><strong>{config?.openRouterConfigured ? "Evidence summarizer ready" : "Optional AI layer"}</strong></div></div>
            <p>The score stays deterministic. Nano only writes the <b>Why now</b>, opener, risk and next action from verified evidence.</p>
            <div className={styles.aiStats}>
              <div><span>Model</span><strong>{config?.openRouterModel?.split("/").pop() || "Nano"}</strong></div>
              <div><span>Today</span><strong>{openRouter ? `${openRouter.today.fastRequests}/${openRouter.limits.fastDaily}` : "—"}</strong></div>
              <div><span>Est. cost</span><strong>{openRouter ? `$${openRouter.today.estimatedCostUsd.toFixed(4)}` : "—"}</strong></div>
            </div>
          </div>

          <div className={styles.privateCard}>
            <div className={styles.cardTitle}><ShieldCheck size={15}/><div><span>PRIVATE ACTIONS</span><strong>Research & discovery</strong></div></div>
            <label className={styles.keyField}><span><KeyRound size={12}/> Owner key</span><input type="password" value={ownerDraft} onChange={(event) => setOwnerDraft(event.target.value)} placeholder="Session-only key"/></label>
            <button type="button" className={styles.secondaryButton} onClick={saveOwnerKey}>{ownerToken ? <CheckCircle2 size={13}/> : <ShieldCheck size={13}/>} {ownerToken ? "Key active" : "Unlock actions"}</button>
            <div className={styles.divider}/>
            <label className={styles.discoverySelect}><span>Fresh discovery</span><select value={discoveryPages} onChange={(event) => setDiscoveryPages(Number(event.target.value))}>{[1,2,3].map((value) => <option key={value} value={value}>{value * 100} companies · up to {value} credit{value === 1 ? "" : "s"}</option>)}</select></label>
            <button type="button" className={styles.primaryButton} onClick={() => void discover()} disabled={busy === "discover" || !ownerToken}>{busy === "discover" ? <LoaderCircle className={styles.spin} size={14}/> : <Zap size={14}/>} Discover & rank</button>
          </div>

          <Link href="/net-new-accounts" className={styles.fullWorkspace}>
            <span><UsersRound size={16}/></span><div><strong>Full Acquisition Workspace</strong><small>SignalHire people · enrichment · HubSpot push</small></div><ArrowUpRight size={14}/>
          </Link>
        </aside>
      </div>
    </div>

    {selected ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDomain(""); }}>
      <aside className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerIdentity}><span className={styles.companyMarkLarge}>{selected.name.slice(0, 2).toUpperCase()}</span><div><span>PRIORITY ACCOUNT</span><h2>{selected.name}</h2><p>{selected.domain} · {selected.country || "Market unknown"}</p></div></div>
          <button type="button" onClick={() => setSelectedDomain("")}><X size={17}/></button>
        </div>

        <div className={styles.drawerScore}>
          <div className={styles.scoreOrb}><span>{selected.priorityTier}</span><strong>{selected.priorityScore}</strong><small>Priority</small></div>
          <div><span>GTM fit</span><strong>{selected.gtmScore}</strong><small>Deterministic</small></div>
          <div><span>Intent</span><strong>{selected.intentScore}</strong><small>{selected.activeJobs} jobs</small></div>
          <div><span>ATS opp.</span><strong>{selected.atsOpportunityScore}</strong><small>{selected.detectedAts || "Unverified"}</small></div>
        </div>

        <section className={styles.drawerSection}>
          <div className={styles.drawerSectionHead}><BrainCircuit size={15}/><div><span>AI ACCOUNT BRIEF</span><strong>{selected.aiBrief ? "Grounded in the evidence below" : "Research to generate a grounded brief"}</strong></div></div>
          {selected.aiBrief ? <div className={styles.briefGrid}>
            <div className={styles.briefPrimary}><span>WHY NOW</span><p>{selected.aiBrief.whyNow}</p></div>
            <div><span>OPENER</span><p>{selected.aiBrief.opener || selected.recommendedAngle}</p></div>
            <div><span>RISK / UNKNOWN</span><p>{selected.aiBrief.risk || "Validate the current recruitment setup before making a displacement claim."}</p></div>
            <div><span>NEXT STEP</span><p>{selected.aiBrief.nextStep || selected.recommendation}</p></div>
          </div> : <p className={styles.placeholderBrief}>{selected.recommendedAngle}</p>}
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.drawerSectionHead}><Flame size={15}/><div><span>VERIFIED SIGNALS</span><strong>{selected.strongestSignal || "Recruiting activity"}</strong></div></div>
          <div className={styles.signalGrid}>
            <div><span>Hiring</span><strong>{fmt(selected.activeJobs)} active jobs</strong></div>
            <div><span>Company size</span><strong>{selected.employeeCount ? `${fmt(selected.employeeCount)} employees` : "Pending"}</strong></div>
            <div><span>Growth</span><strong>{percent(selected.headcountGrowth) || "No strong signal"}</strong></div>
            <div><span>Research</span><strong>{confidenceLabel(selected)}</strong></div>
          </div>
          <div className={styles.drawerChips}>{selected.evidenceChips.map((chip) => <span key={chip}>{chip}</span>)}</div>
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.drawerSectionHead}><UsersRound size={15}/><div><span>BUYING COMMITTEE</span><strong>Start close to the recruiting pain</strong></div></div>
          <div className={styles.personaGrid}>
            <div><span>Primary</span><strong>{selected.primaryPersona}</strong></div>
            <div><span>Secondary</span><strong>{selected.secondaryPersona}</strong></div>
            <div><span>Economic buyer</span><strong>{selected.economicBuyer}</strong></div>
            <div><span>Technical</span><strong>{selected.technicalInfluencer}</strong></div>
          </div>
        </section>

        <div className={styles.drawerActions}>
          <button type="button" className={styles.researchButton} onClick={() => void researchAccount(selected)} disabled={busy === `research:${selected.domain}` || !ownerToken}>{busy === `research:${selected.domain}` ? <LoaderCircle className={styles.spin} size={14}/> : <Sparkles size={14}/>} {selected.researched ? "Refresh intelligence" : "Deep research account"}</button>
          {selected.careerPageUrl ? <a href={selected.careerPageUrl} target="_blank" rel="noreferrer">Career page <ExternalLink size={12}/></a> : null}
          <Link href="/net-new-accounts">Find people & push <ArrowUpRight size={12}/></Link>
        </div>
      </aside>
    </div> : null}
  </main>;
}
