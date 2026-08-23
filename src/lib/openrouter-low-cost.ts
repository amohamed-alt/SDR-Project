import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { decideRecipientLanguage } from "@/lib/recipient-language-routing";

export type OpenRouterMode = "fast" | "deep";

export type OpenRouterUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  reportedCostUsd: number | null;
};

export type OpenRouterResult = {
  content: string;
  model: string;
  mode: OpenRouterMode;
  cached: boolean;
  usage: OpenRouterUsage;
};

type CacheEntry = {
  createdAt: number;
  expiresAt: number;
  result: OpenRouterResult;
};

type CostState = {
  version: 1;
  day: string;
  fastRequests: number;
  deepRequests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  reportedCostUsd: number;
  cache: Record<string, CacheEntry>;
};

type CompletionInput = {
  cacheKey: string;
  system: string;
  user: string;
  mode?: OpenRouterMode;
  maxOutputTokens?: number;
  temperature?: number;
};

type OpenRouterPayload = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string };
  message?: string;
};

const DAY_MS = 86_400_000;
const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const STATE_PATH = process.env.OPENROUTER_STATE_PATH || "/app/data/openrouter-cost-state.json";
const FAST_MODEL = process.env.OPENROUTER_FAST_MODEL || "openai/gpt-4.1-nano";
const DEEP_MODEL = process.env.OPENROUTER_DEEP_MODEL || "openai/gpt-4.1-mini";
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

let stateQueue = Promise.resolve();

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function decimalEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

function config() {
  return {
    fastModel: FAST_MODEL,
    deepModel: DEEP_MODEL,
    fastDailyLimit: numberEnv("OPENROUTER_FAST_DAILY_LIMIT", 150, 1, 10_000),
    deepDailyLimit: numberEnv("OPENROUTER_DEEP_DAILY_LIMIT", 10, 0, 1_000),
    fastMaxOutputTokens: numberEnv("OPENROUTER_FAST_MAX_OUTPUT_TOKENS", 220, 32, 1_000),
    deepMaxOutputTokens: numberEnv("OPENROUTER_DEEP_MAX_OUTPUT_TOKENS", 360, 64, 2_000),
    maxInputChars: numberEnv("OPENROUTER_MAX_INPUT_CHARS", 12_000, 1_000, 100_000),
    cacheTtlSeconds: numberEnv("OPENROUTER_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS, 60, 30 * 24 * 60 * 60),
    cacheMaxEntries: numberEnv("OPENROUTER_CACHE_MAX_ENTRIES", 500, 10, 10_000),
    timeoutMs: numberEnv("OPENROUTER_TIMEOUT_MS", 25_000, 3_000, 120_000),
  };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(): CostState {
  return {
    version: 1,
    day: todayUtc(),
    fastRequests: 0,
    deepRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    reportedCostUsd: 0,
    cache: {},
  };
}

function normalizeState(input: Partial<CostState> | null | undefined): CostState {
  const state: CostState = {
    ...emptyState(),
    ...(input || {}),
    version: 1,
    cache: input?.cache && typeof input.cache === "object" ? input.cache : {},
  };
  if (state.day !== todayUtc()) {
    state.day = todayUtc();
    state.fastRequests = 0;
    state.deepRequests = 0;
    state.promptTokens = 0;
    state.completionTokens = 0;
    state.estimatedCostUsd = 0;
    state.reportedCostUsd = 0;
  }
  const now = Date.now();
  for (const [key, entry] of Object.entries(state.cache)) {
    if (!entry || entry.expiresAt <= now) delete state.cache[key];
  }
  return state;
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    return normalizeState(JSON.parse(raw) as Partial<CostState>);
  } catch {
    return emptyState();
  }
}

async function writeState(state: CostState) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const tempPath = `${STATE_PATH}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, STATE_PATH);
}

async function withStateLock<T>(callback: () => Promise<T>) {
  const previous = stateQueue;
  let release: (() => void) | undefined;
  stateQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await callback();
  } finally {
    release?.();
  }
}

function smartleadLanguage(input: CompletionInput): "ar" | "en" | null {
  if (!/^(?:smartlead-visible|smartlead-v2-intelligence):/i.test(input.cacheKey)) return null;
  try {
    const data = JSON.parse(input.user) as { firstName?: string; fullName?: string; country?: string };
    const decision = decideRecipientLanguage({ firstName: data.firstName, fullName: data.fullName, country: data.country });
    return decision.locale === "en" ? "en" : "ar";
  } catch {
    return "en";
  }
}

function normalizeSmartleadResult(input: CompletionInput, result: OpenRouterResult): OpenRouterResult {
  const language = smartleadLanguage(input);
  if (!language) return result;
  let openingLine = "";
  try {
    const content = result.content.trim();
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 && end > start ? content.slice(start, end + 1) : content) as { openingLine?: unknown };
    openingLine = String(parsed.openingLine || "").replace(/\s+/g, " ").trim().slice(0, 220);
  } catch {
    openingLine = "";
  }
  const hasArabic = ARABIC_SCRIPT.test(openingLine);
  if ((language === "en" && hasArabic) || (language === "ar" && openingLine && !hasArabic)) openingLine = "";
  return { ...result, content: JSON.stringify({ openingLine }) };
}

function cacheHash(input: CompletionInput, model: string, maxOutputTokens: number) {
  return createHash("sha256")
    .update(JSON.stringify({ input: input.cacheKey, model, mode: input.mode || "fast", maxOutputTokens, system: input.system, user: input.user }))
    .digest("hex");
}

function pricingForModel(model: string) {
  if (model.includes("gpt-4.1-nano")) return { inputPerMillion: 0.10, outputPerMillion: 0.40 };
  if (model.includes("gpt-4.1-mini")) return { inputPerMillion: 0.40, outputPerMillion: 1.60 };
  return {
    inputPerMillion: decimalEnv("OPENROUTER_CUSTOM_INPUT_USD_PER_M", 0, 0, 1_000),
    outputPerMillion: decimalEnv("OPENROUTER_CUSTOM_OUTPUT_USD_PER_M", 0, 0, 1_000),
  };
}

export function estimateOpenRouterCostUsd(model: string, promptTokens: number, completionTokens: number) {
  const pricing = pricingForModel(model);
  const total = (Math.max(0, promptTokens) / 1_000_000) * pricing.inputPerMillion
    + (Math.max(0, completionTokens) / 1_000_000) * pricing.outputPerMillion;
  return Number(total.toFixed(8));
}

function trimCache(state: CostState, maxEntries: number) {
  const entries = Object.entries(state.cache);
  if (entries.length <= maxEntries) return;
  entries.sort((a, b) => b[1].createdAt - a[1].createdAt);
  state.cache = Object.fromEntries(entries.slice(0, maxEntries));
}

export async function getOpenRouterStatus() {
  const state = normalizeState(await readState());
  const cfg = config();
  return {
    configured: Boolean(String(process.env.OPENROUTER_API_KEY || "").trim()),
    fastModel: cfg.fastModel,
    deepModel: cfg.deepModel,
    policy: "nano-first, mini-explicit-only",
    cacheTtlSeconds: cfg.cacheTtlSeconds,
    maxInputChars: cfg.maxInputChars,
    limits: {
      fastDaily: cfg.fastDailyLimit,
      deepDaily: cfg.deepDailyLimit,
      fastOutputTokens: cfg.fastMaxOutputTokens,
      deepOutputTokens: cfg.deepMaxOutputTokens,
    },
    today: {
      day: state.day,
      fastRequests: state.fastRequests,
      deepRequests: state.deepRequests,
      promptTokens: state.promptTokens,
      completionTokens: state.completionTokens,
      estimatedCostUsd: Number(state.estimatedCostUsd.toFixed(6)),
      reportedCostUsd: Number(state.reportedCostUsd.toFixed(6)),
    },
    cacheEntries: Object.keys(state.cache).length,
  };
}

export async function openRouterCompletion(input: CompletionInput): Promise<OpenRouterResult> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const cfg = config();
  const mode: OpenRouterMode = input.mode === "deep" ? "deep" : "fast";
  const model = mode === "deep" ? cfg.deepModel : cfg.fastModel;
  const hardOutputCap = mode === "deep" ? cfg.deepMaxOutputTokens : cfg.fastMaxOutputTokens;
  const maxOutputTokens = Math.min(hardOutputCap, Math.max(32, Math.round(input.maxOutputTokens || hardOutputCap)));
  const requiredLanguage = smartleadLanguage(input);
  const languageGuard = requiredLanguage
    ? `\nFor this outreach request the deterministic required language is ${requiredLanguage === "ar" ? "Arabic" : "English"}. Return ONLY JSON with one key named openingLine. The openingLine must be in that language. Do not return locale, greetingName, transliteration or any language decision.`
    : "";
  const system = `${String(input.system || "")}${languageGuard}`.slice(0, Math.floor(cfg.maxInputChars * 0.35));
  const user = String(input.user || "").slice(0, cfg.maxInputChars - system.length);
  const normalizedInput = { ...input, mode, system, user };
  const key = cacheHash(normalizedInput, model, maxOutputTokens);

  const cached = await withStateLock(async () => {
    const state = normalizeState(await readState());
    const hit = state.cache[key];
    if (!hit) return null;
    return normalizeSmartleadResult(normalizedInput, { ...hit.result, cached: true } satisfies OpenRouterResult);
  });
  if (cached) return cached;

  await withStateLock(async () => {
    const state = normalizeState(await readState());
    const current = mode === "deep" ? state.deepRequests : state.fastRequests;
    const limit = mode === "deep" ? cfg.deepDailyLimit : cfg.fastDailyLimit;
    if (current >= limit) {
      throw new Error(`OpenRouter ${mode} daily safety limit reached (${limit}).`);
    }
    if (mode === "deep") state.deepRequests += 1;
    else state.fastRequests += 1;
    await writeState(state);
  });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://sdr.dashboardtalentera.tech",
      "X-Title": "Talentera SDR Dashboard",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxOutputTokens,
      temperature: Math.min(0.7, Math.max(0, input.temperature ?? 0.15)),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });

  const payload = await response.json().catch(() => ({})) as OpenRouterPayload;
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `HTTP ${response.status}`;
    throw new Error(`OpenRouter request failed: ${message}`);
  }

  const content = String(payload.choices?.[0]?.message?.content || "").trim();
  if (!content) throw new Error("OpenRouter returned an empty completion.");

  const promptTokens = Math.max(0, Number(payload.usage?.prompt_tokens || 0));
  const completionTokens = Math.max(0, Number(payload.usage?.completion_tokens || 0));
  const totalTokens = Math.max(promptTokens + completionTokens, Number(payload.usage?.total_tokens || 0));
  const estimatedCostUsd = estimateOpenRouterCostUsd(model, promptTokens, completionTokens);
  const reportedRaw = Number(payload.usage?.cost);
  const reportedCostUsd = Number.isFinite(reportedRaw) && reportedRaw >= 0 ? reportedRaw : null;
  const rawResult: OpenRouterResult = {
    content,
    model: String(payload.model || model),
    mode,
    cached: false,
    usage: { promptTokens, completionTokens, totalTokens, estimatedCostUsd, reportedCostUsd },
  };
  const result = normalizeSmartleadResult(normalizedInput, rawResult);

  await withStateLock(async () => {
    const state = normalizeState(await readState());
    state.promptTokens += promptTokens;
    state.completionTokens += completionTokens;
    state.estimatedCostUsd += estimatedCostUsd;
    if (reportedCostUsd !== null) state.reportedCostUsd += reportedCostUsd;
    state.cache[key] = {
      createdAt: Date.now(),
      expiresAt: Date.now() + cfg.cacheTtlSeconds * 1000,
      result,
    };
    trimCache(state, cfg.cacheMaxEntries);
    await writeState(state);
  });

  return result;
}
