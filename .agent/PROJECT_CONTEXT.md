# SDR Project Context

This document gives agents a fast orientation to the repository. It supplements, but does not replace, the live code and primary docs.

## Project purpose

`SDR-Project` is a full-stack SDR command center centered on HubSpot. It combines performance reporting, contact/company intelligence, tasks, calls, meetings, email engagement, outbound operations, career/ATS intelligence, enrichment, scheduling, and workflow automation.

## Main systems in the repository

- Next.js + React + TypeScript application.
- HubSpot CRM integration for contacts, companies, deals, owners, calls, meetings, tasks, emails, and associations.
- Google Calendar OAuth and meeting booking flows.
- SmartLead outbound/campaign automation.
- SignalHire-related browser/enrichment tooling.
- Career page / ATS intelligence workflows.
- GitHub Actions for operational and scheduled automation.
- Docker deployment for the production service.
- Existing path toward n8n + Postgres for higher-scale reporting and automation.

## Important local locations

- `README.md` — high-level source of truth for capabilities, environment, security, deployment, and quality checks.
- `docs/ARCHITECTURE.md` — current application and data-flow architecture.
- `docs/METRICS.md` — dashboard metric definitions and CRM field behavior.
- `docs/DASHBOARD_GUIDE_AR.md` — detailed operational guide to dashboard behavior.
- `docs/CAREER_INTELLIGENCE.md` — ATS/career research logic.
- `docs/FAST_DASHBOARD_ARCHITECTURE.md` — performance/scaling direction.
- `docs/MAQSAM_CALLS.md` — call integration behavior.
- `.github/workflows/` — production operations and one-time/scheduled jobs.
- `chrome-companion/` — browser-side enrichment/SignalHire companion.
- `.agent/ROUTER.md` — how to select relevant references before solving a task.
- `.agent/skill-sources.json` — curated external engineering and agent skill/reference registry.

## Existing architectural assumptions

- HubSpot is the system of record for CRM data.
- HubSpot aggregation is currently server-side and cached for dashboard use.
- At larger scale, incremental extraction through n8n and materialized Postgres reporting data is preferred over repeated full scans.
- CRM drill-downs should point back to original HubSpot records.
- Optional sources should fail visibly rather than silently being converted to zero or fabricated data.
- Demo/synthetic data exists for safe local development and CI.
- Tokens and private credentials remain server-side.
- Google Calendar credentials are organizer-specific and encrypted.
- Calendar booking has explicit availability/identity validation before consequential writes.

## Working style expected from agents

Do not interpret a new request in isolation.

For any meaningful SDR change:

1. establish which subsystem and business process the user is referring to;
2. inspect current behavior and data flow;
3. locate the existing implementation and connected workflows;
4. identify relevant project constraints;
5. consult only relevant skills/references;
6. choose the least risky maintainable solution;
7. implement without unrelated redesign/refactoring;
8. verify the actual outcome.

## Data and automation safety

Particular care is required for changes that can create or mutate CRM or outbound records.

Always consider:

- duplicate contacts;
- duplicate tasks;
- duplicate meetings;
- duplicate outbound sends;
- repeated enrichment charges/calls;
- stale verification status;
- overwriting higher-confidence phone/email data;
- incorrect HubSpot associations;
- owner attribution changes;
- workflow retries;
- API rate limits;
- production secrets;
- CRM snapshots or logs accidentally committed to Git.

## Quality bar

The repository exposes these standard checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Use additional targeted checks for integration changes. Passing static checks alone is not proof that a live integration path works.

## Freshness rule

This file is an orientation layer, not a frozen specification. If live code, tests, or current vendor behavior differs from this document, investigate and update the relevant documentation rather than forcing the implementation to match stale context.
