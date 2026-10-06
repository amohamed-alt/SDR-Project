import fs from "node:fs/promises";
import path from "node:path";

export const NEWS_MARKETS = {
  mena: { label: "MENA", query: "MENA Saudi Arabia UAE Egypt recruitment talent acquisition hiring workforce HR technology news" },
  saudi: { label: "Saudi Arabia", query: "Saudi Arabia recruitment hiring jobs Saudization workforce talent acquisition HR technology news" },
  uae: { label: "United Arab Emirates", query: "United Arab Emirates Dubai Abu Dhabi recruitment hiring Emiratisation talent acquisition HR technology news" },
  egypt: { label: "Egypt", query: "Egypt Cairo recruitment hiring jobs workforce talent acquisition HR technology news" },
} as const;
export type NewsMarket = keyof typeof NEWS_MARKETS;
export type NewsItem = { id: string; title: string; url: string; source: string; publishedAt: string | null; excerpt: string; signal: string };
export type MarketNews = { market: NewsMarket; fetchedAt: string | null; nextRefreshAt: string | null; status: "ready" | "unavailable" | "unconfigured" | "limited" | "demo"; message: string; items: NewsItem[] };
const NEWS_VERSION = "talent-v2";
type State = { version?: string; day: string; requests: number; feeds: Partial<Record<NewsMarket, MarketNews>> };
const file = process.env.SDR_NEWS_STATE_PATH || "/app/data/sdr-market-news.json";
const TTL = 6 * 60 * 60 * 1000;
let queue = Promise.resolve();
const inflight = new Map<NewsMarket, Promise<MarketNews>>();

export function normalizeNewsItems(raw: unknown, now = Date.now()): NewsItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: NewsItem[] = [];
  for (const row of raw.slice(0, 20)) {
    if (!row || typeof row !== "object" || typeof row.url !== "string" || typeof row.title !== "string") continue;
    let url: URL;
    try { url = new URL(row.url); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const date = typeof row.published_date === "string" ? Date.parse(row.published_date) : NaN;
    if (Number.isFinite(date) && (date > now + 86_400_000 || date < now - 31 * 86_400_000)) continue;
    const title = row.title.replace(/\s+/g, " ").trim().slice(0, 220);
    if (!title) continue;
    const excerpt = String(row.content || "").replace(/\s+/g, " ").trim().slice(0, 380);
    const haystack = `${title} ${excerpt}`;
    const signal = /hir(e|ing)|recruit|jobs|workforce/i.test(haystack) ? "Hiring signal to validate" : /funding|investment|raised|financ/i.test(haystack) ? "Investment signal to validate" : /expan|launch|facilit|office/i.test(haystack) ? "Expansion signal to validate" : "Market context";
    result.push({ id: `N${result.length + 1}`, title, url: url.href, source: url.hostname.replace(/^www\./, ""), publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null, excerpt, signal });
    if (result.length === 6) break;
  }
  return result;
}

export function isTalentNews(row: { title?: string; content?: string } | null, market: NewsMarket) {
  if (!row) return false;
  const text = `${row.title || ""} ${row.content || ""}`;
  const talent = /\b(hiring|recruit\w*|talent|workforce|employment|jobs?|human resources|HR tech\w*|HR software|Saudization|Saudisation|Emiratisation|Emiratization|reskilling|upskilling)\b|توظيف|الموارد البشرية|العمالة|توطين/i.test(text);
  const geography = { saudi: /Saudi|Riyadh|Jeddah|KSA|Saudization|Saudisation|السعودية/i, uae: /UAE|U\.A\.E|United Arab Emirates|Dubai|Abu Dhabi|Emirati|الإمارات/i, egypt: /Egypt|Cairo|Egyptian|مصر/i, mena: /MENA|Middle East|North Africa|GCC|Saudi|Riyadh|Jeddah|UAE|United Arab Emirates|Dubai|Abu Dhabi|Egypt|Cairo|Qatar|Kuwait|Bahrain|Oman|Jordan|Lebanon|Morocco|Tunisia|Algeria|السعودية|الإمارات|مصر/i };
  return talent && geography[market].test(text);
}

async function locked<T>(fn: () => Promise<T>) {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
}
async function readState(): Promise<State> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const data = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file, "utf8")) as State;
    return { day: today, requests: data.day === today ? Number(data.requests) || 0 : 0, feeds: data.version === NEWS_VERSION ? data.feeds || {} : {} };
  } catch { return { day: today, requests: 0, feeds: {} }; }
}
async function save(state: State) {
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await fs.writeFile(/* turbopackIgnore: true */ `${file}.tmp`, JSON.stringify({ ...state, version: NEWS_VERSION }), { mode: 0o600 });
  await fs.rename(/* turbopackIgnore: true */ `${file}.tmp`, /* turbopackIgnore: true */ file);
}
function empty(market: NewsMarket, status: MarketNews["status"], message: string): MarketNews {
  return { market, status, message, fetchedAt: null, nextRefreshAt: null, items: [] };
}
async function load(market: NewsMarket): Promise<MarketNews> {
  if (process.env.DEMO_MODE === "true") return empty(market, "demo", "News search is disabled for demo data.");
  if (!process.env.TAVILY_API_KEY?.trim()) return empty(market, "unconfigured", "Live news is not available right now.");
  const reservation = await locked(async () => {
    const state = await readState();
    const cached = state.feeds[market];
    if (cached?.nextRefreshAt && Date.parse(cached.nextRefreshAt) > Date.now()) return { result: cached };
    // A small shared budget across every browser and market; persistent across restarts.
    if (state.requests >= 8) return { result: { ...(cached ?? empty(market, "limited", "")), status: "limited" as const, message: "New sources will be available after the next daily refresh. Showing available recent coverage." } };
    state.requests += 1;
    await save(state);
    return { cached };
  });
  if (reservation.result) return reservation.result;
  let result: MarketNews;
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY.trim()}` },
      body: JSON.stringify({ query: NEWS_MARKETS[market].query, topic: "news", search_depth: "basic", time_range: "month", max_results: 8, include_answer: false, include_raw_content: false }),
      signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (!response.ok) throw new Error("Search unavailable");
    const payload = await response.json();
    const items = normalizeNewsItems(Array.isArray(payload.results) ? payload.results.filter((row: { title?: string; content?: string }) => isTalentNews(row, market)) : []);
    result = { market, status: "ready", fetchedAt: new Date().toISOString(), nextRefreshAt: new Date(Date.now() + TTL).toISOString(), items, message: items.length ? "Hiring and talent developments to investigate. Open each source for the full context." : "No recent recruitment or talent sources matched this market." };
  } catch {
    result = { ...(reservation.cached ?? empty(market, "unavailable", "")), status: "unavailable", nextRefreshAt: new Date(Date.now() + 15 * 60_000).toISOString(), message: "News search is temporarily unavailable. Any sources below are from the last successful scan." };
  }
  await locked(async () => { const state = await readState(); state.feeds[market] = result; await save(state); });
  return result;
}
export function getMarketNews(market: NewsMarket) {
  const pending = inflight.get(market);
  if (pending) return pending;
  const promise = load(market).finally(() => inflight.delete(market));
  inflight.set(market, promise);
  return promise;
}
