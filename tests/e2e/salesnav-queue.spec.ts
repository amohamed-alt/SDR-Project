import { expect, test } from '@playwright/test';

const lead = (id: string, connectionDegree = '2nd') => ({ name: `Person ${id}`, company: 'Example company', title: 'HR Director', location: 'Riyadh', connectionDegree, salesLeadUrl: `https://www.linkedin.com/sales/lead/${id}`, linkedinUrl: '' });
const run = { id: 'queue-test', startedAt: '2026-10-11T07:00:00Z', updatedAt: '2026-10-11T07:00:00Z', completedAt: '', complete: false, stopReason: '', sourceUrl: '', searchFingerprint: '', pagesRead: 1, total: 3, leads: [lead('first', '1st'), lead('resume'), lead('unknown')] };

test('queue restores a saved phone/contact, excludes first-degree and preserves uncertain requests', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sdr_v2_visitor_id', 'visitor_playwright_salesnav');
    localStorage.setItem('sdr_v2_visitor_name', 'Playwright Sales Navigator');
    sessionStorage.setItem('sdr_v2_session_id', 'session_playwright_salesnav');
  });
  await page.request.post('/api/sdr-admin', { data: { password: 'playwright-tools-only-password' } });
  let paidCalls = 0;
  const checked: string[] = [];
  await page.route('**/api/prospecting/salesnav/task-options', route => route.fulfill({ json: { owners: [{ id: '31644369', name: 'Marita' }] } }));
  await page.route('**/api/prospecting/salesnav/full-run**', route => route.fulfill({ json: { run, history: [], operations: {
    'reveal:sales:resume': { state: 'completed', result: { prospect: { fullName: 'Person resume', company: 'Example company', phone: '+966555555555' } } },
    'push:sales:resume': { state: 'review', result: { contactId: 'contact-1', pending: '' } },
    'reveal:sales:unknown': { state: 'review', result: { pending: 'provider', creditOutcome: 'unknown' } },
  } } }));
  await page.route('**/api/prospecting/salesnav/precheck-v2', route => {
    checked.push(route.request().postDataJSON().name);
    return route.fulfill({ json: { contact: { inHubSpot: true, id: 'contact-1', matchedBy: 'email' }, company: { inHubSpot: true, protected: false, engagementChecked: true, name: 'Example company' } } });
  });
  await page.route('**/api/prospecting/salesnav/reveal-fast', route => { paidCalls++; return route.fulfill({ status: 500, json: {} }); });
  await page.goto('/signalhire-queue');
  await expect(page.getByRole('button', { name: /^Review/ })).toContainText('1');
  await page.getByRole('button', { name: /HubSpot Check/i }).click();
  await expect(page.getByRole('button', { name: /^Ready NEW/ })).toContainText('1');
  await page.getByRole('button', { name: /^Ready NEW/ }).click();
  await expect(page.getByText('+966555555555', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Blocked/ }).click();
  await expect(page.getByText('DEGREE_1ST: captured and excluded before reveal.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Review/ }).click();
  await expect(page.getByText('Saved request is uncertain. Reconcile before another reveal or write.', { exact: true })).toBeVisible();
  expect(checked).toEqual(['Person resume']);
  expect(paidCalls).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /^Review/ })).toBeVisible();
});
