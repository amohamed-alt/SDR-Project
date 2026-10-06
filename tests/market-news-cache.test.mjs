import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("news deduplicates concurrent scans, persists its cache and caps searches across restarts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdr-news-test-"));
  const statePath = path.join(dir, "news.json");
  process.env.SDR_NEWS_STATE_PATH = statePath;
  process.env.TAVILY_API_KEY = "test-key-not-a-secret";
  process.env.DEMO_MODE = "false";
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.tavily.com/search");
    assert.equal(JSON.parse(options.body).search_depth, "basic");
    requests += 1;
    return new Response(JSON.stringify({ results: [{ title: "New hiring", url: "https://example.com/source", published_date: new Date().toISOString() }] }));
  };
  try {
    const { getMarketNews } = await import("../src/lib/market-news.ts");
    const [one, two] = await Promise.all([getMarketNews("mena"), getMarketNews("mena")]);
    assert.equal(requests, 1);
    assert.deepEqual(one, two);
    await getMarketNews("mena");
    assert.equal(requests, 1);
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    state.requests = 8;
    state.feeds.mena.nextRefreshAt = new Date(0).toISOString();
    await fs.writeFile(statePath, JSON.stringify(state));
    const limited = await getMarketNews("mena");
    assert.equal(limited.status, "limited");
    assert.equal(limited.items.length, 1);
    assert.equal(requests, 1);
    const freshMarket = await getMarketNews("egypt");
    assert.equal(freshMarket.status, "limited");
    assert.equal(freshMarket.items.length, 0);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
