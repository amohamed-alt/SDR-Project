import { expect, test } from "@playwright/test";

const account = {
  domain: "example.com", name: "Example company", country: "Saudi Arabia", industry: "Retail",
  employeeCount: 0, source: "Clay", evidence: { businessLine: "Talentera" }, gtmTier: "Watch", gtmScore: 0,
  activeJobs: 0, detectedAts: "", atsOpportunityScore: 0, primaryPersona: "HR Manager",
  exclusionStatus: "review", exclusionReason: "Identity and fit review required", status: "candidate",
  phoneReadyCount: 0, assignedOwnerName: "", peopleCount: 0,
};

test("inventory filters and pagination use all-source server queries", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/sdr-admin", (route) => route.fulfill({ json: { unlocked: false } }));
  await page.route("**/api/acquisition?**", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { accounts: [account], summary: { eligible: 150, needs_people: 150 }, pagination: { filteredTotal: 150 }, configuration: {} } });
  });
  await page.goto("/lead-inventory");
  await expect(page.getByRole("heading", { name: "Lead Inventory" })).toBeVisible();
  await expect(page.getByText("Example company", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("allSources")).toBe("1");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("offset")).toBe("100");
  await page.getByRole("combobox", { name: "Source", exact: true }).selectOption("Clay");
  await expect.poll(() => requests.at(-1)?.searchParams.get("source")).toBe("Clay");
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Lead Inventory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview & check duplicates" })).toBeVisible();
});

test("company import previews first and only saves after the explicit save action", async ({ page }) => {
  const writes: { execute: boolean }[] = [];
  await page.route("**/api/sdr-admin", (route) => route.fulfill({ json: { unlocked: true } }));
  await page.route("**/api/acquisition?**", (route) => route.fulfill({ json: { accounts: [], summary: {}, pagination: { filteredTotal: 0 }, configuration: {} } }));
  await page.route("**/api/lead-inventory", (route) => {
    const data = route.request().postDataJSON(); writes.push(data);
    return route.fulfill({ json: { candidates: 1, added: data.execute ? 1 : 0, duplicates: 0, invalid: 0, rows: [{ name: "Example company", outcome: "review", reason: "Review required" }] } });
  });
  await page.goto("/lead-inventory");
  await page.locator('input[type="file"]').setInputFiles({ name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from("name,domain,country\nExample company,example.com,Saudi Arabia") });
  await page.getByRole("button", { name: "Preview & check duplicates" }).click();
  await expect(page.getByRole("button", { name: "Save reviewed import" })).toBeVisible();
  expect(writes).toHaveLength(1); expect(writes[0].execute).toBe(false);
  await page.getByRole("button", { name: "Save reviewed import" }).click();
  await expect(page.getByRole("status")).toContainText("1 companies saved");
  expect(writes).toHaveLength(2); expect(writes[1].execute).toBe(true);
});

test("inventory CRM actions reject unauthenticated requests", async ({ request }) => {
  const response = await request.post("/api/lead-inventory", { data: { source: "Clay", companies: [{ name: "Example", domain: "example.com" }], execute: true } });
  expect(response.status()).toBe(401);
});
