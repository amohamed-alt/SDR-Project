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

export interface LabelOption {
  value: string;
  label: string;
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
  dueToday: number;
  dueTomorrow: number;
  highPriorityOpenTasks: number;
  completedTasks: number;
  emailsSent: number;
  emailReplies: number;
  emailReplyRate: number;
  dealsCreated: number;
  openDeals: number;
  pipelineValue: number;
  untouchedContacts: number;
  untouchedOver24h: number;
  noNextActivity: number;
  nextActivityCoverage: number;
  leadResponseCoverage: number;
  medianLeadResponseHours: number;
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
  email: string;
  phone: string;
  linkedinUrl: string;
  title: string;
  company: string;
  country: string;
  originalSource: string;
  originalSourceDetail: string;
  latestSource: string;
  latestSourceDetail: string;
  recordSource: string;
  recordSourceDetail: string;
  leadSource: string;
  contactSource: string;
  leadStatus: string;
  lifecycleStage: string;
  tier: string;
  contactPriority: string;
  persona: string;
  emailStatus: string;
  phoneStatus: string;
  createdAt: string;
  lastContacted: string;
  nextActivity: string;
  leadResponseTimeHours: number | null;
  hasConnectedCall: boolean;
  hasMeeting: boolean;
  hasDeal: boolean;
  hasOpenDeal: boolean;
  qualityIssues: string[];
  priorityScore: number;
  url: string;
  companyUrl?: string;
}

export interface ActivityRow {
  id: string;
  type: "Call" | "Meeting" | "Task" | "Email";
  subject: string;
  status: string;
  detail: string;
  assignedTo: string;
  occurredAt: string;
  metricAt: string;
  dueAt: string;
  dueBucket: string;
  isOpen: boolean;
  isHighPriority: boolean;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
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
  createdAt: string;
  closeDate: string;
  isOpen: boolean;
  url: string;
}

export interface FilterOptions {
  countries: LabelOption[];
  originalSources: LabelOption[];
  latestSources: LabelOption[];
  tiers: LabelOption[];
  personas: LabelOption[];
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
    hubspotUrls: {
      contacts: string;
      companies: string;
      calls: string;
      meetings: string;
      tasks: string;
      emails: string;
      deals: string;
    };
  };
  kpis: DashboardKpis;
  dailyActivities: DailyActivityDatum[];
  funnel: ChartDatum[];
  originalSources: ChartDatum[];
  latestSources: ChartDatum[];
  recordSources: ChartDatum[];
  integrationSources: ChartDatum[];
  sourceAudit: {
    integrationRecords: number;
    extensiveLighterRecords: number;
    formRecords: number;
    apiShare: number;
  };
  leadStatuses: ChartDatum[];
  lifecycleStages: ChartDatum[];
  callOutcomes: ChartDatum[];
  meetingOutcomes: ChartDatum[];
  meetingOwners: ChartDatum[];
  meetingSources: ChartDatum[];
  taskStatuses: ChartDatum[];
  taskDueBuckets: ChartDatum[];
  emailPerformance: ChartDatum[];
  countries: ChartDatum[];
  industries: ChartDatum[];
  atsPlatforms: ChartDatum[];
  dealStages: ChartDatum[];
  quality: QualityMetric[];
  alerts: AlertItem[];
  priorityContacts: ContactRow[];
  recentActivities: ActivityRow[];
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
