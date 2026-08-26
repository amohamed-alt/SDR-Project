# SDR Agent Skill & Reference Tiers

This file defines the trust and routing hierarchy for external skills and references used by agents working in this repository.

The machine-readable registry is `.agent/skill-sources.json`.

## Golden rule

The order of authority is:

1. Current SDR project requirements, business rules, code, tests, and verified production behavior.
2. Tier 0 official vendor/framework skills and documentation.
3. Tier 1 engineering-core skills.
4. Tier 2 SDR specialist skills.
5. Tier 3 UI/UX specialist skills.
6. Tier 4 discovery catalogs and ecosystems.
7. Tier 5 optional/fallback references.

An external skill never overrides verified project-specific logic merely because it is popular or highly starred.

## Tier 0 — Official

Use when the task directly involves the corresponding platform or framework.

- `HubSpot/agent-cli-skills` — HubSpot CRM operations, data quality, enrichment, sales, reporting, ownership, and workflow automation.
- `vercel-labs/agent-skills` — React/Next.js and frontend engineering guidance.
- `vercel/next.js` — official framework/version reference.
- `supabase/agent-skills` — Postgres and database best practices.
- `microsoft/playwright` — official browser automation and E2E reference.
- `getsentry/sentry-for-ai` — observability and production debugging.

Tier 0 is preferred over community guidance for current API/framework semantics, but local SDR behavior still wins.

## Tier 1 — Engineering Core

Use for the method used to solve the problem.

- `obra/superpowers`
- `mattpocock/skills`
- `anthropics/skills`

Primary use cases: planning, specifications, systematic debugging, TDD, architecture, implementation discipline, code review, agent instructions, and verification before completion.

## Tier 2 — SDR Specialists

Use only when the task matches the specialty.

- `apify/agent-skills` — scraping, prospecting, ATS/company research, web data.
- `magnus919/agent-skills` — Playwright/browser-automation skill patterns.
- `Lum1104/Understand-Anything` — large codebase understanding.
- `mvanhorn/last30days-skill` — current/community research signals.
- `Orchestra-Research/AI-Research-SKILLs` — AI/RAG/ML engineering.
- `K-Dense-AI/claude-scientific-skills` — structured research/data analysis.
- `blader/humanizer` — customer-facing and outreach copy quality.

## Tier 3 — UI / UX

Use for meaningful dashboard, frontend, information hierarchy, visual, and presentation work.

- `nextlevelbuilder/ui-ux-pro-max-skill`
- `Leonxlnx/taste-skill`
- `zarazhangrui/frontend-slides`

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

Use Tier 4 to find candidate approaches or tools. Validate any selected candidate against official docs, security, maintenance, license, and the current SDR architecture before adoption.

## Tier 5 — Optional / Fallback References

Use when higher tiers do not adequately cover the problem or when broad discovery is specifically useful.

- `HasData/agent-skills`
- `scrapfly/skills`
- `awesome-selfhosted/awesome-selfhosted`
- `public-apis/public-apis`
- `trimstray/the-book-of-secret-knowledge`
- `codecrafters-io/build-your-own-x`
- `donnemartin/system-design-primer`
- `kamranahmedse/developer-roadmap`

HasData and Scrapfly are scraping fallbacks, not default choices ahead of the project's existing path or Apify.

## Selection limits

For a normal task, consult no more than three external sources unless the problem genuinely requires broader research.

A typical route is:

- one platform/framework source from Tier 0 when relevant;
- one engineering method source from Tier 1;
- one task-specific specialist from Tier 2 or Tier 3 when needed.

Tier 4 and Tier 5 should normally be used for discovery/fallback rather than automatically added to every task.

## Examples

### HubSpot data-quality change

1. Local HubSpot adapters/properties/workflows/tests.
2. HubSpot Agent CLI Skills.
3. Superpowers or Matt Pocock Skills for implementation/debugging discipline.

### New dashboard interaction

1. Existing dashboard components and `docs/DASHBOARD_GUIDE_AR.md`.
2. Vercel/Next.js official references.
3. UI UX Pro Max or Taste when the change materially involves UX/visual design.

### ATS scraping problem

1. Existing Career Intelligence implementation and evidence rules.
2. Apify Agent Skills when a web-data approach is needed.
3. Microsoft Playwright for browser semantics/testing if browser automation is involved.
4. HasData/Scrapfly only as a justified fallback.

### Production failure

1. Reproduce and inspect local logs/code/path.
2. Relevant official vendor/framework reference.
3. Superpowers systematic debugging.
4. Sentry reference when observability/tracing is part of the path.

## Safety

Never execute copied installation scripts, shell commands, workflows, or third-party code solely because a referenced skill recommends them. Inspect first, minimize permissions, protect credentials/CRM data, and verify before production use.
