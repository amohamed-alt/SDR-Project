import type { DashboardData } from "@/lib/types";

const daily = [36, 59, 0, 0, 0, 31, 37, 46, 37, 0, 0, 33, 20, 34, 35, 17, 0, 0, 39];

export function createMockDashboard(from: string, to: string, ownerId: string): DashboardData {
  return {
    meta: {
      generatedAt: new Date().toISOString(), from, to, timezone: "Asia/Riyadh", ownerId,
      ownerName: "Marita Chedid", portalId: "145742477", isDemo: true,
      warnings: ["Demo mode is active. Connect a HubSpot private app token to load live CRM data."],
      hubspotUrls: {
        contacts: "#", companies: "#", calls: "#", meetings: "#", tasks: "#", emails: "#", deals: "#",
      },
    },
    kpis: {
      portfolioContacts: 529, newContacts: 220, companies: 387, calls: 424, connectedCalls: 106,
      connectionRate: 25, bookedMeetings: 21, completedMeetings: 9, meetingCompletionRate: 42.9,
      openTasks: 311, overdueTasks: 0, dueToday: 176, dueTomorrow: 0, highPriorityOpenTasks: 187, completedTasks: 280,
      emailsSent: 318, emailReplies: 31, emailReplyRate: 9.7, dealsCreated: 12, openDeals: 9,
      pipelineValue: 186500, untouchedContacts: 176, untouchedOver24h: 114, noNextActivity: 315,
      nextActivityCoverage: 39.5, leadResponseCoverage: 6.5, medianLeadResponseHours: 2.9,
    },
    dailyActivities: daily.map((calls, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`, calls, connected: Math.round(calls * 0.25),
      tasksCompleted: Math.round(calls * 0.65), tasksDue: Math.round(calls * 0.78), meetingsBooked: calls ? Math.max(1, Math.round(calls / 24)) : 0,
      emailsSent: Math.round(calls * 0.8),
    })),
    funnel: [
      { name: "Portfolio", value: 529 }, { name: "Contacted", value: 401 }, { name: "Connected", value: 106 },
      { name: "Meeting", value: 21 }, { name: "Deal", value: 12 }, { name: "Open Deal", value: 9 },
    ],
    originalSources: [
      { name: "Offline Sources", value: 306 }, { name: "Direct Traffic", value: 88 }, { name: "Organic Search", value: 51 },
      { name: "Paid Social", value: 34 }, { name: "Referrals", value: 21 }, { name: "Unknown", value: 29 },
    ],
    latestSources: [
      { name: "Direct Traffic", value: 201 }, { name: "Offline Sources", value: 139 }, { name: "Organic Search", value: 72 },
      { name: "Email Marketing", value: 49 }, { name: "Paid Social", value: 38 }, { name: "Unknown", value: 30 },
    ],
    recordSources: [
      { name: "Integration", value: 311 }, { name: "CRM UI", value: 96 }, { name: "Import", value: 71 }, { name: "Forms", value: 51 },
    ],
    integrationSources: [{ name: "Extensive Lighter", value: 287 }, { name: "Other Integration", value: 24 }],
    sourceAudit: { integrationRecords: 311, extensiveLighterRecords: 287, formRecords: 51, apiShare: 58.8 },
    leadStatuses: [
      { name: "Attempted To Contact", value: 211 }, { name: "New", value: 128 }, { name: "Connected", value: 106 }, { name: "Open Deal", value: 39 }, { name: "Unknown", value: 45 },
    ],
    lifecycleStages: [
      { name: "Lead", value: 351 }, { name: "Marketing Qualified Lead", value: 92 }, { name: "Sales Qualified Lead", value: 58 }, { name: "Opportunity", value: 28 },
    ],
    callOutcomes: [{ name: "No answer", value: 317 }, { name: "Connected", value: 106 }, { name: "Busy", value: 1 }],
    meetingOutcomes: [{ name: "Scheduled", value: 10 }, { name: "Completed", value: 9 }, { name: "Unknown", value: 2 }],
    meetingOwners: [{ name: "Marita Chedid", value: 18 }, { name: "Zein Fares", value: 2 }, { name: "Ursula Waked", value: 1 }],
    meetingSources: [{ name: "Bidirectional Sync", value: 11 }, { name: "Bidirectional Api", value: 9 }, { name: "Meetings Public", value: 1 }],
    taskStatuses: [{ name: "Completed", value: 280 }, { name: "Not Started", value: 309 }],
    taskDueBuckets: [{ name: "Due today", value: 176 }, { name: "Future", value: 135 }],
    emailPerformance: [{ name: "Sent", value: 318 }, { name: "Opened", value: 117 }, { name: "Clicked", value: 46 }, { name: "Replied", value: 31 }],
    countries: [{ name: "Egypt", value: 141 }, { name: "United Arab Emirates", value: 85 }, { name: "Saudi Arabia", value: 71 }, { name: "Qatar", value: 34 }, { name: "Unknown", value: 18 }],
    industries: [{ name: "Technology", value: 74 }, { name: "Healthcare", value: 62 }, { name: "Education", value: 54 }, { name: "Government", value: 41 }, { name: "Retail", value: 36 }],
    atsPlatforms: [{ name: "Oracle HCM", value: 51 }, { name: "SAP SuccessFactors", value: 43 }, { name: "Workday", value: 37 }, { name: "No ATS Detected", value: 118 }, { name: "Unknown", value: 138 }],
    dealStages: [{ name: "Demo Booked", value: 5, amount: 46000 }, { name: "Demo Done", value: 3, amount: 72500 }, { name: "Proposal Shared", value: 2, amount: 68000 }, { name: "Cashing", value: 2, amount: 0 }],
    quality: [
      ["email", "Email coverage", 488, 529], ["gtm_email_status", "Verified email", 421, 529], ["phone", "Phone coverage", 502, 529],
      ["phone_number_status", "Tested phone", 311, 529], ["gtm_linkedin_url", "LinkedIn coverage", 510, 529], ["company_id", "Company association", 507, 529],
      ["country", "Country coverage", 511, 529], ["hs_analytics_source", "Original source coverage", 500, 529], ["gtm_icp_tier", "ICP tier coverage", 467, 529],
      ["signalhire_match_status", "SignalHire enrichment", 284, 529],
    ].map(([key, label, complete, total]) => ({ key: String(key), label: String(label), complete: Number(complete), total: Number(total), rate: Math.round((Number(complete) / Number(total)) * 1000) / 10 })),
    alerts: [
      { id: "due", severity: "critical", title: "Tasks due tomorrow", detail: "Review capacity and redistribute overloaded days.", count: 174, action: "Open task workload" },
      { id: "tier-a", severity: "critical", title: "Tier A untouched", detail: "High-value leads with no logged outreach.", count: 43, action: "Start outreach" },
      { id: "phones", severity: "warning", title: "Wrong phone numbers", detail: "Contacts needing SignalHire fallback enrichment.", count: 17, action: "Run enrichment" },
      { id: "outcomes", severity: "warning", title: "Missing meeting outcomes", detail: "Deduplicated meetings without a final outcome.", count: 2, action: "Update outcomes" },
    ],
    priorityContacts: [
      ["1", "Noura Al-Hassan", "Talent Acquisition Director", "Gulf Health Group", "Saudi Arabia", 96],
      ["2", "Omar Al-Mansoori", "Head of Recruitment", "Emirates Industrial", "United Arab Emirates", 93],
      ["3", "Layla Farouk", "CHRO", "Nile Digital", "Egypt", 91],
      ["4", "Fahad Al-Qahtani", "VP People", "Riyadh Logistics", "Saudi Arabia", 89],
    ].map(([id, name, title, company, country, score]) => ({
      id: String(id), name: String(name), email: String(name).toLowerCase().replace(/\s+/g, ".") + "@example.com",
      phone: "+966 50 000 0000", linkedinUrl: "https://www.linkedin.com", title: String(title), company: String(company), country: String(country),
      originalSource: "Offline Sources", latestSource: "Direct Traffic", recordSource: "Integration", leadStatus: "New", lifecycleStage: "Lead",
      originalSourceDetail: "Integration", latestSourceDetail: "Direct", recordSourceDetail: "Extensive-Lighter", leadSource: "Outbound", contactSource: "SDR Outbound",
      tier: "Tier 1", contactPriority: "High", persona: "Talent Acquisition", emailStatus: "Valid", phoneStatus: "Pending",
      createdAt: "2026-07-10T08:00:00Z", lastContacted: "", nextActivity: "", leadResponseTimeHours: null,
      hasConnectedCall: Number(score) >= 93, hasMeeting: Number(score) >= 91, hasDeal: Number(score) >= 93,
      hasOpenDeal: Number(score) >= 93, qualityIssues: ["hs_time_to_first_engagement"], priorityScore: Number(score), url: "#",
    })),
    recentActivities: [
      { id: "call-1", type: "Call", subject: "Discovery call", status: "Connected", detail: "Connected", assignedTo: "Marita Chedid", occurredAt: "2026-07-19T10:30:00Z", metricAt: "2026-07-19T10:30:00Z", dueAt: "", dueBucket: "", isOpen: false, isHighPriority: false, opened: false, clicked: false, replied: false, url: "#" },
      { id: "meeting-1", type: "Meeting", subject: "Talentera demo", status: "Completed", detail: "Meetings Public", assignedTo: "Marita Chedid", occurredAt: "2026-07-19T09:00:00Z", metricAt: "2026-07-19T09:00:00Z", dueAt: "", dueBucket: "", isOpen: false, isHighPriority: false, opened: false, clicked: false, replied: false, url: "#" },
      { id: "task-1", type: "Task", subject: "Follow up with HR Director", status: "Not Started", detail: "High", assignedTo: "Marita Chedid", occurredAt: "2026-07-19T08:00:00Z", metricAt: "2026-07-19T08:00:00Z", dueAt: "2026-07-19T08:00:00Z", dueBucket: "Due today", isOpen: true, isHighPriority: true, opened: false, clicked: false, replied: false, url: "#" },
    ],
    companies: [
      ["1", "Gulf Health Group", "gulfhealth.example", "Saudi Arabia", "Healthcare", "5000", "A", "Oracle HCM", 4],
      ["2", "Emirates Industrial", "emiratesindustrial.example", "United Arab Emirates", "Manufacturing", "2400", "A", "SAP SuccessFactors", 3],
      ["3", "Nile Digital", "niledigital.example", "Egypt", "Technology", "900", "B", "Workday", 3],
    ].map(([id, name, domain, country, industry, employees, tier, ats, contacts]) => ({
      id: String(id), name: String(name), domain: String(domain), country: String(country), industry: String(industry), employees: String(employees), tier: String(tier),
      ats: String(ats), atsCategory: "Enterprise ATS", atsConfidence: "High", associatedContacts: Number(contacts), url: "#",
    })),
    deals: [
      { id: "1", name: "Gulf Health — Talentera", stage: "Demo Done", owner: "Zein Fares", amount: 72500, createdAt: "2026-07-08", closeDate: "2026-08-30", isOpen: true, url: "#" },
      { id: "2", name: "Emirates Industrial — Talentera", stage: "Proposal Shared", owner: "Ursula Waked", amount: 68000, createdAt: "2026-07-12", closeDate: "2026-09-15", isOpen: true, url: "#" },
    ],
    filterOptions: {
      countries: ["Egypt", "Qatar", "Saudi Arabia", "United Arab Emirates"].map((value) => ({ value, label: value })),
      originalSources: [{ value: "OFFLINE", label: "Offline Sources" }, { value: "DIRECT_TRAFFIC", label: "Direct Traffic" }, { value: "ORGANIC_SEARCH", label: "Organic Search" }, { value: "PAID_SOCIAL", label: "Paid Social" }],
      latestSources: [{ value: "DIRECT_TRAFFIC", label: "Direct Traffic" }, { value: "EMAIL_MARKETING", label: "Email Marketing" }, { value: "OFFLINE", label: "Offline Sources" }, { value: "ORGANIC_SEARCH", label: "Organic Search" }],
      tiers: ["A", "B", "C"].map((value) => ({ value, label: `Tier ${value}` })),
      personas: ["CHRO", "HR Director", "Talent Acquisition"].map((value) => ({ value, label: value })),
      owners: [{ id: ownerId, name: "Marita Chedid" }],
    },
  };
}
