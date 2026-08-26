# Approved SDR Open-Source Stack

This is the opinionated shortlist of open-source projects that agents may consult for SDR work. It supplements `.agent/skill-sources.json` and is intentionally narrower.

Machine-readable registry: `.agent/approved-stack.json`.

## Operating rule

Do not add a service just because it exists here. First inspect the current SDR implementation and prove that the new component solves a real gap better than the existing stack.

HubSpot remains the CRM system of record. SmartLead remains the current production cold-email sender. n8n remains the preferred orchestration platform.

## Research and web intelligence

Preferred path:

1. **SearXNG** — self-hosted discovery/metasearch when the instance is healthy.
2. **Firecrawl** — crawl/extract public pages and sites into clean structured content.
3. **Browser Use** — agentic browser navigation only when an interactive/dynamic workflow requires reasoning.
4. **Microsoft Playwright** — deterministic browser automation, testing, selectors, and repeatable browser behavior.
5. Existing Apify skills remain a specialist option for scalable public-web workflows.

Never treat a SearXNG empty result as proof that no evidence exists until the instance and upstream engines are verified healthy.

## Email verification

Preferred decision path for future verification work:

1. Preserve any existing verified status/provenance in HubSpot.
2. Use **Reacher** as the preferred open-source first-pass reference for syntax, MX/SMTP/catch-all/disposable/role checks when self-hosting is appropriate.
3. Use **MillionVerifier** according to current business rules when a Reacher result is risky, unknown, ambiguous, or stronger paid verification is required.
4. Never overwrite a stronger verified result with a weaker result.
5. Review Reacher licensing and SMTP/network limitations before production self-hosting.

This is a routing policy, not an instruction to change the current production verification flow without a tested implementation.

## AI and agents

- **OpenAI Cookbook** — preferred official implementation reference for OpenAI agents, tool calling, structured outputs, evals, RAG, and embeddings.
- **Dify** — optional AI application/agent/RAG platform when a separate platform is genuinely useful.
- **LiteLLM** — optional gateway when multi-provider model routing, centralized quotas, or abstraction becomes useful.
- **Langfuse** — optional tracing/evaluation/observability layer for production AI workflows.
- Existing Anthropic Skills, AI Research Skills, and Scientific Agent Skills remain available through the normal tier router.

Do not introduce Dify, LiteLLM, or Langfuse merely because the task uses AI. Prefer the current application/n8n path when it is simpler.

## Automation and internal operations

- **n8n upstream** — official reference and preferred orchestration platform.
- **Windmill** — optional for code-heavy internal tools, scripts-as-jobs, and developer operations when n8n is not the best fit.
- **NocoDB** — optional internal data/review UI over operational data; never replace HubSpot as CRM authority.

## Outreach references

These are references, not approved production sender replacements:

- **Listmonk** — mailing/campaign architecture reference.
- **Mautic** — marketing automation/segmentation reference.
- **Quickly** — experimental self-hosted cold-email reference.

Any SmartLead replacement requires a controlled pilot covering inbox placement, bounce rate, reply handling, OAuth/token stability, throttling, rotation, deliverability, observability, and rollback before migration.

## UI/UX

For every meaningful design/frontend task, follow `.agent/UI_UX_RULES.md`.

The preferred design reference route is:

1. inspect the existing dashboard and current components;
2. Vercel/Next.js official references;
3. UI UX Pro Max;
4. Taste Skill for visual-quality review when useful;
5. verify responsive behavior, density, usability, and accessibility.

The goal is a stronger version of the existing SDR product, not a generic redesign.

## SearXNG

A known-good optional SearXNG deployment is stored under `ops/searxng/` because the running VPS SearXNG service was not represented in this repository.

Before using SearXNG in an SDR feature, verify both:

- `GET /healthz` returns success;
- `GET /search?q=<query>&format=json` returns a valid JSON response and usable upstream results.

If health succeeds but engines repeatedly time out, investigate outbound networking/DNS and engine errors instead of treating searches as valid empty responses.
