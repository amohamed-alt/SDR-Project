# Maqsam Calls integration

The SDR dashboard includes a `Maqsam Calls` view for Marita (`m.chedid@bayt.net`). It stores every completed call whose Maqsam AI summary is ready, including calls that cannot be matched safely to a HubSpot Contact.

## Data flow

1. n8n scans the previous three hours of Maqsam calls every ten minutes.
2. Only completed or serviced calls for `m.chedid@bayt.net` are processed.
3. The workflow waits for a non-empty Maqsam summary, then keeps the full `transcription` and `segments` fields.
4. HubSpot is searched by normalized phone number.
5. Every call is upserted into `POST /api/maqsam/calls` using the Maqsam Call ID as the unique key.
6. A unique safe HubSpot match receives a Note containing call metadata, AI summary, and transcript.
7. Unmatched and ambiguous calls remain in the dashboard and are never attached to a random Contact.

## Match and Note statuses

- `matched`: one unique safe HubSpot Contact match.
- `unmatched`: no safe HubSpot Contact match.
- `ambiguous`: multiple candidates tied at the strongest score.
- `pending`: matched but the HubSpot Note has not been confirmed yet.
- `synced`: the workflow created the HubSpot Note.
- `already_synced`: an existing Note already contains the Call ID or Reference ID.
- `not_applicable`: unmatched or ambiguous; no HubSpot Note is created.

## Dashboard environment

```env
MAQSAM_INGEST_SECRET=<strong-random-shared-secret>
MAQSAM_CALL_STORE_PATH=/app/data/maqsam-calls.json
MAQSAM_CALL_RETENTION_DAYS=180
MAQSAM_CALL_MAX_RECORDS=5000
```

The existing Docker volume mounted at `/app/data` persists Maqsam calls and Google Calendar credentials across rebuilds.

## n8n setup

Create an **HTTP Basic Auth** credential named `Maqsam Basic Auth`:

- Username: rotated Maqsam Access Key
- Password: rotated Maqsam Access Secret

Configure these n8n environment variables:

```env
SDR_DASHBOARD_BASE_URL=https://sdr.dashboardtalentera.tech
MAQSAM_INGEST_SECRET=<same-value-as-dashboard>
```

Never commit live values. The Maqsam key and secret must be rotated if they appeared in a workflow export or chat message.

## Deployment and verification

1. Redeploy the SDR dashboard after setting the dashboard environment variables.
2. Import the updated n8n workflow and select the `Maqsam Basic Auth` credential plus the existing HubSpot Bearer credential.
3. Run the workflow manually.
4. Verify that a matched call appears in the `Maqsam Calls` view and creates a HubSpot Note.
5. Verify that an unmatched number appears in the dashboard without creating a Contact or Note.
6. Activate the ten-minute schedule.
