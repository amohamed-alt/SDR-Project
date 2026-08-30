# FastAPI-first dashboard migration

## Goal

Make dashboard reads independent of HubSpot latency during normal use.

## Phase 1

- Keep Next.js as the UI and compatibility/build worker.
- Use the existing FastAPI snapshot service as the first data source.
- Pre-warm Marita, Ursula, and Zein snapshots in the background.
- Never force a synchronous HubSpot refresh from the warmer when a snapshot already exists.
- Serve stale snapshots immediately while Node refreshes them in the background.

## Phase 2

Port analytics generation from Node to FastAPI only after parity tests prove KPI output is identical for the same filters. Until then, Node remains the canonical calculator so there is no KPI drift.

## Target request path

Browser -> Next.js UI -> /api/dashboard -> FastAPI snapshot -> instant response

On cache miss only:

FastAPI miss -> Node analytics builder -> HubSpot -> persist snapshot -> response

Normal navigation should therefore avoid waiting on HubSpot.
