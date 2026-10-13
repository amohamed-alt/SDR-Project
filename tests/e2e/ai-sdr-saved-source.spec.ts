import { test, expect } from "@playwright/test";

test("AI SDR loads Sales Nav-only saved people for review without triggering paid or CRM actions", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_ai_saved_source_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Saved source QA");
  });
  await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  const mutations: string[] = [];
  await page.route("**/api/prospecting/**", route => {
    if (route.request().method() !== "GET") {
      mutations.push(route.request().url());
      return route.fulfill({ status: 409, json: { error: "Mutations disabled in this read-only fixture" } });
    }
    return route.fulfill({ json: { run: { id: "saved-run-qa", total: 70, leads: Array.from({ length: 70 }, (_, index) => ({ name: `Saved Person ${index}`, title: "HR Director", company: `Saved Company ${index}`, location: "Riyadh", connectionDegree: "2nd", linkedinUrl: "", salesLeadUrl: `https://www.linkedin.com/sales/lead/ACw${index},NAME_SEARCH,123` })) } } });
  });
  await page.goto("/ai-sdr-agent");
  await page.getByRole("button", { name: "Load saved Sales Nav batch", exact: true }).click();
  await expect(page.getByText(/Loaded 30 new people from 70 saved Sales Nav rows/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sales Nav profile", exact: true })).toHaveCount(30);
  await expect(page.getByRole("link", { name: "LinkedIn profile", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Reveal selected \(0\)/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Push \+ CALL tasks \(0\)/ })).toBeDisabled();
  await page.getByLabel("Public LinkedIn profile for Saved Person 0", { exact: true }).fill("https://www.linkedin.com/in/verified-person-0");
  await expect(page.getByRole("link", { name: "LinkedIn profile", exact: true })).toHaveAttribute("href", "https://www.linkedin.com/in/verified-person-0");
  await page.getByRole("button", { name: "Load saved Sales Nav batch", exact: true }).click();
  await expect(page.getByText(/No new people added from 70 saved Sales Nav rows/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(30);
  expect(mutations).toEqual([]);
});
