import dns from "node:dns/promises";
import net from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  stage: z.enum(["company", "tam", "icp", "personas", "sourcing", "filters", "copy", "channels"]),
  domain: z.string().trim().max(255).optional(),
  approvedContext: z.unknown().optional(),
});

const OLLAMA_URL = process.env.GTM_RESEARCH_OLLAMA_URL || process.env.OLLAMA_URL || "http://career-judge-ollama:11434/api/chat";
const OLLAMA_MODEL = process.env.GTM_RESEARCH_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "qwen3:1.7b";

const STAGE_PROMPTS: Record<string, string> = {
  company: `Return a JSON object with exactly these top-level keys:
company_name, domain, summary, products_services, value_proposition, pain_points_solved, competitors, primary_markets, target_customer_types, evidence_notes, confidence.
products_services, value_proposition, pain_points_solved, primary_markets, target_customer_types, evidence_notes must be arrays of strings.
competitors must be an array of objects with name and reason.
confidence must be low, medium, or high.
Use only evidence from the supplied website content. If something is uncertain, say so in evidence_notes instead of inventing facts.`,
  tam: `Return a JSON object with exactly these top-level keys:
recommended_markets, target_industries, employee_bands, exclusions, tam_hypothesis, assumptions, open_questions.
recommended_markets must be an array of objects with market, priority, and why.
All other plural fields must be arrays of strings except tam_hypothesis, which is a concise string.
Treat the approved context as the source of truth, including any human edits that conflict with earlier AI research.`,
  icp: `Return a JSON object with exactly these top-level keys: tier_1, tier_2, tier_3.
Each tier must contain name, description, geographies, industries, employee_range, signals, exclusions.
geographies, industries, signals, exclusions must be arrays of strings.
Use only the approved company and TAM context. Tier 1 is best fit, Tier 2 is good fit, Tier 3 is experimental/adjacent.`,
  personas: `Return a JSON object with exactly one top-level key: personas.
personas must be an array of 3 to 6 objects. Each object must contain persona, likely_titles, seniority, role_in_buying, pains, goals, kpis, buying_triggers, objections, messaging_angle.
likely_titles, pains, goals, kpis, buying_triggers, objections must be arrays of strings.
Use only approved upstream context.`,
  sourcing: `Return a JSON object with exactly these top-level keys: primary_tools, fallback_tools, rationale.
primary_tools and fallback_tools must be arrays of objects with tool, best_for, and why.
rationale must be an array of strings.
Recommend sourcing/enrichment tools based on the approved ICP and personas. Do not assume a tool must be used just because it is popular.`,
  filters: `Return a JSON object with exactly these top-level keys: sales_navigator, apollo, notes.
sales_navigator and apollo must be objects whose values are strings or arrays of strings and should contain copy-ready filter guidance derived from the approved ICP/personas.
notes must be an array of strings explaining exclusions, edge cases, or filters that need manual judgment.`,
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

function isPrivateIp(address: string) {
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
  return Array.from(new Map(scored.sort((a, b) => b.score - a.score).map((entry) => [entry.url.toString(), entry.url])).values()).slice(0, 5);
}

async function collectWebsiteEvidence(domain: string) {
  const start = normalizeDomain(domain);
  const homepage = await safeFetchText(start);
  const pages = [{ url: homepage.finalUrl.toString(), html: homepage.html }];
  const links = discoverUsefulLinks(homepage.html, homepage.finalUrl);
  const settled = await Promise.allSettled(links.map(async (url) => {
    const result = await safeFetchText(url);
    return { url: result.finalUrl.toString(), html: result.html };
  }));
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
    combinedText: evidence.map((page) => `SOURCE: ${page.url}\nTITLE: ${page.title}\nDESCRIPTION: ${page.description}\nTEXT: ${page.text}`).join("\n\n").slice(0, 24_000),
  };
}

function extractJsonObject(raw: string) {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI response did not contain JSON.");
  return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
}

async function callOllama(stage: string, source: string) {
  const system = `You are a senior B2B GTM research analyst. Return valid JSON only, with no markdown or commentary. Never ignore human-approved context. Never fabricate precise facts that are not supported. ${STAGE_PROMPTS[stage]}`;
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: "json",
      options: { temperature: 0.2 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: source.slice(0, 30_000) },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Local AI returned HTTP ${response.status}.`);
  const payload = await response.json() as { message?: { content?: string }; response?: string };
  const content = payload.message?.content || payload.response || "";
  return extractJsonObject(content);
}

function fallbackCompany(domain: string, evidence: Awaited<ReturnType<typeof collectWebsiteEvidence>>) {
  const first = evidence.pages[0];
  return {
    company_name: first?.title?.split(/[|–—-]/)[0]?.trim() || evidence.canonicalDomain,
    domain: evidence.canonicalDomain,
    summary: first?.description || `Website research captured for ${evidence.canonicalDomain}, but the local AI service was unavailable.`,
    products_services: [],
    value_proposition: [],
    pain_points_solved: [],
    competitors: [],
    primary_markets: [],
    target_customer_types: [],
    evidence_notes: [
      `Captured ${evidence.pages.length} public website page(s).`,
      "AI analysis was unavailable, so only deterministic website metadata is shown. Retry when the local model is ready.",
    ],
    confidence: "low",
    requested_domain: domain,
  };
}

function fallbackStage(stage: string) {
  const common = { status: "ai_unavailable", note: "The local AI service is unavailable. Keep the approved upstream context and retry this stage when Ollama is ready." };
  if (stage === "tam") return { ...common, recommended_markets: [], target_industries: [], employee_bands: [], exclusions: [], tam_hypothesis: "", assumptions: [], open_questions: [] };
  if (stage === "icp") return { ...common, tier_1: {}, tier_2: {}, tier_3: {} };
  if (stage === "personas") return { ...common, personas: [] };
  if (stage === "sourcing") return { ...common, primary_tools: [], fallback_tools: [], rationale: [] };
  if (stage === "filters") return { ...common, sales_navigator: {}, apollo: {}, notes: [] };
  if (stage === "copy") return { ...common, email: {}, linkedin: {}, notes: [] };
  return { ...common, recommended_channels: [], cadence: [], rationale: [] };
}

export async function POST(request: NextRequest) {
  try {
    const parsed = inputSchema.parse(await request.json());
    if (parsed.stage === "company") {
      if (!parsed.domain) return NextResponse.json({ error: "Website domain is required." }, { status: 400 });
      const evidence = await collectWebsiteEvidence(parsed.domain);
      try {
        const result = await callOllama("company", `WEBSITE DOMAIN: ${evidence.canonicalDomain}\n\nPUBLIC WEBSITE EVIDENCE:\n${evidence.combinedText}`);
        return NextResponse.json({ result, meta: { ai: "ollama", model: OLLAMA_MODEL, sources: evidence.pages.map((page) => page.url) } });
      } catch (error) {
        return NextResponse.json({
          result: fallbackCompany(parsed.domain, evidence),
          meta: { ai: "fallback", model: OLLAMA_MODEL, sources: evidence.pages.map((page) => page.url), warning: error instanceof Error ? error.message : "Local AI unavailable." },
        });
      }
    }

    const context = JSON.stringify(parsed.approvedContext ?? {}, null, 2);
    if (context.length > 60_000) return NextResponse.json({ error: "Approved context is too large." }, { status: 413 });
    try {
      const result = await callOllama(parsed.stage, `APPROVED UPSTREAM CONTEXT (source of truth):\n${context}`);
      return NextResponse.json({ result, meta: { ai: "ollama", model: OLLAMA_MODEL } });
    } catch (error) {
      return NextResponse.json({
        result: fallbackStage(parsed.stage),
        meta: { ai: "fallback", model: OLLAMA_MODEL, warning: error instanceof Error ? error.message : "Local AI unavailable." },
      });
    }
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid GTM research request." : error instanceof Error ? error.message : "Unexpected GTM research error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
