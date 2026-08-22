"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, BadgeCheck, Building2, Check, ChevronRight, CircleAlert,
  Coins, Database, ExternalLink, Filter, Flame, KeyRound, LoaderCircle, Mail, Phone,
  RefreshCw, Search, ShieldCheck, Sparkles, Target, UserRoundSearch, UsersRound, X, Zap,
} from "lucide-react";
import styles from "./NetNewAccounts.module.css";

type Account = {
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
  pushCount: number;
};

type Person = {
  uid: string;
  accountDomain: string;
  fullName: string;
  title: string;
  currentCompany: string;
  location: string;
  linkedinUrl: string;
  rankScore: number;
  fitReason: string;
  emails: string[];
  phones: string[];
  enrichmentStatus: "search_only" | "enriched" | "failed";
  selected: boolean;
  meta: Record<string, unknown>;
};

type Configuration = {
  apolloConfigured: boolean;
  signalHireConfigured: boolean;
  ownerActionsConfigured: boolean;
  apolloCost: string;
  signalHirePolicy: string;
};

type Payload = {
  summary: Record<string, number>;
  accounts: Account[];
  configuration: Configuration;
  error?: string;
};

type FilterTier = "" | Account["gtmTier"];
type FilterCountry = "" | "Saudi Arabia" | "United Arab Emirates";

const OWNER_STORAGE_KEY = "sdr-acquisition-owner-token";

function number(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function track(feature: string, meta: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent("sdr:usage", { detail: { eventType: "action", feature, meta } }));
}

function statusLabel(account: Account) {
  if (account.status === "pushed") return "In HubSpot";
  if (account.status === "enriched") return "Contact ready";
  if (account.status === "people_ready") return "People found";
  if (account.exclusionStatus === "review") return "Review";
  return "Qualified";
}

function tierClass(tier: Account["gtmTier"]) {
  if (tier === "A") return styles.tierA;
  if (tier === "B") return styles.tierB;
  if (tier === "C") return styles.tierC;
  return styles.tierWatch;
}

function statusClass(account: Account) {
  if (account.status === "pushed") return styles.statusPushed;
  if (account.status === "enriched") return styles.statusEnriched;
  if (account.status === "people_ready") return styles.statusPeople;
  if (account.exclusionStatus === "review") return styles.statusReview;
  return styles.statusQualified;
}

function first<T>(values: T[] | undefined) {
  return values?.[0];
}

export function NetNewAccounts({ onBack }: { onBack: () => void }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<FilterTier>("");
  const [country, setCountry] = useState<FilterCountry>("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [ownerToken, setOwnerToken] = useState("");
  const [ownerTokenDraft, setOwnerTokenDraft] = useState("");
  const [pages, setPages] = useState(1);
  const [showExcluded, setShowExcluded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "500" });
      if (showExcluded) query.set("includeExcluded", "1");
      const response = await fetch(`/api/acquisition?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error || "Unable to load net-new accounts.");
      setPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load net-new accounts.");
    } finally {
      setLoading(false);
    }
  }, [showExcluded]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(OWNER_STORAGE_KEY) || "";
    setOwnerToken(saved);
    setOwnerTokenDraft(saved);
    void load();
  }, [load]);

  const selected = useMemo(
    () => payload?.accounts.find((account) => account.domain === selectedDomain) || null,
    [payload, selectedDomain],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (payload?.accounts || []).filter((account) => {
      if (tier && account.gtmTier !== tier) return false;
      if (country && account.country !== country) return false;
      if (!query) return true;
      return [account.name, account.domain, account.industry, account.detectedAts, account.primaryPersona, account.strongestSignal]
        .join(" ").toLowerCase().includes(query);
    });
  }, [country, payload, search, tier]);

  async function loadPeople(domain: string) {
    const response = await fetch(`/api/acquisition?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
    const data = await response.json() as { people?: Person[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to load people.");
    setPeople(data.people || []);
  }

  async function openAccount(account: Account) {
    setSelectedDomain(account.domain);
    setPeople([]);
    setNotice("");
    try { await loadPeople(account.domain); } catch { setPeople([]); }
    track("net-new-account-open", { tier: account.gtmTier, status: account.status });
  }

  function saveOwnerToken() {
    const value = ownerTokenDraft.trim();
    setOwnerToken(value);
    if (value) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
    setNotice(value ? "Owner key saved for this browser session." : "Owner key cleared.");
  }

  async function action(body: Record<string, unknown>) {
    if (!ownerToken) throw new Error("Enter your Owner key first.");
    const response = await fetch("/api/acquisition", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken },
      body: JSON.stringify(body),
    });
    const data = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error || "Acquisition action failed.");
    return data;
  }

  async function discover() {
    const approved = window.confirm(`Discover up to ${pages * 100} companies from Apollo? This run can consume up to ${pages} Apollo credit${pages === 1 ? "" : "s"}.`);
    if (!approved) return;
    setBusy("discover");
    setError("");
    setNotice("");
    try {
      const result = await action({ action: "discover", pages, confirmCredits: true });
      setNotice(`Discovery complete · ${String(result.fetched || 0)} fetched · ${String(result.eligible || 0)} eligible · ${String(result.excluded || 0)} excluded.`);
      track("net-new-discover", { pages, fetched: result.fetched, eligible: result.eligible });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Apollo discovery failed.");
    } finally { setBusy(""); }
  }

  async function findPeople() {
    if (!selected) return;
    setBusy("people");
    setError("");
    try {
      const result = await action({ action: "find_people", domain: selected.domain });
      setNotice(`SignalHire found ${String(result.returned || 0)} ranked people from ${String(result.total || 0)} matches.`);
      await loadPeople(selected.domain);
      await load();
      track("net-new-find-people", { domain: selected.domain, returned: result.returned });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Person search failed.");
    } finally { setBusy(""); }
  }

  async function enrich(person: Person) {
    if (!selected) return;
    setBusy(`enrich:${person.uid}`);
    setError("");
    try {
      const result = await action({ action: "enrich_person", domain: selected.domain, uid: person.uid });
      const enriched = result.person as Person | undefined;
      setNotice(enriched ? `${enriched.fullName} enriched · ${enriched.emails.length} email(s) · ${enriched.phones.length} phone(s).` : "Person enriched.");
      await loadPeople(selected.domain);
      await load();
      track("net-new-enrich", { domain: selected.domain, hasEmail: Boolean(enriched?.emails.length), hasPhone: Boolean(enriched?.phones.length) });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SignalHire enrichment failed.");
    } finally { setBusy(""); }
  }

  async function ensureAssignment(account: Account) {
    if (account.assignedOwnerId) return { ownerId: account.assignedOwnerId, ownerName: account.assignedOwnerName };
    const result = await action({ action: "assign", domain: account.domain });
    const assignment = result.assignment as { ownerId: string; ownerName: string };
    await load();
    return assignment;
  }

  async function push(person: Person) {
    if (!selected) return;
    if (person.enrichmentStatus !== "enriched" || (!person.emails.length && !person.phones.length)) {
      setError("Enrich the selected person and verify at least one email or phone before pushing to HubSpot.");
      return;
    }
    const approved = window.confirm(`Push ${person.fullName} at ${selected.name} to HubSpot and create the assigned SDR task?`);
    if (!approved) return;
    setBusy(`push:${person.uid}`);
    setError("");
    try {
      const assignment = await ensureAssignment(selected);
      const response = await fetch("/api/prospecting/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken },
        body: JSON.stringify({
          linkedinUrl: person.linkedinUrl,
          source: "Net-New Acquisition",
          signalHireUid: person.uid,
          assignmentMode: "acquisition",
          ownerId: assignment.ownerId,
          ownerName: assignment.ownerName,
          fullName: person.fullName,
          title: person.title,
          company: selected.name,
          companyWebsite: `https://${selected.domain}`,
          companyDomain: selected.domain,
          careerPageUrl: selected.careerPageUrl,
          detectedAts: selected.detectedAts,
          atsConfidence: selected.detectedAts ? "verified" : "",
          careerConfidence: 0,
          companyEvidenceUrl: selected.careerPageUrl,
          companyVerificationReason: selected.strongestSignal,
          hiring: {
            status: selected.activeJobs > 0 ? "Hiring Now" : "Unknown",
            activeJobs: selected.activeJobs,
            hiringScore: selected.intentScore,
            hiringLabel: selected.strongestSignal,
            hasHrJobs: /recruit|talent|hris|human resources|\bhr\b/i.test(selected.strongestSignal),
            source: selected.source,
            sourceUrl: selected.careerPageUrl,
            checkedAt: new Date().toISOString(),
            jobsSample: [],
          },
          location: person.location,
          email: first(person.emails) || "",
          emails: person.emails,
          phone: first(person.phones) || "",
          phones: person.phones,
          score: selected.gtmScore,
          priority: selected.gtmTier === "A" ? "high" : selected.gtmTier === "B" ? "medium" : "normal",
          previousTitle: "",
          previousCompany: "",
          recentSignal: { type: "", label: selected.strongestSignal },
          scoreReasons: [
            { label: `GTM Tier ${selected.gtmTier}`, points: Math.min(100, selected.gtmScore) },
            { label: "Intent score", points: Math.min(100, selected.intentScore) },
            { label: "Persona match", points: Math.min(100, person.rankScore) },
          ],
        }),
      });
      const result = await response.json() as { error?: string; ownerName?: string; duplicate?: boolean };
      if (!response.ok) throw new Error(result.error || "HubSpot push failed.");
      setNotice(`${person.fullName} ${result.duplicate ? "already had an open task" : "was pushed"} · assigned to ${result.ownerName || assignment.ownerName}.`);
      await loadPeople(selected.domain);
      await load();
      track("net-new-hubspot-push", { domain: selected.domain, duplicate: Boolean(result.duplicate), owner: result.ownerName });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "HubSpot push failed.");
    } finally { setBusy(""); }
  }

  const config = payload?.configuration;
  const summary = payload?.summary || {};

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <button type="button" onClick={onBack} className={styles.back}><ArrowLeft size={16}/> Dashboard</button>
        <div className={styles.titleBlock}>
          <span>ACCOUNT ACQUISITION</span>
          <h1>Net-New Accounts</h1>
          <p>Company-first prospecting · Apollo discovery · GTM ranking · SignalHire personas · HubSpot routing</p>
        </div>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.livePill}><i/> Postgres queue</span>
        <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} size={15}/> Refresh</button>
      </div>
    </header>

    <section className={styles.heroStrip}>
      <div><ShieldCheck size={17}/><span><strong>Hard exclusions</strong> Government · semi-government · ATS/HRTech competitors · existing HubSpot companies</span></div>
      <div><Target size={17}/><span><strong>Core ICP</strong> KSA + UAE · 201–2,000 employees · 5+ active jobs</span></div>
      <div><Coins size={17}/><span><strong>Cost control</strong> Search people first; enrich only the selected persona</span></div>
    </section>

    {error ? <div className={styles.error}><CircleAlert size={18}/><span>{error}</span><button onClick={() => setError("")}><X size={14}/></button></div> : null}
    {notice ? <div className={styles.notice}><Check size={17}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div> : null}

    <section className={styles.metrics}>
      <div><span>Eligible</span><strong>{number(summary.eligible || 0)}</strong><small>Net-new after exclusions</small></div>
      <div className={styles.metricHot}><span>Tier A</span><strong>{number(summary.tier_a || 0)}</strong><small>Highest priority</small></div>
      <div><span>People ready</span><strong>{number(summary.people_ready || 0)}</strong><small>Persona search completed</small></div>
      <div><span>Enriched</span><strong>{number(summary.enriched || 0)}</strong><small>Email / phone available</small></div>
      <div><span>Pushed</span><strong>{number(summary.pushed || 0)}</strong><small>Company + contact + task</small></div>
      <div><span>Excluded</span><strong>{number(summary.excluded || 0)}</strong><small>Kept out of SDR queue</small></div>
    </section>

    <div className={styles.layout}>
      <section className={styles.mainPanel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account, ATS, industry, persona..."/></label>
          <label><Filter size={14}/><select value={tier} onChange={(event) => setTier(event.target.value as FilterTier)}><option value="">All tiers</option><option value="A">Tier A</option><option value="B">Tier B</option><option value="C">Tier C</option><option value="Watch">Watch</option></select></label>
          <label><Building2 size={14}/><select value={country} onChange={(event) => setCountry(event.target.value as FilterCountry)}><option value="">KSA + UAE</option><option value="Saudi Arabia">Saudi Arabia</option><option value="United Arab Emirates">United Arab Emirates</option></select></label>
          <label className={styles.checkLabel}><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}/> Include excluded</label>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Account</th><th>GTM</th><th>Hiring</th><th>ATS</th><th>Best persona</th><th>Status</th><th>SDR</th><th/></tr></thead>
            <tbody>
              {filtered.map((account) => <tr key={account.domain} className={selectedDomain === account.domain ? styles.selectedRow : ""}>
                <td><button type="button" className={styles.accountCell} onClick={() => void openAccount(account)}><span className={styles.companyMark}>{account.name.slice(0, 2).toUpperCase()}</span><span><strong>{account.name}</strong><small>{account.country || "Market unknown"} · {account.employeeCount ? `${number(account.employeeCount)} employees` : "Size pending"}</small><em>{account.domain}</em></span></button></td>
                <td><span className={`${styles.tier} ${tierClass(account.gtmTier)}`}>Tier {account.gtmTier}</span><b className={styles.score}>{account.gtmScore}</b></td>
                <td><strong className={styles.jobs}>{number(account.activeJobs)}</strong><small className={styles.cellSub}>active jobs</small></td>
                <td><span className={styles.ats}>{account.detectedAts || "To verify"}</span><small className={styles.cellSub}>{account.atsOpportunityScore}/100 opportunity</small></td>
                <td><span className={styles.persona}>{account.primaryPersona || "TA leader"}</span></td>
                <td><span className={`${styles.status} ${statusClass(account)}`}>{statusLabel(account)}</span></td>
                <td><span className={styles.owner}>{account.assignedOwnerName || "Smart route"}</span></td>
                <td><button type="button" className={styles.rowAction} onClick={() => void openAccount(account)}><ChevronRight size={16}/></button></td>
              </tr>)}
              {!loading && !filtered.length ? <tr><td colSpan={8}><div className={styles.empty}><Database size={24}/><strong>No net-new accounts in this view</strong><span>{config?.apolloConfigured ? "Run Apollo discovery or change the filters." : "Add the Apollo server key, then run discovery."}</span></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <aside className={styles.controlPanel}>
        <div className={styles.controlHeader}><span>OWNER CONTROLS</span><strong>Discovery & write access</strong></div>
        <div className={styles.configRows}>
          <div><span className={config?.apolloConfigured ? styles.okDot : styles.offDot}/><p><strong>Apollo</strong><small>{config?.apolloConfigured ? "API connected" : "API key required"}</small></p></div>
          <div><span className={config?.signalHireConfigured ? styles.okDot : styles.offDot}/><p><strong>SignalHire</strong><small>{config?.signalHireConfigured ? "Search + enrichment ready" : "API key required"}</small></p></div>
          <div><span className={config?.ownerActionsConfigured ? styles.okDot : styles.offDot}/><p><strong>Owner actions</strong><small>{config?.ownerActionsConfigured ? "Server gate configured" : "Owner secret required"}</small></p></div>
        </div>
        <label className={styles.ownerKey}><span><KeyRound size={14}/> Owner key</span><input type="password" value={ownerTokenDraft} onChange={(event) => setOwnerTokenDraft(event.target.value)} placeholder="Session-only key"/></label>
        <button type="button" className={styles.saveKey} onClick={saveOwnerToken}><ShieldCheck size={15}/> Save for this session</button>

        <div className={styles.divider}/>
        <div className={styles.discoveryTitle}><div><span>APOLLO DISCOVERY</span><strong>Load medium-market accounts</strong></div><Sparkles size={17}/></div>
        <label className={styles.pageSelect}><span>Pages</span><select value={pages} onChange={(event) => setPages(Number(event.target.value))}>{[1,2,3,4,5,6].map((page) => <option key={page} value={page}>{page} · up to {page * 100} companies</option>)}</select></label>
        <p className={styles.costNote}><Coins size={13}/> Up to {pages} Apollo credit{pages === 1 ? "" : "s"}. Existing HubSpot accounts and hard exclusions are removed before SDR work.</p>
        <button type="button" className={styles.discover} disabled={busy === "discover" || !config?.apolloConfigured || !config?.ownerActionsConfigured || !ownerToken} onClick={() => void discover()}>{busy === "discover" ? <LoaderCircle className={styles.spin} size={16}/> : <Zap size={16}/>} Discover & rank</button>
      </aside>
    </div>

    {selected ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDomain(""); }}>
      <aside className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <div><span>NET-NEW ACCOUNT</span><h2>{selected.name}</h2><p>{selected.domain} · {selected.country || "Market unknown"}</p></div>
          <button type="button" onClick={() => setSelectedDomain("")}><X size={18}/></button>
        </div>

        <div className={styles.drawerScoreRow}>
          <div className={`${styles.bigScore} ${tierClass(selected.gtmTier)}`}><span>Tier {selected.gtmTier}</span><strong>{selected.gtmScore}</strong><small>GTM score</small></div>
          <div><span>Intent</span><strong>{selected.intentScore}</strong><small>{selected.activeJobs} active jobs</small></div>
          <div><span>Fit</span><strong>{selected.fitScore}</strong><small>{selected.employeeCount ? `${number(selected.employeeCount)} employees` : "Size pending"}</small></div>
          <div><span>ATS opp.</span><strong>{selected.atsOpportunityScore}</strong><small>{selected.detectedAts || "ATS to verify"}</small></div>
        </div>

        <section className={styles.drawerSection}>
          <div className={styles.sectionTitle}><Target size={16}/><div><span>WHY THIS ACCOUNT</span><strong>{selected.strongestSignal || "Current hiring activity"}</strong></div></div>
          <p>{selected.recommendedAngle}</p>
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.sectionTitle}><UsersRound size={16}/><div><span>BUYING COMMITTEE</span><strong>Who to approach first</strong></div></div>
          <div className={styles.personaGrid}>
            <div><span>Primary</span><strong>{selected.primaryPersona}</strong></div>
            <div><span>Secondary</span><strong>{selected.secondaryPersona}</strong></div>
            <div><span>Economic</span><strong>{selected.economicBuyer}</strong></div>
            <div><span>Technical</span><strong>{selected.technicalInfluencer}</strong></div>
          </div>
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.peopleHeader}>
            <div className={styles.sectionTitle}><UserRoundSearch size={16}/><div><span>SIGNALHIRE</span><strong>Best people at this company</strong></div></div>
            <button type="button" onClick={() => void findPeople()} disabled={busy === "people" || !ownerToken || !config?.signalHireConfigured}>{busy === "people" ? <LoaderCircle className={styles.spin} size={14}/> : <Search size={14}/>} Find people</button>
          </div>
          <p className={styles.peoplePolicy}>Search results don&apos;t reveal contacts. We spend a Person API credit only after you choose a candidate to enrich.</p>
          <div className={styles.peopleList}>
            {people.map((person, index) => <div className={`${styles.personCard} ${person.enrichmentStatus === "enriched" ? styles.personEnriched : ""}`} key={person.uid}>
              <div className={styles.personRank}>{index + 1}</div>
              <div className={styles.personMain}>
                <div><strong>{person.fullName}</strong>{person.enrichmentStatus === "enriched" ? <span className={styles.verified}><BadgeCheck size={12}/> Enriched</span> : null}</div>
                <p>{person.title || "Role unavailable"}</p>
                <small>{person.currentCompany || "Company pending"}{person.location ? ` · ${person.location}` : ""}</small>
                <em>{person.fitReason}</em>
                {person.enrichmentStatus === "enriched" ? <div className={styles.contacts}>
                  {person.emails.map((email) => <span key={email}><Mail size={12}/>{email}</span>)}
                  {person.phones.map((phone) => <span key={phone}><Phone size={12}/>{phone}</span>)}
                </div> : null}
              </div>
              <div className={styles.personActions}>
                <span className={styles.personScore}>{person.rankScore}</span>
                {person.linkedinUrl ? <a href={person.linkedinUrl} target="_blank" rel="noreferrer" aria-label="LinkedIn"><ExternalLink size={14}/></a> : null}
                {person.enrichmentStatus !== "enriched" ? <button type="button" onClick={() => void enrich(person)} disabled={busy === `enrich:${person.uid}` || !ownerToken}>{busy === `enrich:${person.uid}` ? <LoaderCircle className={styles.spin} size={13}/> : <Sparkles size={13}/>} Enrich</button> : <button type="button" className={styles.pushButton} onClick={() => void push(person)} disabled={busy === `push:${person.uid}` || !ownerToken}>{busy === `push:${person.uid}` ? <LoaderCircle className={styles.spin} size={13}/> : <ArrowUpRight size={13}/>} Push</button>}
              </div>
            </div>)}
            {!people.length ? <div className={styles.peopleEmpty}><UserRoundSearch size={22}/><span>No people searched yet.</span></div> : null}
          </div>
        </section>

        <div className={styles.assignmentBar}>
          <div><span>SDR ROUTING</span><strong>{selected.assignedOwnerName || "Smart assignment on push"}</strong><small>{selected.assignedOwnerName ? "Assignment is frozen for this account" : "Lowest weighted open-task load; existing HubSpot ownership always wins"}</small></div>
          {selected.hubspotCompanyId ? <a href={`https://app-eu1.hubspot.com/contacts/145742477/company/${selected.hubspotCompanyId}`} target="_blank" rel="noreferrer">HubSpot <ArrowUpRight size={13}/></a> : null}
        </div>
      </aside>
    </div> : null}
  </main>;
}
