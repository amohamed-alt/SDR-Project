# Saudi company coverage engine

The Lead Inventory now connects company stock to CRM coverage and product-specific outcome ranking. Apollo discovery remains a resumable source crawl, not a census of every Saudi business. Keep unresolved source totals visible. Company discovery and contact readiness are separate milestones.

## Operating policy

- Saudi headquarters, 200+ provider size filter; exact 250+ counts get first priority. Unknown exact size remains unknown. There is no upper employee limit.
- Existing HubSpot companies remain in the coverage denominator but are excluded from new acquisition. Government/job boards, unresolved domains and review records cannot enter automatic enrichment.
- Work the qualified queue only. Entity exclusions use the company name, industry and official domain; a vendor description mentioning government customers is not a government classification. Fresh domain aliases and exact company names are checked before spend; existing owner assignments are frozen.
- Talentera: recruitment/TA and HR decision makers. Evalufy education: admissions/assessment/examinations; corporate Evalufy: assessment/selection/TA. An industry-based product suggestion is stored as a suggestion and can be overridden through reviewed inventory records. It is not a claim that a company uses or needs a product.
- Missing exact company size and industry are enriched from Apollo only after fresh HubSpot exclusion, with a durable 10/day budget. Domain identity and Saudi/200+ policy are checked again before person spend.
- One selected current-employer-verified person per company, with a phone required before CRM push. Existing saved enrichment is reused.
- At most 10 new company processing slots, 10 Apollo company enrichments (one documented credit per organization), 10 person reveal attempts and 10 inventory push reservations per Riyadh calendar day. A same-day company slot may be recovered once only for a documented pre-reveal failure, after a completed company enrichment and database proof that no person reveal or CRM push was reserved. Other uncertain outcomes stay blocked. These provider ceilings include failures and ambiguous responses; no credit purchase is authorized or performed by the engine.
- New assignments follow the existing product workspaces: Talentera to Marita, Evalufy to Daniel. Current workload controls task scheduling rather than moving a lead to the other product owner. Inventory task scheduling keeps Marita's existing 70/day rule and uses 50/day for Daniel, including overdue carry and Sun–Thu workdays. Existing task dates/owners are not rewritten.
- External-operation reservations live in Postgres. An uncertain reveal/write stays blocked for reconciliation. No automatic retry can produce a second charge or CRM POST for the same reserved operation. A review outcome is not a successful push.

## Coverage and learning

`POST /api/lead-inventory/engine` with `{action:"sync",limit:10}` refreshes oldest company histories first. It reads direct company activities and activities associated with all its contacts, following association pagination. It records attempted call, exact Connected outcome, scheduled/held meetings, future tasks and ownership/retention/deal protection. Existing companies are read only.

Company coverage is deduplicated and cumulative. A company reaches the goal only when both a Connected call and a completed meeting are observed. Booked/cancelled/no-show meetings do not satisfy the held-meeting milestone. Unchecked companies remain unknown, not zero activity. The displayed checked denominator exposes partial backfills.

Learning uses a 30-day window after the first call by Marita/Daniel to a product-attributed contact. Only fully elapsed windows enter training, including unsuccessful attempts. Untouched/new prospects never become negative examples. Contact-associated completed meetings provide persona outcomes; company-only meetings count toward company coverage but not a particular persona. At most one company vote per product/segment prevents repeated contacts inflating sample size.

The first model is Beta(1,1)-smoothed segment ranking with a 95% Wilson interval and a minimum 20 distinct companies per segment. Separate product, persona, industry and known employee-size segments receive bounded priority adjustments. The UI stays in collecting mode until a segment meets this gate. It is observational learning, not a causal model or a validated conversion forecast. No neural model or external LLM is needed for this initial data volume.

Limitations: historical titles/product labels use current CRM values, because historical feature snapshots were not previously captured. Owner, seasonality and selection differences can confound results; probability calibration and temporal holdout validation are required before presenting predictive performance. Start recording immutable decision-time features before upgrading to a predictive model. Missing exact employee counts must be enriched/reviewed before size comparisons are meaningful.

## Execution and persistence

`GET /api/lead-inventory/engine` returns aggregate coverage, model state and operation counts. Authenticated POST `{action:"run",limit:1,confirmCredits:true}` processes the bounded qualified queue. The dashboard offers an explicit two-company run. Existing admin cookies or the acquisition automation token authorize writes; provider credentials stay server-side.

The existing Saudi inventory GitHub workflow runs the engine at 04:00 UTC Sun–Thu, with 100 historical company refreshes and up to 10 company attempts per run. Initial push waits for the requested production build or a newer deployed descendant verified through GitHub before actions. Discovery and coverage each serialize independently, so a waiting discovery run does not block replenishment. It uses the canonical deployment workflow; no new Docker service, data volume or deployment path is introduced. n8n can invoke the same authenticated API when orchestration is consolidated there.

Detailed contact data and per-company operation results stay in Postgres/HubSpot. GitHub job logs contain aggregate counts and fixed non-identifying error categories only. A fully failed history batch stays visibly incomplete and fails the job after the independently guarded acquisition pass; it never supplies negative learning examples. To pause the schedule, disable the existing Saudi inventory workflow; manual inventory actions remain subject to the durable reservations and daily limits.

Before retrying a reserved or review operation, reconcile the provider/CRM result and the stored person/company/task. Do not delete reservations merely to retry an uncertain write. If a task write succeeded while its audit failed, recover the identifiers and mark the operation complete.

## Validation

Unit tests cover censoring, product isolation, minimum samples, per-company deduplication, size boundaries, outcome windows and protected owner routing. Browser checks cover coverage rendering alongside the existing import/filter workflow and disabled write controls without admin access. Live deployment, source completeness, contact enrichments and CRM pushes must be reported independently.
