import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { TASK_OUTREACH_SYSTEM, parseOutreachDraft, type OutreachEvidence, type OutreachDraft } from "./task-outreach.ts";

type Result = { draft: OutreachDraft; model: string; cached: boolean };
type State = { day: string; requests: number; cache: Record<string, { at: number; result: Result }> };
let queue = Promise.resolve();
const inflight = new Map<string, Promise<Result>>();

async function locked<T>(run: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await run(); } finally { release(); }
}

export function commandCodeConfig() {
  return {
    apiKey: (process.env.COMMANDCODE_API || process.env.COMMANDCODE_API_KEY || "").trim(),
    model: (process.env.COMMANDCODE_MODEL || "deepseek/deepseek-v4-flash").trim(),
    statePath: process.env.COMMANDCODE_STATE_PATH || "/app/data/commandcode-outreach.json",
    dailyLimit: Math.min(1000, Math.max(1, Number(process.env.COMMANDCODE_DAILY_LIMIT) || 200)),
  };
}

// The app runs as one Node process. Reserve usage before calling the provider,
// persist across restarts, and share concurrent clicks for the same evidence.
export async function commandCodeOutreach(evidence: OutreachEvidence): Promise<Result> {
  const cfg = commandCodeConfig();
  if (!cfg.apiKey || !cfg.model) throw new Error("CommandCode requires COMMANDCODE_API on the server.");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const key = createHash("sha256").update(JSON.stringify({ evidence, model: cfg.model, prompt: TASK_OUTREACH_SYSTEM })).digest("hex");
  const existing = inflight.get(key);
  if (existing) return existing;
  const read = async (): Promise<State> => {
    try {
      const state = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ cfg.statePath, "utf8")) as State;
      if (!state.cache || !Number.isFinite(state.requests)) throw new Error("Invalid outreach state");
      return { ...state, day, requests: state.day === day ? state.requests : 0 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("CommandCode usage storage is unavailable.");
      return { day, requests: 0, cache: {} };
    }
  };
  const write = async (state: State) => {
    await fs.mkdir(/* turbopackIgnore: true */ path.dirname(cfg.statePath), { recursive: true });
    const temporary = `${cfg.statePath}.${process.pid}.tmp`;
    await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(/* turbopackIgnore: true */ temporary, /* turbopackIgnore: true */ cfg.statePath);
  };
  const work = (async () => {
    const cached = await locked(async () => {
      const state = await read();
      const entry = state.cache[key];
      if (entry && Date.now() - entry.at < 24 * 3600_000) return { ...entry.result, cached: true };
      if (state.requests >= cfg.dailyLimit) throw new Error("CommandCode daily message limit reached.");
      state.requests++;
      await write(state);
      return null;
    });
    if (cached) return cached;
    const response = await fetch("https://api.commandcode.ai/provider/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, messages: [
        { role: "system", content: TASK_OUTREACH_SYSTEM },
        { role: "user", content: JSON.stringify({ firstName: evidence.firstName, company: evidence.company, title: evidence.title, brand: evidence.brand }) },
      ], max_tokens: 900, temperature: 0.4 }),
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    // Do not echo vendor bodies: they can contain submitted business data.
    if (!response.ok) throw new Error(`CommandCode unavailable (HTTP ${response.status}). Check model access and API credit.`);
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || body?.choices?.[0]?.finish_reason === "length") throw new Error("CommandCode returned an incomplete message. Please retry.");
    const result: Result = { draft: parseOutreachDraft(content, evidence.brand), model: cfg.model, cached: false };
    await locked(async () => {
      const state = await read();
      state.cache[key] = { at: Date.now(), result };
      state.cache = Object.fromEntries(Object.entries(state.cache).filter(([, entry]) => Date.now() - entry.at < 24 * 3600_000).sort((a,b) => b[1].at - a[1].at).slice(0, 500));
      await write(state);
    });
    return result;
  })();
  inflight.set(key, work);
  try { return await work; } finally { inflight.delete(key); }
}
