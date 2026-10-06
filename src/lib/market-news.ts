import fs from "node:fs/promises";
import path from "node:path";

export const NEWS_MARKETS = {
  mena: { label: "MENA", query: "Saudi Arabia UAE Egypt companies hiring expansion funding new facilities" },
  saudi: { label: "Saudi Arabia", query: "Saudi Arabia companies hiring expansion investment new facilities" },
  uae: { label: "United Arab Emirates", query: "UAE companies hiring expansion funding new facilities" },
  egypt: { label: "Egypt", query: "Egypt companies hiring expansion funding new facilities" },
} as const;
export type NewsMarket = keyof typeof NEWS_MARKETS;
export type NewsItem = { id: string; title: string; url: string; source: string; publishedAt: string | null; excerpt: string; signal: string };
export type MarketNews = { market: NewsMarket; fetchedAt: string | null; nextRefreshAt: string | null; status: "ready" | "unavailable" | "unconfigured" | "limited" | "demo"; message: string; items: NewsItem[] };
type State = { day: string; requests: number; feeds: Partial<Record<NewsMarket, MarketNews>> };
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
    return { day: today, requests: data.day === today ? Number(data.requests) || 0 : 0, feeds: data.feeds || {} };
  } catch { return { day: today, requests: 0, feeds: {} }; }
}
async function save(state: State) {
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await fs.writeFile(/* turbopackIgnore: true */ `${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await fs.rename(/* turbopackIgnore: true */ `${file}.tmp`, /* turbopackIgnore: true */ file);
}
function empty(market: NewsMarket, status: MarketNews["status"], message: string): MarketNews {
  return { market, status, message, fetchedAt: null, nextRefreshAt: null, items: [] };
}
async function load(market: NewsMarket): Promise<MarketNews> {
  if (process.env.DEMO_MODE === "true") return empty(market, "demo", "News search is disabled for demo data.");
  if (!process.env.TAVILY_API_KEY?.trim()) return empty(market, "unconfigured", "Live news is unavailable: the existing Tavily integration is not configured.");
  const reservation = await locked(async () => {
    const state = await readState();
    const cached = state.feeds[market];
    if (cached?.nextRefreshAt && Date.parse(cached.nextRefreshAt) > Date.now()) return { result: cached };
    // A small shared budget across every browser and market; persistent across restarts.
    if (state.requests >= 8) return { result: { ...(cached ?? empty(market, "limited", "")), status: "limited" as const, message: "Today's news search budget has been reached. Showing the last available sources." } };
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
    const items = normalizeNewsItems(payload.results);
    result = { market, status: "ready", fetchedAt: new Date().toISOString(), nextRefreshAt: new Date(Date.now() + TTL).toISOString(), items, message: items.length ? "Public news signals, not confirmed buying intent. Validate company identity and the original source before outreach." : "No usable recent sources were returned for this market." };
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
