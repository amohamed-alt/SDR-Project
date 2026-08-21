"use client";

import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Flame, RefreshCw, Search, ShieldCheck } from "lucide-react";
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

  const visibleResults = useMemo(() => payload?.results || [], [payload]);

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");

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

  return (
    <main className={styles.page}>
      <div className={styles.backdrop}/>
      <section className={styles.hero}>
        <button className={styles.backButton} type="button" onClick={onBack}>
          <ArrowLeft size={16}/>
          Dashboard
        </button>
        <div className={styles.eyebrow}><Flame size={15}/> TALENTERA INTENT ENGINE · PROTOTYPE</div>
        <div className={styles.heroGrid}>
          <div>
            <h1>ATS Intent Search</h1>
            <p>Find public LinkedIn posts that mention ATS, recruitment-system pain, vendor evaluation, replacement or implementation — without logging into LinkedIn from the VPS.</p>
          </div>
          <div className={styles.sourceCard}>
            <ShieldCheck size={18}/>
            <div>
              <strong>Public-web discovery</strong>
              <span>No LinkedIn cookies, account session or hidden profile crawling.</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.searchPanel}>
        <form className={styles.searchForm} onSubmit={runSearch}>
          <label className={styles.searchField}>
            <Search size={18}/>
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="ATS, Workday, recruitment system..."
              maxLength={120}
            />
          </label>
          <select value={region} onChange={(event) => setRegion(event.target.value as Region)}>
            <option>Saudi Arabia</option>
            <option>United Arab Emirates</option>
            <option>GCC</option>
            <option>All</option>
          </select>
          <select value={String(minScore)} onChange={(event) => setMinScore(Number(event.target.value))}>
            <option value="0">All intent scores</option>
            <option value="55">55+ Medium intent</option>
            <option value="80">80+ High intent</option>
          </select>
          <button className={styles.searchButton} type="submit" disabled={loading || !keyword.trim()}>
            {loading ? <RefreshCw className={styles.spin} size={17}/> : <Search size={17}/>} {loading ? "Searching…" : "Search posts"}
          </button>
        </form>
        <div className={styles.quickRow}>
          <span>Quick searches</span>
          {QUICK_SEARCHES.map((value) => (
            <button key={value} type="button" onClick={() => applyQuickSearch(value)} className={keyword === value ? styles.quickActive : ""}>{value}</button>
          ))}
        </div>
      </section>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {!payload && !loading && !error ? (
        <section className={styles.emptyState}>
          <Search size={27}/>
          <h2>Run the first ATS signal search</h2>
          <p>Start with <strong>ATS</strong> + <strong>Saudi Arabia</strong>. The result table will separate commercial intent from normal job-seeker ATS content.</p>
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
              <div>
                <span className={styles.sectionKicker}>SEARCH RESULTS</span>
                <h2>{payload.meta.keyword} · {payload.meta.region}</h2>
              </div>
              <div className={styles.metaText}>{payload.meta.source} · {new Date(payload.meta.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>

            {visibleResults.length ? (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Intent</th>
                      <th>Signal</th>
                      <th>Post</th>
                      <th>Region / ATS</th>
                      <th>Indexed</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResults.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className={`${styles.score} ${scoreClass(item.intentScore)}`}>{item.intentScore}</div>
                          <small className={styles.sourceScore}>source {item.sourceScore}</small>
                        </td>
                        <td>
                          <span className={styles.signalBadge}>{item.signalLabel}</span>
                          {item.matchedPhrases.length ? <small className={styles.matchText}>{item.matchedPhrases[0]}</small> : null}
                        </td>
                        <td className={styles.postCell}>
                          <strong>{item.title || item.authorLabel}</strong>
                          <p>{item.snippet || "Public LinkedIn result indexed without a snippet."}</p>
                        </td>
                        <td>
                          <div className={styles.tags}>
                            {item.detectedRegion ? <span>{item.detectedRegion}</span> : <span>Region from query</span>}
                            {item.detectedVendors.slice(0, 3).map((vendor) => <span key={vendor}>{vendor}</span>)}
                          </div>
                        </td>
                        <td className={styles.dateCell}>{readableDate(item.publishedAt)}</td>
                        <td>
                          <a className={styles.openLink} href={item.url} target="_blank" rel="noreferrer" title="Open public LinkedIn post">
                            <ExternalLink size={16}/>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.noResults}>
                <Search size={22}/>
                <strong>No matching LinkedIn posts found.</strong>
                <span>Try a broader keyword or lower the intent-score filter.</span>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
