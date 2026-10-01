# Lead Inventory

Open `/?view=inventory` or `/lead-inventory`. The inventory uses the existing persistent Postgres acquisition ledger, including companies already discovered by market coverage. HubSpot remains the CRM authority.

## Workflow

1. Browse all sources; filter country, product, GTM tier and readiness. Results are paginated server-side, 100 per page. Counts describe the whole inventory, not just the displayed page.
2. Unlock actions with the existing Admin password (signed HttpOnly cookie). Server keys never enter the client. Automation may use `x-acquisition-owner-token`.
3. Import CSV or JSON, up to 100 companies / 250 KB. Choose the source, preview the duplicate/CRM checks, then save. Duplicate domains never overwrite existing inventory rows, even when imports race.
4. Imported companies enter Review. Confirm identity and product fit before searching people. Existing HubSpot records and government signals remain excluded.
5. Open the company, find ranked people using SignalHire, then choose an individual to enrich. Already-enriched people reuse stored results instead of another paid lookup. CRM is rechecked before paid enrichment.
6. Choose Marita or Daniel for a newly assigned company. Existing assignments remain frozen. Push one person after reviewing the data. Inventory pushes recheck company/contact presence before CRM writes and retain existing task deduplication.

## Import format

Required: `name`, `domain`.

Optional: `country`, `industry`, `employeeCount`, `sourceUrl`, `linkedinUrl`, `careerPageUrl`, `detectedAts`, `evidence`, `businessLine` (`Talentera` / `Evalufy`, default Talentera).

Use exact column names. Company domains must be real website hostnames. Links must use HTTP(S). Unknown employee counts remain zero/unknown; imported ATS claims are stored as research and are not pushed as verified evidence.

Source options: Clay, SignalHire, Sales Navigator, LinkedIn, Public research, Manual. These are ingestion/provenance labels; importing a file does not imply a continuous API connection to that source.

## Automation integration

`POST /api/lead-inventory` accepts `{ source, companies, execute: false }` for preview, and the same payload with `execute: true` to save. Authenticate using the existing automation token header. The API performs fresh checks on every execution and fails visibly if CRM/storage is unavailable. It does not purchase contacts or create CRM tasks during import.

`PATCH /api/lead-inventory` accepts `{ domain, identityReviewed: true, icpReviewed: true }` to qualify a review record after an actual human review. Existing HubSpot domains/names are rechecked.

An n8n source workflow can send bounded batches to this API. No recurring provider spend or automatic contact pushes are enabled by this feature. Configure actual provider access, schedules, quotas and budgets before continuous replenishment.

## CRM mapping verified on 2026-10-01

For newly created inventory contacts: `business_name=ATS` for Talentera, or `Evalufy`; `sdr_owner` is the selected SDR ID. New companies use `talentera_business_line=ATS` / `Evalufy`. Both CRM enums and Marita/Daniel SDR enum IDs were checked against live property definitions. Existing contact fields are not overwritten.

## Storage compatibility

The existing coverage view keeps its original source scope. Inventory requests use `allSources=1`. Exact domain lookups search the entire acquisition ledger. Database imports accept `insertOnly=true`; the domain primary key provides atomic protection against duplicate overwrites.

Readiness means a stored enriched contact has a phone or email, not independent email deliverability or proof the telephone reaches that person. Imported companies require review; aggregate eligibility from historical data should not be interpreted as freshly verified ICP fit.

## Verification

Run lint, typecheck, unit tests, production build and Python syntax checks. Browser tests cover import preview/save, filters, pagination and narrow-screen rendering without real CRM writes or paid enrichment.
