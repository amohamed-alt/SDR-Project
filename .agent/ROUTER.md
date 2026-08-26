# SDR Agent Router

Use this router after reading `AGENTS.md` and the relevant local project documentation.

The goal is not to maximize the number of references consulted. The goal is to select the smallest set of high-value references that improves the decision for the current task.

The tier hierarchy is documented in `.agent/TIERS.md` and the machine-readable source registry is `.agent/skill-sources.json`.

## Authority order

Use this order when guidance conflicts:

1. Current SDR project requirements, business rules, code, tests, and verified production behavior.
2. Tier 0 official vendor/framework skills and documentation.
3. Tier 1 engineering-core skills.
4. Tier 2 SDR specialist skills.
5. Tier 3 UI/UX specialist skills.
6. Tier 4 discovery catalogs/ecosystems.
7. Tier 5 optional/fallback references.

Do not let a generic or popular external skill override verified SDR-specific behavior.

## Routing sequence

1. Identify the task domain and the exact SDR outcome requested.
2. Identify the local code/docs/workflows that currently own the behavior.
3. Read those local sources first and inspect current callers/tests/configuration.
4. Select a Tier 0 official source when the task involves a supported platform/framework.
5. Select a Tier 1 engineering skill when planning, debugging, TDD, review, or architecture discipline is useful.
6. Add one Tier 2 or Tier 3 specialist only when the task clearly matches that specialty.
7. Use Tier 4 discovery only when the needed approach/tool is not already known.
8. Use Tier 5 only as a justified fallback or broad technical reference.
9. Normally consult no more than three external sources per task.
10. Decide, implement, and verify using the existing project architecture.

## Default engineering route

For any meaningful code change:

- Method: `obra/superpowers`
- Engineering/specification: `mattpocock/skills`
- Agent/skill standards when relevant: `anthropics/skills`

Do not automatically use all three if one is enough.

## Tier 0 platform routes

### HubSpot / CRM

Use `HubSpot/agent-cli-skills` as the preferred external skill source after inspecting local property mappings, associations, workflows, tests, and current HubSpot behavior.

Verify exact internal property names, object types, enum values, association types, and write semantics before live mutations.

### Next.js / React

Use `vercel-labs/agent-skills` for frontend engineering guidance and `vercel/next.js` for framework/version behavior.

The current project stack wins over recommendations that assume another framework or version.

### Postgres / reporting data model

Use `supabase/agent-skills` for Postgres schema/query/index/migration best practices even when the deployment is not Supabase-hosted.

Do not move HubSpot system-of-record behavior into Postgres merely because a database pattern recommends it.

### Browser automation / E2E

Use `microsoft/playwright` as the official browser/testing reference. Use `magnus919/agent-skills` only for additional agent-oriented Playwright patterns.

### Observability

Use `getsentry/sentry-for-ai` when production debugging, tracing, monitoring, or AI observability is materially part of the solution. Do not introduce Sentry merely for a local bug that can be diagnosed directly.

## Task matrix

| Task | Local sources first | Preferred route |
|---|---|---|
| Bug / regression | affected code, tests, callers, logs | Tier 0 platform source if relevant + Superpowers systematic debugging |
| New backend feature | architecture, API routes, adapters, tests | relevant Tier 0 + Matt Pocock/Superpowers; System Design Primer only if needed |
| HubSpot integration | CRM adapters, property mappings, associations, workflows | HubSpot Agent CLI Skills + official HubSpot docs + one Tier 1 method skill |
| HubSpot data quality / enrichment | current provenance/status fields and workflows | HubSpot Agent CLI Skills; Apify only if new web research is actually required |
| SmartLead automation | SmartLead workflows, eligibility/status logic | official SmartLead docs + Tier 1 engineering; discovery only if an integration gap exists |
| SignalHire enrichment | `chrome-companion/`, enrichment workflows, mappings | vendor behavior first; Playwright only for browser-flow testing/automation |
| Career / ATS research | `docs/CAREER_INTELLIGENCE.md`, existing search/evidence code | Apify Agent Skills; Playwright when browser automation is required; Last 30 Days only when recency/community signal matters |
| Prospecting / public web data | current data model, dedupe and source tracking | Apify Agent Skills first; HasData/Scrapfly only as fallback |
| Dashboard / UI / charts | existing components and dashboard guide | Vercel/Next.js + UI UX Pro Max or Taste when material UX/design work is involved |
| UX redesign | dashboard workflow, user actions, current visual system | Vercel Agent Skills + UI UX Pro Max/Taste; preserve operational density |
| n8n automation | existing workflow/data model/idempotency | Tier 1 engineering + Awesome n8n Workflows for discovery, not authority |
| GitHub Actions | `.github/workflows/`, scripts, secrets model | Superpowers + official GitHub behavior; Secret Knowledge only as optional reference |
| Docker / VPS / networking | Dockerfiles, compose, ops docs | Tier 1 engineering + Secret Knowledge/Awesome Selfhosted if needed |
| Scaling / caching | architecture, measurements, cache/query path | relevant Tier 0 + Matt Pocock/Superpowers; System Design Primer as optional architecture reference |
| Postgres reporting layer | architecture and HubSpot source-of-truth boundaries | Supabase Agent Skills + Tier 1 engineering |
| Browser E2E test | current UI/API behavior | Microsoft Playwright + Playwright Agent Skills when useful |
| Production observability | logs, runtime path, current monitoring | Sentry for AI + relevant platform source |
| AI/RAG/ML feature | data policy, project boundary, current architecture | AI Research Skills; Scientific Agent Skills only when the task requires deeper analytical methods |
| Large codebase understanding | repo tree, callers, tests, docs | Understand Anything after normal code search/navigation |
| Presentation generation | requested content/source data | Frontend Slides |
| Customer-facing/outreach copy | product facts, SDR terminology, actual workflow | Humanizer only as a style aid; never invent claims |
| New tool/API discovery | requirements and existing stack | Vercel Skills Ecosystem, Composio, Awesome catalogs, Public APIs |
| New self-hosted service | VPS architecture, threat model, maintenance burden | Awesome Selfhosted + Secret Knowledge; validate official project docs before adoption |
| New MCP/tool connector | exact integration requirement and security | Awesome MCP Servers/Composio for discovery; verify selected server/tool independently |

## SDR decision checklist

Before implementation, answer these questions from evidence:

- What exact user/SDR problem is being solved?
- Which current module/workflow owns this behavior?
- Is HubSpot, SmartLead, SignalHire, Calendar, GitHub Actions, n8n, or another system the source of truth for this operation?
- What existing business rule must remain unchanged?
- Which tier/source is relevant, and why is it needed?
- What data can be written, and is the write idempotent/reversible?
- Could the change create duplicate sends, tasks, meetings, contacts, enrichments, or CRM writes?
- Could it expose a token, CRM data, personal data, or browser/session data?
- What is the smallest change that solves the root cause?
- How will success be verified?

## Skill selection examples

### Dashboard card is wrong

Route:

1. `docs/METRICS.md`.
2. Relevant aggregation/API code and test.
3. Vercel/Next.js only if framework behavior is relevant.
4. Superpowers systematic debugging.

Do not start with UI redesign.

### Add a new HubSpot property workflow

Route:

1. Inspect current property mappings, object ownership, associations, and workflow code.
2. Read HubSpot Agent CLI Skills and official HubSpot behavior.
3. Verify the exact internal property name and valid values.
4. Use a Tier 1 implementation/review pattern if the change is meaningful.
5. Test a safe target before any broad write.

### Add WhatsApp action

Route:

1. Inspect contact phone/mobile normalization and dashboard action patterns.
2. Inspect security and browser behavior.
3. Use Vercel/Next.js for the UI/framework path if relevant.
4. Use integration/discovery catalogs only if a new provider/tool is actually needed.
5. Test both phone fields, missing-number behavior, normalization, and URL encoding.

### Speed up HubSpot dashboard

Route:

1. Measure existing request/caching/query fan-out.
2. Read `docs/ARCHITECTURE.md` and `docs/FAST_DASHBOARD_ARCHITECTURE.md`.
3. Use relevant Vercel/Next.js guidance for server/cache behavior.
4. Use Supabase Postgres skills only if the measured solution involves the reporting database path.
5. Use System Design Primer only as a supporting architecture reference.

### Research ATS / career pages

Route:

1. Inspect `docs/CAREER_INTELLIGENCE.md` and existing evidence/status rules.
2. Keep company identity and evidence provenance explicit.
3. Use Apify Agent Skills when scalable public-web extraction is appropriate.
4. Use Microsoft Playwright for browser semantics/testing when browser automation is required.
5. Use HasData/Scrapfly only if the preferred path cannot reliably extract the needed public data.

### Production failure

Route:

1. Reproduce or trace the failure through the actual local path.
2. Inspect logs, code, recent changes, config, and dependencies.
3. Read the relevant Tier 0 platform/framework source.
4. Apply Superpowers systematic debugging.
5. Use Sentry guidance only when observability/tracing materially helps diagnosis or prevention.

## Discovery rules

Tier 4 catalogs are not trusted implementation sources by default.

When a discovery catalog suggests a tool, MCP server, workflow, or skill:

1. Find the upstream/original project.
2. Check maintenance and current compatibility.
3. Read official documentation.
4. Review permissions, secrets, data handling, and license.
5. Prefer an existing project dependency/integration when it already solves the need.
6. Do not install or execute copied commands without inspection.

## Fallback rules

Tier 5 exists to solve gaps, not to compete with the normal route.

Examples:

- Apify preferred for a supported scraping/data workflow; HasData/Scrapfly are fallbacks.
- Existing VPS services preferred over adding another self-hosted product just because it appears in Awesome Selfhosted.
- Current architecture and measured bottlenecks preferred over generic System Design patterns.

## Conflict resolution

If an external skill conflicts with the repository:

1. security and data integrity win;
2. explicit current SDR project requirements win;
3. verified current vendor/API/framework behavior wins;
4. existing project architecture wins unless there is a documented reason to change it;
5. higher-trust tiers beat lower-trust tiers for the same question;
6. external patterns are adapted rather than copied blindly.
