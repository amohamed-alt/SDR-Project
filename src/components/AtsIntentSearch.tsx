"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, Flame, RefreshCw, Search, ShieldCheck, UploadCloud, UserSearch } from "lucide-react";
import styles from "@/components/AtsIntentSearch.module.css";

type Region = "Saudi Arabia" | "United Arab Emirates" | "GCC" | "All";

type IntentResult = {
  id: string;
  title: string;
  authorLabel: string;
  url: string;
  snippet: string;
  publishedAt: string;
  sourceScore: number;
  intentScore: number;
  signalType: string;
  signalLabel: string;
  detectedRegion: string;
  detectedVendors: string[];
  matchedPhrases: string[];
};

type SearchPayload = {
  meta: {
    source: string;
    keyword: string;
    region: Region;
    minScore: number;
    fetchedAt: string;
    cached: boolean;
    providerErrors: string[];
  };
  summary: {
    total: number;
    highIntent: number;
    mediumIntent: number;
    lowIntent: number;
    buyingOrReplacement: number;
  };
  results: IntentResult[];
};

type ProfileCandidate = { url: string; title: string; snippet: string; confidence: number };
type EnrichedProspect = {
  linkedinUrl: string;
  fullName: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  score: number;
  priority: "high" | "medium" | "normal";
} & Record<string, unknown>;

type EnrichmentPayload = {
  error?: string;
  needsProfileUrl?: boolean;
  needsProfileConfirmation?: boolean;
  authorName?: string;
  candidates?: ProfileCandidate[];
  author?: { name: string; profileUrl: string; matchConfidence: number; candidates: ProfileCandidate[] };
  prospect?: EnrichedProspect;
  meta?: { provider?: string; creditsLeft?: number | null; safeMatchThreshold?: number };
};

type PushResult = {
  pushed?: boolean;
  duplicate?: boolean;
  taskId?: string;
  contactId?: string;
  companyId?: string | null;
  message?: string;
  error?: string;
};

const QUICK_SEARCHES = [
  "ATS",
  "applicant tracking system",
  "looking for an ATS",
  "replace our ATS",
  "recruitment system",
  "candidate experience",
];

function scoreClass(score: number) {
  if (score >= 80) return styles.scoreHigh;
  if (score >= 55) return styles.scoreMedium;
  return styles.scoreLow;
}

function readableDate(value: string) {
  if (!value) return "Indexed result";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function AtsIntentSearch({ onBack }: { onBack: () => void }) {
  const [keyword, setKeyword] = useState("ATS");
  const [region, setRegion] = useState<Region>("Saudi Arabia");
  const [minScore, setMinScore] = useState(0);
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [enrichingId, setEnrichingId] = useState("");
  const [pushingId, setPushingId] = useState("");
  const [enrichment, setEnrichment] = useState<Record<string, EnrichmentPayload>>({});
  const [pushResults, setPushResults] = useState<Record<string, PushResult>>({});

  const visibleResults = useMemo(() => payload?.results || [], [payload]);

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setEnrichment({});
    setPushResults({});

    try {
      const response = await fetch("/api/ats-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, region, minScore, maxResults: 30 }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as SearchPayload & { error?: string; providerErrors?: string[] };
      if (!response.ok) {
        const details = Array.isArray(body.providerErrors) && body.providerErrors.length ? ` ${body.providerErrors.join(" · ")}` : "";
        throw new Error(`${body.error || `Search failed (${response.status})`}${details}`);
      }
      setPayload(body);
    } catch (searchError) {
      setPayload(null);
      setError(searchError instanceof Error ? searchError.message : "ATS intent search failed.");
    } finally {
      setLoading(false);
    }
  }

  function applyQuickSearch(value: string) {
    setKeyword(value);
  }

  async function enrichResult(item: IntentResult, profileUrl = "") {
    if (enrichingId) return;
    setEnrichingId(item.id);
    setPushResults((current) => ({ ...current, [item.id]: {} }));
    try {
      const response = await fetch("/api/ats-intent/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postUrl: item.url,
          title: item.title,
          authorLabel: item.authorLabel,
          snippet: item.snippet,
          region: item.detectedRegion || region,
          signalLabel: item.signalLabel,
          intentScore: item.intentScore,
          matchedPhrases: item.matchedPhrases,
          detectedVendors: item.detectedVendors,
          ...(profileUrl ? { profileUrl } : {}),
        }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as EnrichmentPayload;
      setEnrichment((current) => ({ ...current, [item.id]: body }));
    } catch (enrichError) {
      setEnrichment((current) => ({ ...current, [item.id]: { error: enrichError instanceof Error ? enrichError.message : "Enrichment failed." } }));
    } finally {
      setEnrichingId("");
    }
  }

  async function pushProspect(item: IntentResult) {
    const prospect = enrichment[item.id]?.prospect;
    if (!prospect || pushingId) return;
    setPushingId(item.id);
    try {
      const response = await fetch("/api/prospecting/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prospect),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as PushResult;
      setPushResults((current) => ({ ...current, [item.id]: body }));
    } catch (pushError) {
      setPushResults((current) => ({ ...current, [item.id]: { error: pushError instanceof Error ? pushError.message : "HubSpot push failed." } }));
    } finally {
      setPushingId("");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.backdrop}/>
      <section className={styles.hero}>
        <button className={styles.backButton} type="button" onClick={onBack}>
          <ArrowLeft size={16}/>
          Dashboard
        </button>
        <div className={styles.eyebrow}><Flame size={15}/> TALENTERA INTENT ENGINE · PEOPLE BRIDGE</div>
        <div className={styles.heroGrid}>
          <div>
            <h1>ATS Intent Search</h1>
            <p>Find public LinkedIn posts that mention ATS pain, evaluation or replacement, resolve the author safely, enrich the person through SignalHire, then push verified leads into the existing HubSpot SDR queue.</p>
          </div>
          <div className={styles.sourceCard}>
            <ShieldCheck size={18}/>
            <div>
              <strong>Public discovery + controlled enrichment</strong>
              <span>No LinkedIn cookies. SignalHire is only called when the public author/profile match is confident enough, or after you pick a profile explicitly.</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.searchPanel}>
        <form className={styles.searchForm} onSubmit={runSearch}>
          <label className={styles.searchField}>
            <Search size={18}/>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="ATS, Workday, recruitment system..." maxLength={120}/>
          </label>
          <select value={region} onChange={(event) => setRegion(event.target.value as Region)}>
            <option>Saudi Arabia</option><option>United Arab Emirates</option><option>GCC</option><option>All</option>
          </select>
          <select value={String(minScore)} onChange={(event) => setMinScore(Number(event.target.value))}>
            <option value="0">All intent scores</option><option value="55">55+ Medium intent</option><option value="80">80+ High intent</option>
          </select>
          <button className={styles.searchButton} type="submit" disabled={loading || !keyword.trim()}>
            {loading ? <RefreshCw className={styles.spin} size={17}/> : <Search size={17}/>} {loading ? "Searching…" : "Search posts"}
          </button>
        </form>
        <div className={styles.quickRow}>
          <span>Quick searches</span>
          {QUICK_SEARCHES.map((value) => <button key={value} type="button" onClick={() => applyQuickSearch(value)} className={keyword === value ? styles.quickActive : ""}>{value}</button>)}
        </div>
      </section>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {!payload && !loading && !error ? (
        <section className={styles.emptyState}>
          <Search size={27}/><h2>Run the first ATS signal search</h2>
          <p>Start with <strong>ATS</strong> + <strong>Saudi Arabia</strong>. High-intent posts can then be converted into enriched people without manually copying data between tools.</p>
          <button type="button" onClick={() => void runSearch()}><Flame size={16}/> Test Saudi ATS signals</button>
        </section>
      ) : null}

      {payload ? (
        <>
          <section className={styles.statsGrid}>
            <article><span>LinkedIn posts</span><strong>{payload.summary.total}</strong><small>{payload.meta.cached ? "10-min cache hit" : "Fresh public-web search"}</small></article>
            <article><span>High intent</span><strong>{payload.summary.highIntent}</strong><small>Score 80+</small></article>
            <article><span>Buying / replacement</span><strong>{payload.summary.buyingOrReplacement}</strong><small>Highest-priority signals</small></article>
            <article><span>Medium intent</span><strong>{payload.summary.mediumIntent}</strong><small>Score 55–79</small></article>
          </section>

          <section className={styles.resultsCard}>
            <div className={styles.resultsHeader}>
              <div><span className={styles.sectionKicker}>SEARCH → PERSON → SIGNALHIRE → HUBSPOT</span><h2>{payload.meta.keyword} · {payload.meta.region}</h2></div>
              <div className={styles.metaText}>{payload.meta.source} · {new Date(payload.meta.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>

            {visibleResults.length ? (
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>Intent</th><th>Signal</th><th>Post</th><th>Region / ATS</th><th>Indexed</th><th>Action</th></tr></thead>
                  <tbody>
                    {visibleResults.map((item) => {
                      const enriched = enrichment[item.id];
                      const pushed = pushResults[item.id];
                      return (
                        <>
                          <tr key={item.id}>
                            <td><div className={`${styles.score} ${scoreClass(item.intentScore)}`}>{item.intentScore}</div><small className={styles.sourceScore}>source {item.sourceScore}</small></td>
                            <td><span className={styles.signalBadge}>{item.signalLabel}</span>{item.matchedPhrases.length ? <small className={styles.matchText}>{item.matchedPhrases[0]}</small> : null}</td>
                            <td className={styles.postCell}><strong>{item.title || item.authorLabel}</strong><p>{item.snippet || "Public LinkedIn result indexed without a snippet."}</p></td>
                            <td><div className={styles.tags}>{item.detectedRegion ? <span>{item.detectedRegion}</span> : <span>Region from query</span>}{item.detectedVendors.slice(0, 3).map((vendor) => <span key={vendor}>{vendor}</span>)}</div></td>
                            <td className={styles.dateCell}>{readableDate(item.publishedAt)}</td>
                            <td>
                              <div className={styles.actionStack}>
                                <button className={styles.enrichButton} type="button" onClick={() => void enrichResult(item)} disabled={Boolean(enrichingId)}>
                                  {enrichingId === item.id ? <RefreshCw className={styles.spin} size={14}/> : <UserSearch size={14}/>} {enriched?.prospect ? "Re-enrich" : "Resolve + enrich"}
                                </button>
                                <a className={styles.openLink} href={item.url} target="_blank" rel="noreferrer" title="Open public LinkedIn post"><ExternalLink size={16}/></a>
                              </div>
                            </td>
                          </tr>
                          {enriched ? (
                            <tr key={`${item.id}-enrichment`} className={styles.enrichmentRow}>
                              <td colSpan={6}>
                                <div className={styles.enrichmentPanel}>
                                  {enriched.error && !enriched.candidates?.length ? <div className={styles.inlineError}><AlertCircle size={16}/>{enriched.error}</div> : null}
                                  {enriched.candidates?.length && !enriched.prospect ? (
                                    <div className={styles.candidatePanel}>
                                      <div><strong>Confirm the author profile</strong><span>{enriched.error || "Pick the correct public LinkedIn profile before spending a SignalHire credit."}</span></div>
                                      <div className={styles.candidateList}>{enriched.candidates.map((candidate) => (
                                        <button type="button" key={candidate.url} onClick={() => void enrichResult(item, candidate.url)} disabled={Boolean(enrichingId)}>
                                          <span>{candidate.title || candidate.url}</span><small>{candidate.confidence}% match</small>
                                        </button>
                                      ))}</div>
                                    </div>
                                  ) : null}
                                  {enriched.prospect ? (
                                    <div className={styles.prospectPanel}>
                                      <div className={styles.personIdentity}>
                                        <strong>{enriched.prospect.fullName}</strong>
                                        <span>{enriched.prospect.title}{enriched.prospect.company ? ` · ${enriched.prospect.company}` : ""}</span>
                                        <small>Profile match {enriched.author?.matchConfidence ?? 100}% · Lead score {enriched.prospect.score}/100 · SignalHire credits left {enriched.meta?.creditsLeft ?? "—"}</small>
                                      </div>
                                      <div className={styles.contactFacts}>
                                        <span><b>Email</b>{enriched.prospect.email || "Not found"}</span>
                                        <span><b>Phone</b>{enriched.prospect.phone || "Not found"}</span>
                                        <span><b>LinkedIn</b><a href={enriched.prospect.linkedinUrl} target="_blank" rel="noreferrer">Profile</a></span>
                                      </div>
                                      <button className={styles.pushButton} type="button" onClick={() => void pushProspect(item)} disabled={Boolean(pushingId)}>
                                        {pushingId === item.id ? <RefreshCw className={styles.spin} size={14}/> : pushed?.pushed || pushed?.duplicate ? <CheckCircle2 size={14}/> : <UploadCloud size={14}/>} {pushed?.duplicate ? "Already queued" : pushed?.pushed ? "Pushed to HubSpot" : "Push to SDR queue"}
                                      </button>
                                      {pushed?.error ? <div className={styles.inlineError}><AlertCircle size={14}/>{pushed.error}</div> : null}
                                      {pushed?.message ? <div className={styles.inlineSuccess}><CheckCircle2 size={14}/>{pushed.message}</div> : null}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className={styles.noResults}><Search size={22}/><strong>No matching LinkedIn posts found.</strong><span>Try a broader keyword or lower the intent-score filter.</span></div>}
          </section>
        </>
      ) : null}
    </main>
  );
}
