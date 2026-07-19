# SDR Command Center

A secure, full-stack HubSpot dashboard for SDR performance, multi-touch attribution, data quality, account intelligence, meetings, tasks, calls, email engagement, and SDR-attributed pipeline.

The project is configured for Talentera's EU1 HubSpot portal and defaults to Marita Chedid (`ownerId=31644369`) with a reporting start date of `2026-07-01`.

## What it measures

- Current SDR portfolio and contacts created in the selected period
- Original, latest, record, lead, contact, UTM, campaign, and meeting-booking sources
- Calls, connection rate, daily activity, and call outcomes
- Tasks due, completed, open, overdue, and due tomorrow
- Deduplicated meetings, outcomes, booking source, creator, and assigned owner
- Sales email sends, opens, clicks, replies, and reply rate
- Contact data quality across email, phone, LinkedIn, company association, country, source, ICP, Apollo, SignalHire, and MillionVerifier fields
- Company country, industry, employee count, ICP context, detected ATS, and ATS confidence
- Deals associated with SDR-owned contacts, stage conversion, open pipeline, and meeting-to-deal conversion
- In-dashboard searchable drill-down drawers for KPI cards, alerts, funnel stages, chart slices, bars, and daily activity points
- Exact HubSpot record links inside every drill-down result

See [docs/METRICS.md](docs/METRICS.md) for exact property definitions and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow.

For a detailed Arabic walkthrough of every dashboard tab, KPI, filter, HubSpot field, source rule, and drill-down link, see [docs/DASHBOARD_GUIDE_AR.md](docs/DASHBOARD_GUIDE_AR.md).

## Security model

- `HUBSPOT_PRIVATE_APP_TOKEN` is server-only and is never sent to the browser.
- Production requests require HTTP Basic Auth unless platform-level authentication is used and `DISABLE_AUTH=true` is deliberately set.
- No CRM data, API token, or generated HubSpot snapshot is committed to Git.
- The repository may remain public only while it contains code and synthetic demo data. Make it private before adding exports, logs, screenshots, or CRM snapshots.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. The supplied environment template starts in synthetic `DEMO_MODE=true`.

For live data:

1. Create a HubSpot private app.
2. Add the required read scopes listed below.
3. Set `HUBSPOT_PRIVATE_APP_TOKEN` in `.env.local`.
4. Set `DEMO_MODE=false`.
5. Configure `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` for production.

## HubSpot private app scopes

The live dashboard needs read access for:

- Contacts
- Companies
- Deals
- Owners
- Calls
- Meetings
- Tasks
- Emails
- CRM associations
- Deal pipelines

HubSpot scope names differ slightly between private-app screens and API versions. Enable the corresponding `crm.objects.*.read` scopes for every object above. The dashboard handles an optional data source being unavailable and surfaces a warning instead of silently replacing it with fake data.

## Environment variables

| Variable | Purpose |
|---|---|
| `HUBSPOT_PRIVATE_APP_TOKEN` | Server-only HubSpot token |
| `HUBSPOT_PORTAL_ID` | HubSpot portal ID; defaults to `145742477` |
| `HUBSPOT_UI_DOMAIN` | EU1 UI domain for drill-down URLs |
| `HUBSPOT_TIMEZONE` | Reporting timezone; defaults to `Asia/Riyadh` |
| `DEFAULT_SDR_OWNER_ID` | Default SDR owner; Marita is `31644369` |
| `NEXT_PUBLIC_DEFAULT_START_DATE` | Initial dashboard start date |
| `DASHBOARD_USERNAME` | Internal dashboard username |
| `DASHBOARD_PASSWORD` | Internal dashboard password |
| `DISABLE_AUTH` | Disable built-in auth only when deployment protection replaces it |
| `DEMO_MODE` | Use safe synthetic data without calling HubSpot |

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs all three checks on every push and pull request.

## Docker deployment on Hostinger

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env
# Fill the production values in .env
docker compose up -d --build
curl http://127.0.0.1:3010/api/health
```

Put the service behind the existing reverse proxy and TLS. Do not expose port `3010` publicly.

## Scaling path

The current live adapter queries HubSpot and caches results for 15 minutes. This is appropriate for one SDR and hundreds to a few thousand active records. For the full acquisition team or higher refresh frequency:

1. Use the existing n8n server to extract changed HubSpot records every 15 minutes.
2. Materialize contacts, companies, activities, associations, and deals in Postgres.
3. Change the dashboard adapter from HubSpot search to Postgres views.
4. Keep HubSpot record URLs for drill-down and HubSpot as the system of record.

This avoids repeatedly scanning CRM activities and provides stable historical snapshots for assignment changes.
