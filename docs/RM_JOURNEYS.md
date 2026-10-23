# Relationship-manager prospect journeys

## Entry points

`/rm` is the team overview. Six bookmarkable pages use the same protected workspace: `/rm/zein`, `/rm/jehad`, `/rm/fadi`, `/rm/faizan`, `/rm/ursula`, `/rm/bassam`. Navigation is available from SDR Tools, Sales Handoff and the older meeting follow-up page. Existing signed tools access protects every page and API; separate URLs are not individual authentication or a new permission model.

## Attribution and counting

Meetings belong to an RM view when the RM is the mapped creator user, assigned activity owner, or an exact member of `hs_attendee_owner_ids`. Creator user IDs are resolved through HubSpot owner metadata. They are never compared blindly to owner IDs. SDR involvement follows the same evidence plus existing explicit booking markers. An SDR attendee is shown as a participant, not given booking credit. Assigned owner is shown as CRM ownership, not asserted to be the calendar organizer.

A shared meeting appears in each involved RM page. Team totals count the raw meeting once, so per-RM totals are not additive. Rows are grouped by explicitly linked company or external contact set, with all matching meeting records visible in the drawer. Records with no customer association remain review items rather than invented prospects. Internal contacts matching team email addresses are excluded from prospect contacts.

Direct acquisition deal links and contact-linked deal candidates remain separate. A unique direct deal belonging to the selected RM takes precedence over a unique contact-linked RM deal. Multiple candidates are shown without silently selecting one. Updates require an explicit target and fresh HubSpot read-back.

## Follow-up responsibility

Meeting visibility is separate from accountability. Follow-up ownership is grounded in directly linked opportunity ownership, a CRM-assigned RM, contact ownership, or a unique contact-linked opportunity owner, in that order. A task explicitly assigned to an RM also establishes responsibility for that RM task. Attendance alone never creates a personal SLA breach; unconfirmed ownership is shown for review.

## Follow-up and evidence

The snapshot reads RM-owned calls, outgoing emails, communications and completed meetings after the selected meeting and before now. Calls are attempts, not proof of a connection. Notes and completed tasks never stand in for outreach. Contact-linked evidence may concern another opportunity; the timeline shows linkage, author, timestamp and recorded status. Failed sources and capped history explicitly indicate incomplete coverage.

Tasks are directly linked to contacts/deals and must belong to the selected RM. A task linked to a different known opportunity cannot satisfy coverage. SLA rules use the existing Sunday–Thursday 09:00–16:30 Riyadh work calendar; holidays are not configured. Current evidence drives progress indicators, not reconstructed historical stage changes.

Cache generations prevent an in-flight pre-save read from repopulating a stale post-save cache. Snapshots share a two-minute cache across six pages; an in-flight build is reused. Open drawers pause automatic refresh. Saves invalidate this cache, and stale optimistic write checks remain in place. The activity drawer loads associated records on demand, preserves warning states, and does not expose tokens or raw recording URLs.

## Transcript access

Only `hs_has_meeting_transcript` establishes reported HubSpot availability. `hs_meeting_summary` is displayed as a summary, never a transcript. The drawer opens the associated CRM record so authorized users can select the meeting and review its private transcript/recording in HubSpot. Full transcript text is not fetched through an undocumented endpoint or synthesized when unavailable.

## Not changed

No CRM properties, customer records, tasks, meetings or email sends are created by loading the dashboard. Existing mutation confirmations and CRM read-back remain. Scheduled email summaries/escalation, individual RM identity and task creation are separate rollout work.
