# SDR Agent Router

Use current code, verified production behavior, and local business rules before external references. Consult the smallest set of sources that materially improves the task.

## Authority order

1. Current SDR requirements, code, tests, and verified production behavior.
2. Official platform/vendor/framework documentation.
3. Relevant engineering/specialist references.
4. Discovery/fallback references only when preferred paths are insufficient.

## Core project routes

### HubSpot / CRM
HubSpot is the system of record. Verify internal property names, associations, object types, enum values, and write semantics before mutations. Protect against duplicate contacts, tasks, meetings, enrichments, and owner changes.

### Next.js / React
Inspect the existing UI/data path first. Use current Next.js/Vercel behavior as framework authority. Follow `.agent/UI_UX_RULES.md` for meaningful UI changes.

### n8n
n8n is the preferred orchestration platform when orchestration is needed. It is managed outside the SDR application Compose stack. Do not add another automation platform unless it solves a concrete gap materially better.

### Docker / VPS / Traefik
The canonical production definition is `docker-compose.yml`. The public dashboard is routed only through Traefik on external network `n8n_default`. Do not add host-port recovery routes, duplicate Compose files, or ad-hoc no-cache deploy paths as normal architecture. Persistent volumes are never routine cleanup targets.

### Production deployment
`.github/workflows/deploy-hostinger.yml` is the production deployment path after main CI. Reject stale deploy candidates, avoid overlapping Hostinger Compose mutations, and verify the exact `buildRef` publicly before declaring success.

### Public research / ATS intelligence
Use evidence-preserving public research paths. Firecrawl is preferred for extraction, Playwright for deterministic browser work, and Browser Use only when interactive reasoning is necessary. A separately managed SearXNG instance may be used only after health and real search behavior are verified; this repository does not own a SearXNG deployment.

### Email verification / enrichment
Preserve provenance and stronger existing data. MillionVerifier is the configured paid verification service where project rules require it. Reacher is an optional reference. SignalHire remains an enrichment source. Verification/enrichment must not silently become an outbound sending engine.

### Outbound sending
There is currently **no production cold-email sender integration in SDR-Project**. Retired outbound vendors must not be reintroduced from old code, environment keys, documentation, or historical workflows. A future sender requires an explicit current requirement plus controlled deliverability, bounce/reply, throttling, mailbox-rotation, observability, and rollback validation.

### AI / agents
Prefer the existing application and orchestration path. OpenAI Cookbook, LiteLLM, Langfuse, Dify, and other platforms are references/options only when the additional platform solves a real gap.

## Task matrix

| Task | Local sources first | Preferred route |
|---|---|---|
| Bug/regression | affected code, tests, logs | official platform docs + targeted debugging |
| HubSpot integration | CRM adapters/mappings/associations | HubSpot docs + project business rules |
| Data quality/enrichment | provenance/status fields | SignalHire/MillionVerifier rules + targeted tests |
| Dashboard/UI | existing components + dashboard guide | Next.js/Vercel + UI rules |
| n8n automation | existing workflow/data model | upstream n8n + idempotency checks |
| Docker/VPS/networking | Compose/Dockerfile/workflows | canonical Compose + Traefik + health verification |
| GitHub Actions | active workflows + deployment model | minimize duplicated work and stale runs |
| Career/ATS research | current evidence rules | Firecrawl/Playwright/Browser Use as needed |
| New sender/outreach | explicit new requirements only | controlled pilot; never revive retired code by default |

## Decision checklist

Before implementation establish:

- exact user/business outcome;
- current owning module/workflow;
- source of truth;
- write/retry/idempotency risks;
- secret/data exposure risks;
- whether an existing component already solves the need;
- smallest maintainable change;
- live verification method.

If external guidance conflicts with verified project behavior, current security/data integrity and explicit SDR requirements win.
