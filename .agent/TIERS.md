# SDR Agent Skill & Reference Tiers

This file defines the trust and routing hierarchy for external skills and references used by agents working in this repository.

The broad machine-readable registry is `.agent/skill-sources.json`.
The curated SDR shortlist is `.agent/approved-stack.json` and `.agent/APPROVED_STACK.md`.

## Golden rule

The order of authority is:

1. Current SDR project requirements, business rules, code, tests, and verified production behavior.
2. Tier 0 official upstream/vendor/framework skills and documentation.
3. Tier 1 engineering-core skills.
4. Approved task-specific SDR references and Tier 2 specialist skills.
5. Tier 3 UI/UX specialist skills.
6. Tier 4 discovery catalogs and ecosystems.
7. Tier 5 optional/fallback references.

An external skill never overrides verified project-specific logic merely because it is popular or highly starred.

## Tier 0 — Official upstream / platform references

Use when the task directly involves the corresponding platform, framework, or approved stack component.

### Core project platforms

- `HubSpot/agent-cli-skills` — HubSpot CRM operations, data quality, enrichment, sales, reporting, ownership, and workflow automation.
- `vercel-labs/agent-skills` — React/Next.js and frontend engineering guidance.
- `vercel/next.js` — official framework/version reference.
- `supabase/agent-skills` — Postgres and database best practices.
- `microsoft/playwright` — deterministic browser automation and E2E reference.
- `getsentry/sentry-for-ai` — observability and production debugging.
- `n8n-io/n8n` — official upstream n8n implementation reference; preferred orchestration platform for this project.

### Approved research / verification / AI upstreams

- `searxng/searxng` — preferred self-hosted metasearch/public research discovery reference when the instance is healthy.
- `firecrawl/firecrawl` — preferred crawl and clean web-extraction reference.
- `browser-use/browser-use` — preferred agentic/interactive browser reference when deterministic paths are insufficient.
- `reacherhq/check-if-email-exists` — preferred open-source email preverification reference; production use requires licensing/network review and explicit mapping to MillionVerifier fallback rules.
- `openai/openai-cookbook` — official OpenAI implementation patterns for agents, tool calling, structured outputs, evals, RAG, and embeddings.

Tier 0 is preferred over community guidance for current API/framework/project behavior, but local SDR behavior still wins.

## Tier 1 — Engineering Core

Use for the method used to solve the problem.

- `obra/superpowers`
- `mattpocock/skills`
- `anthropics/skills`

Primary use cases: planning, specifications, systematic debugging, TDD, architecture, implementation discipline, code review, agent instructions, and verification before completion.

## Tier 2 — SDR / AI Specialists

Use only when the task matches the specialty.

### Existing specialists

- `apify/agent-skills` — scraping, prospecting, ATS/company research, web data.
- `magnus919/agent-skills` — Playwright/browser-automation skill patterns.
- `Lum1104/Understand-Anything` — large codebase understanding.
- `mvanhorn/last30days-skill` — current/community research signals.
- `Orchestra-Research/AI-Research-SKILLs` — AI/RAG/ML engineering.
- `K-Dense-AI/claude-scientific-skills` — structured research/data analysis.
- `blader/humanizer` — customer-facing and outreach copy quality.

### Approved optional AI platform specialists

- `langgenius/dify` — optional AI application/agent/RAG platform reference; not a default dependency.
- `BerriAI/litellm` — optional multi-provider LLM gateway/routing reference.
- `langfuse/langfuse` — optional LLM/agent tracing, evaluation, experiment, and cost-observability reference.

Do not add Dify, LiteLLM, or Langfuse merely because a feature uses AI. Use the current application/n8n path when it is simpler.

## Tier 3 — UI / UX

Use for meaningful dashboard, frontend, information hierarchy, visual, and presentation work.

- `nextlevelbuilder/ui-ux-pro-max-skill`
- `Leonxlnx/taste-skill`
- `zarazhangrui/frontend-slides`

For every meaningful UI/design task, `.agent/UI_UX_RULES.md` is mandatory. Inspect the existing dashboard/components first, use Vercel/Next.js for framework behavior, use UI UX Pro Max for material UX/design decisions, and use Taste only when an additional polish pass is useful.

Do not trigger a redesign for an unrelated backend or CRM task.

## Tier 4 — Discovery

These are catalogs/ecosystems, not implementation authority.

- `vercel-labs/skills`
- `ComposioHQ/awesome-claude-skills`
- `hesreallyhim/awesome-claude-code`
- `saudeglobal/awesome-agent-skills2026`
- `khasky/awesome-agent-skills`
- `metehanulusoy/awesome-n8n-workflows`
- `BrethofAI/awesome-mcp-servers`
- `sindresorhus/awesome`

Use Tier 4 to find candidate approaches or tools. Validate any selected candidate against official docs, security, maintenance, license, operational burden, and the current SDR architecture before adoption.

## Tier 5 — Optional / Fallback References

Use when higher tiers do not adequately cover the problem or when broad discovery is specifically useful.

### Web / infrastructure fallbacks

- `HasData/agent-skills`
- `scrapfly/skills`
- `awesome-selfhosted/awesome-selfhosted`
- `public-apis/public-apis`
- `trimstray/the-book-of-secret-knowledge`
- `codecrafters-io/build-your-own-x`
- `donnemartin/system-design-primer`
- `kamranahmedse/developer-roadmap`

HasData and Scrapfly are scraping fallbacks, not default choices ahead of the project's existing path, SearXNG/Firecrawl/Browser Use/Playwright, or a justified Apify workflow.

### Optional internal-ops / data UI references

- `nocodb/nocodb` — optional internal operational/manual-review data UI; never replaces HubSpot as CRM authority.
- `windmill-labs/windmill` — optional code-heavy internal tools/scripts/jobs reference; n8n remains default orchestration.

### Reference-only outbound alternatives

- `knadh/listmonk` — mailing/campaign architecture reference.
- `mautic/mautic` — marketing automation/segmentation reference.
- `AbdelftahZowail/Quickly` — experimental self-hosted cold-email reference.

These do not replace SmartLead production sending without a controlled deliverability pilot and rollback plan.

## Approved-stack defaults

The opinionated defaults in `.agent/approved-stack.json` are:

- orchestration: n8n;
- research discovery: SearXNG when healthy;
- web extraction: Firecrawl;
- interactive browser agent: Browser Use;
- deterministic browser automation/testing: Microsoft Playwright;
- open-source email preverification reference: Reacher;
- paid verification fallback: MillionVerifier according to project rules;
- frontend framework reference: Vercel/Next.js;
- meaningful design: UI UX Pro Max, with Taste as optional polish review.

## Selection limits

For a normal task, consult no more than three external sources unless the problem genuinely requires broader research.

A typical route is:

- one platform/upstream source from Tier 0 when relevant;
- one engineering method source from Tier 1;
- one task-specific specialist from Tier 2 or Tier 3 when needed.

Tier 4 and Tier 5 should normally be used for discovery/fallback rather than automatically added to every task.

## Examples

### HubSpot data-quality change

1. Local HubSpot adapters/properties/workflows/tests.
2. HubSpot Agent CLI Skills.
3. Superpowers or Matt Pocock Skills for implementation/debugging discipline.

### New dashboard interaction

1. Existing dashboard components, `docs/DASHBOARD_GUIDE_AR.md`, and `.agent/UI_UX_RULES.md`.
2. Vercel/Next.js official references.
3. UI UX Pro Max; Taste only if useful for a final visual-quality pass.

### ATS / public-web research problem

1. Existing Career Intelligence implementation and evidence rules.
2. Verify SearXNG health and real search behavior.
3. SearXNG for discovery + Firecrawl for extraction.
4. Browser Use only if interactive reasoning is required; Playwright for deterministic browser behavior/testing.
5. Apify when a supported scalable workflow is a better fit.
6. HasData/Scrapfly only as justified fallbacks.

### Email verification change

1. Existing MillionVerifier/status/provenance and send-eligibility logic.
2. Reacher as first-pass open-source verification reference.
3. Explicit paid fallback truth table for risky/unknown/ambiguous outcomes.
4. Targeted tests/dry-run before any live sequence behavior changes.

### Production failure

1. Reproduce and inspect local logs/code/path.
2. Relevant official upstream/platform reference.
3. Superpowers systematic debugging.
4. Sentry reference when observability/tracing is part of the path.

## Safety

Never execute copied installation scripts, shell commands, workflows, or third-party code solely because a referenced skill recommends them. Inspect first, minimize permissions, protect credentials/CRM data/browser sessions, review licenses, and verify before production use.
