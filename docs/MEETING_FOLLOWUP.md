# Meeting follow-up workspace

Entry: Sales Handoff → SLA exceptions & verified HubSpot updates (`/meeting-followup`). Existing SDR tools unlock protects the page and both API methods. This is an administrator workspace, not per-RM identity or permissions.

## Scope and attribution

The date range filters meeting start timestamps in Asia/Riyadh (maximum 93 days). Only explicit booking markers or owner-to-user creator mapping establish Marita/Daniel attribution. Current deal ownership alone does not establish booking attribution. Counts are raw meeting records and separately unique directly linked opportunities; repeated CRM meeting records are not silently merged. Contact-only associations and conflicting/multiple deal associations require manual review.

SLAs default to Sunday–Thursday 09:00–16:30 Riyadh, excluding Friday/Saturday and overnight time. Holidays are not configured. Outcome due after two working hours; completed-meeting notes and next-step coverage after three. Date-only next steps expire at the end of their Riyadh calendar date. Task coverage checks directly associated tasks belonging to the RM with a future due date; task presence does not prove outreach took place. Signed Contract/Booking remains monitored; Cashing and Closed Lost stop these follow-up alerts.

## Writes

Deal edits use existing HubSpot field definitions and enum options. Meeting outcome edits update the original CRM meeting, never calendar invitations. Saves require an explicit confirmation. The server compares the previously read modification timestamp and rejects stale edits before writing. This is optimistic preflight conflict detection, not an atomic HubSpot compare-and-swap. A fresh read must match every submitted value before success is returned. Failed verification may follow an accepted PATCH: refresh before retrying. No live CRM mutations are part of automated tests.

## Remaining rollout work

This version does not create tasks, send emails, run unattended alerts, provide per-RM login, or populate historical attribution. It does not infer absence of real-world outreach from absent CRM data. Email sender/recipients, escalation recipients, holiday policy and individual authorization need configuration before activation. Existing fields are reused; no properties or CRM records were created during development. Verify representative live records and production token write scopes after deployment before enabling team-wide editing.
