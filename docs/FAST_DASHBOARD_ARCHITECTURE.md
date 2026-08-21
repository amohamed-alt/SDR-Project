# Fast SDR Dashboard Architecture

## Goal

The SDR dashboard should open from a ready snapshot instead of making the browser wait for a full HubSpot aggregation. HubSpot remains the system of record; the acceleration layer only stores derived dashboard JSON.

## Request path

```text
Browser
  -> Next.js /api/dashboard
      -> in-process memory snapshot (fastest)
      -> FastAPI persistent snapshot (survives Next.js restart/deploy)
      -> Next.js cache / HubSpot analytics build (cold fallback only)

Background refresh
  dashboard-warmer -> Next.js /api/dashboard?refresh=1
                    -> returns the current snapshot immediately
                    -> refreshes HubSpot analytics asynchronously
                    -> writes the new snapshot to FastAPI + SQLite
```

## Components

### `sdr-dashboard`

The existing Next.js app remains responsible for all HubSpot reads and analytics logic. This avoids duplicating the large analytics model in Python and prevents metric drift between two implementations.

### `dashboard-cache-api`

A private Docker-only FastAPI service. It stores dashboard snapshots in SQLite under a named Docker volume.

Endpoints:

- `GET /health`
- `GET /v1/dashboard/{sha256-cache-key}`
- `PUT /v1/dashboard/{sha256-cache-key}`
- `DELETE /v1/dashboard/{sha256-cache-key}`
- `GET /v1/stats`

The service is not exposed through Traefik and has no public host port.

### `dashboard-warmer`

A lightweight Alpine sidecar that keeps configured SDR owner views hot every five minutes by default. `refresh=1` is stale-while-revalidate: a user-facing request can still return the last snapshot while HubSpot is refreshed in the background.

## Cache key isolation

The SHA-256 key includes:

- from date
- to date
- owner ID
- country
- original source
- latest source
- tier
- persona

Different owners and filter combinations can never share the same snapshot accidentally.

## Persistence and limits

The FastAPI service uses SQLite WAL mode and stores at most 250 dashboard combinations by default. Entries older than seven days are pruned. Individual JSON payloads are limited to 16 MB.

Production volume:

```text
sdr_dashboard_cache -> /data/dashboard-cache.sqlite3
```

A container rebuild or Next.js restart does not delete the latest dashboard snapshots.

## Failure behavior

FastAPI is an acceleration layer, not a new system of record.

If the FastAPI service is unavailable:

1. Next.js logs the cache read failure.
2. The normal Next.js cache/HubSpot path is used.
3. The dashboard remains functional, but the first uncached request can be slower.

Operational diagnostics are exposed through:

```text
GET /api/dashboard/cache-health
```

## Runtime configuration

```env
DASHBOARD_CACHE_API_URL=http://dashboard-cache-api:8000
DASHBOARD_CACHE_READ_TIMEOUT_MS=700
DASHBOARD_CACHE_WRITE_TIMEOUT_MS=2000
DASHBOARD_WARM_OWNER_IDS=31644369
DASHBOARD_WARM_INTERVAL_SECONDS=300
```

`DASHBOARD_WARM_OWNER_IDS` accepts a comma-separated list. Add the SDR owner IDs whose default views should always be precomputed.

## Deploy checks

CI validates:

1. Next.js lint/typecheck/tests/build/smoke.
2. FastAPI Python syntax.
3. FastAPI Docker image build.
4. A live container write/read/delete smoke test against SQLite.
5. Production Docker Compose configuration.

## Verifying production

After deployment:

```bash
docker compose ps dashboard-cache-api dashboard-warmer sdr-dashboard
curl -s http://127.0.0.1:3010/api/dashboard/cache-health
```

A dashboard response exposes:

```text
X-Dashboard-Cache-Version: v7-fastapi-persistent
X-Dashboard-Cache: memory | fastapi-disk | next-cache
X-Dashboard-Snapshot-Age: <seconds>
X-Dashboard-Refreshing: 0 | 1
```

After a restart, the first request should normally report `fastapi-disk` instead of rebuilding the entire HubSpot dashboard.

## Why FastAPI is used this way

Reimplementing the HubSpot analytics model in Python would create two calculation engines and increase the risk that dashboard totals disagree. The FastAPI layer therefore focuses on what it is best at here: a very small, fast persistent API for serving precomputed data.

## Next scaling step: Postgres materialization

The persistent snapshot layer fixes dashboard latency and shields interactive requests from HubSpot. When the portfolio grows enough that the background HubSpot build itself becomes expensive, the next stage should be:

```text
HubSpot incremental sync (n8n / worker)
  -> Postgres raw CRM tables
  -> indexed/materialized reporting views
  -> analytics builder
  -> FastAPI snapshot layer
  -> dashboard
```

Recommended materialized entities:

- contacts
- companies
- deals
- calls
- meetings
- tasks
- emails
- communications
- associations
- owner mappings

That stage reduces HubSpot API volume and makes cross-SDR/history queries predictable without changing HubSpot as the business system of record.
