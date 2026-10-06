"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Newspaper } from "lucide-react";
import type { MarketNews, NewsMarket } from "@/lib/market-news";
import styles from "./DecisionStudio.module.css";
const marketOptions = [["mena", "MENA Region"], ["saudi", "Saudi Arabia"], ["uae", "United Arab Emirates"], ["egypt", "Egypt"]];
export function TalentMarketWatch() {
  const [market, setMarket] = useState<NewsMarket>("mena");
  const [news, setNews] = useState<MarketNews | null>(null);
  const [newsError, setNewsError] = useState("");
  const [scan, setScan] = useState(0);
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
  const currentNews = news?.market === market ? news : null;
  return <>      <section className={styles.panel} aria-label="Market news watch"><header><div><Newspaper size={20}/><h2>Market news watch</h2><p>Recruitment, hiring demand, workforce policy and HR technology across MENA</p></div><select aria-label="News market" value={market} onChange={event => setMarket(event.target.value as NewsMarket)}>{marketOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></header>
        {newsError ? <div role="alert" className={styles.error}>{newsError}<button type="button" onClick={() => setScan(value => value + 1)}>Retry news</button></div> : null}
        {!currentNews && !newsError ? <p role="status" className={styles.empty}>Checking recent sources…</p> : null}
        {currentNews ? <><p>{currentNews.message}</p><div className={styles.newsList}>{currentNews.items.map(item => <article key={item.url}><span className={styles.kicker}>{item.signal}</span><p><a href={item.url} target="_blank" rel="noreferrer">{item.title} <ArrowUpRight size={12}/></a></p><small>{item.source} · {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("en-GB") : "Publication date unavailable"}</small><p>{item.excerpt}</p></article>)}</div><p><small>{currentNews.fetchedAt ? `Last scan: ${new Date(currentNews.fetchedAt).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}. ` : ""}Asia/Riyadh · Recent 30-day news, independent of the CRM date range.</small></p></> : null}
      </section></>;
}
