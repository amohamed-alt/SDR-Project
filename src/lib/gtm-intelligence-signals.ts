export type IntelligenceContact = {
  id: string;
  companyId: string;
  createdAt: string;
  lastSalesActivityAt: string;
  nextActivityAt: string;
  firstEngagementMs: number | null;
  hasPhone: boolean;
  hasEmail: boolean;
  hasLinkedIn: boolean;
};

export type IntelligenceDeal = {
  id: string;
  contactIds: string[];
  createdAt: string;
  closeDate: string;
  nextActivityAt: string;
  isOpen: boolean;
};

export type IntelligenceMeeting = {
  id: string;
  contactIds: string[];
  createdAt: string;
  startAt: string;
  endAt: string;
  outcome: string;
};

export type IntelligenceActivity = {
  id: string;
  contactIds: string[];
  occurredAt: string;
  kind: "call" | "email" | "whatsapp" | "meeting";
  connected?: boolean;
  emailOpenCount?: number;
  emailClickCount?: number;
  emailReplyCount?: number;
};

export type SignalMetric = {
  count: number;
  ids: string[];
};

export type ConversionMetric = {
  numerator: number;
  denominator: number;
  rate: number;
};

export type AccountEngagement = {
  companyId: string;
  score: number;
  connectedCalls: number;
  emailReplies: number;
  emailClicks: number;
  emailOpens: number;
  hasMeeting: boolean;
};

export type MissingContactInfo = {
  missingPhone: SignalMetric;
  missingEmail: SignalMetric;
  missingLinkedIn: SignalMetric;
  missingAny: SignalMetric;
};

export type LeadResponseSla = {
  eligible: number;
  met: number;
  missing: number;
  rate: number;
  overdueIds: string[];
};

export type GtmIntelligenceSignals = {
  staleDeals: SignalMetric;
  dealsWithoutFutureActivity: SignalMetric;
  dealsWithOverdueCloseDate: SignalMetric;
  meetingsWithoutFollowUp: SignalMetric;
  completedMeetingsWithoutProgression: SignalMetric;
  noShowMeetings: SignalMetric;
  highEngagementAccountsWithoutMeeting: SignalMetric;
  contactsWithConnectedCallsWithoutMeeting: SignalMetric;
  meetingToDealConversion: ConversionMetric;
  connectedCallToMeetingConversion: ConversionMetric;
  accountEngagement: AccountEngagement[];
  leadResponseSla: LeadResponseSla;
  missingContactInfo: MissingContactInfo;
};

export type GtmIntelligenceInput = {
  contacts: IntelligenceContact[];
  deals: IntelligenceDeal[];
  meetings: IntelligenceMeeting[];
  activities: IntelligenceActivity[];
  from: string;
  to: string;
  now?: Date;
  staleAfterDays?: number;
  followUpSlaHours?: number;
  progressionGraceDays?: number;
  highEngagementThreshold?: number;
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function inPeriod(value: string, from: string, to: string) {
  const at = timestamp(value);
  return at >= timestamp(`${from}T00:00:00+03:00`) && at <= timestamp(`${to}T23:59:59.999+03:00`);
}

function signalMetric(ids: Iterable<string>): SignalMetric {
  const uniqueIds = [...new Set(ids)];
  return { count: uniqueIds.length, ids: uniqueIds };
}

function rate(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function futureActivityAfter(value: string, after: number, now: number) {
  const at = timestamp(value);
  return at > after && at >= now;
}

/**
 * Account engagement score definition: 30 points per connected call (maximum 60),
 * 30 points per email reply (maximum 30), 15 points per email click (maximum 30),
 * and 10 points when three or more email opens are logged. Scores are capped at 100.
 * Only explicit HubSpot engagement fields contribute; untracked website visits and
 * inferred intent do not contribute.
 */
function calculateAccountEngagement(
  contacts: IntelligenceContact[],
  meetings: IntelligenceMeeting[],
  activities: IntelligenceActivity[],
): AccountEngagement[] {
  const contactCompanies = new Map(contacts.filter((contact) => contact.companyId).map((contact) => [contact.id, contact.companyId]));
  const byCompany = new Map<string, Omit<AccountEngagement, "score">>();

  for (const companyId of new Set(contactCompanies.values())) {
    byCompany.set(companyId, { companyId, connectedCalls: 0, emailReplies: 0, emailClicks: 0, emailOpens: 0, hasMeeting: false });
  }

  for (const activity of activities) {
    const companyIds = new Set(activity.contactIds.map((contactId) => contactCompanies.get(contactId)).filter(Boolean) as string[]);
    for (const companyId of companyIds) {
      const account = byCompany.get(companyId);
      if (!account) continue;
      if (activity.kind === "call" && activity.connected) account.connectedCalls += 1;
      if (activity.kind === "email") {
        account.emailReplies += Math.max(0, activity.emailReplyCount ?? 0);
        account.emailClicks += Math.max(0, activity.emailClickCount ?? 0);
        account.emailOpens += Math.max(0, activity.emailOpenCount ?? 0);
      }
    }
  }

  for (const meeting of meetings) {
    for (const contactId of meeting.contactIds) {
      const companyId = contactCompanies.get(contactId);
      const account = companyId ? byCompany.get(companyId) : undefined;
      if (account) account.hasMeeting = true;
    }
  }

  return [...byCompany.values()]
    .map((account) => ({
      ...account,
      score: Math.min(100,
        Math.min(account.connectedCalls * 30, 60)
        + Math.min(account.emailReplies * 30, 30)
        + Math.min(account.emailClicks * 15, 30)
        + (account.emailOpens >= 3 ? 10 : 0),
      ),
    }))
    .sort((left, right) => right.score - left.score || left.companyId.localeCompare(right.companyId));
}

export function calculateGtmIntelligenceSignals(input: GtmIntelligenceInput): GtmIntelligenceSignals {
  const now = input.now?.getTime() ?? Date.now();
  const staleAfterDays = input.staleAfterDays ?? 21;
  const followUpSlaHours = input.followUpSlaHours ?? 24;
  const progressionGraceDays = input.progressionGraceDays ?? 7;
  const highEngagementThreshold = input.highEngagementThreshold ?? 60;
  const contactsById = new Map(input.contacts.map((contact) => [contact.id, contact]));
  const activitiesByContact = new Map<string, IntelligenceActivity[]>();

  for (const activity of input.activities) {
    for (const contactId of activity.contactIds) {
      const items = activitiesByContact.get(contactId) ?? [];
      items.push(activity);
      activitiesByContact.set(contactId, items);
    }
  }

  function hasLoggedFollowUp(contactIds: string[], after: number) {
    return contactIds.some((contactId) => {
      const contact = contactsById.get(contactId);
      if (timestamp(contact?.lastSalesActivityAt ?? "") > after) return true;
      return (activitiesByContact.get(contactId) ?? []).some((activity) => timestamp(activity.occurredAt) > after);
    });
  }

  function hasScheduledNextActivity(contactIds: string[], after: number) {
    return contactIds.some((contactId) => futureActivityAfter(contactsById.get(contactId)?.nextActivityAt ?? "", after, now));
  }

  function dealCreatedAfterMeeting(contactIds: string[], meetingAt: number) {
    return input.deals.some((deal) => deal.contactIds.some((contactId) => contactIds.includes(contactId)) && timestamp(deal.createdAt) >= meetingAt);
  }

  /**
   * Stale deals definition: open deals whose latest known sales activity across
   * associated dashboard contacts is older than 21 days. Deals without any known
   * activity are stale only when they were created more than 21 days ago.
   */
  const staleDeals = signalMetric(input.deals
    .filter((deal) => {
      if (!deal.isOpen) return false;
      const latestKnownActivity = Math.max(
        timestamp(deal.createdAt),
        ...deal.contactIds.map((contactId) => timestamp(contactsById.get(contactId)?.lastSalesActivityAt ?? "")),
      );
      return latestKnownActivity > 0 && latestKnownActivity <= now - staleAfterDays * DAY_MS;
    })
    .map((deal) => deal.id));

  /**
   * Deals with no future activity definition: open deals with no deal-level
   * `notes_next_activity_date` on or after now. A past or blank date is not a
   * future activity, and contact-level dates are deliberately not substituted.
   */
  const dealsWithoutFutureActivity = signalMetric(input.deals
    .filter((deal) => deal.isOpen && !futureActivityAfter(deal.nextActivityAt, 0, now))
    .map((deal) => deal.id));

  /**
   * Overdue close-date definition: open deals with a populated close date before
   * the current instant. Closed deals and blank/unparseable close dates are excluded.
   */
  const dealsWithOverdueCloseDate = signalMetric(input.deals
    .filter((deal) => deal.isOpen && timestamp(deal.closeDate) > 0 && timestamp(deal.closeDate) < now)
    .map((deal) => deal.id));

  /**
   * Meetings with no follow-up definition: completed or no-show meetings that
   * ended at least 24 hours ago and have no later logged call, email, WhatsApp,
   * meeting, or `hs_last_sales_activity_timestamp` on any associated contact.
   */
  const meetingsWithoutFollowUp = signalMetric(input.meetings
    .filter((meeting) => {
      const endAt = timestamp(meeting.endAt || meeting.startAt);
      return (meeting.outcome === "COMPLETED" || meeting.outcome === "NO_SHOW")
        && endAt > 0
        && endAt <= now - followUpSlaHours * HOUR_MS
        && !hasLoggedFollowUp(meeting.contactIds, endAt);
    })
    .map((meeting) => meeting.id));

  /**
   * Completed meetings with no progression definition: completed meetings at
   * least seven days old with neither an associated deal created on/after the
   * meeting nor a contact-level next activity scheduled after it. This avoids
   * treating a mere historical touch as sales progression.
   */
  const completedMeetingsWithoutProgression = signalMetric(input.meetings
    .filter((meeting) => {
      const meetingAt = timestamp(meeting.startAt);
      return meeting.outcome === "COMPLETED"
        && meetingAt > 0
        && meetingAt <= now - progressionGraceDays * DAY_MS
        && !dealCreatedAfterMeeting(meeting.contactIds, meetingAt)
        && !hasScheduledNextActivity(meeting.contactIds, meetingAt);
    })
    .map((meeting) => meeting.id));

  /**
   * No-show meetings definition: meetings explicitly marked `NO_SHOW` whose
   * start time is in the past. Scheduled or outcome-unknown meetings are excluded.
   */
  const noShowMeetings = signalMetric(input.meetings
    .filter((meeting) => meeting.outcome === "NO_SHOW" && timestamp(meeting.startAt) > 0 && timestamp(meeting.startAt) < now)
    .map((meeting) => meeting.id));

  const accountEngagement = calculateAccountEngagement(input.contacts, input.meetings, input.activities);

  /**
   * High-engagement accounts without a meeting definition: company-associated
   * accounts with an engagement score of at least 60 and no associated meeting.
   * The score threshold requires multiple explicit high-intent signals (for
   * example, two connected calls), not a single email open or click.
   */
  const highEngagementAccountsWithoutMeeting = signalMetric(accountEngagement
    .filter((account) => account.score >= highEngagementThreshold && !account.hasMeeting)
    .map((account) => account.companyId));

  const connectedContactIds = new Set(input.activities
    .filter((activity) => activity.kind === "call" && activity.connected)
    .flatMap((activity) => activity.contactIds));
  const meetingContactIds = new Set(input.meetings.flatMap((meeting) => meeting.contactIds));

  /**
   * Contacts with connected calls but no meeting definition: distinct dashboard
   * contacts with one or more explicitly connected calls and no associated
   * deduplicated meeting, regardless of the meeting outcome or call age.
   */
  const contactsWithConnectedCallsWithoutMeeting = signalMetric([...connectedContactIds]
    .filter((contactId) => contactsById.has(contactId) && !meetingContactIds.has(contactId)));

  const periodMeetings = input.meetings.filter((meeting) => inPeriod(meeting.createdAt, input.from, input.to));
  const periodDealIds = new Set(input.deals.filter((deal) => inPeriod(deal.createdAt, input.from, input.to)).map((deal) => deal.id));

  /**
   * Meeting-to-deal conversion definition: distinct associated deals created in
   * the reporting period divided by deduplicated meetings created in that period.
   * This preserves the existing dashboard metric dictionary definition.
   */
  const meetingToDealConversion: ConversionMetric = {
    numerator: periodDealIds.size,
    denominator: periodMeetings.length,
    rate: rate(periodDealIds.size, periodMeetings.length),
  };

  const connectedCallsInPeriod = input.activities.filter((activity) => activity.kind === "call" && activity.connected && inPeriod(activity.occurredAt, input.from, input.to));

  /**
   * Connected-call-to-meeting conversion definition: deduplicated meetings
   * created in the reporting period divided by explicitly connected calls logged
   * in that period. It is a volume conversion, not a per-contact attribution claim.
   */
  const connectedCallToMeetingConversion: ConversionMetric = {
    numerator: periodMeetings.length,
    denominator: connectedCallsInPeriod.length,
    rate: rate(periodMeetings.length, connectedCallsInPeriod.length),
  };

  const responseContacts = input.contacts.filter((contact) => inPeriod(contact.createdAt, input.from, input.to));
  const overdueResponseIds = responseContacts
    .filter((contact) => contact.firstEngagementMs === null || contact.firstEngagementMs > followUpSlaHours * HOUR_MS)
    .map((contact) => contact.id);
  const metResponseCount = responseContacts.filter((contact) => contact.firstEngagementMs !== null && contact.firstEngagementMs <= followUpSlaHours * HOUR_MS).length;

  /**
   * Lead response SLA definition: contacts created in the reporting period meet
   * SLA only when HubSpot's `hs_time_to_first_engagement` is populated and is at
   * most 24 hours. Missing timing is treated as not met rather than estimated.
   */
  const leadResponseSla: LeadResponseSla = {
    eligible: responseContacts.length,
    met: metResponseCount,
    missing: responseContacts.filter((contact) => contact.firstEngagementMs === null).length,
    rate: rate(metResponseCount, responseContacts.length),
    overdueIds: overdueResponseIds,
  };

  /**
   * Missing contact information definition: each field is missing when its
   * normalized dashboard value is blank. `missingAny` is the union of contacts
   * missing phone, email, or LinkedIn; validation status is intentionally separate.
   */
  const missingContactInfo: MissingContactInfo = {
    missingPhone: signalMetric(input.contacts.filter((contact) => !contact.hasPhone).map((contact) => contact.id)),
    missingEmail: signalMetric(input.contacts.filter((contact) => !contact.hasEmail).map((contact) => contact.id)),
    missingLinkedIn: signalMetric(input.contacts.filter((contact) => !contact.hasLinkedIn).map((contact) => contact.id)),
    missingAny: signalMetric(input.contacts
      .filter((contact) => !contact.hasPhone || !contact.hasEmail || !contact.hasLinkedIn)
      .map((contact) => contact.id)),
  };

  return {
    staleDeals,
    dealsWithoutFutureActivity,
    dealsWithOverdueCloseDate,
    meetingsWithoutFollowUp,
    completedMeetingsWithoutProgression,
    noShowMeetings,
    highEngagementAccountsWithoutMeeting,
    contactsWithConnectedCallsWithoutMeeting,
    meetingToDealConversion,
    connectedCallToMeetingConversion,
    accountEngagement,
    leadResponseSla,
    missingContactInfo,
  };
}
