# SDR Project Context

`SDR-Project` is a HubSpot-centered SDR command center for reporting, CRM data quality, prospecting, enrichment, calls, meetings, tasks, scheduling, account intelligence, and operational automation.

## Current systems

- Next.js + React + TypeScript application.
- HubSpot for contacts, companies, deals, owners, calls, meetings, tasks, emails, and associations.
- Google Calendar OAuth and meeting booking.
- SignalHire browser/enrichment tooling.
- MillionVerifier verification context.
- Maqsam call ingestion/synchronization.
- Postgres + dashboard-cache service for persistent runtime/reporting support.
- GitHub Actions for CI, production deployment, monitoring, and the small number of active scheduled jobs.
- Traefik as the single production ingress for the SDR dashboard.

There is currently **no production cold-email sender integration in this repository**. Cancelled outreach vendors must not be reintroduced from stale docs, environment variables, old workflows, or copied legacy code without a new explicit requirement.

## Production layout

- Canonical Compose: `docker-compose.yml` only.
- Public host: `sdr.dashboardtalentera.tech` through Traefik on external network `n8n_default`.
- No application host-port publishing in the normal production stack.
- Persistent named volumes preserve runtime env, application data, cache data, and Postgres data.
- Deployments are performed by `.github/workflows/deploy-hostinger.yml` after successful main CI.
- Ad-hoc no-cache/manual recovery deployments are not the normal production path.

## Important local locations

- `README.md` — production overview and deployment model.
- `docs/ARCHITECTURE.md` — application/data flow.
- `docs/METRICS.md` — metric definitions.
- `docs/DASHBOARD_GUIDE_AR.md` — operational dashboard guide.
- `docs/MAQSAM_CALLS.md` — call integration behavior.
- `.github/workflows/` — active CI/production/scheduled operations only.
- `chrome-companion/` — browser-side SignalHire/prospecting companion.
- `.agent/ROUTER.md`, `.agent/TIERS.md`, `.agent/approved-stack.json` — agent reference routing.

## Architectural assumptions

- HubSpot remains system of record.
- n8n is the preferred orchestration platform when orchestration is required, but it is managed outside this application Compose stack.
- Repeated dashboard reads should prefer bounded cache/materialized reporting data over repeated full CRM scans.
- Optional sources fail visibly; missing data must not be fabricated.
- Credentials remain server-side.
- Google tokens remain encrypted and organizer-specific.
- Writes that create meetings/tasks/CRM records must be explicit, idempotent where possible, and verified.

## Research / AI defaults

Use the smallest necessary path. Firecrawl, Playwright, Browser Use, SearXNG, Reacher, Dify, LiteLLM, Langfuse, Windmill, and NocoDB are references/options, not automatically deployed services. A separately managed service must be verified healthy before relying on it; this repository does not own a SearXNG deployment.

## Data and automation safety

Before live writes consider duplicate contacts/tasks/meetings, repeated enrichment charges, stale verification, overwriting stronger data, incorrect associations, owner changes, retries, rate limits, and credential exposure.

## Quality bar

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Pull requests run the heavier integration-quality path. Main CI is production-focused so a validated change can reach deployment without duplicate heavyweight work.

Live behavior and current code outrank stale documentation. When they differ, update the documentation rather than preserving obsolete architecture.
