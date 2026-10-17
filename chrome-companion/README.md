# Talentera Dashboard Collector 1.7.0

The dashboard is the only prospecting work surface. The extension only connects Chrome and reads rendered Sales Navigator pages. No LinkedIn cookies, passwords, hidden APIs, stealth, or contact credits are used by the collector.

## Update / setup

1. Replace the files in the same unpacked extension folder, then Reload the extension in Chrome.
2. Open the extension once and click **Enable Sales Nav reading**. Existing pairing tokens stay valid; only paste a new token if connection testing rejects the existing one.
3. Refresh the dashboard at https://sdr.dashboardtalentera.tech/signalhire-queue .
4. The dashboard must say **Collector 1.7.0 connected**. **Server pairing configured** alone only means a token exists; it is not proof Chrome is connected.

## Work from the dashboard

1. Open the desired Sales Navigator People Search, then return to the dashboard and select that open search.
2. Click **Capture full search**. The collector saves each rendered page before normal Next pagination. Capture stops at no Next page, 100 pages or 2,500 unique leads. First-degree connections are excluded.
3. When capture finishes, click **Read / retry missing URLs**. Chrome opens ordinary temporary profile tabs, reads their actual public LinkedIn URL, saves it to the originating capture and closes each tab.
4. Read progress, failed names, failure reasons and **Stop collector** are visible in the dashboard. Sign-in/verification pauses reading. Retry only requests people who still lack public URLs in the saved server run.
5. **HubSpot Check** runs in the dashboard independently from URL reading. Slow or unavailable CRM checks cannot stop the URL reader.
6. Reveal contacts and create guarded SDR tasks only through the dashboard. Existing identity, phone, CRM conflict and task verification checks remain in place.

The popup contains only connection settings, the one-time Sales Nav permission and a dashboard link. It has no reveal or task controls. The companion endpoint also rejects extension reveal/push actions.

## Recovery / limitations

- Keep Chrome open for capture and profile reading. The popup can stay closed.
- Failed profiles remain missing until retried; a finished search capture does not mean all profile URLs were read.
- A sign-in, checkpoint or identity mismatch is shown as a failure, never converted into a successful read.
- The background worker stores URL-reading progress across popup closures. An old queue mixing HubSpot checks with reading is paused after update; start missing URL reads from the dashboard instead.
- Chrome's unpacked-extension update and one-time access grant must be performed in Chrome. The dashboard cannot replace or reload installed extension files.

## Boundaries

- No cookies permission or LinkedIn session upload.
- Optional access is limited to https://www.linkedin.com/sales/* .
- The page bridge accepts only status/capture/read/stop from the exact dashboard origin.
- Profile targets come from the authenticated server's saved run, not arbitrary page-provided URLs.
- Pairing tokens never appear in bridge status responses.
- Capture and profile URL reading perform zero paid contact reveals and zero CRM writes.
- Build the versioned download from repository source with `python3 scripts/package-companion.py`.
