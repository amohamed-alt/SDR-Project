import assert from "node:assert/strict";
import test from "node:test";
import { projectDashboardPayload } from "../src/lib/dashboard-payload.ts";

function contact(id, originalSource, createdAt) {
  return {
    id: String(id),
    name: `Contact ${id}`,
    email: "",
    phone: "",
    linkedinUrl: "",
    title: "",
    company: "",
    country: "",
    originalSource,
    originalSourceDetail: "",
    latestSource: "",
    latestSourceDetail: "",
    recordSource: "",
    recordSourceDetail: "",
    leadSource: "",
    contactSource: "",
    leadStatus: "",
    lifecycleStage: "",
    tier: "",
    contactPriority: "",
    persona: "",
    emailStatus: "",
    phoneStatus: "",
    createdAt,
    lastContacted: "",
    nextActivity: "",
    leadResponseTimeHours: null,
    hasConnectedCall: false,
    hasMeeting: false,
    hasDeal: false,
    hasOpenDeal: false,
    qualityIssues: [],
    priorityScore: 0,
    url: "",
  };
}

function activity(id, overrides = {}) {
  return {
    id: String(id),
    type: "Call",
    subject: "",
    status: "",
    detail: "",
    assignedTo: "",
    occurredAt: "2026-09-09T00:00:00.000Z",
    metricAt: "2026-09-09T00:00:00.000Z",
    dueAt: "",
    dueBucket: "",
    isOpen: false,
    isHighPriority: false,
    opened: false,
    clicked: false,
    replied: false,
    url: "",
    ...overrides,
  };
}

function dashboard() {
  const contacts = Array.from({ length: 500 }, (_, index) => contact(
    index + 1,
    index < 250 ? "Organic Search" : "Offline Sources",
    new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
  ));
  const activities = Array.from({ length: 600 }, (_, index) => activity(index + 1));
  activities[450] = activity(451, { type: "Task", isOpen: true, dueBucket: "Due today" });
  activities[500] = activity(501, { type: "Task", isOpen: true, isHighPriority: true });
  activities[550] = activity(551, { type: "Meeting", isOpen: true });

  return {
    meta: { generatedAt: "2026-09-09T00:00:00.000Z", warnings: [] },
    kpis: { portfolioContacts: 500, calls: 600 },
    priorityContacts: contacts,
    recentActivities: activities,
    companies: [{ id: "company-1" }],
    deals: [{ id: "deal-1" }],
    dailyActivities: [{ date: "2026-09-09", calls: 600 }],
  };
}

test("compact dashboard keeps summaries and trims heavy detail arrays", () => {
  const source = dashboard();
  const projected = projectDashboardPayload(source);

  assert.equal(projected.kpis, source.kpis);
  assert.equal(projected.dailyActivities, source.dailyActivities);
  assert.equal(projected.companies, source.companies);
  assert.equal(projected.deals, source.deals);
  assert.ok(projected.priorityContacts.length <= 300);
  assert.ok(projected.recentActivities.length <= 203);
});

test("compact dashboard preserves newest online leads and operationally important activities", () => {
  const source = dashboard();
  const projected = projectDashboardPayload(source);
  const contactIds = new Set(projected.priorityContacts.map((item) => item.id));
  const activityIds = new Set(projected.recentActivities.map((item) => item.id));

  assert.ok(contactIds.has("250"), "newest online contact should be retained");
  assert.ok(activityIds.has("451"), "today task should be retained outside recent window");
  assert.ok(activityIds.has("501"), "high-priority task should be retained outside recent window");
  assert.ok(activityIds.has("551"), "open meeting should be retained outside recent window");
});
