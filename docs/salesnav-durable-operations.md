# Sales Navigator capture and durable operations

Companion 1.5.7 captures first-degree people and counts them; they are excluded at reveal/push. A non-final page with fewer than 25 extracted people, a skipped page number, ambiguous pagination or stale cards pauses capture with saved progress. Safety-cap termination is explicitly labelled, not proof that every search result was accessible.

## Company and person gates

The current Ready queue blocks existing people, retention accounts/deals, meaningful or unset-outcome meetings, any connected call across all associated company contacts, incomplete reads, active deals and conflicting owners. Exact company matches do not skip sibling/duplicate identity checks. Preview scans are persisted per run/company for five minutes; reveal and push recheck fresh. Missing ATS is unknown; automatic routing requires explicit supported status, otherwise manual Marita/Daniel selection is required. No default owner transfer is allowed.

Stable Sales Navigator entity IDs and public profile slugs are the shared strong identifiers. Tracking query parameters and display-name suffixes do not change identity. Name/company strings are capture hints only, never paid-result cache keys. Legacy URL-shaped ledger aliases remain readable; corrupt files fail visibly instead of resetting history.

## Durable side effects

The existing Postgres data service owns `salesnav_operations`, independent of inventory operation kinds and daily budgets. A transaction/advisory lock provides one claim across application processes. Company resources serialize pushes and enforce a maximum of two completed people per company in this workflow. A random lease fences checkpoint updates; after thirty minutes only operations without a pending external action can be reclaimed.

Reveal records `pending=provider` before dispatch. Success stores the result even without a public LinkedIn URL. A known pre-provider failure can retry. A timeout, no-result charged request, crash or malformed response remains unknown and blocks another paid request until reconciled. `creditUsed=null` means unknown; shared balance headers are evidence, not per-lead billing. Cached reuse records zero new requests.

Push checkpoints company, contact, association and task IDs. A proven journal-owned contact can resume after a pre-task failure; an unrelated existing person cannot. A write with an uncertain result is never repeated automatically. Readback verifies task owner/date/type before success. Existing SDR capacity/weekend rules select the task date, with the requested date/time as a lower bound; no task-date PATCH bypasses scheduling. Older reveal/push-ready URLs delegate to the same guarded paths.

The queue restores paid results and push state on reload. Unknown operations appear in Review and cannot be selected. Postgres unavailability pauses mutations. Do not clear pending markers just to unblock a run: establish the provider result or verify the exact CRM records first. A crash in the narrow gap between CRM acceptance and its checkpoint requires reconciliation, not an automatic retry.

## Validation and rollout

Route tests execute actual handlers with mocked external adapters: concurrent reveal, timeout protection, pre-provider retry, first-degree/weak identity exclusions, saved-result reuse, contact resume, no date PATCH, legacy cache migration, corrupt-ledger protection and capacity/weekend planning. Isolated PostgreSQL CI tests exercise cross-instance claims, lease fencing, crash recovery, uncertain-write company locks and company limits.

A production-sized 2,500-lead run has not been proven by these mocks. Before rollout verify the HubSpot v4 zero-association response, actual Sales Navigator card loading/page URLs and provider charging semantics with a small controlled sample. A new country/headcount/private-sector policy is not inferred from a person's location or added globally by this change; company ICP evidence still requires the existing verified research workflow. No new paid vendor, automatic reveal, automatic push or new SDR quota is introduced.
