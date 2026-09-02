# SDR Command Center

A production HubSpot SDR command center for performance reporting, CRM data quality, account intelligence, prospecting, calls, meetings, tasks, Google Calendar scheduling, SignalHire enrichment, MillionVerifier verification context, and SDR-attributed pipeline.

HubSpot is the CRM system of record. The production application is a Next.js service backed by a small dashboard-cache API and Postgres, with Maqsam sync as the only dedicated worker in this repository.

## Production stack

The canonical runtime is `docker-compose.yml` only:

- `sdr-dashboard` — Next.js application
- `dashboard-cache-api` — bounded dashboard cache service
- `postgres` — persistent reporting/runtime store
- `maqsam-sync` — lightweight Maqsam synchronization worker using the same SDR image
- `runtime-bootstrap` — one-shot runtime environment/data migration guard

Persistent data lives in named Docker volumes and must not be deleted during deploys or routine cleanup.

The dashboard is exposed **only through Traefik** on the shared external `n8n_default` network. The application container does not publish a host port. Traefik owns TLS, routing, compression, and upstream health checks for `sdr.dashboardtalentera.tech`.

## Active integrations

- HubSpot
- Google Calendar
- Maqsam
- SignalHire
- MillionVerifier
- Apollo where configured
- Tavily / Gemini / OpenRouter where configured for bounded research and AI features

Cancelled outbound vendors are intentionally absent from application code, production Compose, deployment environment generation, runtime environment loading, tests, and UI.

## What it measures

- SDR portfolio and contacts
- source and attribution fields
- calls, connection rate, daily activity, and outcomes
- tasks due/completed/open/overdue
- deduplicated meetings and booking attribution
- HubSpot sales-email engagement
- contact/company data quality and enrichment context
- ATS / recruiting-system context already stored in HubSpot
- SDR-attributed deals, pipeline, and conversion

See `docs/METRICS.md`, `docs/ARCHITECTURE.md`, and `docs/DASHBOARD_GUIDE_AR.md` for feature details.

## Security

- Private tokens remain server-side.
- Google refresh tokens are encrypted and persisted in the application data volume.
- CRM/API secrets must never be committed or printed by workflows.
- Runtime bootstrap sanitizes retired vendor keys without printing the environment file.
- Production data volumes are preserved across image rebuilds.

## Local development

```bash
cp .env.example .env.local
npm ci
npm run dev
```

The environment template defaults to safe demo data where supported.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Pull requests run the full quality/integration suite. Main-branch CI runs only for production-relevant code/config changes and is intentionally smaller so deployments are not delayed by duplicate heavyweight checks.

## Production deployment

Production deployment is owned by `.github/workflows/deploy-hostinger.yml` after a successful main-branch CI run. Do not use ad-hoc `docker compose down`, host-port recovery overlays, or no-cache manual rebuild scripts as a normal deployment path.

For local Compose validation only:

```bash
docker compose -f docker-compose.yml config
```

Production flow:

1. CI validates the exact main revision.
2. The deploy workflow rejects stale candidates and overlapping Hostinger Compose mutations.
3. Hostinger deploys the canonical `docker-compose.yml`.
4. The workflow waits for the exact commit SHA to appear at `/api/health` and verifies the public route/admin state.
5. Traefik remains the single public ingress.

## Scaling path

For higher reporting volume, prefer incremental HubSpot extraction through the existing orchestration layer and materialized Postgres views rather than repeated full CRM scans. HubSpot remains authoritative and drill-downs should link back to original HubSpot records.
