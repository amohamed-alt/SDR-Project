import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES = ["company", "tam", "icp", "personas", "sourcing", "filters", "copy", "channels"] as const;
type Stage = (typeof STAGES)[number];

const CORE_REASONING_STAGES = new Set<Stage>(["company", "tam", "icp", "personas"]);
const LIGHT_EXECUTION_STAGES = new Set<Stage>(["sourcing", "filters", "copy", "channels"]);

const inputSchema = z.object({
  stage: z.enum(STAGES),
  domain: z.string().trim().max(255).optional(),
  approvedContext: z.unknown().optional(),
});

const OLLAMA_URL = process.env.GTM_RESEARCH_OLLAMA_URL || process.env.OLLAMA_URL || "http://career-judge-ollama:11434/api/chat";
const OLLAMA_MODEL = process.env.GTM_RESEARCH_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "qwen3:1.7b";
const OPENROUTER_API_KEY = process.env.GTM_RESEARCH_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.GTM_RESEARCH_OPENROUTER_MODEL || "openai/gpt-4.1-mini";
const OPENROUTER_LIGHT_MODEL = process.env.GTM_RESEARCH_OPENROUTER_LIGHT_MODEL || "openai/gpt-4.1-nano";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const REQUESTS_PER_WINDOW = 40;
const PAID_REQUESTS_PER_WINDOW = 12;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_RESEARCH = 2;
const PREMIUM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PREMIUM_CACHE_MAX = 100;

type RateEntry = { count: number; resetAt: number };
type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};
type OpenRouterMeta = {
  ai: "openrouter";
  model: string;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};
type PremiumCacheEntry = {
  expiresAt: number;
  result: Record<string, unknown>;
  meta: OpenRouterMeta;
};
type ResearchRuntimeState = {
  clients: Map<string, RateEntry>;
  paidClients: Map<string, RateEntry>;
  premiumCache: Map<string, PremiumCacheEntry>;
  inFlight: number;
  lastCleanup: number;
};
type GlobalWithResearchState = typeof globalThis & { __gtmResearchRuntime?: ResearchRuntimeState };

const sharedGlobal = globalThis as GlobalWithResearchState;
const researchRuntime = sharedGlobal.__gtmResearchRuntime ?? (sharedGlobal.__gtmResearchRuntime = {
  clients: new Map<string, RateEntry>(),
  paidClients: new Map<string, RateEntry>(),
  premiumCache: new Map<string, PremiumCacheEntry>(),
  inFlight: 0,
  lastCleanup: Date.now(),
});

const STAGE_PROMPTS: Record<Stage, string> = {
  company: `Return a JSON object with exactly these top-level keys:
company_name, domain, summary, products_services, value_proposition, pain_points_solved, competitors, primary_markets, target_customer_types, evidence_notes, confidence.
products_services, value_proposition, pain_points_solved, primary_markets, target_customer_types, evidence_notes must be arrays of strings.
competitors must be an array of objects with name and reason.
confidence must be low, medium, or high.
Use only evidence from the supplied website content. If something is uncertain, say so in evidence_notes instead of inventing facts.`,
  tam: `Return a JSON object with exactly these top-level keys:
market_definition, estimated_tam, estimated_tam_basis, recommended_markets, target_industries, employee_bands, revenue_bands, exclusions, assumptions, open_questions.
market_definition must be a concise paragraph describing the overall account market/category broad enough to cover all ICP tiers.
estimated_tam must be a rough integer estimate of total accounts, and estimated_tam_basis must be one concise sentence explaining the estimate and clearly labeling it as rough.
recommended_markets must be an array of objects with market, priority, and why.
target_industries, employee_bands, revenue_bands, exclusions, assumptions, open_questions must be arrays of strings.
Treat the approved human overview and approved company context as the source of truth. Do not re-introduce a geography, segment, or positioning point that the human explicitly corrected.`,
  icp: `Return a JSON object with exactly these top-level keys: tier_1, tier_2, tier_3.
Each tier must contain name, description, industry, client_type, employee_range_min, employee_range_max, revenue_range_min, revenue_range_max, geography, keywords, pain_points, signals, buying_triggers, ideal_client_examples, disqualifiers, exclusion_terms.
industry, client_type, geography, keywords, pain_points, signals, buying_triggers, ideal_client_examples, disqualifiers, exclusion_terms must be arrays of strings.
employee_range_min, employee_range_max, revenue_range_min, revenue_range_max must be numbers.
Tier 1 is best fit with strong alignment and buying power. Tier 2 is good fit with weaker strategic alignment or smaller footprint. Tier 3 is exploratory/possible fit.
keywords must be short search terms useful for Apollo, Sales Navigator, Google, or lookalike discovery.
buying_triggers must be live events that indicate an account may be in a buying window.
disqualifiers and exclusion_terms must make it easy to remove false positives from sourcing.
Use only approved company, human, and TAM context.`,
  personas: `Return a JSON object with exactly one top-level key: personas.
personas must be an array of 3 to 6 objects. Each persona must contain persona, likely_titles, seniority, role_in_buying, pains, goals, kpis, buying_triggers, objections, day_in_the_life, jobs_to_be_done, messaging_angle.
likely_titles, pains, goals, kpis, buying_triggers, objections must be arrays of strings.
jobs_to_be_done must be an object containing functional_job, emotional_job, social_job as strings.
day_in_the_life must be one or two concise sentences.
Cover economic buyers, champions, and important influencers where relevant. Use only approved upstream context and do not invent company-specific facts.`,
  sourcing: `Return a JSON object with exactly these top-level keys: primary_tools, fallback_tools, rationale.
primary_tools and fallback_tools must be arrays of objects with tool, best_for, and why.
rationale must be an array of strings.
Recommend sourcing/enrichment tools based on the approved ICP and personas. Prefer the minimum practical stack and do not assume a paid tool must be used just because it is popular.`,
  filters: `Return a JSON object with exactly these top-level keys: sales_navigator, apollo, notes.
sales_navigator and apollo must be objects whose values are strings or arrays of strings and should contain copy-ready filter guidance derived from the approved ICP/personas.
Include useful include filters and explicit exclusions/NOT logic derived from disqualifiers and exclusion_terms.
notes must be an array of strings explaining edge cases or filters that require manual judgment.`,
  copy: `Return a JSON object with exactly these top-level keys: email, linkedin, notes.
email must contain first_touch, second_touch, third_touch.
linkedin must contain connection_note, first_touch, second_touch, third_touch.
Each touch must be concise, natural, and tied to the approved persona pains/value proposition without fabricated personalization.
notes must be an array of strings.`,
  channels: `Return a JSON object with exactly these top-level keys: recommended_channels, cadence, rationale.
recommended_channels must be an ordered array of strings.
cadence must be an array of objects with day, channel, action.
rationale must be an array of strings.
Base the recommendation only on approved ICP, personas, sourcing choices, and messaging context.`,
};

function preferredModelForStage(stage: Stage) {
  return LIGHT_EXECUTION_STAGES.has(stage) ? OPENROUTER_LIGHT_MODEL : OPENROUTER_MODEL;
}

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("cf-connecting-ip")?.trim() || forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function cleanupRuntime(now: number) {
  if (
    now - researchRuntime.lastCleanup < 5 * 60 * 1000 &&
    researchRuntime.clients.size < 500 &&
    researchRuntime.paidClients.size < 500 &&
    researchRuntime.premiumCache.size <= PREMIUM_CACHE_MAX
  ) return;

  for (const bucket of [researchRuntime.clients, researchRuntime.paidClients]) {
    for (const [key, entry] of bucket.entries()) {
      if (entry.resetAt <= now) bucket.delete(key);
    }
  }

  for (const [key, entry] of researchRuntime.premiumCache.entries()) {
    if (entry.expiresAt <= now) researchRuntime.premiumCache.delete(key);
  }

  while (researchRuntime.premiumCache.size > PREMIUM_CACHE_MAX) {
    const firstKey = researchRuntime.premiumCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    researchRuntime.premiumCache.delete(firstKey);
  }

  researchRuntime.lastCleanup = now;
}

function acquireResearchSlot(request: NextRequest) {
  const now = Date.now();
  cleanupRuntime(now);
  const key = clientKey(request);
  const current = researchRuntime.clients.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + RATE_WINDOW_MS } : current;

  if (entry.count >= REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return {
      response: NextResponse.json(
        { error: "GTM research rate limit reached. Try again after the current window resets." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      ),
    };
  }

  if (researchRuntime.inFlight >= MAX_CONCURRENT_RESEARCH) {
    return {
      response: NextResponse.json(
        { error: "The GTM research engine is busy with other analysis. Retry this stage shortly." },
        { status: 429, headers: { "Retry-After": "10" } },
      ),
    };
  }

  entry.count += 1;
  researchRuntime.clients.set(key, entry);
  researchRuntime.inFlight += 1;
  let released = false;

  return {
    release: () => {
      if (released) return;
      released = true;
      researchRuntime.inFlight = Math.max(0, researchRuntime.inFlight - 1);
    },
  };
}

function consumePaidQuota(request: NextRequest) {
  const now = Date.now();
  cleanupRuntime(now);
  const key = clientKey(request);
  const current = researchRuntime.paidClients.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + RATE_WINDOW_MS } : current;

  if (entry.count >= PAID_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Premium GTM AI limit reached for this hour. This guard prevents accidental OpenRouter credit burn." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  entry.count += 1;
  researchRuntime.paidClients.set(key, entry);
  return null;
}

function normalizeDomain(input: string) {
  const raw = input.trim();
  if (!raw) throw new Error("Website domain is required.");
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(candidate);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only http/https websites are supported.");
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed;
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) {
      const mapped = value.slice("::ffff:".length);
      return net.isIPv4(mapped) ? isPrivateIp(mapped) : true;
    }
    return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }

  return true;
}

async function assertPublicHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new Error("Local/private hosts are not allowed.");
  }

  if (net.isIP(lower)) {
    if (isPrivateIp(lower)) throw new Error("Private IP addresses are not allowed.");
    return;
  }

  const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("The website resolved to a private or unavailable address.");
  }
}

async function safeFetchText(input: URL) {
  let current = new URL(input.toString());

  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    await assertPublicHostname(current.hostname);
    const response = await fetch(current, {
      cache: "no-store",
      redirect: "manual",
      headers: {
        "User-Agent": "Talentera-GTM-Research/1.0 (+https://sdr.dashboardtalentera.tech)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Website returned redirect ${response.status} without a location.`);
      current = new URL(location, current);
      if (!/^https?:$/.test(current.protocol)) throw new Error("Website redirected to an unsupported protocol.");
      continue;
    }

    if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      throw new Error("The supplied URL did not return an HTML page.");
    }

    return { html: await response.text(), finalUrl: current };
  }

  throw new Error("Too many website redirects.");
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractTitle(html: string) {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "");
}

function extractDescription(html: string) {
  const match = html.match(/<meta[^>]+(?:name=["']description["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+name=["']description["'])[^>]*>/i);
  return decodeEntities((match?.[1] || match?.[2] || "").trim());
}

function discoverUsefulLinks(html: string, base: URL) {
  const matches = Array.from(html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi));
  const scored: Array<{ url: URL; score: number }> = [];
  const keywords = ["about", "product", "platform", "solution", "customer", "industry", "company", "why", "services"];

  for (const match of matches) {
    try {
      const url = new URL(match[1], base);
      if (url.origin !== base.origin || !/^https?:$/.test(url.protocol)) continue;
      const path = `${url.pathname}${url.search}`.toLowerCase();
      const score = keywords.reduce((total, keyword) => total + (path.includes(keyword) ? 1 : 0), 0);
      if (score > 0) scored.push({ url, score });
    } catch {
      // Ignore malformed links.
    }
  }

  return Array.from(
    new Map(scored.sort((a, b) => b.score - a.score).map((entry) => [entry.url.toString(), entry.url])).values(),
  ).slice(0, 5);
}

async function collectWebsiteEvidence(domain: string) {
  const start = normalizeDomain(domain);
  const homepage = await safeFetchText(start);
  const pages = [{ url: homepage.finalUrl.toString(), html: homepage.html }];
  const links = discoverUsefulLinks(homepage.html, homepage.finalUrl);
  const settled = await Promise.allSettled(
    links.map(async (url) => {
      const result = await safeFetchText(url);
      return { url: result.finalUrl.toString(), html: result.html };
    }),
  );

  for (const item of settled) {
    if (item.status === "fulfilled") pages.push(item.value);
  }

  const evidence = pages.map((page) => ({
    url: page.url,
    title: extractTitle(page.html),
    description: extractDescription(page.html),
    text: htmlToText(page.html).slice(0, 6_000),
  }));

  return {
    canonicalDomain: homepage.finalUrl.hostname,
    pages: evidence,
    combinedText: evidence
      .map((page) => `SOURCE: ${page.url}\nTITLE: ${page.title}\nDESCRIPTION: ${page.description}\nTEXT: ${page.text}`)
      .join("\n\n")
      .slice(0, 24_000),
  };
}

function extractJsonObject(raw: string) {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI response did not contain JSON.");
  return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
}

function systemPrompt(stage: Stage) {
  return `You are a senior B2B GTM research strategist. Return valid JSON only, with no markdown or commentary. Human-approved context is authoritative. Never fabricate precise facts that are not supported; clearly label estimates and assumptions. ${STAGE_PROMPTS[stage]}`;
}

async function callOllama(stage: Stage, source: string) {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: "json",
      options: { temperature: 0.2 },
      messages: [
        { role: "system", content: systemPrompt(stage) },
        { role: "user", content: source.slice(0, 30_000) },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) throw new Error(`Local AI returned HTTP ${response.status}.`);
  const payload = await response.json() as { message?: { content?: string }; response?: string };
  const content = payload.message?.content || payload.response || "";
  return extractJsonObject(content);
}

async function callOpenRouter(stage: Stage, source: string, model: string) {
  if (!OPENROUTER_API_KEY) throw new Error("OpenRouter is not configured.");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://sdr.dashboardtalentera.tech/gtm-research",
      "X-OpenRouter-Title": "Talentera GTM Research",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt(stage) },
        { role: "user", content: source.slice(0, 30_000) },
      ],
      temperature: 0.2,
      max_tokens: LIGHT_EXECUTION_STAGES.has(stage) ? 2_500 : 3_500,
      response_format: { type: "json_object" },
      provider: {
        sort: "price",
        require_parameters: true,
        data_collection: "deny",
      },
      stream: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const payload = await response.json() as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: OpenRouterUsage;
  };

  if (!response.ok) throw new Error(payload.error?.message || `OpenRouter returned HTTP ${response.status}.`);
  const content = payload.choices?.[0]?.message?.content || "";
  return { result: extractJsonObject(content), usage: payload.usage || {} };
}

function premiumCacheKey(stage: Stage, source: string, model: string) {
  return createHash("sha256").update(`${stage}\n${model}\n${source}`).digest("hex");
}

async function runStageModel(stage: Stage, source: string, request: NextRequest) {
  const model = preferredModelForStage(stage);

  if (!OPENROUTER_API_KEY) {
    const result = await callOllama(stage, source);
    return {
      result,
      meta: {
        ai: "ollama" as const,
        model: OLLAMA_MODEL,
        cached: false,
        warning: `OpenRouter is not configured, so ${stage} used the local fallback model.`,
      },
    };
  }

  const cacheKey = premiumCacheKey(stage, source, model);
  const cached = researchRuntime.premiumCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { result: cached.result, meta: { ...cached.meta, cached: true } };
  }

  const quotaResponse = consumePaidQuota(request);
  if (quotaResponse) return { response: quotaResponse };

  try {
    const { result, usage } = await callOpenRouter(stage, source, model);
    const meta: OpenRouterMeta & { cached: boolean } = {
      ai: "openrouter",
      model,
      cached: false,
      cost: usage.cost,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };

    researchRuntime.premiumCache.set(cacheKey, {
      expiresAt: Date.now() + PREMIUM_CACHE_TTL_MS,
      result,
      meta: {
        ai: "openrouter",
        model,
        cost: usage.cost,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    });
    cleanupRuntime(Date.now());
    return { result, meta };
  } catch (openRouterError) {
    try {
      const result = await callOllama(stage, source);
      return {
        result,
        meta: {
          ai: "ollama" as const,
          model: OLLAMA_MODEL,
          cached: false,
          warning: `OpenRouter ${model} failed and the local fallback was used instead: ${openRouterError instanceof Error ? openRouterError.message : "unknown OpenRouter error"}`,
        },
      };
    } catch (localError) {
      throw new Error(
        `OpenRouter ${model} failed (${openRouterError instanceof Error ? openRouterError.message : "unknown error"}) and local AI fallback also failed (${localError instanceof Error ? localError.message : "unknown error"}).`,
      );
    }
  }
}

async function ollamaReady() {
  try {
    const tagsUrl = new URL(OLLAMA_URL);
    tagsUrl.pathname = "/api/tags";
    tagsUrl.search = "";
    const response = await fetch(tagsUrl, { cache: "no-store", signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return false;
    const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const models = payload.models || [];
    return models.some((item) => {
      const name = item.name || item.model || "";
      return name === OLLAMA_MODEL || name.startsWith(`${OLLAMA_MODEL}:`);
    });
  } catch {
    return false;
  }
}

function fallbackCompany(domain: string, evidence: Awaited<ReturnType<typeof collectWebsiteEvidence>>) {
  const first = evidence.pages[0];
  return {
    company_name: first?.title?.split(/[|–—-]/)[0]?.trim() || evidence.canonicalDomain,
    domain: evidence.canonicalDomain,
    summary: first?.description || `Website research captured for ${evidence.canonicalDomain}, but AI analysis was unavailable.`,
    products_services: [],
    value_proposition: [],
    pain_points_solved: [],
    competitors: [],
    primary_markets: [],
    target_customer_types: [],
    evidence_notes: [
      `Captured ${evidence.pages.length} public website page(s).`,
      "AI analysis was unavailable, so only deterministic website metadata is shown. Retry this stage later.",
    ],
    confidence: "low",
    requested_domain: domain,
  };
}

function fallbackStage(stage: Stage) {
  const common = {
    status: "ai_unavailable",
    note: "Both OpenRouter and the local fallback were unavailable. Keep the approved upstream context and retry this stage later.",
  };

  if (stage === "tam") return { ...common, market_definition: "", estimated_tam: 0, estimated_tam_basis: "", recommended_markets: [], target_industries: [], employee_bands: [], revenue_bands: [], exclusions: [], assumptions: [], open_questions: [] };
  if (stage === "icp") return { ...common, tier_1: {}, tier_2: {}, tier_3: {} };
  if (stage === "personas") return { ...common, personas: [] };
  if (stage === "sourcing") return { ...common, primary_tools: [], fallback_tools: [], rationale: [] };
  if (stage === "filters") return { ...common, sales_navigator: {}, apollo: {}, notes: [] };
  if (stage === "copy") return { ...common, email: {}, linkedin: {}, notes: [] };
  return { ...common, recommended_channels: [], cadence: [], rationale: [] };
}

export async function GET() {
  const localAiReady = await ollamaReady();
  const openRouterConfigured = Boolean(OPENROUTER_API_KEY);

  return NextResponse.json({
    status: "ok",
    aiReady: openRouterConfigured || localAiReady,
    localAiReady,
    openRouterConfigured,
    localModel: OLLAMA_MODEL,
    premiumModel: OPENROUTER_MODEL,
    lightModel: OPENROUTER_LIGHT_MODEL,
    premiumStages: Array.from(CORE_REASONING_STAGES),
    lightStages: Array.from(LIGHT_EXECUTION_STAGES),
    openRouterStages: STAGES,
    localStages: [],
    localFallbackEnabled: true,
    limits: {
      requestsPerHour: REQUESTS_PER_WINDOW,
      premiumRequestsPerHour: PAID_REQUESTS_PER_WINDOW,
      maxConcurrent: MAX_CONCURRENT_RESEARCH,
      premiumCacheHours: PREMIUM_CACHE_TTL_MS / (60 * 60 * 1000),
    },
    stages: STAGES,
  });
}

export async function POST(request: NextRequest) {
  const slot = acquireResearchSlot(request);
  if ("response" in slot) return slot.response;

  try {
    const parsed = inputSchema.parse(await request.json());

    if (parsed.stage === "company") {
      if (!parsed.domain) return NextResponse.json({ error: "Website domain is required." }, { status: 400 });
      const evidence = await collectWebsiteEvidence(parsed.domain);

      try {
        const modelOutput = await runStageModel(
          "company",
          `WEBSITE DOMAIN: ${evidence.canonicalDomain}\n\nPUBLIC WEBSITE EVIDENCE:\n${evidence.combinedText}`,
          request,
        );
        if ("response" in modelOutput) return modelOutput.response;
        return NextResponse.json({
          result: modelOutput.result,
          meta: { ...modelOutput.meta, sources: evidence.pages.map((page) => page.url) },
        });
      } catch (error) {
        return NextResponse.json({
          result: fallbackCompany(parsed.domain, evidence),
          meta: {
            ai: "fallback",
            model: preferredModelForStage("company"),
            cached: false,
            sources: evidence.pages.map((page) => page.url),
            warning: error instanceof Error ? error.message : "AI unavailable.",
          },
        });
      }
    }

    const context = JSON.stringify(parsed.approvedContext ?? {}, null, 2);
    if (context.length > 60_000) return NextResponse.json({ error: "Approved context is too large." }, { status: 413 });

    try {
      const modelOutput = await runStageModel(
        parsed.stage,
        `APPROVED UPSTREAM CONTEXT (source of truth):\n${context}`,
        request,
      );
      if ("response" in modelOutput) return modelOutput.response;
      return NextResponse.json({ result: modelOutput.result, meta: modelOutput.meta });
    } catch (error) {
      return NextResponse.json({
        result: fallbackStage(parsed.stage),
        meta: {
          ai: "fallback",
          model: preferredModelForStage(parsed.stage),
          cached: false,
          warning: error instanceof Error ? error.message : "AI unavailable.",
        },
      });
    }
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "Invalid GTM research request."
      : error instanceof Error
        ? error.message
        : "Unexpected GTM research error.";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    slot.release();
  }
}
