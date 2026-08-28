"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Coins,
  Crosshair,
  Database,
  Filter,
  LoaderCircle,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserRoundSearch,
  X,
} from "lucide-react";
import styles from "./TargetAccountPool.module.css";

type Market = {
  country: string;
  code: string;
  phase: string;
  marketSize: number;
  priority: number;
  industries: readonly string[];
  naics: readonly string[];
};

type Account = {
  domain: string;
  name: string;
  source: string;
  sourceId: string;
  country: string;
  employeeCount: number;
  industry: string;
  activeJobs: number;
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
  peopleCount: number;
  enrichedCount: number;
  phoneReadyCount: number;
  pushCount: number;
  evidence: Record<string, unknown>;
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

type Payload = {
  accounts: Account[];
  markets: Market[];
  targetUniverse: number;
  configuration: {
    apolloConfigured: boolean;
    signalHireConfigured: boolean;
    ownerActionsConfigured: boolean;
    hubspotWritePolicy: string;
    signalHirePolicy: string;
  };
};

function fmt(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function feedRequested(account: Account) {
  return account.evidence?.feedMaritaRequested === true;
}

function verified(account: Account) {
  return Boolean(account.evidence?.targetPoolVerifiedAt);
}

function stage(account: Account) {
  if (account.status === "pushed" || account.pushCount > 0) return "Sent";
  if (feedRequested(account)) return "Queued for Marita";
  if (account.phoneReadyCount > 0) return "Phone ready";
  if (account.peopleCount > 0) return "Persona found";
  if (verified(account)) return "Verified target";
  if (account.exclusionStatus === "review") return "Review";
  if (account.exclusionStatus === "excluded") return "Excluded";
  return "Target pool";
}

export function TargetAccountPool() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [country, setCountry] = useState("Saudi Arabia");
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ country, limit: "1000" });
      if (showExcluded) query.set("includeExcluded", "1");
      const response = await fetch(`/api/target-account-pool?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load Target Account Pool.");
      setPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Target Account Pool.");
    } finally {
      setLoading(false);
    }
  }, [country, showExcluded]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let active = true;
    fetch("/api/sdr-admin", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { unlocked?: boolean }) => { if (active) setAdminUnlocked(Boolean(data.unlocked)); })
      .catch(() => { if (active) setAdminUnlocked(false); });
    const sync = () => {
      fetch("/api/sdr-admin", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: { unlocked?: boolean }) => { if (active) setAdminUnlocked(Boolean(data.unlocked)); })
        .catch(() => { if (active) setAdminUnlocked(false); });
    };
    window.addEventListener("sdr:admin-auth-changed", sync);
    return () => { active = false; window.removeEventListener("sdr:admin-auth-changed", sync); };
  }, []);

  const selected = useMemo(
    () => payload?.accounts.find((account) => account.domain === selectedDomain) || null,
    [payload, selectedDomain],
  );

  const currentMarket = useMemo(
    () => payload?.markets.find((market) => market.country === country) || null,
    [country, payload],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (payload?.accounts || []).filter((account) => {
      if (tier && account.gtmTier !== tier) return false;
      if (!query) return true;
      return [account.name, account.domain, account.industry, account.detectedAts, account.primaryPersona, account.strongestSignal]
        .join(" ").toLowerCase().includes(query);
    }).sort((a, b) => {
      const feedDelta = Number(feedRequested(b)) - Number(feedRequested(a));
      if (feedDelta) return feedDelta;
      const phoneDelta = Number(b.phoneReadyCount > 0) - Number(a.phoneReadyCount > 0);
      if (phoneDelta) return phoneDelta;
      return b.gtmScore - a.gtmScore || a.name.localeCompare(b.name);
    });
  }, [payload, search, tier]);

  const stats = useMemo(() => {
    const accounts = payload?.accounts || [];
    return {
      stocked: accounts.length,
      eligible: accounts.filter((account) => account.exclusionStatus === "eligible").length,
      verified: accounts.filter(verified).length,
      queued: accounts.filter(feedRequested).length,
      phone: accounts.filter((account) => account.phoneReadyCount > 0).length,
    };
  }, [payload]);

  async function ownerAction(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as Record<string, unknown> & { error?: string };
    if (response.status === 401) {
      setAdminUnlocked(false);
      window.dispatchEvent(new CustomEvent("sdr:admin-auth-changed"));
      throw new Error("Admin access is locked. Open SDR Tools → Advanced & Data Ops and enter the admin password.");
    }
    if (!response.ok) throw new Error(data.error || "Target Pool action failed.");
    return data;
  }

  async function loadPeople(domain: string) {
    const response = await fetch(`/api/acquisition?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
    const data = await response.json() as { people?: Person[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to load people.");
    setPeople([...(data.people || [])].sort((a, b) => {
      const phoneDelta = Number(b.phones.length > 0) - Number(a.phones.length > 0);
      return phoneDelta || b.rankScore - a.rankScore;
    }));
  }

  async function openAccount(account: Account) {
    setSelectedDomain(account.domain);
    setPeople([]);
    setNotice("");
    try { await loadPeople(account.domain); } catch { setPeople([]); }
  }

  async function discoverMarket() {
    if (!currentMarket) return;
    const approved = window.confirm(
      `Load up to ${pages * 100} ${currentMarket.country} companies into the dashboard pool? This can consume up to ${pages} Apollo credit${pages === 1 ? "" : "s"}. Nothing will be written to HubSpot.`,
    );
    if (!approved) return;
    setBusy("discover");
    setError("");
    try {
      const result = await ownerAction("/api/target-account-pool", {
        action: "discover_market",
        country: currentMarket.country,
        pages,
        confirmCredits: true,
      });
      setNotice(`${currentMarket.country}: ${String(result.uniqueDomains || 0)} domains stored · ${String(result.eligible || 0)} eligible · ${String(result.existingHubSpot || 0)} already in HubSpot.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Apollo market load failed.");
    } finally { setBusy(""); }
  }

  async function verifyCompany() {
    if (!selected) return;
    setBusy("verify");
    setError("");
    try {
      await ownerAction("/api/target-account-pool", { action: "verify_account", domain: selected.domain });
      setNotice("Company rechecked · official site, Career/ATS evidence and HubSpot domain gate refreshed.");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Company verification failed.");
    } finally { setBusy(""); }
  }

  async function findPeople() {
    if (!selected) return;
    setBusy("people");
    setError("");
    try {
      const result = await ownerAction("/api/acquisition", { action: "find_people", domain: selected.domain });
      setNotice(`SignalHire search ranked ${String(result.returned || 0)} people. No contact reveal was requested.`);
      await loadPeople(selected.domain);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SignalHire person search failed.");
    } finally { setBusy(""); }
  }

  async function revealPhone(person: Person) {
    if (!selected) return;
    const approved = window.confirm(`Reveal contacts for ${person.fullName}? This is a SignalHire Person API attempt. Only this selected persona will be revealed.`);
    if (!approved) return;
    setBusy(`reveal:${person.uid}`);
    setError("");
    try {
      const result = await ownerAction("/api/acquisition", { action: "enrich_person", domain: selected.domain, uid: person.uid });
      const enriched = result.person as Person | undefined;
      setNotice(enriched?.phones?.length
        ? `${enriched.fullName}: ${enriched.phones.length} phone number(s) ready.`
        : `${enriched?.fullName || person.fullName}: no phone returned. No automatic second reveal was triggered.`);
      await loadPeople(selected.domain);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SignalHire reveal failed.");
    } finally { setBusy(""); }
  }

  async function requestMaritaFeed() {
    if (!selected) return;
    const approved = window.confirm(
      `Queue ${selected.name} for Marita? The worker may search SignalHire and reveal only the highest-ranked verified persona when needed. HubSpot write happens only when a phone-ready persona is found.`,
    );
    if (!approved) return;
    setBusy("feed");
    setError("");
    try {
      await ownerAction("/api/target-account-pool", { action: "request_feed", domain: selected.domain });
      setNotice(`${selected.name} queued for Marita · phone required · HubSpot will be rechecked before any write.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to queue this account for Marita.");
    } finally { setBusy(""); }
  }

  async function cancelMaritaFeed() {
    if (!selected) return;
    setBusy("cancel-feed");
    try {
      await ownerAction("/api/target-account-pool", { action: "cancel_feed", domain: selected.domain });
      setNotice(`${selected.name} removed from the Marita feed queue.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to cancel Marita feed.");
    } finally { setBusy(""); }
  }

  return <div className={styles.pool}>
    <section className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>TARGET ACCOUNT POOL</span>
        <h2>Qualified market inventory before HubSpot</h2>
        <p>Store strong accounts in the dashboard, verify them, and spend SignalHire credits only when you explicitly feed Marita.</p>
      </div>
      <div className={styles.heroBadges}>
        <span><ShieldCheck size={14}/> HubSpot read-only until feed</span>
        <span><Phone size={14}/> Phone required for Marita</span>
      </div>
    </section>

    <section className={styles.marketRail}>
      {(payload?.markets || []).map((market) => <button key={market.country} type="button" className={`${styles.marketCard} ${country === market.country ? styles.marketActive : ""}`} onClick={() => setCountry(market.country)}>
        <span>{market.code} · {market.phase}</span>
        <strong>{market.country}</strong>
        <b>{fmt(market.marketSize)}</b>
        <small>target companies</small>
      </button>)}
    </section>

    <section className={styles.metrics}>
      <div><span>Approved universe</span><strong>{fmt(payload?.targetUniverse || 9292)}</strong><small>11 markets · 201+ employees</small></div>
      <div><span>{country} stocked</span><strong>{fmt(stats.stocked)}</strong><small>actual domains in dashboard DB</small></div>
      <div><span>Eligible</span><strong>{fmt(stats.eligible)}</strong><small>after HubSpot + safety gate</small></div>
      <div><span>Verified</span><strong>{fmt(stats.verified)}</strong><small>career/ATS research attempted</small></div>
      <div className={styles.hotMetric}><span>Queued for Marita</span><strong>{fmt(stats.queued)}</strong><small>explicitly armed only</small></div>
      <div className={styles.hotMetric}><span>Phone ready</span><strong>{fmt(stats.phone)}</strong><small>SignalHire reveal succeeded</small></div>
    </section>

    {error ? <div className={styles.error}><CircleAlert size={17}/><span>{error}</span><button onClick={() => setError("")}><X size={14}/></button></div> : null}
    {notice ? <div className={styles.notice}><CheckCircle2 size={17}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div> : null}

    <div className={styles.workspace}>
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <label className={styles.search}><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account, industry, ATS, persona..."/></label>
          <label><Filter size={14}/><select value={tier} onChange={(event) => setTier(event.target.value)}><option value="">All tiers</option><option value="A">Tier A</option><option value="B">Tier B</option><option value="C">Tier C</option><option value="Watch">Watch</option></select></label>
          <label className={styles.check}><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}/> Show blocked</label>
          <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} size={15}/> Refresh</button>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Account</th><th>Industry</th><th>Score</th><th>Career</th><th>ATS</th><th>HubSpot</th><th>Persona</th><th>Stage</th><th/></tr></thead>
            <tbody>
              {filtered.map((account) => <tr key={account.domain}>
                <td><button className={styles.account} type="button" onClick={() => void openAccount(account)}><span>{account.name.slice(0, 2).toUpperCase()}</span><div><strong>{account.name}</strong><small>{account.employeeCount ? `${fmt(account.employeeCount)} employees` : "201+ employee filter"}</small><em>{account.domain}</em></div></button></td>
                <td><strong>{account.industry || "Target industry"}</strong><small>{account.country}</small></td>
                <td><b className={styles.score}>{account.gtmScore}</b><small>Tier {account.gtmTier}</small></td>
                <td>{account.careerPageUrl ? <span className={styles.good}>Verified</span> : verified(account) ? <span className={styles.warn}>Not found</span> : <span className={styles.muted}>Pending</span>}</td>
                <td><span>{account.detectedAts || (verified(account) ? "Unknown" : "Pending")}</span></td>
                <td>{account.hubspotCompanyId ? <span className={styles.blocked}>Existing</span> : <span className={styles.good}>Net-new</span>}</td>
                <td><span>{account.primaryPersona || "TA / HR leader"}</span></td>
                <td><span className={feedRequested(account) ? styles.queued : styles.stage}>{stage(account)}</span></td>
                <td><button type="button" className={styles.rowButton} onClick={() => void openAccount(account)}><ChevronRight size={16}/></button></td>
              </tr>)}
              {!loading && !filtered.length ? <tr><td colSpan={9}><div className={styles.empty}><Database size={22}/><strong>No stocked accounts for this view</strong><span>Use the controlled market loader to add the next Apollo page. Nothing is sent to HubSpot.</span></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </main>

      <aside className={styles.control}>
        <div className={styles.controlTitle}><Crosshair size={17}/><div><span>MARKET STOCKING</span><strong>{country}</strong></div></div>
        <p>{currentMarket?.industries.join(" · ")}</p>
        <div className={styles.controlStat}><span>Apollo market universe</span><strong>{fmt(currentMarket?.marketSize || 0)}</strong></div>
        <label className={styles.pages}><span>Pages to load</span><select value={pages} onChange={(event) => setPages(Number(event.target.value))}>{[1,2,3,4,5,6].map((page) => <option value={page} key={page}>{page} · up to {page * 100} companies</option>)}</select></label>
        <div className={styles.cost}><Coins size={14}/><span>Up to <strong>{pages}</strong> Apollo credit{pages === 1 ? "" : "s"}. Domain dedupe happens before the account becomes eligible.</span></div>
        <button className={styles.stock} type="button" onClick={() => void discoverMarket()} disabled={busy === "discover" || !payload?.configuration.apolloConfigured || !adminUnlocked}>{busy === "discover" ? <LoaderCircle className={styles.spin} size={16}/> : <Sparkles size={16}/>} Load market page</button>

        <div className={styles.divider}/>
        <div className={styles.guard}><BadgeCheck size={15}/><span><strong>{adminUnlocked ? "Admin unlocked" : "Admin locked"}</strong>{adminUnlocked ? " Administrative actions are ready. No browser key is required." : " Open SDR Tools → Advanced & Data Ops and enter the admin password."}</span></div>
        <div className={styles.guard}><ShieldCheck size={15}/><span><strong>Credit guard</strong> Dormant pool accounts trigger zero SignalHire reveals. Marita queue is explicit.</span></div>
      </aside>
    </div>

    {selected ? <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDomain(""); }}>
      <aside className={styles.drawer}>
        <header><div><span>TARGET ACCOUNT</span><h3>{selected.name}</h3><p>{selected.domain} · {selected.country} · {selected.industry}</p></div><button onClick={() => setSelectedDomain("")}><X size={18}/></button></header>

        <div className={styles.drawerScores}>
          <div><span>GTM</span><strong>{selected.gtmScore}</strong><small>Tier {selected.gtmTier}</small></div>
          <div><span>Career</span><strong>{selected.careerPageUrl ? "Yes" : verified(selected) ? "No" : "—"}</strong><small>{verified(selected) ? "checked" : "pending"}</small></div>
          <div><span>ATS</span><strong>{selected.detectedAts || "—"}</strong><small>{String(selected.evidence?.atsConfidence || "not verified")}</small></div>
          <div><span>Phones</span><strong>{selected.phoneReadyCount || 0}</strong><small>revealed</small></div>
        </div>

        {selected.exclusionStatus !== "eligible" ? <div className={styles.drawerBlock}><CircleAlert size={17}/><span><strong>Blocked</strong>{selected.exclusionReason || "This account is not eligible."}</span></div> : null}

        <section className={styles.drawerSection}>
          <div className={styles.sectionTitle}><Building2 size={16}/><div><span>ACCOUNT VERIFICATION</span><strong>Career, ATS & HubSpot recheck</strong></div></div>
          <p>{selected.strongestSignal}</p>
          {selected.careerPageUrl ? <a href={selected.careerPageUrl} target="_blank" rel="noreferrer">Open verified career destination ↗</a> : null}
          <button className={styles.secondaryAction} type="button" disabled={busy === "verify" || !adminUnlocked || selected.exclusionStatus === "excluded"} onClick={() => void verifyCompany()}>{busy === "verify" ? <LoaderCircle className={styles.spin} size={15}/> : <ShieldCheck size={15}/>} Verify company now</button>
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.sectionTitle}><Target size={16}/><div><span>BUYING COMMITTEE</span><strong>{selected.primaryPersona}</strong></div></div>
          <div className={styles.personas}><span>Secondary · {selected.secondaryPersona}</span><span>Economic · {selected.economicBuyer}</span><span>Technical · {selected.technicalInfluencer}</span></div>
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.peopleHead}><div className={styles.sectionTitle}><UserRoundSearch size={16}/><div><span>SIGNALHIRE</span><strong>Search first · reveal one person</strong></div></div><button type="button" disabled={busy === "people" || !adminUnlocked || selected.exclusionStatus !== "eligible"} onClick={() => void findPeople()}>{busy === "people" ? <LoaderCircle className={styles.spin} size={14}/> : <Search size={14}/>} Search personas</button></div>
          {!people.length ? <div className={styles.peopleEmpty}>No persona search stored yet. This step does not request contact reveal.</div> : <div className={styles.peopleList}>{people.map((person, index) => <div className={styles.person} key={person.uid}>
            <div className={styles.personRank}>{index + 1}</div><div className={styles.personCopy}><strong>{person.fullName}</strong><span>{person.title}</span><small>{person.fitReason}</small></div><div className={styles.personContact}>{person.phones.length ? <b><Phone size={12}/>{person.phones[0]}</b> : person.enrichmentStatus === "enriched" ? <em>No phone</em> : <button type="button" disabled={busy === `reveal:${person.uid}` || !adminUnlocked} onClick={() => void revealPhone(person)}>{busy === `reveal:${person.uid}` ? <LoaderCircle className={styles.spin} size={13}/> : <Coins size={13}/>} Reveal selected</button>}</div>
          </div>)}</div>}
        </section>

        <footer className={styles.drawerFooter}>
          {feedRequested(selected) ? <button className={styles.cancelFeed} type="button" disabled={busy === "cancel-feed"} onClick={() => void cancelMaritaFeed()}>Cancel Marita queue</button> : <button className={styles.feed} type="button" disabled={busy === "feed" || !adminUnlocked || selected.exclusionStatus !== "eligible" || !verified(selected)} onClick={() => void requestMaritaFeed()}>{busy === "feed" ? <LoaderCircle className={styles.spin} size={16}/> : <Phone size={16}/>} Feed Marita</button>}
          <p>{!verified(selected) ? "Verify the company first. " : ""}Feed Marita is the only state that allows the daily worker to reveal a persona and create a HubSpot CALL task.</p>
        </footer>
      </aside>
    </div> : null}
  </div>;
}
