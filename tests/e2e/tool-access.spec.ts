import { test, expect } from "@playwright/test";
test("direct tools and their APIs require a password and re-lock after logout", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("sdr_v2_visitor_id", "visitor_tools_gate"); localStorage.setItem("sdr_v2_visitor_name", "Tool gate QA"); sessionStorage.setItem("sdr_v2_session_id", "session_tools_gate"); });
  const protectedUrl = "/?view=team-activity&from=2026-07-15&to=2026-10-07";
  expect((await page.request.get("/api/usage")).status()).toBe(401);
  expect((await page.request.get("/api/maqsam/calls", { headers: { Authorization: "Bearer invalid" } })).status()).toBe(401);
  await page.goto(protectedUrl);
  await expect(page).toHaveURL(/\/tools-unlock\?returnTo=/);
  await expect(page.getByRole("heading", { name: "SDR tools are locked" })).toBeVisible();
  await page.getByLabel("Tools password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Unlock tools", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect admin password" })).toBeVisible();
  expect((await page.request.get("/api/usage")).status()).toBe(401);
  await page.getByLabel("Tools password", { exact: true }).fill("playwright-tools-only-password");
  await page.getByRole("button", { name: "Unlock tools", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("view=team-activity&from=2026-07-15&to=2026-10-07"));
  expect((await page.request.get("/api/usage")).status()).toBe(200);
  const cookie = (await page.context().cookies()).find(row => row.name === "sdr_admin_access")!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe("Lax");
  await page.getByRole("button", { name: "Lock tools", exact: true }).click();
  await expect(page.getByRole("heading", { name: "SDR tools are locked" })).toBeVisible();
  expect((await page.request.get("/api/usage")).status()).toBe(401);
  await page.reload();
  await expect(page).toHaveURL(/tools-unlock/);
});
test("cross-site tool login and logout are rejected", async ({ request }) => {
  for (const method of ["POST", "DELETE"]) {
    const response = await request.fetch("/api/sdr-admin", { method, headers: { origin: "https://unrelated.example", "sec-fetch-site": "cross-site" }, data: { password: "playwright-tools-only-password" } });
    expect(response.status()).toBe(403);
  }
});
