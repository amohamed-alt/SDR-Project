import { commandCodeModelOptions } from "./commandcode-model-options.ts";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type CommandCodeMode = "fast" | "deep";

export type CommandCodeServerTool = {
  type: string;
  parameters?: Record<string, unknown>;
};

export type CommandCodeUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  webSearchRequests: number;
  estimatedCostUsd: number;
  reportedCostUsd: number | null;
};

export type CommandCodeResult = {
  content: string;
  model: string;
  mode: CommandCodeMode;
  cached: boolean;
  usage: CommandCodeUsage;
};

type CacheEntry = {
  createdAt: number;
  expiresAt: number;
  result: CommandCodeResult;
};

type CostState = {
  version: 1;
  day: string;
  fastRequests: number;
  deepRequests: number;
  webSearchRequests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  reportedCostUsd: number;
  cache: Record<string, CacheEntry>;
};

export type CommandCodeCompletionInput = {
  cacheKey: string;
  system: string;
  user: string;
  mode?: CommandCodeMode;
  maxOutputTokens?: number;
  temperature?: number;
  serverTools?: CommandCodeServerTool[];
  maxToolCalls?: number;
  forceServerTool?: boolean;
  estimatedServerToolCostUsdPerUse?: number;
};

type CommandCodePayload = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    server_tool_use?: {
      web_search_requests?: number;
    };
  };
  error?: { message?: string };
  message?: string;
};

const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const STATE_PATH = process.env.COMMANDCODE_GATEWAY_STATE_PATH || "/app/data/commandcode-gateway-state.json";
const FAST_MODEL = process.env.COMMANDCODE_MODEL || "deepseek/deepseek-v4-flash";
const DEEP_MODEL = process.env.COMMANDCODE_DEEP_MODEL || FAST_MODEL;

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
    fastDailyLimit: numberEnv("COMMANDCODE_FAST_DAILY_LIMIT", 150, 1, 10_000),
    deepDailyLimit: numberEnv("COMMANDCODE_DEEP_DAILY_LIMIT", 10, 0, 1_000),
    webSearchDailyLimit: 0,
    fastMaxOutputTokens: numberEnv("COMMANDCODE_FAST_MAX_OUTPUT_TOKENS", 900, 32, 2_000),
    deepMaxOutputTokens: numberEnv("COMMANDCODE_DEEP_MAX_OUTPUT_TOKENS", 1200, 64, 2_000),
    maxInputChars: numberEnv("COMMANDCODE_MAX_INPUT_CHARS", 12_000, 1_000, 100_000),
    cacheTtlSeconds: numberEnv("COMMANDCODE_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS, 60, 30 * 24 * 60 * 60),
    cacheMaxEntries: numberEnv("COMMANDCODE_CACHE_MAX_ENTRIES", 500, 10, 10_000),
    timeoutMs: numberEnv("COMMANDCODE_TIMEOUT_MS", 25_000, 3_000, 120_000),
  };
}

function todayUtc() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}

function emptyState(): CostState {
  return {
    version: 1,
    day: todayUtc(),
    fastRequests: 0,
    deepRequests: 0,
    webSearchRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    reportedCostUsd: 0,
    cache: {},
  };
}

function normalizeResult(result: CommandCodeResult): CommandCodeResult {
  return {
    ...result,
    usage: {
      promptTokens: Math.max(0, Number(result?.usage?.promptTokens || 0)),
      completionTokens: Math.max(0, Number(result?.usage?.completionTokens || 0)),
      totalTokens: Math.max(0, Number(result?.usage?.totalTokens || 0)),
      webSearchRequests: Math.max(0, Number(result?.usage?.webSearchRequests || 0)),
      estimatedCostUsd: Math.max(0, Number(result?.usage?.estimatedCostUsd || 0)),
      reportedCostUsd: result?.usage?.reportedCostUsd === null || result?.usage?.reportedCostUsd === undefined
        ? null
        : Math.max(0, Number(result.usage.reportedCostUsd || 0)),
    },
  };
}

function normalizeState(input: Partial<CostState> | null | undefined): CostState {
  const state: CostState = {
    ...emptyState(),
    ...(input || {}),
    version: 1,
    webSearchRequests: Math.max(0, Number(input?.webSearchRequests || 0)),
    cache: input?.cache && typeof input.cache === "object" ? input.cache : {},
  };
  if (state.day !== todayUtc()) {
    state.day = todayUtc();
    state.fastRequests = 0;
    state.deepRequests = 0;
    state.webSearchRequests = 0;
    state.promptTokens = 0;
    state.completionTokens = 0;
    state.estimatedCostUsd = 0;
    state.reportedCostUsd = 0;
  }
  const now = Date.now();
  for (const [key, entry] of Object.entries(state.cache)) {
    if (!entry || entry.expiresAt <= now) {
      delete state.cache[key];
      continue;
    }
    entry.result = normalizeResult(entry.result);
  }
  return state;
}

async function readState() {
  try {
    const raw = await fs.readFile(/* turbopackIgnore: true */ STATE_PATH, "utf8");
    return normalizeState(JSON.parse(raw) as Partial<CostState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw new Error("CommandCode usage storage is unavailable.");
  }
}

async function writeState(state: CostState) {
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(STATE_PATH), { recursive: true });
  const tempPath = `${STATE_PATH}.tmp-${process.pid}`;
  await fs.writeFile(/* turbopackIgnore: true */ tempPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await fs.rename(/* turbopackIgnore: true */ tempPath, /* turbopackIgnore: true */ STATE_PATH);
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

function cacheHash(input: CommandCodeCompletionInput, model: string, maxOutputTokens: number) {
  return createHash("sha256")
    .update(JSON.stringify({
      input: input.cacheKey,
      generationOptions: commandCodeModelOptions(model),
      model,
      mode: input.mode || "fast",
      maxOutputTokens,
      system: input.system,
      user: input.user,
      temperature: input.temperature ?? 0.15,
      serverTools: input.serverTools || [],
      maxToolCalls: input.maxToolCalls || 0,
      forceServerTool: Boolean(input.forceServerTool),
    }))
    .digest("hex");
}

function pricingForModel(model: string) {
  void model; // Rates are explicit configuration, never borrowed from another provider.
  return {
    inputPerMillion: decimalEnv("COMMANDCODE_CUSTOM_INPUT_USD_PER_M", 0, 0, 1_000),
    outputPerMillion: decimalEnv("COMMANDCODE_CUSTOM_OUTPUT_USD_PER_M", 0, 0, 1_000),
  };
}

export function estimateCommandCodeCostUsd(model: string, promptTokens: number, completionTokens: number) {
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

export async function getCommandCodeStatus() {
  const state = normalizeState(await readState());
  const cfg = config();
  return {
    configured: Boolean(String(process.env.COMMANDCODE_API || process.env.COMMANDCODE_API_KEY || "").trim()),
    fastModel: cfg.fastModel,
    deepModel: cfg.deepModel,
    provider: "commandcode",
    policy: "bounded-evidence-only",
    nativeWebSearch: false,
    webSearchBounded: false,
    cacheTtlSeconds: cfg.cacheTtlSeconds,
    maxInputChars: cfg.maxInputChars,
    limits: {
      fastDaily: cfg.fastDailyLimit,
      deepDaily: cfg.deepDailyLimit,
      webSearchDaily: cfg.webSearchDailyLimit,
      fastOutputTokens: cfg.fastMaxOutputTokens,
      deepOutputTokens: cfg.deepMaxOutputTokens,
    },
    today: {
      day: state.day,
      fastRequests: state.fastRequests,
      deepRequests: state.deepRequests,
      webSearchRequests: state.webSearchRequests,
      promptTokens: state.promptTokens,
      completionTokens: state.completionTokens,
      estimatedCostUsd: Number(state.estimatedCostUsd.toFixed(6)),
      reportedCostUsd: Number(state.reportedCostUsd.toFixed(6)),
    },
    cacheEntries: Object.keys(state.cache).length,
  };
}

export async function commandCodeCompletion(input: CommandCodeCompletionInput): Promise<CommandCodeResult> {
  const apiKey = String(process.env.COMMANDCODE_API || process.env.COMMANDCODE_API_KEY || "").trim();
  if (!apiKey) throw new Error("COMMANDCODE_API_KEY is not configured.");

  const cfg = config();
  const mode: CommandCodeMode = input.mode === "deep" ? "deep" : "fast";
  const model = mode === "deep" ? cfg.deepModel : cfg.fastModel;
  const hardOutputCap = mode === "deep" ? cfg.deepMaxOutputTokens : cfg.fastMaxOutputTokens;
  const maxOutputTokens = Math.min(hardOutputCap, Math.max(32, Math.round(input.maxOutputTokens || hardOutputCap)));
  const system = String(input.system || "").slice(0, Math.floor(cfg.maxInputChars * 0.35));
  const user = String(input.user || "").slice(0, cfg.maxInputChars - system.length);
  const serverTools = Array.isArray(input.serverTools) ? input.serverTools.slice(0, 4) : [];
  if (serverTools.length) throw new Error("CommandCode gateway does not provide native web verification.");
  const usesWebSearch = false;
  const key = cacheHash({ ...input, mode, system, user, serverTools }, model, maxOutputTokens);

  const cached = await withStateLock(async () => {
    const state = normalizeState(await readState());
    const hit = state.cache[key];
    if (!hit) return null;
    return { ...normalizeResult(hit.result), cached: true } satisfies CommandCodeResult;
  });
  if (cached) return cached;

  await withStateLock(async () => {
    const state = normalizeState(await readState());
    const current = mode === "deep" ? state.deepRequests : state.fastRequests;
    const limit = mode === "deep" ? cfg.deepDailyLimit : cfg.fastDailyLimit;
    if (current >= limit) {
      throw new Error(`CommandCode ${mode} daily safety limit reached (${limit}).`);
    }
    if (usesWebSearch && state.webSearchRequests >= cfg.webSearchDailyLimit) {
      throw new Error(`CommandCode web-search daily safety limit reached (${cfg.webSearchDailyLimit}).`);
    }
    if (mode === "deep") state.deepRequests += 1;
    else state.fastRequests += 1;
    // Reserve one search when a web tool is required. The actual usage is reconciled below.
    if (usesWebSearch && input.forceServerTool) state.webSearchRequests += 1;
    await writeState(state);
  });

  const response = await fetch("https://api.commandcode.ai/provider/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://sdr.dashboardtalentera.tech",
      "X-Title": "Talentera SDR Dashboard",
    },
    body: JSON.stringify({
      model,
      ...commandCodeModelOptions(model),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxOutputTokens,
      temperature: Math.min(0.7, Math.max(0, input.temperature ?? 0.15)),
      ...(serverTools.length ? { tools: serverTools } : {}),
      ...(serverTools.length && input.forceServerTool ? { tool_choice: "required" } : {}),
      ...(serverTools.length ? { max_tool_calls: Math.min(5, Math.max(1, Math.round(input.maxToolCalls || 1))) } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });

  const payload = await response.json().catch(() => ({})) as CommandCodePayload;
  if (!response.ok) {
    throw new Error(`CommandCode request failed (HTTP ${response.status}).`);
  }

  const content = String(payload.choices?.[0]?.message?.content || "").trim();
  if (!content) throw new Error("CommandCode returned an empty completion.");

  const promptTokens = Math.max(0, Number(payload.usage?.prompt_tokens || 0));
  const completionTokens = Math.max(0, Number(payload.usage?.completion_tokens || 0));
  const totalTokens = Math.max(promptTokens + completionTokens, Number(payload.usage?.total_tokens || 0));
  const webSearchRequests = Math.max(0, Number(payload.usage?.server_tool_use?.web_search_requests || 0));
  const serverToolCostPerUse = Math.max(0, Number(input.estimatedServerToolCostUsdPerUse || 0));
  const estimatedCostUsd = Number((
    estimateCommandCodeCostUsd(model, promptTokens, completionTokens)
    + webSearchRequests * serverToolCostPerUse
  ).toFixed(8));
  const reportedRaw = payload.usage?.cost == null ? NaN : Number(payload.usage.cost);
  const reportedCostUsd = Number.isFinite(reportedRaw) && reportedRaw >= 0 ? reportedRaw : null;
  const result: CommandCodeResult = {
    content,
    model: String(payload.model || model),
    mode,
    cached: false,
    usage: { promptTokens, completionTokens, totalTokens, webSearchRequests, estimatedCostUsd, reportedCostUsd },
  };

  await withStateLock(async () => {
    const state = normalizeState(await readState());
    state.promptTokens += promptTokens;
    state.completionTokens += completionTokens;
    if (usesWebSearch) {
      const reserved = input.forceServerTool ? 1 : 0;
      state.webSearchRequests += Math.max(0, webSearchRequests - reserved);
    }
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