# Metric dictionary

## Global reporting rules

- Default SDR owner: Marita Chedid (`31644369`).
- Default start date: 1 July 2026.
- Reporting timezone: Asia/Riyadh (UTC+3), matching the HubSpot account.
- Date range applies to activity dates. The portfolio KPI remains the current set of contacts whose `sdr_owner` is the selected SDR.
- Country, original source, latest source, tier, and persona filters define a contact cohort. Activity filters use HubSpot associations to keep calls, meetings, tasks, emails, companies, and deals aligned with that cohort where associations are available.

## Source and attribution fields

| Layer | HubSpot property | Meaning |
|---|---|---|
| Original traffic source | `hs_analytics_source` | First known acquisition channel |
| Original drill-down 1 | `hs_analytics_source_data_1` | First-touch campaign/provider detail |
| Original drill-down 2 | `hs_analytics_source_data_2` | More specific first-touch detail |
| Latest traffic source | `hs_latest_source` | Most recent tracked session source |
| Latest drill-downs | `hs_latest_source_data_1`, `hs_latest_source_data_2` | Latest-touch detail |
| Latest source date | `hs_latest_source_timestamp` | When the latest source was observed |
| Record source | `hs_object_source_label` | How the CRM record was created |
| Record source detail | `hs_object_source_detail_1..3` | Import/API/integration/form detail |
| Lead source | `lead_source` | User-defined lead acquisition classification |
| Contact source | `contact_source` | User-defined contact source |
| UTMs | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | Campaign tracking values |
| First conversion | `first_conversion_event_name`, `first_conversion_date` | First form conversion |
| Recent conversion | `recent_conversion_event_name`, `recent_conversion_date` | Latest form conversion |
| Converting campaigns | `hs_analytics_first_touch_converting_campaign`, `hs_analytics_last_touch_converting_campaign` | First/last converting campaign |
| Meeting attribution | `engagements_last_meeting_booked_source`, `engagements_last_meeting_booked_campaign` | Tracked meeting-booking UTM source/campaign |
| GTM provider source | Company `gtm_source` plus contact research/enrichment properties | Outbound intelligence provider; must not overwrite Original Traffic Source |

## Portfolio and quality

| Metric | Definition |
|---|---|
| SDR portfolio | Current contacts where `sdr_owner = selected owner` |
| New contacts | Portfolio contacts whose `createdate` is inside the selected period |
| Distinct companies | Unique populated contact `company_id`, batch-read as company records |
| Untouched | `notes_last_contacted` is blank |
| Untouched over 24h | Untouched contact whose `createdate` is more than 24 hours old |
| Next activity coverage | Contacts with `notes_next_activity_date` / portfolio contacts |
| No next activity | Portfolio contacts without `notes_next_activity_date` |
| Lead response time coverage | Reporting-period contacts with `hs_time_to_first_engagement` / reporting-period contacts |
| Median lead response time | Median populated `hs_time_to_first_engagement`, converted from milliseconds to hours |
| Verified email | `gtm_email_status` contains a valid/verified/deliverable value |
| Tested phone | `phone_number_status` contains a correct/valid/verified value |
| SignalHire coverage | `signalhire_match_status` is populated |
| ICP | `gtm_icp_tier`, `gtm_icp_score`, `gtm_persona`, `gtm_contact_priority` |

`createdate` is not an SDR assignment date. For exact daily assignment reporting, add `sdr_owner_assigned_date` and update it whenever `sdr_owner` changes.

## Calls

- Calls are filtered by `hubspot_owner_id` and `hs_timestamp`.
- Connected disposition ID: `f240bbac-87c9-4f6e-bf70-924b57d47db7`.
- Connection rate = connected calls / all calls.
- Call outcomes use `hs_call_disposition`; call state uses `hs_call_status`.

## Meetings

- Productivity attribution: `hs_created_by_user_id` and `hs_createdate`.
- Sales assignment: `hubspot_owner_id`.
- Meeting date: `hs_meeting_start_time`.
- Outcome: `hs_meeting_outcome`.
- Source: `hs_meeting_source`.
- Calendar booking sources include `BIDIRECTIONAL_API`, `BIDIRECTIONAL_SYNC`, `MEETINGS_PUBLIC`, and `MEETINGS_EMBEDDED`.

HubSpot currently contains calendar-sync meeting records plus separate CRM UI outcome records for some meetings. The dashboard groups records by associated contact, local meeting date, and hour, then merges the strongest outcome in this order: Completed, No Show, Canceled, Rescheduled, Scheduled. The operational process should still update the original meeting outcome instead of creating another meeting activity.

## Tasks

- Assigned owner: `hubspot_owner_id`.
- Due date: `hs_timestamp`.
- Completed date: `hs_task_completion_date`.
- Status: `hs_task_status`.
- Open workload combines `NOT_STARTED`, `IN_PROGRESS`, `WAITING`, and `DEFERRED`.
- Overdue = open task with a due timestamp before now.
- Due today and due tomorrow use the HubSpot account timezone.
- High-priority open tasks use `hs_task_priority = HIGH`.
- Task workload buckets separate overdue-before-today, due today, due tomorrow, future, and missing due date.

## Emails

- Owner and date: `hubspot_owner_id`, `hs_timestamp`.
- Direction: `hs_email_direction`.
- Delivery state: `hs_email_status`.
- Engagement: `hs_email_open_count`, `hs_email_click_count`, `hs_email_reply_count`.
- Reply rate = outgoing email records with at least one reply / outgoing email records.

## Companies and ATS

- Firmographics: `gtm_country`/`country`, `gtm_industry`/`industry`, `gtm_employee_count`/`numberofemployees`.
- ATS: `ats_status`, `detected_ats`, `ats_category`, `ats_confidence`, `ats_evidence_url`.
- Career intelligence: `career_page_url`, `gtm_segment`, `gtm_recommended_product`.

## Deals and pipeline

- Contacts are batch-associated to deals; deal IDs are deduplicated before reading.
- Created deals use `createdate` in the selected period.
- Open deals use `hs_is_closed != true`.
- Pipeline value uses `amount_in_home_currency`, then falls back to `amount`.
- Deal stages are resolved from HubSpot pipeline metadata.
- Meeting-to-deal conversion = deals created in period / deduplicated meetings created in period.
