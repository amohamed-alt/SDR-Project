import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_read_resilience_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Read resilience QA");
    sessionStorage.setItem("sdr_v2_session_id", "session_read_resilience_ci");
  });
});

test("opening Maqsam after applying reporting dates keeps the new scope", async ({ page }) => {
  let maqsamSearch = "";
  await page.route("**/api/maqsam/calls?**", route => {
    maqsamSearch = new URL(route.request().url()).search;
    return route.fulfill({ json: { calls: [], meta: { generatedAt: "2026-10-13T12:00:00Z", totalStored: 0, totalMatching: 0, nextOffset: null } } });
  });
  await page.goto("/?acq=marita&from=2026-07-01&to=2026-07-19");
  await page.getByRole("button", { name: "Toggle filters", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-13");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Maqsam Calls", exact: true }).click();
  await expect.poll(() => new URLSearchParams(maqsamSearch).get("from")).toBe("2026-10-01");
  expect(new URLSearchParams(maqsamSearch).get("to")).toBe("2026-10-13");
});

test("Team Activity survives an upstream HTTP error and its refresh recovers", async ({ page }) => {
  await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  let unavailable = true;
  await page.route("**/api/usage", route => {
    if (route.request().method() !== "GET") return route.continue();
    return unavailable
      ? route.fulfill({ status: 503, json: { error: "Usage service temporarily unavailable" } })
      : route.fulfill({ json: { tracking: true, users: [], topFeatures: [], metrics: { activeNow: 0, uniqueUsersToday: 2, sessionsToday: 3, opensToday: 4, eventsToday: 8, avgSessionMinutes: 5 } } });
  });
  await page.goto("/?acq=marita&view=team-activity");
  await expect(page.getByRole("heading", { name: "Team Activity", exact: true })).toBeVisible();
  await expect(page.getByText("Usage data could not load. Refresh to try again.")).toBeVisible();
  await expect(page.getByText("This workspace could not load.")).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("PostgreSQL tracking live")).toBeVisible();
  await expect(page.getByText("Tracking unavailable", { exact: true })).toHaveCount(0);
});

test("Intelligence Studio releases a stalled refresh and keeps its last snapshot", async ({ page }) => {
  const fixture = await (await page.request.get("/api/dashboard/insights?ownerId=31644369&from=2026-07-01&to=2026-07-19")).json();
  await page.addInitScript(() => {
    const originalNow = Date.now;
    const clock = window as unknown as { readTestOffset?: number };
    Date.now = () => originalNow() + (clock.readTestOffset || 0);
  });
  await page.route("**/api/dashboard/insights?**", route => route.fulfill({ json: { ...fixture, refreshing: true } }));
  await page.goto("/?acq=intelligence&from=2026-07-01&to=2026-07-19");
  await expect(page.getByRole("heading", { name: "Where to focus next" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Updating…", exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as unknown as { readTestOffset: number }).readTestOffset = 91_000; });
  await expect(page.getByRole("alert")).toContainText("The live refresh is taking longer than expected", { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Refresh data", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Where to focus next" })).toBeVisible();
});

test("Prospecting cancels stale searches so older results cannot replace the current filter", async ({ page }) => {
  await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  await page.route("**/api/acquisition/zero-credit-ready", route => route.fulfill({ json: { zeroCreditMode: true, summary: { stored: 0, ready: 0, needsPeople: 0, searchOnly: 0, pushed: 0 }, accounts: [] } }));
  let releaseOld: (() => void) | undefined;
  let oldStarted = false;
  await page.route("**/api/acquisition/coverage-status?**", async route => {
    const search = new URL(route.request().url()).searchParams.get("q") || "initial";
    if (search === "old") {
      oldStarted = true;
      await new Promise<void>(resolve => { releaseOld = resolve; });
    }
    await route.fulfill({ json: {
      generatedAt: "2026-10-13T12:00:00Z", storage: { sourceOfTruth: "Test ledger" }, scope: { countries: ["Saudi Arabia"] },
      pagination: { page: 1, limit: 100, filteredTotal: 1, totalPages: 1, returned: 1 }, countries: [],
      accounts: [{ domain: `${search}.example`, name: `${search} result`, country: "Saudi Arabia", employeeCount: 250, industry: "Technology", gtmScore: 60, gtmTier: "A", exclusionStatus: "eligible", evidence: {} }],
    } }).catch(() => { /* A cancelled browser request may already be disposed. */ });
  });
  await page.goto("/?acq=marita&view=net-new");
  await expect(page.getByText("initial result", { exact: true })).toBeVisible();
  const search = page.getByPlaceholder("Search company, domain, industry, persona…");
  await search.fill("old");
  await expect.poll(() => oldStarted).toBe(true);
  const aborted = page.waitForEvent("requestfailed", { predicate: request => request.url().includes("coverage-status") && new URL(request.url()).searchParams.get("q") === "old" });
  await search.fill("new");
  await aborted;
  await expect(page.getByText("new result", { exact: true })).toBeVisible();
  releaseOld?.();
  await expect(page.getByText("old result", { exact: true })).toHaveCount(0);
});
