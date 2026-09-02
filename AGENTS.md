# SDR Project Agent Operating Rules

This is the default operating contract for agents working in this repository.

## Prime directive

Understand the current SDR implementation and business rule first, make the smallest safe maintainable change, and verify the real outcome. Current code and verified production behavior outrank stale documentation.

## Mandatory workflow

For non-trivial work:

1. Read this file and `.agent/PROJECT_CONTEXT.md`.
2. Inspect the relevant code, tests, workflows, and current production path.
3. Route the task with `.agent/ROUTER.md` and use only relevant references.
4. Preserve secrets, HubSpot data integrity, idempotency, and persistent Docker data.
5. Implement one coherent production-ready change.
6. Run the relevant checks and verify live behavior when the task affects production.

## Current architecture guardrails

- HubSpot is the CRM system of record.
- There is **no production cold-email sender integration in SDR-Project**. Retired outbound vendors must not be reintroduced from historical code, environment variables, workflows, tests, or docs without a new explicit requirement and controlled production plan.
- n8n is the preferred orchestration platform when orchestration is needed, but it is managed outside the SDR application Compose stack.
- `docker-compose.yml` is the only canonical SDR production Compose definition.
- Traefik on shared network `n8n_default` is the only normal public ingress for `sdr.dashboardtalentera.tech`; do not add a host-port recovery route as standard architecture.
- `.github/workflows/deploy-hostinger.yml` is the production deploy path after main CI. Do not create parallel manual/no-cache deploy paths for normal operation.
- Named Docker volumes containing runtime env, application data, cache data, or Postgres data are not routine cleanup targets.
- Secrets stay server-side and must never be printed in workflows/logs.
- Google organizer credentials remain isolated and encrypted.
- Optional upstream failures must be visible; never fabricate missing live data.

## Active integration guidance

### HubSpot
Verify exact property names, object types, associations, enum values, owner behavior, and write semantics before mutations. Guard against duplicate contacts, tasks, meetings, enrichments, or write-backs.

### SignalHire / MillionVerifier
Preserve provenance and stronger existing data. Enrichment and verification must not silently become an outbound sending engine.

### Maqsam
Keep call sync lightweight and restart-safe. The worker reuses the SDR application image; avoid duplicate builds unless architecture genuinely changes.

### Public research / ATS
Preserve evidence URLs and company identity. Use Firecrawl/Playwright/Browser Use or other approved references only when needed. A separately managed SearXNG instance may be used only after health and real search behavior are verified; SDR-Project does not own a SearXNG deployment.

### UI / UX
Inspect the current product first and follow `.agent/UI_UX_RULES.md`. Preserve operational density and existing interaction language unless a redesign is explicitly requested.

### GitHub Actions / deploys
Keep the number of workflows small. Prefer one CI path, one production deploy path, monitoring, and only genuinely recurring operational jobs. Avoid one-off/pilot workflows remaining in main after completion. Keep stale runs from blocking current deploys and avoid duplicated heavyweight builds.

## Verification

Standard checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Use targeted API, Compose, health, workflow, and live-route checks where relevant. Passing static checks alone is not proof a production integration works.

## Completion standard

Report what changed, what was verified, and any remaining material risk. Never claim a live change happened unless the deployment/write actually succeeded.
