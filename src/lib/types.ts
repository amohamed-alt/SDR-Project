export type HubSpotProperties = Record<string, string | null | undefined>;

export interface HubSpotRecord {
  id: string;
  properties: HubSpotProperties;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

export interface HubSpotOwner {
  id: string;
  name: string;
  email?: string;
}

export interface ChartDatum {
  name: string;
  value: number;
  secondary?: number;
  amount?: number;
}

export interface DailyActivityDatum {
  date: string;
  calls: number;
  connected: number;
  tasksCompleted: number;
  tasksDue: number;
  meetingsBooked: number;
  emailsSent: number;
}

export interface KpiMetric {
  value: number;
  previous?: number;
  rate?: number;
}

export interface DashboardKpis {
  portfolioContacts: number;
  newContacts: number;
  companies: number;
  calls: number;
  connectedCalls: number;
  connectionRate: number;
  bookedMeetings: number;
  completedMeetings: number;
  meetingCompletionRate: number;
  openTasks: number;
  overdueTasks: number;
  dueTomorrow: number;
  completedTasks: number;
  emailsSent: number;
  emailReplies: number;
  emailReplyRate: number;
  dealsCreated: number;
  openDeals: number;
  pipelineValue: number;
  untouchedContacts: number;
  nextActivityCoverage: number;
}

export interface QualityMetric {
  key: string;
  label: string;
  complete: number;
  total: number;
  rate: number;
}

export interface AlertItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  count: number;
  action: string;
}

export interface ContactRow {
  id: string;
  name: string;
  title: string;
  company: string;
  country: string;
  originalSource: string;
  latestSource: string;
  recordSource: string;
  leadStatus: string;
  lifecycleStage: string;
  tier: string;
  persona: string;
  emailStatus: string;
  phoneStatus: string;
  lastContacted: string;
  nextActivity: string;
  priorityScore: number;
  url: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  country: string;
  industry: string;
  employees: string;
  tier: string;
  ats: string;
  atsCategory: string;
  atsConfidence: string;
  associatedContacts: number;
  url: string;
}

export interface DealRow {
  id: string;
  name: string;
  stage: string;
  owner: string;
  amount: number;
  closeDate: string;
  url: string;
}

export interface FilterOptions {
  countries: string[];
  originalSources: string[];
  latestSources: string[];
  tiers: string[];
  personas: string[];
  owners: HubSpotOwner[];
}

export interface DashboardData {
  meta: {
    generatedAt: string;
    from: string;
    to: string;
    timezone: string;
    ownerId: string;
    ownerName: string;
    portalId: string;
    isDemo: boolean;
    warnings: string[];
  };
  kpis: DashboardKpis;
  dailyActivities: DailyActivityDatum[];
  funnel: ChartDatum[];
  originalSources: ChartDatum[];
  latestSources: ChartDatum[];
  recordSources: ChartDatum[];
  leadStatuses: ChartDatum[];
  lifecycleStages: ChartDatum[];
  callOutcomes: ChartDatum[];
  meetingOutcomes: ChartDatum[];
  meetingOwners: ChartDatum[];
  meetingSources: ChartDatum[];
  taskStatuses: ChartDatum[];
  emailPerformance: ChartDatum[];
  countries: ChartDatum[];
  industries: ChartDatum[];
  atsPlatforms: ChartDatum[];
  dealStages: ChartDatum[];
  quality: QualityMetric[];
  alerts: AlertItem[];
  priorityContacts: ContactRow[];
  companies: CompanyRow[];
  deals: DealRow[];
  filterOptions: FilterOptions;
}

export interface DashboardFilters {
  from: string;
  to: string;
  ownerId: string;
  country?: string;
  originalSource?: string;
  latestSource?: string;
  tier?: string;
  persona?: string;
}
