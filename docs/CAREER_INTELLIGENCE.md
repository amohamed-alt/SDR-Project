# Career Intelligence

Career Intelligence is the SDR Dashboard control center for discovering and verifying official employer Career Pages, reviewing ambiguous cases, and safely backfilling HubSpot.

## Architecture

```text
HubSpot companies missing career_page_url
        |
        v
SDR Dashboard / Career Intelligence
        |
        v
Career batch runner (static-first)
        |
        v
http://gtm-career-browser:3000/career-detect
        |
        +--> static paths + navigation + robots + sitemap
        +--> ATS fingerprints
        +--> Playwright only when static discovery cannot decide
        +--> positive and negative cache
        |
        v
/app/data/career-intelligence.json
        |
        +--> manual approve / reject
        +--> safe HubSpot push after a fresh re-read
```

The dashboard and `gtm-career-browser` share the private Docker network named `n8n_default`, so the browser service is not exposed publicly.

## Statuses

- `needs_research` — waiting for the engine.
- `found_verified` — official employer Career Page was verified.
- `no_public_career_page` — the site was checked without finding a safe employer-owned Career Page.
- `needs_manual_review` — blocked, ambiguous, timed out, or missing enough evidence.
- `website_domain_invalid` — the supplied domain could not be validated as a public website.
- `insufficient_company_data` — company identity/domain is unusable.

`Found & Verified` is the only automatic status that can be pushed to HubSpot from the UI.

## Safe HubSpot writes

The `Push to HubSpot` action:

1. Re-reads the company immediately before writing.
2. Never overwrites a different existing `career_page_url`.
3. Fills `detected_ats` and ATS evidence fields only when those fields are empty.
4. Writes `career_portal_type` only when it is empty.

There is intentionally no automatic HubSpot write on scan completion. Autonomous processing only researches and stores results in Career Intelligence.

## False-positive guard

A normal company homepage is never accepted as the Career Page merely because its footer or marketing copy mentions `Careers`, `Jobs`, or hiring. Same-domain pages must use a dedicated career/job path or subdomain, while external portals must carry employer-brand proof plus recruitment signals. Arabic career paths such as `/وظائف` and `/التوظيف` are supported.

## Dashboard security

Production uses Basic Auth from `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`. HubSpot-backed pages and APIs remain protected. The health route is public for deployment verification; internal Docker workers can call only their exact POST endpoints over the private service hostname.

## Environment

Required production values:

```env
HUBSPOT_PRIVATE_APP_TOKEN=...
DASHBOARD_USERNAME=...
DASHBOARD_PASSWORD=...
CAREER_INTELLIGENCE_STORE_PATH=/app/data/career-intelligence.json
CAREER_ENGINE_URL=http://gtm-career-browser:3000/career-detect
CAREER_ENGINE_TIMEOUT_MS=90000
CAREER_SCAN_LIMIT=25
CAREER_SCAN_CONCURRENCY=6
CAREER_PORTFOLIO_CACHE_MS=60000
CAREER_AUTO_SCAN_ENABLED=true
CAREER_AUTO_SCAN_INTERVAL_SECONDS=45
```

Set `CAREER_AUTO_SCAN_ENABLED=false` explicitly if autonomous research needs to be paused. This does not control HubSpot writes; HubSpot writes are always a separate verified action.

## Production rollout

1. Deploy the SDR Dashboard and internal `gtm-career-browser` together.
2. Run the one-time 25-company validation after both services are healthy.
3. Store the validation marker and expose the results immediately in Career Intelligence.
4. Start the autonomous `career-refresh` worker after validation.
5. Process only `needs_research` records in bounded batches, preserving progress after every company.
6. Keep blocked/ambiguous records in `needs_manual_review` instead of guessing.
7. Review results from the dashboard and use manual approve/reject where required.
8. Push only `found_verified` results to HubSpot; re-read HubSpot immediately before every write and never overwrite a conflicting Career Page.

## Cost controls

The dashboard reports static, browser, and cache resolution rates. The intended waterfall is:

1. Cache
2. Static HTTP + common paths + navigation + robots/sitemap
3. Browser only for unresolved sites
4. Manual review for blocked or ambiguous results

Search/LLM fallback is intentionally kept outside the default path so the backfill does not spend search or model calls on easy cases. It can be added later only for the remaining manual-review tail if measured coverage justifies it.
