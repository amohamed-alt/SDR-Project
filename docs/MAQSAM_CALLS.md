# Maqsam Calls integration

Open **Maqsam Calls** directly in the analytics sidebar or use `?view=maqsam`. Both Marita and Daniel workspaces expose the same view. It defaults to the active SDR and all available history; switch between Marita, Daniel, or All agents and apply a date range. **Since first call** clears the lower date bound. Counts include external call attempts without summaries, and `serviced` is treated as completed.

## Sync and history

The existing `maqsam-sync` worker reuses the app image. Marita is matched by `MAQSAM_TARGET_AGENT_EMAIL` or exact full name **Marita Chedid**. Daniel is matched by verified HubSpot email `d.beaini@talentera.com` or exact full name **Daniel Beaini**; `MAQSAM_DANIEL_AGENT_EMAIL` can override the email if his Maqsam login differs. Unknown agents are never assigned to an SDR.

Recent calls are polled every ten minutes with a three-hour overlap. A background historical scan starts at `MAQSAM_BACKFILL_FROM` (default 2026-09-07, the creation date of Daniel’s verified HubSpot user record). Existing Marita history is retained. This scan includes Daniel’s onboarding day so his first available call is discovered rather than using the current month. It reads one day at a time, all pages until empty, and upserts by Call ID. A persistent checkpoint advances only after the entire window succeeds. Failures retry the same window. Busy windows that exceed the page budget split into smaller time windows automatically. If the provider ignores pagination or a one-minute window still hits the page cap, the checkpoint stops and worker logs report the failure.

The existing `/app/data` volume stores calls and the worker checkpoint. Do not delete either during redeploys. The dashboard reports historical import progress; counts are incomplete until the import catches up. Available history remains subject to Maqsam availability and configured retention/capacity (180 days and 50,000 records by default; existing server overrides still apply).

## HubSpot integrity

Phone matching keeps unmatched and ambiguous calls visible without creating random contacts or notes. The worker preserves confirmed matched contact and note statuses on repeated syncs; it does not create HubSpot notes itself. An independently configured n8n flow may ingest calls and create confirmed notes. Missing summaries/transcripts stay explicit.

## Settings

```env
MAQSAM_TARGET_AGENT_EMAIL=m.chedid@bayt.net
MAQSAM_DANIEL_AGENT_EMAIL=d.beaini@talentera.com
MAQSAM_BACKFILL_FROM=2026-09-07
MAQSAM_SYNC_CHECKPOINT_PATH=/app/data/maqsam-sync-checkpoint.json
MAQSAM_SYNC_INTERVAL_SECONDS=600
MAQSAM_SYNC_LOOKBACK_SECONDS=10800
MAQSAM_SYNC_PAGE_COUNT=12
MAQSAM_CALL_RETENTION_DAYS=180
MAQSAM_CALL_MAX_RECORDS=50000
```

Maqsam and ingest credentials remain server-side in the persistent runtime env. Deploy through the canonical main CI → Hostinger workflow. Verify `/api/health` buildRef, the sidebar, both agent filters, historical progress, and actual Daniel records before claiming history is complete.
