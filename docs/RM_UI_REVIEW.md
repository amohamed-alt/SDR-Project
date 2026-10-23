# RM workspace UI review

Reviewed on 23 October 2026 against the live Zein workspace. This is a working CRM queue: the primary question is which account needs action and where the RM should record it.

## Sources consulted

- Anthropic frontend-design: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- UI/UX Pro Max: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Taste app-screen guidance: https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/references/app-screens.md

These are design references, not installed dependencies. No external Claude session was invoked. Repository operating rules and existing CRM safeguards take precedence.

## Findings and decisions

The live review showed 78 company/contact groups and 129 meeting records. At the observed desktop viewport the first account began at roughly 663 CSS pixels. A long unpaginated account list also pushed the private tracker sources far below the working queue. The missing-upcoming-task message appeared twice in individual rows.

Keep the existing Talentera mark, teal accent, DM Sans/Manrope typography, named RM navigation and record drawer. Reduce header/date/KPI padding together, increase working table text to 13px, use sentence-case table headings, and reserve amber for actionable exceptions. This applies the references to an existing product rather than adopting an unrelated visual kit.

Show 20 account groups per page. Pagination affects presentation only; summary counts and the fixed 13 July 2026 through today reporting period retain their scope. Search, SDR, SLA and queue filters reset the displayed page. Clamp the page after a refresh reduces the number of results.

Give each account an explicit Update HubSpot action that opens the existing verified editing flow. Do not create tasks, write properties, or change SLA classification from presentation controls. Remove duplicate task warnings from the summary row; preserve full evidence and issues in the drawer.

## Verification targets

- Desktop first account moves up while remaining readable.
- Mobile page and drawer have no horizontal overflow.
- Long lists show every group across pages without altering totals.
- Filtering on the last page returns the first matching page.
- Direct edit opens the verified HubSpot editor; it never writes automatically.
- Existing keyboard, save confirmation, disqualification and ownership tests remain green.
