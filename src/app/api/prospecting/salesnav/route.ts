import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const requestSchema = z.object({
  searchUrl: z.string().trim().url().max(5000),
  limit: z.number().int().min(1).max(50).default(50),
});

const ENGINE_URL = process.env.SALESNAV_ENGINE_URL || "http://gtm-career-browser:3000/salesnav-extract";
const RUNTIME_ENV_FILE = process.env.SDR_RUNTIME_ENV_FILE || "/run/sdr-env/.env";

type RuntimeSecrets = {
  liAt: string;
  jsessionId: string;
};

function unquote(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseRuntimeValue(content: string, key: string) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const index = normalized.indexOf("=");
    if (index < 1 || normalized.slice(0, index).trim() !== key) continue;
    return unquote(normalized.slice(index + 1));
  }
  return "";
}

async function linkedinSecrets(): Promise<RuntimeSecrets> {
  let liAt = String(process.env.LINKEDIN_LI_AT || "").trim();
  let jsessionId = String(process.env.LINKEDIN_JSESSIONID || "").trim();
  if (liAt) return { liAt, jsessionId };

  try {
    const content = await readFile(RUNTIME_ENV_FILE, "utf8");
    liAt = parseRuntimeValue(content, "LINKEDIN_LI_AT").trim();
    jsessionId = parseRuntimeValue(content, "LINKEDIN_JSESSIONID").trim();
  } catch {
    // Runtime env is optional. The UI will expose a safe "not connected" state.
  }
  return { liAt, jsessionId };
}

function validSalesNavUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "linkedin.com" || host.endsWith(".linkedin.com"))
      && /^\/sales\/search\/people\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export async function GET() {
  const session = await linkedinSecrets();
  return NextResponse.json({
    status: "ok",
    sessionConfigured: Boolean(session.liAt),
    signalHireConfigured: Boolean(process.env.SIGNALHIRE_API_KEY),
    maxResults: 50,
    mode: "bounded_headless",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !validSalesNavUrl(parsed.success ? parsed.data.searchUrl : "")) {
    return NextResponse.json({ error: "Paste a valid Sales Navigator People Search URL." }, { status: 400 });
  }

  const session = await linkedinSecrets();
  if (!session.liAt) {
    return NextResponse.json({
      error: "LinkedIn Sales Navigator session is not connected on the VPS yet.",
      status: "session_required",
      sessionConfigured: false,
    }, { status: 412 });
  }

  try {
    const response = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchUrl: parsed.data.searchUrl,
        limit: parsed.data.limit,
        sessionToken: session.liAt,
        jsessionToken: session.jsessionId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(170_000),
    });
    const payload = await response.json().catch(() => ({ error: `Sales Nav worker returned HTTP ${response.status}.` }));
    return NextResponse.json({
      ...payload,
      sessionConfigured: true,
      signalHireConfigured: Boolean(process.env.SIGNALHIRE_API_KEY),
    }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Sales Navigator extraction failed.",
      status: "worker_error",
    }, { status: 502 });
  }
}
