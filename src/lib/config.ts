export const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? "145742477";
export const HUBSPOT_UI_DOMAIN = process.env.HUBSPOT_UI_DOMAIN ?? "app-eu1.hubspot.com";
export const HUBSPOT_TIMEZONE = process.env.HUBSPOT_TIMEZONE ?? "Asia/Riyadh";
export const DEFAULT_SDR_OWNER_ID = process.env.DEFAULT_SDR_OWNER_ID ?? "31644369";

export const CONNECTED_CALL_DISPOSITION = "f240bbac-87c9-4f6e-bf70-924b57d47db7";

export const CALL_DISPOSITION_LABELS: Record<string, string> = {
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Busy",
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Left live message",
  "b2cf5968-551e-4856-9783-52b3da59a7d0": "Left voicemail",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "No answer",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Wrong number",
};

export const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "jobtitle",
  "company",
  "company_id",
  "country",
  "createdate",
  "hubspot_owner_id",
  "sdr_owner",
  "lifecyclestage",
  "hs_lead_status",
  "hs_analytics_source",
  "hs_analytics_source_data_1",
  "hs_analytics_source_data_2",
  "hs_latest_source",
  "hs_latest_source_data_1",
  "hs_latest_source_data_2",
  "hs_latest_source_timestamp",
  "hs_object_source_label",
  "hs_object_source_detail_1",
  "hs_object_source_detail_2",
  "hs_object_source_detail_3",
  "lead_source",
  "contact_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "first_conversion_event_name",
  "first_conversion_date",
  "recent_conversion_event_name",
  "recent_conversion_date",
  "hs_analytics_first_touch_converting_campaign",
  "hs_analytics_last_touch_converting_campaign",
  "engagements_last_meeting_booked_source",
  "engagements_last_meeting_booked_campaign",
  "notes_last_contacted",
  "notes_last_updated",
  "notes_next_activity_date",
  "hs_last_sales_activity_timestamp",
  "num_notes",
  "hs_time_to_first_engagement",
  "hs_sequences_is_enrolled",
  "hs_latest_sequence_enrolled",
  "hs_sales_email_last_clicked",
  "gtm_persona",
  "gtm_icp_tier",
  "gtm_icp_score",
  "gtm_contact_priority",
  "gtm_email_status",
  "gtm_email_source",
  "gtm_phone_type",
  "gtm_phone_confidence",
  "gtm_phone_enrichment_source",
  "gtm_linkedin_url",
  "gtm_recommended_product",
  "gtm_recommended_action",
  "gtm_contact_research_sources",
  "phone_number_status",
  "signalhire_match_status",
  "signalhire_last_enriched_at",
  "apollo_person_id",
] as const;

export const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "country",
  "gtm_country",
  "industry",
  "gtm_industry",
  "numberofemployees",
  "gtm_employee_count",
  "company_tier",
  "gtm_segment",
  "gtm_source",
  "gtm_recommended_product",
  "ats_status",
  "detected_ats",
  "ats_category",
  "ats_confidence",
  "ats_evidence_url",
  "career_page_url",
] as const;

export const CALL_PROPERTIES = [
  "hs_timestamp",
  "hs_call_status",
  "hs_call_disposition",
  "hs_call_duration",
  "hs_call_title",
  "hubspot_owner_id",
  "hs_created_by_user_id",
] as const;

export const MEETING_PROPERTIES = [
  "hs_timestamp",
  "hs_createdate",
  "hs_meeting_start_time",
  "hs_meeting_end_time",
  "hs_meeting_title",
  "hs_meeting_outcome",
  "hs_meeting_source",
  "hubspot_owner_id",
  "hs_created_by_user_id",
] as const;

export const TASK_PROPERTIES = [
  "hs_timestamp",
  "hs_createdate",
  "hs_task_completion_date",
  "hs_task_status",
  "hs_task_is_overdue",
  "hs_task_priority",
  "hs_task_subject",
  "hubspot_owner_id",
] as const;

export const EMAIL_PROPERTIES = [
  "hs_timestamp",
  "hs_createdate",
  "hs_email_direction",
  "hs_email_status",
  "hs_email_open_count",
  "hs_email_click_count",
  "hs_email_reply_count",
  "hs_email_subject",
  "hubspot_owner_id",
] as const;

export const DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "pipeline",
  "amount",
  "amount_in_home_currency",
  "sar_amount",
  "createdate",
  "closedate",
  "hubspot_owner_id",
  "hs_is_closed",
  "hs_is_closed_won",
  "notes_next_activity_date",
] as const;

export const BOOKING_MEETING_SOURCES = new Set([
  "BIDIRECTIONAL_API",
  "BIDIRECTIONAL_SYNC",
  "MEETINGS_PUBLIC",
  "MEETINGS_EMBED",
]);

const HUBSPOT_OBJECT_TYPE_IDS = {
  contact: "0-1",
  company: "0-2",
  deal: "0-3",
  task: "0-27",
  meeting: "0-47",
  call: "0-48",
  email: "0-49",
} as const;

export type HubSpotObjectType = keyof typeof HUBSPOT_OBJECT_TYPE_IDS;

export function hubspotRecordUrl(objectType: HubSpotObjectType, id: string) {
  const typeId = HUBSPOT_OBJECT_TYPE_IDS[objectType];
  return `https://${HUBSPOT_UI_DOMAIN}/contacts/${HUBSPOT_PORTAL_ID}/record/${typeId}/${id}?utm_source=sdr_project&utm_medium=dashboard&utm_campaign=drilldown`;
}

export function hubspotListUrl(objectType: HubSpotObjectType) {
  const typeId = HUBSPOT_OBJECT_TYPE_IDS[objectType];
  return `https://${HUBSPOT_UI_DOMAIN}/contacts/${HUBSPOT_PORTAL_ID}/objects/${typeId}/views/all/list?utm_source=sdr_project&utm_medium=dashboard&utm_campaign=object_list`;
}
