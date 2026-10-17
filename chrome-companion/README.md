# Talentera Sales Nav Collector 1.8.0

The extension again owns capture. HubSpot checks, contact reveals and CRM tasks stay in the dashboard.

## Update / setup

1. Replace the files in the same unpacked extension folder, then press Reload in Chrome.
2. Open the extension once and click **Enable Sales Nav reading**. Existing pairing tokens remain valid.
3. Open the Sales Navigator People Search you want to use.
4. Open the extension and choose **Capture 25**, **Capture 50**, or **Capture FULL search**.

## Workflow

1. The background collector saves rendered search cards and follows normal Sales Navigator pagination up to the chosen limit.
2. After card capture, it opens ordinary temporary Sales Navigator profile tabs one at a time, reads the actual public LinkedIn URL, saves it to the same server run, and closes the tab.
3. The run remains in preparation until URL reading finishes. The collector then marks it complete and opens the prospecting dashboard automatically.
4. Run **HubSpot Check → Reveal → Push** in the dashboard. Capture and URL reading use no contact credits and perform no CRM writes.
5. **Read / retry missing URLs** remains in the dashboard only as recovery for sign-in, verification, identity mismatch, or a transient profile failure.

Keep Chrome open while the collector runs. The popup may close; progress is stored by the background worker. Changing search filters during capture pauses safely before another search can be mixed into the run. Stop pauses after the current person and keeps saved progress.

## Boundaries

- No cookies permission, password access, hidden LinkedIn API, stealth, paid reveal or CRM write from the collector.
- Optional access is limited to `https://www.linkedin.com/sales/*`.
- Public URLs are accepted only when the rendered profile name matches the captured person.
- Pairing tokens never appear in dashboard bridge responses.
- Reveal and Push remain guarded dashboard actions.
- Build the versioned download with `python3 scripts/package-companion.py`.
