# Saudi company coverage engine

The Lead Inventory now connects company stock to CRM coverage and product-specific outcome ranking. Apollo discovery remains a resumable source crawl, not a census of every Saudi business. Keep unresolved source totals visible. Company discovery and contact readiness are separate milestones.

## Operating policy

- Saudi headquarters, 200+ provider size filter; exact 250+ counts get first priority with no upper limit. Unknown exact size remains unknown. Saudi operations of foreign-headquartered firms require a separate verified discovery pass; this inventory is not a national census.
- Existing HubSpot companies remain in coverage but are excluded from acquisition. Fresh domain aliases and exact company names are checked before provider spend. Government/job boards and unresolved domains cannot enter automatic enrichment.
- Check official career/application pages first. A verified ATS routes to Daniel / Evalufy. A verified direct CV form or recruitment email with no recognized ATS observed routes to Marita / Talentera. This describes the public application process, not proof of absent internal software. Blocked, empty and ambiguous pages stay in review. Evidence URLs, reasons and checked dates are stored; routing evidence expires after 30 days.
- Missing company size and industry are enriched from Apollo after fresh HubSpot exclusion and ATS verification. Domain identity and exact Saudi/200+ eligibility are checked again before person spend. Existing assignments are frozen; an assignment conflicting with ATS routing stays in review.
- Target current recruitment, TA and HR decision makers; corporate Evalufy adds assessment/selection and education adds admissions/assessment/examinations. SignalHire company-name search can find regional decision makers outside Saudi Arabia. Apollo domain search is a fallback; paid identity matches must verify the current organization domain and LinkedIn identity.
- Try at most three new phone reveals per company. Reuse saved enriched profiles, including completed attempts without phones. A syntactically usable person-level phone, suitable persona and verified current employer are required before CRM push; a switchboard is not a contact phone. Availability is not a claim that the number has been reached.
- Daily Riyadh ceilings are 100 company slots, 100 Apollo company enrichments, 100 Apollo identity matches, 100 SignalHire phone reveals and 100 push reservations. These are attempt ceilings, not promised additions, and include failures/ambiguous responses. No credit purchase is performed.
- The ATS-v2 queue can reassess legacy completed review outcomes once under the new policy. Pending legacy company operations, pending person reveals, any push reservation and existing ATS-v2 reservations remain blocked. Completed provider results are reused. Reservations are not deleted to retry uncertain charges or writes.
- Inventory tasks retain Marita's 70/day and Daniel's 50/day scheduling rules, overdue carry and Sun–Thu workdays. Workload schedules tasks rather than moving prospects to another product owner. Existing task dates/owners are not rewritten. No email or LinkedIn outreach is automatically sent.
- LinkedIn recent posting is a priority signal, not an eligibility requirement. Only a dated LinkedIn source within 30 days receives the bounded ranking boost. Sales Navigator filtering does not by itself import signals or establish company completeness; capture and validate the source before marking an account as recently active.
- External-operation reservations live in Postgres. Uncertain provider/CRM outcomes stay blocked for reconciliation. A review outcome is never counted as a push.

## Market coverage work

1. Exhaust the saved net-new Saudi inventory: validate domains, ATS, exact size and exclusions; identify current personas; obtain phones; create company/contact/task together through the guarded push route.
2. Resolve separate queues for missing domains, unknown career/ATS evidence, unknown size, missing personas/phones and uncertain writes. Do not silently discard them or call them covered.
3. Reconcile Apollo source result totals against unique IDs and completed pages. Expand discovery to independently verified Saudi operations, branches and organizations missing from the initial headquarters search; deduplicate subsidiaries and parents by actual entity/domain.
4. Use Sales Navigator Saudi HR/TA searches across all 201+ employee buckets and recent-post filtering to prioritize timely outreach. The separate 200-employee boundary still needs inventory/provider verification.
5. Track each milestone separately: discovered, eligible, ATS verified, phone ready, CRM added, task scheduled, connected call and held meeting. Existing CRM accounts remain part of the final coverage target.
6. Replenish on the scheduled workdays, review exceptions and compare product/persona outcomes only after the observation windows mature. Complete market coverage cannot be claimed from one provider count or from creating tasks.

## Coverage and learning

Association reads use a shared queue paced at two requests per second. A short HubSpot 429 limit is retried at most twice, honoring Retry-After and sharing the cooldown with queued reads. Daily/long limits remain visible failures. This retry applies only to history reads; paid enrichments and CRM writes retain their one-attempt reservations.

`POST /api/lead-inventory/engine` with `{action:"sync",limit:10}` refreshes oldest company histories first. It reads direct company activities and activities associated with all its contacts, following association pagination. It records attempted call, exact Connected outcome, scheduled/held meetings, future tasks and ownership/retention/deal protection. Existing companies are read only.

Company coverage is deduplicated and cumulative. A company reaches the goal only when both a Connected call and a completed meeting are observed. Booked/cancelled/no-show meetings do not satisfy the held-meeting milestone. Unchecked companies remain unknown, not zero activity. The displayed checked denominator exposes partial backfills.

Learning uses a 30-day window after the first call by Marita/Daniel to a product-attributed contact. Only fully elapsed windows enter training, including unsuccessful attempts. Untouched/new prospects never become negative examples. Contact-associated completed meetings provide persona outcomes; company-only meetings count toward company coverage but not a particular persona. At most one company vote per product/segment prevents repeated contacts inflating sample size.

The first model is Beta(1,1)-smoothed segment ranking with a 95% Wilson interval and a minimum 20 distinct companies per segment. Separate product, persona, industry and known employee-size segments receive bounded priority adjustments. The UI stays in collecting mode until a segment meets this gate. It is observational learning, not a causal model or a validated conversion forecast. No neural model or external LLM is needed for this initial data volume.

Limitations: historical titles/product labels use current CRM values, because historical feature snapshots were not previously captured. Owner, seasonality and selection differences can confound results; probability calibration and temporal holdout validation are required before presenting predictive performance. Start recording immutable decision-time features before upgrading to a predictive model. Missing exact employee counts must be enriched/reviewed before size comparisons are meaningful.

## Execution and persistence

`GET /api/lead-inventory/engine` returns aggregate coverage, model state and operation counts. Authenticated POST `{action:"run",limit:1,confirmCredits:true}` processes the bounded ATS-verification queue. The dashboard offers an explicit two-company run. Existing admin cookies or the acquisition automation token authorize writes; provider credentials stay server-side.

The existing Saudi inventory GitHub workflow runs the engine at 04:00 UTC Sun–Thu, with up to 100 company attempts first, followed by 100 historical company refreshes. Initial push waits for the requested production build or a newer deployed descendant verified through GitHub before actions. Discovery and coverage each serialize independently, so a waiting discovery run does not block replenishment. It uses the canonical deployment workflow; no new Docker service, data volume or deployment path is introduced. n8n can invoke the same authenticated API when orchestration is consolidated there.

Detailed contact data and per-company operation results stay in Postgres/HubSpot. GitHub job logs contain aggregate counts and fixed non-identifying error categories only. A fully failed history batch stays visibly incomplete and fails the job after the independently guarded acquisition pass; it never supplies negative learning examples. To pause the schedule, disable the existing Saudi inventory workflow; manual inventory actions remain subject to the durable reservations and daily limits.

Before retrying a reserved or review operation, reconcile the provider/CRM result and the stored person/company/task. Do not delete reservations merely to retry an uncertain write. If a task write succeeded while its audit failed, recover the identifiers and mark the operation complete.

## Validation

Unit tests cover censoring, product isolation, minimum samples, per-company deduplication, size boundaries, outcome windows and protected owner routing. Browser checks cover coverage rendering alongside the existing import/filter workflow and disabled write controls without admin access. Live deployment, source completeness, contact enrichments and CRM pushes must be reported independently.
