# Dashboard audit — 9 October 2026

Scope: production dashboard, SDR comparison, Ursula and Zein reporting. Baseline build: 7296a664028828d64130591133d3f34ee7e85202. Observations below are sampled behavior, not a full load test or a measured explanation of low adoption.

## Findings and implemented repairs

- Repeated warm API reads took approximately 0.4–9.8 seconds; one Ursula read exceeded the 10-second probe timeout. Full portfolio builds are serialized and frequent refreshes contend with interactive requests.
- Extend CRM snapshot freshness from two to five minutes, preserving explicit refresh and background refresh. Invalidate persisted snapshots for corrected ownership semantics.
- Refresh Google meeting sheets independently of expensive full CRM rebuilds. Share the sheet cache across server bundles, deduplicate refresh work, and return the previous sheet while refreshing. Preserve CRM meeting evidence when overlays are reapplied and surface source failures.
- SDR contacts retain `sdr_owner` attribution and meetings retain creator-user attribution. Ursula/Zein contacts, meetings and deals use assigned `hubspot_owner_id`; their existing figures must not be compared directly with the previous incorrectly scoped figures.
- Separate meetings booked (creation date) from meetings held (meeting date) in RM cards and drilldowns. Rename the unlinked deals/bookings ratio so it does not claim cohort conversion.
- SDR comparison displays one selectable metric at a time; calls no longer flatten meetings on a shared scale. Preserve previous same-query owner data during partial refresh failure and report errors.

## Remaining work, in priority order

1. **Restore sheet access.** Both configured Marita and Daniel trackers return HTTP 403. The configured reader is `abdullah-mohamed@abiding-bongo-508523-p0.iam.gserviceaccount.com`. A sheet owner must authorize Viewer access before source-of-truth targets and meeting results can be verified. Until then the interface labels HubSpot fallback and unavailable targets. Marita's intended monthly target is 20 inbound + 20 outbound; Daniel's is 50 outbound.
2. **Eliminate cold-query full scans.** New owner/date/cohort combinations still build the full CRM portfolio. Move reporting aggregation to incrementally refreshed persisted tables and serve summary aggregates separately from record drawers. Validate with several concurrent users and p50/p95 latency before declaring the severe slowness fully solved.
3. **Confirm RM business definitions.** The corrected scope includes all deals assigned to each RM. If the Acquisition page must exclude retention or another pipeline, agree the exact pipeline IDs and qualifying stages first. Bookings/held/deals use separate date semantics, and deals/bookings remains an activity ratio, not matched meeting-to-deal conversion.
4. **Verify restored tracker attribution.** After access recovery, reconcile duplicate/cancelled/rescheduled meetings, inbound/outbound classification and monthly target calculations against the actual sheets. Static tests cannot prove live source correctness.
5. **Measure adoption.** No usage funnel was available in this review. Instrument page visits, owner/date selections, drilldown usage, errors and latency without collecting CRM record content. Interview the SDRs/RMs to identify which daily decision is missing. Validate priorities and next actions with those users before a wider redesign.
6. **Audit gated operational tools separately.** Team activity required workspace unlock. This review does not claim to verify every write action, enrichment tool, permissions boundary or task automation. Use a signed-in authorized review to exercise those flows without mutating CRM merely to test the dashboard.

## Validation

Local typecheck, production build and all 216 tests passed. Lint passed with three existing enrichment-script warnings. The new regression checks cover SDR/RM ownership and repeated sheet overlay evidence. Deployment and live measurements must be recorded separately; this document alone is not proof of a production release.
