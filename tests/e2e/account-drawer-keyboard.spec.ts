import { expect, test } from "@playwright/test";

const account = {
  companyId: "account-modal-qa", name: "Account drawer QA", domain: "example.com", country: "Saudi Arabia",
  market: { canonicalCountry: "Saudi Arabia", tier: "Core", score: 10, eligible: true },
  score: 72, tier: "B", intentScore: 40, intentLevel: "Medium", fitScore: 80, complexityScore: 20,
  atsOpportunityScore: 50, atsOpportunity: "Medium", confidence: "medium", hiringVelocity: "Stable", languageRoute: "English",
  signals: [{ key: "fixture", label: "Test evidence", strength: "supporting", evidence: "Browser-test fixture", score: 10 }],
  personas: { primary: "HR Director", secondary: "Talent Acquisition", economicBuyer: "HR Director", technicalInfluencer: "IT", reason: "Browser-test fixture" },
  competitorMotion: { family: "unknown", currentSystem: "Unknown", displacementAngle: "Validate current process", discoveryQuestion: "What process do you use?" },
  recommendedAngle: "Review verified account evidence", recommendedChannels: [], reasons: [], risks: [], nextActions: ["Check the source evidence"],
  source: { taskCount: 1, contactCount: 1, hubspotUrl: "https://app.hubspot.com/contacts/123", careerPageUrl: "https://example.com/careers", sourceUrl: "https://example.com/careers", lastCheckedAt: "2026-07-19T09:00:00Z", lastSuccessfulCheckAt: "2026-07-19T09:00:00Z", activeJobs: 1, newJobs7d: 0, newJobs30d: 1, hiringStatus: "Active", trend: "Stable", topDepartments: [], topLocations: [], employeeCount: 250, industry: "Technology", atsStatus: "Unknown", atsCategory: "Unknown", atsConfidence: "Unknown", hiringSignal: "Test evidence", reasonToReachOut: "Browser-test fixture" },
};

for (const width of [1280, 390]) {
  test(`priority account drawer owns focus and dismissal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("sdr_v2_visitor_id", "visitor_account_modal_ci");
      localStorage.setItem("sdr_v2_visitor_name", "Account modal QA");
      sessionStorage.setItem("sdr_v2_session_id", "session_account_modal_ci");
    });
    await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
    await page.route("**/api/account-intelligence?**", route => route.fulfill({ json: {
      meta: { generatedAt: "2026-07-19T09:00:00Z", scopeGeneratedAt: "2026-07-19T09:00:00Z", source: "test fixture", version: "modal-qa", scope: { taskCount: 1, approvedMarketCompanies: 1, uniqueCompaniesBeforeMarketFilter: 1 } },
      summary: { totalScored: 1, returned: 1, tierCounts: { A: 0, B: 1, C: 0, Watch: 0 }, marketCounts: { Core: 1, "Expansion A": 0, "Expansion B": 0, Selective: 0 }, highIntent: 0, highAtsOpportunity: 0, taOrHrisSignals: 0, withHiringEvidence: 1 },
      accounts: [account],
    } }));
    await page.goto("/?view=gtm-brain");
    const opener = page.getByRole("button", { name: "Open Account drawer QA", exact: true });
    await opener.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Account drawer QA · Account intelligence", exact: true });
    const close = drawer.getByRole("button", { name: "Close account details", exact: true });
    await expect(drawer).toBeVisible();
    await expect(close).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(page.getByRole("button", { name: "Open GTM command palette", exact: true })).toBeHidden();
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.getByRole("link", { name: "Career page", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "GTM command palette", exact: true });
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(drawer).toBeVisible();
    await close.click();
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.locator("body")).not.toHaveClass(/drawer-open/);
    await page.keyboard.press("Enter");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}


test("best account details reuse modal focus and named dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_best_account_modal_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Best account modal QA");
    sessionStorage.setItem("sdr_v2_session_id", "session_best_account_modal_ci");
  });
  await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  await page.route("**/api/best-accounts", route => route.fulfill({ json: {
    generatedAt: "2026-07-19T09:00:00Z",
    summary: { total: 1, eligible: 1, aPlus: 0, tierA: 0, hiringNow: 1, phoneReady: 0, researched: 0 },
    configuration: { openRouterConfigured: false, openRouterModel: "", openRouterPolicy: "", openRouter: null, researchLimit: 6 },
    accounts: [{
      domain: "example.com", name: "Best account modal QA", source: "test fixture", sourceId: "modal-qa", country: "Saudi Arabia",
      employeeCount: 250, industry: "Technology", activeJobs: 1, headcountGrowth: 0, hrHeadcount: 0, careerPageUrl: "https://example.com/careers",
      detectedAts: "Unknown", gtmScore: 72, gtmTier: "B", fitScore: 80, intentScore: 40, atsOpportunityScore: 50,
      exclusionStatus: "eligible", exclusionReason: "", hubspotCompanyId: "", status: "review",
      primaryPersona: "HR Director", secondaryPersona: "Talent Acquisition", economicBuyer: "HR Director", technicalInfluencer: "IT",
      strongestSignal: "Browser-test fixture", recommendedAngle: "Review evidence", assignedOwnerId: "", assignedOwnerName: "",
      evidence: {}, peopleCount: 0, enrichedCount: 0, phoneReadyCount: 0, pushCount: 0, priorityScore: 72, priorityTier: "B",
      recommendation: "Review evidence", evidenceChips: ["Test evidence"], researched: false, researchConfidence: "low", aiBrief: null,
    }],
  } }));
  await page.goto("/best-accounts");
  const opener = page.getByRole("button").filter({ hasText: "Best account modal QA" }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Best account modal QA · Priority account", exact: true });
  const close = drawer.getByRole("button", { name: "Close priority account", exact: true });
  await expect(close).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.getByRole("button", { name: "Open GTM command palette", exact: true })).toBeHidden();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("link", { name: "Find people & push", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(close).toBeFocused();
  await close.click();
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.locator("body")).not.toHaveClass(/drawer-open/);
});
