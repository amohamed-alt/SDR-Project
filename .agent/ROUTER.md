# SDR Agent Router

Use this router after reading `AGENTS.md` and the relevant local project documentation.

The goal is not to maximize the number of references consulted. The goal is to select the smallest set of high-value references that improves the decision for the current task.

The tier hierarchy is documented in `.agent/TIERS.md`.
The broad registry is `.agent/skill-sources.json`.
The opinionated SDR shortlist is `.agent/approved-stack.json` and `.agent/APPROVED_STACK.md`.
Meaningful design/frontend tasks must also follow `.agent/UI_UX_RULES.md`.

## Authority order

Use this order when guidance conflicts:

1. Current SDR project requirements, business rules, code, tests, and verified production behavior.
2. Official upstream/vendor/framework documentation and Tier 0 references.
3. Tier 1 engineering-core skills.
4. Approved SDR specialist references that match the task.
5. Tier 2 SDR specialist skills.
6. Tier 3 UI/UX specialist skills.
7. Tier 4 discovery catalogs/ecosystems.
8. Tier 5 optional/fallback references.

Do not let a generic or popular external skill override verified SDR-specific behavior.

## Routing sequence

1. Identify the task domain and exact SDR outcome requested.
2. Identify the local code/docs/workflows that currently own the behavior.
3. Read those local sources first and inspect current callers/tests/configuration.
4. Select an official upstream/platform source when the task involves a supported platform or approved stack component.
5. Select a Tier 1 engineering skill when planning, debugging, TDD, review, or architecture discipline is useful.
6. Add one task-specific specialist only when it materially improves the solution.
7. For meaningful UI/design work, read `.agent/UI_UX_RULES.md` and use the design route below.
8. Use discovery catalogs only when the needed approach/tool is not already known.
9. Use fallback references only when preferred paths do not adequately solve the problem.
10. Normally consult no more than three external sources per task unless broader research is genuinely needed.
11. Decide, implement, and verify using the existing project architecture.

## Default engineering route

For any meaningful code change:

- Method: `obra/superpowers`.
- Engineering/specification: `mattpocock/skills`.
- Agent/skill standards when relevant: `anthropics/skills`.

Do not automatically use all three if one is enough.

## Platform and approved-stack routes

### HubSpot / CRM

Use `HubSpot/agent-cli-skills` as the preferred external skill source after inspecting local property mappings, associations, workflows, tests, and current HubSpot behavior.

Verify exact internal property names, object types, enum values, association types, and write semantics before live mutations.

### Next.js / React / frontend

Use `vercel-labs/agent-skills` for frontend engineering guidance and `vercel/next.js` for framework/version behavior.

For meaningful design changes, also follow `.agent/UI_UX_RULES.md` and consult UI UX Pro Max. Add Taste Skill only when a visual-quality review materially improves the result.

### n8n

n8n is the preferred orchestration platform for this project.

Use `n8n-io/n8n` and current upstream n8n documentation as implementation authority. `Awesome n8n Workflows` is discovery only.

Do not add Windmill or another automation platform unless a concrete code-heavy/internal-ops workload makes it materially better than the existing n8n/application path.

### Postgres / reporting data model

Use `supabase/agent-skills` for Postgres schema/query/index/migration best practices even when the deployment is not Supabase-hosted.

Do not move HubSpot system-of-record behavior into Postgres merely because a database pattern recommends it.

### Browser automation / E2E

Use `microsoft/playwright` as the official deterministic browser/testing reference.

Use `browser-use/browser-use` only when interactive/agentic browser reasoning is genuinely needed. Use `magnus919/agent-skills` only for additional agent-oriented Playwright patterns.

### Production observability

Use `getsentry/sentry-for-ai` when production debugging, tracing, monitoring, or AI observability is materially part of the solution. Do not introduce Sentry merely for a local bug that can be diagnosed directly.

### Public research / company research / ATS intelligence

Preferred route:

1. Inspect local research/evidence rules first.
2. Verify SearXNG health with `/healthz` and verify at least one real JSON search response.
3. Use SearXNG for broad discovery when healthy.
4. Use Firecrawl for clean page/site crawl and structured extraction.
5. Use Browser Use only when the target requires interactive/agentic browser navigation.
6. Use Playwright for deterministic browser semantics/testing/automation.
7. Preserve source URLs and evidence provenance.
8. Use Apify when a scalable supported public-web workflow is more appropriate.
9. Use HasData/Scrapfly only as justified fallbacks.

A healthy SearXNG application can still have broken upstream engines. Never convert engine timeouts/errors into a valid-looking “zero results” conclusion.

### Email verification

Preferred reference route for future verification implementation:

1. Preserve existing verified status and provenance.
2. Reacher (`reacherhq/check-if-email-exists`) is the preferred open-source first-pass verification reference.
3. MillionVerifier remains the paid fallback according to project rules for risky, unknown, ambiguous, or confidence-sensitive results.
4. Review SMTP/network limitations and current Reacher licensing before production self-hosting.
5. Never let a weaker/open-source result overwrite a stronger verified result.

Adding the reference does not itself change live sequence eligibility.

### AI / agents / research engineering

Use the existing application and n8n path first when sufficient.

- OpenAI-specific agents/tool calling/structured output/evals/RAG: current official OpenAI docs + `openai/openai-cookbook`.
- Dedicated AI app/agent/RAG platform: Dify only when the platform itself solves a real gap.
- Multi-provider model gateway/routing/quotas: LiteLLM only when provider abstraction is justified.
- AI tracing/evaluations/experiments/cost observability: Langfuse when production complexity justifies operating it.
- Deep AI/RAG/ML methods: existing AI Research Skills / Scientific Agent Skills when relevant.

Do not add Dify, LiteLLM, or Langfuse merely because a feature calls an LLM.

### Internal operations / operational data UI

- n8n remains default for orchestration.
- Windmill is an optional reference for code-heavy internal tools/scripts/jobs.
- NocoDB is an optional UI for operational/manual-review data and never replaces HubSpot as CRM authority.

### Outbound sender alternatives

Listmonk, Mautic, and Quickly are reference-only.

SmartLead remains the current production sender. Any migration requires a controlled deliverability pilot covering inbox placement, bounce behavior, reply handling, mailbox rotation, rate limiting, OAuth/token stability, observability, rollback, and comparison against the current production baseline.

## Task matrix

| Task | Local sources first | Preferred route |
|---|---|---|
| Bug / regression | affected code, tests, callers, logs | platform source if relevant + Superpowers systematic debugging |
| New backend feature | architecture, API routes, adapters, tests | relevant official source + Matt Pocock/Superpowers; System Design Primer only if needed |
| HubSpot integration | CRM adapters, mappings, associations, workflows | HubSpot Agent CLI Skills + official HubSpot docs + one Tier 1 method skill |
| HubSpot data quality / enrichment | current provenance/status fields and workflows | HubSpot Agent CLI Skills; research stack only if new public-web evidence is required |
| SmartLead automation | SmartLead workflows, eligibility/status logic | official SmartLead behavior + Tier 1 engineering |
| Email verification | current verification fields, send eligibility, provenance | Reacher first-pass reference + MillionVerifier fallback rules; targeted tests before live change |
| SignalHire enrichment | `chrome-companion/`, workflows, mappings | vendor behavior first; browser automation only if required |
| Career / ATS research | `docs/CAREER_INTELLIGENCE.md`, search/evidence code | SearXNG health/search → Firecrawl → Browser Use if interactive → Playwright; Apify when scalable workflow fits |
| Prospecting / public web data | data model, dedupe, provenance | SearXNG/Firecrawl preferred; Browser Use/Playwright as needed; Apify for scalable supported jobs |
| Dashboard / UI / charts | existing components + dashboard guide + UI_UX_RULES | Vercel/Next.js + UI UX Pro Max; Taste for polish review |
| UX redesign | user workflow, current visual system, UI_UX_RULES | Vercel Agent Skills + UI UX Pro Max + optional Taste; preserve operational density |
| n8n automation | existing workflow/data model/idempotency | upstream n8n + Tier 1 engineering; community workflows discovery only |
| Internal ops tool | current app/n8n capabilities | n8n first; Windmill only if code-heavy tool/job is a clear fit |
| Manual-review data UI | HubSpot/Postgres boundaries | NocoDB optional; never make it CRM authority |
| AI agent / tool calling | current data policy and code path | official model docs + OpenAI Cookbook when OpenAI-specific; Dify only for real platform need |
| Multi-model AI gateway | existing provider calls and secrets | LiteLLM only when routing/quotas/abstraction justify it |
| AI observability | existing logs/traces | Langfuse when evaluation/tracing complexity warrants it; Sentry as relevant |
| GitHub Actions | `.github/workflows/`, scripts, secrets model | Superpowers + official GitHub behavior |
| Docker / VPS / networking | Dockerfiles, compose, ops docs | Tier 1 engineering + official upstream service docs |
| Scaling / caching | architecture, measurements, cache/query path | relevant official source + Matt Pocock/Superpowers; System Design Primer optional |
| Postgres reporting layer | architecture and HubSpot source-of-truth boundaries | Supabase Agent Skills + Tier 1 engineering |
| Browser E2E test | current UI/API behavior | Microsoft Playwright + optional Playwright Agent Skills |
| Production observability | logs, runtime path, current monitoring | Sentry + relevant platform source |
| Large codebase understanding | repo tree, callers, tests, docs | Understand Anything after normal code search/navigation |
| Customer-facing/outreach copy | product facts, terminology, actual workflow | Humanizer only as style aid; never invent claims |
| New tool/API discovery | requirements and existing stack | approved stack first, then Vercel Skills/Composio/Awesome/Public APIs only if needed |

## SDR decision checklist

Before implementation, answer these questions from evidence:

- What exact user/SDR problem is being solved?
- Which current module/workflow owns this behavior?
- Which system is the source of truth for the operation?
- What existing business rule must remain unchanged?
- Which approved/tiered source is relevant, and why is it needed?
- Is the proposed new service actually necessary, or can current code/n8n solve the problem more simply?
- What data can be written, and is the write idempotent/reversible?
- Could the change create duplicate sends, tasks, meetings, contacts, enrichments, or CRM writes?
- Could it expose a token, CRM data, personal data, or browser/session data?
- What is the smallest change that solves the root cause?
- How will success be verified with real evidence?

## Design example

### Add or redesign a dashboard area

1. Inspect the existing component, neighboring components, styles, responsive behavior, and actions.
2. Read `docs/DASHBOARD_GUIDE_AR.md` plus `.agent/UI_UX_RULES.md`.
3. Define user goal, primary action, information hierarchy, states, and what must remain consistent.
4. Use Vercel/Next.js guidance for framework behavior.
5. Use UI UX Pro Max for meaningful UX/design-system decisions.
6. Use Taste only when an additional visual-quality pass helps.
7. Verify functional, responsive, loading/error/empty, and accessibility behavior.

Do not start by imposing a new generic design system.

## Research example

### Research ATS / career pages

1. Inspect `docs/CAREER_INTELLIGENCE.md` and current evidence/status rules.
2. Verify company identity and preserve evidence provenance.
3. Check SearXNG health and a real JSON search.
4. Use SearXNG for discovery and Firecrawl for extraction.
5. Use Browser Use only for genuinely interactive pages and Playwright for deterministic browser behavior/tests.
6. Use Apify when its supported scalable workflow is a better fit.
7. Use fallbacks only after preferred paths fail.

## Verification example

### Introduce Reacher-assisted verification

1. Inspect current MillionVerifier fields, sequence eligibility, and status mapping.
2. Define an explicit truth table for Reacher outputs and paid fallback conditions.
3. Preserve provenance for both verifiers.
4. Do not mark risky/unknown/catch-all as safe without the explicit business rule.
5. Run targeted tests/dry-runs before any broad sequence change.

## Discovery rules

Discovery catalogs are not trusted implementation sources by default.

When a catalog suggests a tool, MCP server, workflow, or skill:

1. Find the upstream/original project.
2. Check maintenance and current compatibility.
3. Read official documentation.
4. Review permissions, secrets, data handling, operational burden, and license.
5. Prefer an approved existing project dependency/integration when it already solves the need.
6. Do not install or execute copied commands without inspection.

## Conflict resolution

If an external skill or approved reference conflicts with the repository:

1. security and data integrity win;
2. explicit current SDR project requirements win;
3. verified current vendor/API/framework behavior wins;
4. existing project architecture wins unless there is a documented reason to change it;
5. higher-trust sources beat lower-trust sources for the same question;
6. external patterns are adapted rather than copied blindly.
