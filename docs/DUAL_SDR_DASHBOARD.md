# Dual SDR reporting

Marita Chedid (HubSpot owner 31644369) uses the Talentera workspace. Daniel Beaini (37624223) uses Evalufy. Both owner records were confirmed active on 2026-09-08. Owner definitions are shared in `src/lib/sdr-owners.ts`.

The existing navigation, analytics, filters, drilldowns and task/lead workspace are reused. `?acq=daniel` opens Daniel; `?acq=comparison` opens management reporting. Ursula and Zein remain available. Evalufy uses the supplied logo with violet, deep purple and teal accents. Lucide and Recharts are reused; reduced-motion preferences disable visual motion. The management chart loads only when selected.

Comparison metrics use identical dates and the existing HubSpot definitions. Activity counts are for the period; portfolio and open/overdue workloads are current. Product labels identify each SDR's business assignment, not a product filter on CRM revenue. Missing sources retain warnings; unavailable owners display a dash. Meetings resolve `hs_created_by_user_id` using the Owners API `userId`, which must not be confused with `hubspot_owner_id`. The cache schema is bumped to prevent reuse of old meeting attribution.

Daniel's analytics and work queue are operational independently of Marita. His meeting composer is unavailable until his own calendar integration is configured; HubSpot meeting links remain available. Marita-specific Maqsam/admin tools are not exposed in Daniel's workspace. This change does not change CRM assignments, task schedules, contacts or calendar credentials.

## Data delivery on Hostinger

- Persistent FastAPI snapshots survive application restarts; memory snapshots serve repeat requests.
- Node startup schedules warmup for both default owner/date combinations after five seconds and checks every minute, even with no open browsers.
- Snapshots become stale after two minutes; readers receive the existing snapshot immediately while the server rebuilds it.
- Full CRM builds are serialized, cold requests deduplicated, and active filter memory is bounded. Existing HubSpot search throttling remains in place.
- Active workspaces poll every 30 seconds, or every three seconds while refreshing. Hidden SDR workspaces stop polling; hidden browser documents skip requests.
- Conditional ETags return 304 for unchanged snapshots, avoiding full contact payload transfers and JSON parsing. The management endpoint returns only KPIs, dates, warnings and daily totals.
- UI timestamps show actual snapshot age. This is eventual refresh, not a webhook-driven realtime feed. Cold first builds, HubSpot indexing, upstream failures and large custom ranges can still take time. A refresh never claims unseen data is current.

Deployment remains main CI → existing Hostinger workflow. No persistent volumes, ingress, secrets, server allocations or unrelated services are changed. Validate production buildRef and measure warm API timings after deployment; local demo timings are not evidence of live HubSpot latency.


## Evalufy visual follow-up

Violet tokens now cover the workspace hero, country filter, queues, chart primary series, hover/focus states and sidebar lighting. Shared CSS modules inherit brand tokens. Red/amber operational alerts remain distinct. The original PNG is retained unchanged and displayed as a cropped white wordmark using CSS screen blending; it is not a newly exported alpha PNG. Generated checkerboard images were rejected and are not shipped. Duplicate SVG chart gradient IDs are owner-scoped. Daniel no longer sees Marita's calendar status card.

Post-deployment timing distinguishes first-load warmup (up to 60 seconds allowed by the probe) from subsequent warm/conditional requests. Increasing the probe timeout does not change API latency or claim the cold path is instantaneous.
