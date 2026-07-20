import type {
  AcquisitionData,
  AcquisitionPeriodMetrics,
  AcquisitionRepSummary,
  ActivityRow,
  ContactRow,
  DealRow,
} from "@/lib/types";

export type AcquisitionPeriodKey = "yesterday" | "mtd" | "ytd";
export type AcquisitionSourceFilter = "all" | "online" | "offline";
export type AcquisitionRankFilter = "all" | "A" | "B";
export type AcquisitionRecordKind = "contacts" | "activities" | "deals";

export interface AcquisitionFilters {
  ownerId: string;
  period: AcquisitionPeriodKey;
  country: string;
  rank: AcquisitionRankFilter;
  source: AcquisitionSourceFilter;
  stage: string;
}

export interface AcquisitionScoreboardRow {
  ownerId: string;
  name: string;
  initials: string;
  color: string;
  mode: "full" | "deal_only";
  calls: number;
  connected: number;
  connectionRate: number;
  meetingsBooked: number;
  meetingsCompleted: number;
  tasksCompleted: number;
  leads: number;
  newDeals: number;
  won: number;
  lost: number;
  pipelineCreated: number;
  openDeals: number;
  openPipeline: number;
  dealsAtRisk: number;
}

export interface AcquisitionRankCountryRow {
  country: string;
  aTotal: number;
  aContacted: number;
  aMeetings: number;
  aUntouched: number;
  bTotal: number;
  bContacted: number;
  bMeetings: number;
  bUntouched: number;
}

export interface AcquisitionDealBucket {
  key: "open" | "at_risk" | "won" | "lost";
  label: string;
  count: number;
  amount: number;
}

export interface AcquisitionSummaryResponse {
  meta: AcquisitionData["meta"] & {
    payloadMode: "summary";
    period: AcquisitionPeriodKey;
    periodFrom: string;
    periodTo: string;
  };
  filters: AcquisitionFilters;
  options: {
    countries: string[];
    stages: string[];
  };
  reps: Array<Pick<AcquisitionRepSummary, "ownerId" | "name" | "email" | "initials" | "color" | "mode">>;
  selected: {
    ownerId: string;
    name: string;
    mode: "full" | "deal_only";
  };
  focus: {
    leadsNeedContact: number;
    rankABUntouched: number;
    dealsAtRisk: number;
    contactedLeads: number;
    eligibleLeads: number;
    contactRate: number;
    openDeals: number;
    openPipeline: number;
  };
  periodMetrics: AcquisitionPeriodMetrics;
  scoreboard: AcquisitionScoreboardRow[];
  rankCoverage: {
    aTotal: number;
    aContacted: number;
    aMeetings: number;
    aUntouched: number;
    bTotal: number;
    bContacted: number;
    bMeetings: number;
    bUntouched: number;
    countries: AcquisitionRankCountryRow[];
  };
  dealBuckets: AcquisitionDealBucket[];
  dealStages: Array<{ name: string; value: number; amount: number }>;
  leadSources: Array<{ name: string; value: number }>;
  priorityContacts: ContactRow[];
}

interface SearchParamsLike {
  get(name: string): string | null;
}

const DEAL_ONLY_OWNER_IDS = new Set(["76369998", "76369995"]);

function valueOrAll(value: string | null) {
  return value?.trim() || "all";
}

export function parseAcquisitionFilters(searchParams: SearchParamsLike): AcquisitionFilters {
  const rawPeriod = searchParams.get("period");
  const period: AcquisitionPeriodKey = rawPeriod === "yesterday" || rawPeriod === "ytd" ? rawPeriod : "mtd";
  const rawRank = searchParams.get("rank");
  const rank: AcquisitionRankFilter = rawRank === "A" || rawRank === "B" ? rawRank : "all";
  const rawSource = searchParams.get("source");
  const source: AcquisitionSourceFilter = rawSource === "online" || rawSource === "offline" ? rawSource : "all";

  return {
    ownerId: valueOrAll(searchParams.get("ownerId")),
    period,
    country: valueOrAll(searchParams.get("country")),
    rank,
    source,
    stage: valueOrAll(searchParams.get("stage")),
  };
}

function zonedDay(raw: string, timezone: string) {
  if (!raw) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(raw));
}

function inRange(raw: string, from: string, to: string, timezone: string) {
  const day = zonedDay(raw, timezone);
  return Boolean(day && day >= from && day <= to);
}

function periodRange(data: AcquisitionData, period: AcquisitionPeriodKey) {
  if (period === "yesterday") return { from: data.meta.yesterday, to: data.meta.yesterday };
  if (period === "ytd") return { from: data.meta.yearStart, to: data.meta.today };
  return { from: data.meta.monthStart, to: data.meta.today };
}

export function acquisitionSourceBucket(contact: ContactRow): "online" | "offline" | "unknown" {
  const raw = [contact.originalSource, contact.latestSource, contact.contactSource, contact.leadSource]
    .join(" ")
    .toLowerCase();
  if (["online", "inbound", "website", "form", "organic", "paid", "social", "referral", "direct"].some((marker) => raw.includes(marker))) return "online";
  if (["offline", "outbound", "manual", "import", "event", "cold", "prospect", "sales generated"].some((marker) => raw.includes(marker))) return "offline";
  return "unknown";
}

function contactMatches(contact: ContactRow, filters: AcquisitionFilters, ownerId = filters.ownerId) {
  if (ownerId !== "all" && contact.ownerId !== ownerId) return false;
  if (filters.country !== "all" && contact.country !== filters.country) return false;
  if (filters.rank !== "all" && contact.companyRank !== filters.rank) return false;
  if (filters.source !== "all" && acquisitionSourceBucket(contact) !== filters.source) return false;
  return true;
}

function dealMatches(deal: DealRow, filters: AcquisitionFilters, ownerId = filters.ownerId) {
  if (ownerId !== "all" && deal.ownerId !== ownerId) return false;
  if (filters.stage !== "all" && deal.stage !== filters.stage) return false;
  return true;
}

function isAtRisk(deal: DealRow, today: string, timezone: string) {
  const closeDay = zonedDay(deal.closeDate, timezone);
  return Boolean(deal.isOpen && (!deal.nextActivity || (closeDay && closeDay < today)));
}

function matchingActivity(
  activity: ActivityRow,
  filters: AcquisitionFilters,
  matchingContactIds: Set<string>,
  ownerId = filters.ownerId,
) {
  if (ownerId !== "all" && activity.ownerId !== ownerId) return false;
  const leadFilterActive = filters.country !== "all" || filters.rank !== "all" || filters.source !== "all";
  if (!leadFilterActive) return true;
  return Boolean(activity.relatedContactId && matchingContactIds.has(activity.relatedContactId));
}

function uniqueCompanyContacts(rows: ContactRow[]) {
  const companies = new Map<string, ContactRow>();
  for (const row of rows) {
    if (!row.companyId || row.companyOwnerId !== row.ownerId) continue;
    if (row.companyRank !== "A" && row.companyRank !== "B") continue;
    const previous = companies.get(row.companyId);
    if (!previous || row.priorityScore > previous.priorityScore) companies.set(row.companyId, row);
  }
  return [...companies.values()];
}

function ownerMode(rep: AcquisitionRepSummary) {
  return rep.mode === "deal_only" || DEAL_ONLY_OWNER_IDS.has(rep.ownerId) ? "deal_only" as const : "full" as const;
}

function ownerPeriodMetrics(
  data: AcquisitionData,
  filters: AcquisitionFilters,
  ownerId: string,
  mode: "full" | "deal_only",
): AcquisitionPeriodMetrics {
  const timezone = data.meta.timezone;
  const range = periodRange(data, filters.period);
  const contacts = mode === "deal_only"
    ? []
    : data.contacts.filter((row) => contactMatches(row, filters, ownerId));
  const contactIds = new Set(contacts.map((row) => row.id));
  const activities = mode === "deal_only"
    ? []
    : data.activities.filter((row) => matchingActivity(row, filters, contactIds, ownerId));
  const deals = data.deals.filter((row) => dealMatches(row, filters, ownerId));

  const calls = activities.filter((row) => row.type === "Call" && inRange(row.metricAt || row.occurredAt, range.from, range.to, timezone));
  const connectedCalls = calls.filter((row) => row.status === "Connected");
  const meetingsBooked = activities.filter((row) => row.type === "Meeting" && inRange(row.metricAt, range.from, range.to, timezone));
  const meetingsCompleted = activities.filter((row) => row.type === "Meeting" && row.status === "Completed" && inRange(row.occurredAt, range.from, range.to, timezone));
  const tasksCompleted = activities.filter((row) => row.type === "Task" && inRange(row.occurredAt, range.from, range.to, timezone));
  const periodContacts = contacts.filter((row) => inRange(row.createdAt, range.from, range.to, timezone));
  const createdDeals = deals.filter((row) => inRange(row.createdAt, range.from, range.to, timezone));
  const wonDeals = deals.filter((row) => row.isWon && inRange(row.closeDate, range.from, range.to, timezone));
  const lostDeals = deals.filter((row) => !row.isOpen && !row.isWon && inRange(row.closeDate, range.from, range.to, timezone));

  return {
    from: range.from,
    to: range.to,
    contacts: periodContacts.length,
    calls: calls.length,
    connectedCalls: connectedCalls.length,
    connectionRate: calls.length ? Math.round((connectedCalls.length / calls.length) * 1_000) / 10 : 0,
    meetingsBooked: meetingsBooked.length,
    meetingsCompleted: meetingsCompleted.length,
    tasksCompleted: tasksCompleted.length,
    dealsCreated: createdDeals.length,
    dealsWon: wonDeals.length,
    dealsLost: lostDeals.length,
    pipelineCreated: createdDeals.reduce((sum, deal) => sum + deal.amount, 0),
  };
}

function rankCoverage(data: AcquisitionData, contacts: ContactRow[], activities: ActivityRow[]) {
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const companies = uniqueCompanyContacts(contacts);
  const meetingCounts = new Map<string, number>();

  for (const activity of activities) {
    if (activity.type !== "Meeting" || activity.status !== "Completed" || !activity.relatedContactId) continue;
    const contact = contactMap.get(activity.relatedContactId);
    if (!contact?.companyId || contact.companyOwnerId !== activity.ownerId) continue;
    meetingCounts.set(contact.companyId, (meetingCounts.get(contact.companyId) ?? 0) + 1);
  }

  const countries = new Map<string, AcquisitionRankCountryRow>();
  const totals = {
    aTotal: 0, aContacted: 0, aMeetings: 0, aUntouched: 0,
    bTotal: 0, bContacted: 0, bMeetings: 0, bUntouched: 0,
  };

  for (const company of companies) {
    const country = company.country || "Unknown";
    const current = countries.get(country) ?? {
      country,
      aTotal: 0, aContacted: 0, aMeetings: 0, aUntouched: 0,
      bTotal: 0, bContacted: 0, bMeetings: 0, bUntouched: 0,
    };
    const prefix = company.companyRank === "A" ? "a" : "b";
    const meetings = meetingCounts.get(company.companyId ?? "") ?? 0;

    if (prefix === "a") {
      totals.aTotal += 1;
      current.aTotal += 1;
      totals.aMeetings += meetings;
      current.aMeetings += meetings;
      if (company.companyTouched) { totals.aContacted += 1; current.aContacted += 1; }
      else { totals.aUntouched += 1; current.aUntouched += 1; }
    } else {
      totals.bTotal += 1;
      current.bTotal += 1;
      totals.bMeetings += meetings;
      current.bMeetings += meetings;
      if (company.companyTouched) { totals.bContacted += 1; current.bContacted += 1; }
      else { totals.bUntouched += 1; current.bUntouched += 1; }
    }
    countries.set(country, current);
  }

  return {
    ...totals,
    countries: [...countries.values()]
      .sort((a, b) => (b.aTotal + b.bTotal) - (a.aTotal + a.bTotal) || a.country.localeCompare(b.country)),
  };
}

function leadSources(rows: ContactRow[], range: { from: string; to: string }, timezone: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!inRange(row.createdAt, range.from, range.to, timezone)) continue;
    counts.set(row.originalSource, (counts.get(row.originalSource) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

export function buildAcquisitionSummary(data: AcquisitionData, filters: AcquisitionFilters): AcquisitionSummaryResponse {
  const selectedRep = filters.ownerId === "all" ? undefined : data.reps.find((rep) => rep.ownerId === filters.ownerId);
  const selectedMode = selectedRep ? ownerMode(selectedRep) : "full";
  const matchingContacts = selectedMode === "deal_only"
    ? []
    : data.contacts.filter((row) => contactMatches(row, filters));
  const matchingContactIds = new Set(matchingContacts.map((row) => row.id));
  const matchingActivities = selectedMode === "deal_only"
    ? []
    : data.activities.filter((row) => matchingActivity(row, filters, matchingContactIds));
  const matchingDeals = data.deals.filter((row) => dealMatches(row, filters));
  const companyRows = uniqueCompanyContacts(matchingContacts);
  const untouchedCompanies = companyRows.filter((row) => !row.companyTouched);
  const leadsNeedContact = matchingContacts.filter((row) => !row.lastContacted);
  const contactedLeads = matchingContacts.length - leadsNeedContact.length;
  const openDeals = matchingDeals.filter((deal) => deal.isOpen);
  const atRiskDeals = openDeals.filter((deal) => isAtRisk(deal, data.meta.today, data.meta.timezone));
  const period = ownerPeriodMetrics(data, filters, filters.ownerId, selectedMode);
  const range = periodRange(data, filters.period);
  const coverage = rankCoverage(data, matchingContacts, matchingActivities);

  const scoreboard = data.reps.map((rep): AcquisitionScoreboardRow => {
    const mode = ownerMode(rep);
    const metrics = ownerPeriodMetrics(data, filters, rep.ownerId, mode);
    const ownerDeals = data.deals.filter((deal) => dealMatches(deal, filters, rep.ownerId));
    const ownerOpenDeals = ownerDeals.filter((deal) => deal.isOpen);
    return {
      ownerId: rep.ownerId,
      name: rep.name,
      initials: rep.initials,
      color: rep.color,
      mode,
      calls: metrics.calls,
      connected: metrics.connectedCalls,
      connectionRate: metrics.connectionRate,
      meetingsBooked: metrics.meetingsBooked,
      meetingsCompleted: metrics.meetingsCompleted,
      tasksCompleted: metrics.tasksCompleted,
      leads: metrics.contacts,
      newDeals: metrics.dealsCreated,
      won: metrics.dealsWon,
      lost: metrics.dealsLost,
      pipelineCreated: metrics.pipelineCreated,
      openDeals: ownerOpenDeals.length,
      openPipeline: ownerOpenDeals.reduce((sum, deal) => sum + deal.amount, 0),
      dealsAtRisk: ownerOpenDeals.filter((deal) => isAtRisk(deal, data.meta.today, data.meta.timezone)).length,
    };
  });

  const wonDeals = matchingDeals.filter((deal) => deal.isWon);
  const lostDeals = matchingDeals.filter((deal) => !deal.isOpen && !deal.isWon);
  const dealBuckets: AcquisitionDealBucket[] = [
    { key: "open", label: "Open", count: openDeals.length, amount: openDeals.reduce((sum, deal) => sum + deal.amount, 0) },
    { key: "at_risk", label: "At risk", count: atRiskDeals.length, amount: atRiskDeals.reduce((sum, deal) => sum + deal.amount, 0) },
    { key: "won", label: "Won", count: wonDeals.length, amount: wonDeals.reduce((sum, deal) => sum + deal.amount, 0) },
    { key: "lost", label: "Lost", count: lostDeals.length, amount: lostDeals.reduce((sum, deal) => sum + deal.amount, 0) },
  ];

  const stageMap = new Map<string, { value: number; amount: number }>();
  for (const deal of openDeals) {
    const current = stageMap.get(deal.stage) ?? { value: 0, amount: 0 };
    stageMap.set(deal.stage, { value: current.value + 1, amount: current.amount + deal.amount });
  }

  const countries = [...new Set(data.contacts.map((contact) => contact.country).filter(Boolean))].sort();
  const stages = [...new Set(data.deals.map((deal) => deal.stage).filter(Boolean))].sort();

  return {
    meta: {
      ...data.meta,
      payloadMode: "summary",
      period: filters.period,
      periodFrom: range.from,
      periodTo: range.to,
    },
    filters,
    options: { countries, stages },
    reps: data.reps.map((rep) => ({
      ownerId: rep.ownerId,
      name: rep.name,
      email: rep.email,
      initials: rep.initials,
      color: rep.color,
      mode: ownerMode(rep),
    })),
    selected: {
      ownerId: filters.ownerId,
      name: selectedRep?.name ?? "Team Overview",
      mode: selectedMode,
    },
    focus: {
      leadsNeedContact: leadsNeedContact.length,
      rankABUntouched: untouchedCompanies.length,
      dealsAtRisk: atRiskDeals.length,
      contactedLeads,
      eligibleLeads: matchingContacts.length,
      contactRate: matchingContacts.length ? Math.round((contactedLeads / matchingContacts.length) * 1_000) / 10 : 0,
      openDeals: openDeals.length,
      openPipeline: openDeals.reduce((sum, deal) => sum + deal.amount, 0),
    },
    periodMetrics: period,
    scoreboard,
    rankCoverage: coverage,
    dealBuckets,
    dealStages: [...stageMap.entries()]
      .map(([name, totals]) => ({ name, ...totals }))
      .sort((a, b) => b.amount - a.amount),
    leadSources: leadSources(matchingContacts, range, data.meta.timezone),
    priorityContacts: [...matchingContacts]
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 12),
  };
}

export function acquisitionRecordRows(
  data: AcquisitionData,
  filters: AcquisitionFilters,
  kind: AcquisitionRecordKind,
  view: string,
) {
  const contacts = data.contacts.filter((row) => contactMatches(row, filters));
  const contactIds = new Set(contacts.map((row) => row.id));
  const activities = data.activities.filter((row) => matchingActivity(row, filters, contactIds));
  const deals = data.deals.filter((row) => dealMatches(row, filters));
  const range = periodRange(data, filters.period);

  if (kind === "contacts") {
    if (view === "need_contact") return contacts.filter((row) => !row.lastContacted);
    if (view === "rank_untouched") return uniqueCompanyContacts(contacts).filter((row) => !row.companyTouched);
    if (view === "period_leads") return contacts.filter((row) => inRange(row.createdAt, range.from, range.to, data.meta.timezone));
    return [...contacts].sort((a, b) => b.priorityScore - a.priorityScore);
  }

  if (kind === "activities") {
    const periodActivities = activities.filter((row) => inRange(
      view === "meetings_completed" || view === "tasks_completed" ? row.occurredAt : row.metricAt || row.occurredAt,
      range.from,
      range.to,
      data.meta.timezone,
    ));
    if (view === "calls") return periodActivities.filter((row) => row.type === "Call");
    if (view === "connected") return periodActivities.filter((row) => row.type === "Call" && row.status === "Connected");
    if (view === "meetings_booked") return periodActivities.filter((row) => row.type === "Meeting");
    if (view === "meetings_completed") return periodActivities.filter((row) => row.type === "Meeting" && row.status === "Completed");
    if (view === "tasks_completed") return periodActivities.filter((row) => row.type === "Task");
    return periodActivities;
  }

  if (view === "open") return deals.filter((row) => row.isOpen);
  if (view === "at_risk") return deals.filter((row) => isAtRisk(row, data.meta.today, data.meta.timezone));
  if (view === "won") return deals.filter((row) => row.isWon);
  if (view === "lost") return deals.filter((row) => !row.isOpen && !row.isWon);
  if (view === "period_created") return deals.filter((row) => inRange(row.createdAt, range.from, range.to, data.meta.timezone));
  if (view === "period_won") return deals.filter((row) => row.isWon && inRange(row.closeDate, range.from, range.to, data.meta.timezone));
  if (view === "period_lost") return deals.filter((row) => !row.isOpen && !row.isWon && inRange(row.closeDate, range.from, range.to, data.meta.timezone));
  return deals;
}
