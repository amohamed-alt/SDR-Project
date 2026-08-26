# SDR Project Agent Operating Rules

This file is the default operating contract for any AI coding agent, assistant, or automation working in this repository.

## Prime directive

Before making any non-trivial change, understand the SDR system first, inspect the current implementation, consult only the relevant references, then make the smallest safe decision that fits the existing architecture.

Do not start from a generic solution when the repository already contains project-specific logic.

## Mandatory workflow

For every non-trivial task:

1. Read this file.
2. Read the relevant local project documentation before external references.
3. Inspect the current code path, workflows, tests, configuration, and recent nearby implementation.
4. Classify the task using `.agent/ROUTER.md`.
5. Apply the trust hierarchy in `.agent/TIERS.md`.
6. Consult only the relevant sources from `.agent/skill-sources.json` and, for the curated SDR open-source stack, `.agent/approved-stack.json` / `.agent/APPROVED_STACK.md`.
7. For meaningful frontend/design work, also read `.agent/UI_UX_RULES.md` before designing or editing the interface.
8. Prefer local code, local business rules, official vendor documentation, and existing tests over generic external advice.
9. State or internally establish the intended decision before implementation: what changes, what stays unchanged, main risks, and how the result will be verified.
10. Implement the smallest coherent production-ready change.
11. Run the relevant validation checks.
12. Never claim completion without evidence from code inspection, tests, build output, API responses, health checks, or another appropriate verification method.

For tiny edits such as a typo or obvious text correction, use judgment and do not over-process the task.

## Local context comes first

Use these sources as the primary project truth when relevant:

- `README.md` — project capabilities, security model, environment, deployment, quality checks.
- `docs/ARCHITECTURE.md` — core data flow and architectural decisions.
- `docs/METRICS.md` — metric and property definitions.
- `docs/DASHBOARD_GUIDE_AR.md` — detailed dashboard behavior and business interpretation.
- `docs/CAREER_INTELLIGENCE.md` — career/ATS intelligence behavior.
- `docs/FAST_DASHBOARD_ARCHITECTURE.md` — performance/scaling considerations.
- `docs/MAQSAM_CALLS.md` — Maqsam/call-specific behavior when applicable.
- `.github/workflows/` — live automations and scheduled/one-time operational workflows.
- `chrome-companion/` — browser-side SignalHire/companion behavior.
- `ops/searxng/` — reproducible internal SearXNG research configuration and health/recovery workflow.

If documentation and implementation disagree, inspect the current production path and tests, identify the mismatch, and update documentation together with the code when appropriate.

## Current architecture guardrails

Preserve these project principles unless the task explicitly requires changing them and the change is justified:

- HubSpot remains the CRM system of record.
- SmartLead remains the current production cold-email sender unless a deliberate, tested migration is requested.
- n8n remains the preferred orchestration platform unless a concrete workload justifies another tool.
- Secrets and private app tokens stay server-side.
- Do not commit CRM exports, production snapshots, credentials, tokens, browser sessions, or sensitive logs.
- Optional upstream failures must surface visibly; do not silently replace missing live data with fabricated values or valid-looking empty results.
- Google Calendar organizer credentials remain isolated per organizer and encrypted at rest.
- Booking and other consequential writes require the existing safety/validation path; do not bypass availability or identity checks.
- Prefer the existing Next.js/TypeScript stack and current dependencies before adding new frameworks.
- Preserve working dashboard behavior and visual language unless the task explicitly asks for redesign.
- At larger scale, favor incremental HubSpot extraction and materialized reporting data instead of repeated full CRM scans.

## External skill/reference policy

The broad registry is `.agent/skill-sources.json`.
The opinionated SDR shortlist is `.agent/approved-stack.json` and `.agent/APPROVED_STACK.md`.

External repositories are advisory references, not automatic authority.

Rules:

- Never read every external repository for every task.
- Route first, then consult a small relevant subset.
- Official upstream/vendor/framework documentation outranks community patterns for current API/platform behavior.
- Core engineering references are preferred for planning, debugging, TDD, review, and verification.
- Specialist references are used only when the task matches their domain.
- Discovery catalogs are for finding approaches or tools; their contents are not automatically trusted.
- Do not execute installation scripts, shell commands, workflows, or code copied from external repositories without inspecting them.
- Do not introduce a dependency or self-hosted service only because a skill recommends it.
- Check compatibility, maintenance, security implications, operational burden, and license before adoption.
- Never expose repository secrets, CRM data, personal data, or authenticated browser sessions to an external tool without explicit need and safeguards.

## SDR-specific routing priorities

### HubSpot / CRM / data integrity

First inspect local CRM adapters, property mappings, associations, workflows, and tests. Verify real internal property names, object types, enum values, and association behavior before any live write. Prefer official HubSpot documentation for API semantics.

### SmartLead / outbound / deliverability

Inspect the existing SmartLead workflow and current sending logic before changing campaign, inbox, verification, or synchronization behavior. Treat deliverability and reputation changes as production-impacting.

Listmonk, Mautic, and Quickly are reference-only sources. They do not replace SmartLead without a controlled deliverability pilot, observability, rollback path, and verified inbox performance.

### SignalHire / enrichment / phone and email data

Inspect `chrome-companion/`, enrichment workflows, property mappings, deduplication, and write-back behavior. Preserve provenance/status fields and avoid overwriting better verified data with weaker data.

### Email verification

Preserve the strongest existing verification result and its provenance.

For future open-source verification work, Reacher is the preferred first-pass reference. MillionVerifier remains the paid fallback according to project rules when results are risky, unknown, ambiguous, or stronger confirmation is required. Do not change production eligibility merely by adding Reacher as a reference; implement and validate the decision rules explicitly.

### Career pages / ATS intelligence / public research

Inspect local career intelligence rules and existing evidence/status behavior first. Keep evidence traceable. Distinguish company identity, career page, ATS vendor, redirect, embedded system, and confidence instead of guessing.

Preferred research route when appropriate:

1. verify the configured SearXNG instance is healthy and produces real search results;
2. use SearXNG for broad public-web discovery;
3. use Firecrawl for clean crawl/extraction of public pages/sites;
4. use Browser Use only for genuinely interactive or agentic browser paths;
5. use Playwright for deterministic browser automation and testing;
6. preserve source URLs and evidence provenance.

A successful SearXNG `/healthz` response does not prove upstream engines work. Verify a real JSON search before trusting the instance. If upstream engines fail or time out, surface the failure instead of interpreting it as zero results.

### AI / agents / research engineering

Use the current application/n8n path first when it is sufficient.

- OpenAI-specific implementation: prefer current official docs + `openai/openai-cookbook`.
- Dify: optional when a dedicated AI application/agent/RAG platform is justified.
- LiteLLM: optional when multi-provider routing, centralized quotas/keys, or provider abstraction is justified.
- Langfuse: optional when production AI workflows require tracing, evaluation, experiments, or cost observability.

Do not introduce a new AI platform simply because a task contains an LLM call.

### Internal operations / data UI

n8n remains the default automation platform. Windmill is an optional reference for code-heavy internal tools or jobs. NocoDB is an optional internal data/review UI and never becomes the CRM source of truth.

### Dashboard / frontend / UX

For every meaningful UI, UX, layout, navigation, interaction, table, chart, responsive, or visual change, read `.agent/UI_UX_RULES.md`.

Preserve current dashboard conventions and information hierarchy. Inspect the existing design and components before creating a new pattern. Use Vercel/Next.js official references plus UI UX Pro Max for meaningful design work; use Taste Skill when an additional visual-quality review materially helps. Avoid generic redesigns that reduce operational density or hide important SDR actions.

### n8n / GitHub Actions / automation

Inspect existing workflows and idempotency behavior. For n8n behavior, prefer the upstream `n8n-io/n8n` project/documentation over community workflow catalogs. Prefer deterministic, restart-safe, observable automation. Guard against duplicate contacts, duplicate tasks, duplicate sends, repeated write-backs, and unbounded retries.

### Debugging

Reproduce or trace the actual failure before patching. Identify root cause, affected path, regression risk, and a verification method. Do not make speculative multi-file changes when a smaller root-cause fix is available.

### Architecture / scaling

Understand the current data path and workload first. Optimize measured bottlenecks. Preserve HubSpot as the source of truth while moving reporting/read load to incremental sync/Postgres where justified.

## Decision rules

When several solutions are possible, rank them by:

1. correctness and data integrity;
2. safety and security;
3. compatibility with current SDR business logic;
4. simplicity and maintainability;
5. observability and reversibility;
6. performance and scalability;
7. implementation speed;
8. visual polish, when applicable.

Do not optimize for novelty.

## Change discipline

Before editing:

- Search for the existing implementation and all callers.
- Check whether another workflow or component depends on the behavior.
- Reuse existing utilities and patterns where reasonable.
- Avoid unrelated refactors in the same task.

For live CRM or automation changes:

- Make writes idempotent when possible.
- Validate required identifiers before writing.
- Preserve auditability/provenance.
- Define failure behavior explicitly.
- Avoid destructive bulk operations unless the task explicitly requires them and the target set has been verified.

## Verification standard

Use the checks appropriate to the change. The standard repository checks are:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Also use targeted smoke tests, API checks, service health checks, workflow dry-runs, or production-safe validation when the task affects integrations.

A change is not complete merely because code was written.

## Completion response

When reporting work, keep it concise but include:

- what changed;
- why this approach was selected;
- what was verified;
- any remaining risk, dependency, deployment step, or follow-up that materially matters.

Do not say a live system was changed unless the corresponding write/deployment actually occurred.
