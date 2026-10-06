import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_playwright_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Playwright CI");
    sessionStorage.setItem("sdr_v2_session_id", "session_playwright_ci");
  });
});

test("dashboard loads and global command palette opens", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SDR Command Center").first()).toBeVisible();
  await expect(page.getByText("Demo data").first()).toBeVisible();

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "GTM command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByPlaceholder("Search dashboard, accounts, prospecting…")).toBeFocused();
});

test("shareable analytics URL restores the Pipeline view", async ({ page }) => {
  await page.goto("/?from=2026-09-01&to=2026-09-09&tab=pipeline");

  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/from=2026-09-01/);
  await expect(page).toHaveURL(/to=2026-09-09/);
  await expect(page).toHaveURL(/tab=pipeline/);
});

test("KPI drilldown exposes the operational table surface", async ({ page }) => {
  await page.goto("/");

  const companiesKpi = page.getByRole("button", { name: /Companies.*Distinct associated accounts/i }).first();
  await expect(companiesKpi).toBeVisible();
  await companiesKpi.click();

  const drawer = page.getByRole("dialog", { name: "Associated companies" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: "Search records" })).toBeVisible();
  await expect(drawer.getByRole("columnheader", { name: /Company/i })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "CSV" })).toBeVisible();
});

test("Daniel deep links render the Evalufy workspace on the server", async ({ page }) => {
  const response = await page.request.get("/?acq=daniel");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("Evalufy");
  expect(html).not.toContain('aria-label="Talentera ATS"');

  await page.goto("/?acq=daniel");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator(".evalufy-logo")).toHaveAttribute("src", /evalufy-logo\.png/);
  await expect(page.locator(".sidebar").getByRole("button", { name: /Inbound vs Outbound/i })).toBeVisible();
  await expect(page.locator(".sidebar").getByRole("region", { name: "SDR Tools", exact: true })).toBeVisible();
});

test("sidebar and owner workspaces remain mounted across tool navigation and reload", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.getByText("TEAM WORKSPACES")).toBeVisible();

  await sidebar.getByRole("region", { name: "SDR Tools", exact: true }).getByRole("button", { name: /Talentera Intelligence/i }).click();
  await expect(page.getByText("Priority Accounts")).toBeVisible();
  await expect(sidebar).toHaveCount(1);
  await expect(sidebar.getByText("TEAM WORKSPACES")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /Zein/i })).toBeVisible();

  await sidebar.getByRole("button", { name: "Analytics Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(sidebar.getByText("TEAM WORKSPACES")).toBeVisible();

  await page.reload();
  await expect(sidebar.getByText("TEAM WORKSPACES")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /Ursula/i })).toBeVisible();
});

test("Team Activity is discoverable and locked admin tools remain visible", async ({ page }) => {
  await page.goto("/");
  const tools = page.locator(".sidebar").getByRole("region", { name: "SDR Tools", exact: true });
  await expect(tools.getByRole("button", { name: /Team Activity/i })).toBeVisible();

  await tools.getByRole("button", { name: /Company Repair/i }).click();
  await expect(tools.getByText("Admin password", { exact: true })).toBeVisible();
  for (const label of ["Sales Nav Source", "Sales Nav Full Run", "SignalHire Source", "SignalHire CSV Queue", "Call Queue Ops", "Company Repair"]) {
    await expect(tools.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }
});

test("Ursula and Zein never reuse another owner's dashboard payload", async ({ page }) => {
  await page.goto("/?acq=ursula");
  await expect(page.getByRole("heading", { name: "Ursula KPIs", exact: true })).toBeVisible();
  await expect(page.getByText("Ursula Waked", { exact: true })).toBeVisible();

  await page.locator(".sidebar").getByRole("button", { name: /Zein/i }).click();
  await expect(page.getByRole("heading", { name: "Zein KPIs", exact: true })).toBeVisible();
  await expect(page.getByText("Zein Fares", { exact: true })).toBeVisible();
  await expect(page.getByText("Ursula Waked", { exact: true })).toHaveCount(0);
});

test("switching owners mounts one clean workspace and clears stale tab state", async ({ page }) => {
  await page.goto("/?from=2026-09-01&to=2026-09-09&tab=pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible();

  await page.locator(".sidebar").getByRole("button", { name: /Daniel/i }).click();
  await expect(page).toHaveURL(/acq=daniel/);
  await expect(page).not.toHaveURL(/tab=/);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator("main.app-shell")).toHaveCount(1);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator(".sidebar").getByRole("button", { name: "SDR Comparison", exact: true }).click();
  await expect(page.getByRole("heading", { name: "SDR performance", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("comparison remains inside the shared dashboard shell", async ({ page }) => {
  await page.goto("/?acq=comparison");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.getByRole("heading", { name: "SDR performance", exact: true })).toBeVisible();
  await expect(page.locator("main.app-shell")).toHaveCount(1);
  for (const owner of ["Marita", "Daniel"]) {
    await expect(page.getByRole("columnheader", { name: owner, exact: true })).toBeVisible();
  }
});

test("reporting dates and cohort survive every owner and comparison navigation", async ({ page }) => {
  await page.goto("/?from=2026-10-01&to=2026-10-04&country=Saudi+Arabia&tier=Tier+1");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  for (const owner of ["Ursula", "Zein", "Daniel"]) {
    const loaded = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/dashboard" && url.searchParams.get("profile") === "summary";
    });
    await page.locator(".sidebar").getByRole("button", { name: new RegExp(owner) }).click();
    const response = await loaded;
    const url = new URL(response.url());
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-04");
    expect(url.searchParams.get("country")).toBe("Saudi Arabia");
    expect(url.searchParams.get("tier")).toBe("Tier 1");
    await expect(page).toHaveURL(/to=2026-10-04/);
  }
  const teamLoaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/dashboard/team");
  await page.locator(".sidebar").getByRole("button", { name: "SDR Comparison", exact: true }).click();
  const teamUrl = new URL((await teamLoaded).url());
  expect(teamUrl.searchParams.get("country")).toBe("Saudi Arabia");
  await expect(page.getByLabel("Reporting start")).toHaveValue("2026-10-01");
  await expect(page.getByLabel("Reporting end")).toHaveValue("2026-10-04");
});

test("summary and detail APIs support versioned records, global search and full export", async ({ page }) => {
  const summaryResponse = await page.request.get("/api/dashboard?from=2026-10-01&to=2026-10-04&profile=summary");
  expect(summaryResponse.ok()).toBeTruthy();
  const summary = await summaryResponse.json();
  expect(summary.priorityContacts).toEqual([]);
  expect(summary.intelligence.accountEngagement).toEqual([]);
  const query = new URLSearchParams({ from: "2026-10-01", to: "2026-10-04", ownerId: summary.meta.ownerId, version: summary.meta.generatedAt, selection: JSON.stringify({ kind: "contacts" }), limit: "25" });
  const records = await page.request.get(`/api/dashboard/records?${query}`);
  expect(records.ok()).toBeTruthy();
  const result = await records.json();
  expect(result.total).toBeGreaterThan(0);
  expect(result.version).toBe(summary.meta.generatedAt);
  query.set("q", result.rows[0].name);
  const found = await page.request.get(`/api/dashboard/records?${query}`);
  expect((await found.json()).rows.some((row: { id: string }) => row.id === result.rows[0].id)).toBeTruthy();
  query.set("format", "csv");
  const csv = await page.request.get(`/api/dashboard/records?${query}`);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(result.rows[0].name);
  query.set("selection", JSON.stringify({ kind: "contacts", where: [{ field: "__proto__" }] }));
  expect((await page.request.get(`/api/dashboard/records?${query}`)).status()).toBe(400);
});
