# Approved SDR Open-Source Stack

This is the opinionated shortlist of references agents may consult for SDR work. It is a reference layer, not an instruction to install services.

## Operating rules

- HubSpot is the CRM system of record.
- n8n is the preferred orchestration platform when orchestration is required.
- The SDR repository currently has **no production cold-email sender integration**. Do not recreate a retired sender or add a replacement without an explicit current requirement and a controlled deliverability plan.
- Prefer the existing application before adding another platform.
- Never add a service just because it appears in this document.

## Research and web intelligence

Preferred references when a feature genuinely needs them:

1. Firecrawl for clean public-page/site extraction.
2. Microsoft Playwright for deterministic browser automation and tests.
3. Browser Use only for genuinely interactive agentic navigation.
4. SearXNG may be considered as an external/self-hosted discovery reference when a separately managed instance is verified healthy; no SearXNG deployment is owned by this repository.
5. Existing Apify capabilities remain a specialist option for supported scalable public-web workflows.

Always preserve evidence URLs and provenance.

## Email verification

1. Preserve stronger existing verification/provenance in HubSpot.
2. Reacher is an optional open-source first-pass reference when self-hosting is justified.
3. MillionVerifier remains the configured paid verification service where project rules require it.
4. Review SMTP/network limitations and licensing before introducing self-hosted verification.

Verification logic must not silently become an outbound-send engine.

## AI and agents

- OpenAI Cookbook — OpenAI implementation reference.
- Dify — optional AI application/RAG platform only when a separate platform solves a real gap.
- LiteLLM — optional multi-provider gateway when centralized routing/quotas are genuinely needed.
- Langfuse — optional tracing/evaluation layer when production AI complexity justifies it.

Prefer the current application and existing orchestration path when simpler.

## Automation and internal operations

- n8n upstream — preferred orchestration reference.
- Windmill — optional for code-heavy internal scripts/jobs when materially better than n8n/application code.
- NocoDB — optional internal data/review UI; never CRM authority.

## Outbound references

Listmonk, Mautic, and Quickly are architecture references only. None is an approved production sender by default. Any future outbound sender requires an explicit request plus deliverability, bounce/reply handling, rate-limit, mailbox-rotation, observability, and rollback validation before production use.

## UI/UX

For meaningful design/frontend work, inspect the current product first, follow `.agent/UI_UX_RULES.md`, use official Vercel/Next.js references, then specialist design references only when they materially improve the result.
