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
http://gtm-ats-browser:3000/career-detect
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

The dashboard and `gtm-ats-browser` share the external Docker network named `n8n_default`, so the browser service is not exposed publicly.

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

There is intentionally no automatic bulk HubSpot write on scan completion.

## Environment

Required production values:

```env
HUBSPOT_PRIVATE_APP_TOKEN=...
CAREER_INTELLIGENCE_STORE_PATH=/app/data/career-intelligence.json
CAREER_ENGINE_URL=http://gtm-ats-browser:3000/career-detect
CAREER_ENGINE_TIMEOUT_MS=90000
CAREER_SCAN_LIMIT=25
CAREER_SCAN_CONCURRENCY=6
CAREER_PORTFOLIO_CACHE_MS=60000
```

Optional autonomous processing:

```env
CAREER_AUTO_SCAN_ENABLED=false
CAREER_AUTO_SCAN_INTERVAL_SECONDS=45
```

Keep autonomous scanning disabled for the first production validation batch. After validating a representative set, enable it and recreate the Docker Compose services.

## Recommended rollout

1. Deploy `gtm-ats-browser` v1.6+ and confirm `/health` lists `career-detect`.
2. Deploy the SDR Dashboard.
3. Keep `CAREER_AUTO_SCAN_ENABLED=false`.
4. Run 25 companies from the UI and inspect false positives / manual review reasons.
5. Run 100 and confirm browser usage remains acceptably low.
6. Enable the autonomous worker to finish the remaining `needs_research` portfolio.
7. Review `needs_manual_review` in the drawer.
8. Push verified results to HubSpot after review.

## Cost controls

The dashboard reports static, browser, and cache resolution rates. The intended waterfall is:

1. Cache
2. Static HTTP + common paths + navigation + robots/sitemap
3. Browser only for unresolved sites
4. Manual review for blocked or ambiguous results

Search/LLM fallback is intentionally kept outside the default path so the 1,400-company backfill does not spend search or model calls on easy cases.
