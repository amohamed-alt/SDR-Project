"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, BrainCircuit, Newspaper } from "lucide-react";
import type { DashboardData, DashboardFilters } from "@/lib/types";
import type { DecisionInsights } from "@/lib/decision-insights";
import type { MarketNews, NewsMarket } from "@/lib/market-news";
import type { RecordSelection } from "@/lib/dashboard-records";
import styles from "./DecisionStudio.module.css";

const marketOptions = [["mena", "MENA"], ["saudi", "Saudi Arabia"], ["uae", "United Arab Emirates"], ["egypt", "Egypt"]];
type Answer = { answer: string; evidence: string[]; model: string; mode?: "ai" | "evidence"; cached: boolean; citations?: Array<{ id: string; title: string; url: string }> };
export function SdrDecisionAgent({ filters, data, insights, onInspect }: { filters: DashboardFilters; data: DashboardData; insights: DecisionInsights; onInspect: (title: string, selection: RecordSelection) => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [market, setMarket] = useState<NewsMarket>("mena");
  const [news, setNews] = useState<MarketNews | null>(null);
  const [newsError, setNewsError] = useState("");
  const [scan, setScan] = useState(0);
  const [includeNews, setIncludeNews] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai/sdr-agent", { signal: controller.signal }).then(response => response.json()).then(value => { setAvailable(Boolean(value.configured || value.evidenceMode)); setAiConfigured(Boolean(value.configured && value.remaining > 0)); }).catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (document.hidden) { timer = setTimeout(load, 60_000); return; }
      try {
        const response = await fetch(`/api/dashboard/market-news?market=${market}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "News unavailable");
        if (!controller.signal.aborted) { setNews(result); setNewsError(""); }
      } catch { if (!controller.signal.aborted) setNewsError("The news feed could not load. Try again shortly."); }
      if (!controller.signal.aborted) timer = setTimeout(load, 6 * 60 * 60_000);
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [market, scan]);
  async function ask(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setAnswer(null);
    try {
      const response = await fetch("/api/ai/sdr-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters, version: data.meta.generatedAt, question, ...(includeNews ? { newsMarket: market } : {}) }), signal: AbortSignal.timeout(45_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The agent is unavailable.");
      setAnswer(result);
    } catch (err) { setError(err instanceof Error ? err.message : "The agent is unavailable."); }
    finally { setBusy(false); }
  }
  const currentNews = news?.market === market ? news : null;
  return <>
    <div className={styles.agentGrid}>
      <section className={styles.agent} aria-label="AI SDR Agent">
        <BrainCircuit size={25}/><span className={styles.kicker}> Evidence-led SDR assistant</span><h2>Ask the data. Choose the next move.</h2><p>Explore your strongest observed markets, ICP gaps and follow-up priorities. Answers use this exact snapshot and aggregate metrics.</p>
        <div className={styles.prompts}>{["Which market should we test next?", "What is our strongest ICP?", "Give me three priorities for today.", "Write a concise CEO brief."].map(prompt => <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>{prompt}</button>)}</div>
        <form onSubmit={event => void ask(event)}><label htmlFor="sdr-agent-question">Your question · English or Arabic</label><textarea id="sdr-agent-question" maxLength={400} value={question} onChange={event => setQuestion(event.target.value)} placeholder="إيه أقوى سوق نستهدفه بناءً على النتائج؟"/><label><input type="checkbox" disabled={!aiConfigured} checked={includeNews} onChange={event => setIncludeNews(event.target.checked)}/> Include current news sources in this answer</label><button type="submit" disabled={busy || !available || question.trim().length < 3}>{busy ? "Analyzing this snapshot…" : "Ask SDR Agent"}</button></form>
        <p><small>Read-only · uses the existing AI budget · no messages sent or CRM changes.</small></p>
        {available && aiConfigured === false ? <div className={styles.notice}>Evidence mode is active. Answers are calculated from this snapshot. Generated AI answers need the existing OpenRouter key and available budget; news remains available separately.</div> : null}
        {available === false ? <div className={styles.notice}>The AI provider is not available in this environment. The evidence and recommended review actions below still work.</div> : null}
        {error ? <div role="alert" className={styles.error}>{error}</div> : null}
        {answer ? <div className={styles.answer} aria-live="polite"><strong>{answer.mode === "evidence" ? "Calculated evidence brief" : "Agent analysis"}</strong><p dir="auto">{answer.answer}</p><div className={styles.sources}><span>Evidence: {answer.evidence.join(" · ")}</span>{answer.citations?.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.id} · {source.title}</a>)}<span>{answer.cached ? "Cached answer" : "Generated now"} · {answer.model}</span></div></div> : null}
      </section>
      <section className={styles.panel} aria-label="Market news watch"><header><div><Newspaper size={20}/><h2>Market news watch</h2><p>Recent public sources · potential signals to investigate</p></div><select aria-label="News market" value={market} onChange={event => setMarket(event.target.value as NewsMarket)}>{marketOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></header>
        {newsError ? <div role="alert" className={styles.error}>{newsError}<button type="button" onClick={() => setScan(value => value + 1)}>Retry news</button></div> : null}
        {!currentNews && !newsError ? <p role="status" className={styles.empty}>Checking recent sources…</p> : null}
        {currentNews ? <><p>{currentNews.message}</p><div className={styles.newsList}>{currentNews.items.map(item => <article key={item.url}><span className={styles.kicker}>{item.signal}</span><p><a href={item.url} target="_blank" rel="noreferrer">{item.title} <ArrowUpRight size={12}/></a></p><small>{item.source} · {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("en-GB") : "Publication date unavailable"}</small><p>{item.excerpt}</p></article>)}</div><p><small>{currentNews.fetchedAt ? `Last scan: ${new Date(currentNews.fetchedAt).toLocaleString("en-GB")}. ` : ""}Refreshes every six hours while this workspace is open. News uses its own current time window, separate from the CRM date filter.</small></p></> : null}
      </section>
    </div>
    <section className={styles.panel} style={{ marginTop: 18 }}><span className={styles.kicker}>Grounded next actions</span><h2>Start with the evidence</h2><p>{insights.bestMarket ? `${insights.bestMarket.name}: ${insights.bestMarket.meetings} contacts with meetings from ${insights.bestMarket.contacts} contacts. ${insights.bestMarket.evidence}.` : "No market has enough observed evidence for a confident recommendation in this scope."}</p><div className={styles.actions}>{insights.actions.map(action => <button key={action.id} onClick={() => onInspect(action.title, action.selection)}><ArrowUpRight size={19}/><span><strong>{action.title}</strong><small>{action.reason}</small></span><b>{action.count}</b></button>)}</div></section>
  </>;
}
