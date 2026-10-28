import { expect, test } from "@playwright/test";

test("task actions open a saved LinkedIn profile and expose missing profiles without unsafe links", async ({ page, context }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_linkedin_ci");
    localStorage.setItem("sdr_v2_visitor_name", "LinkedIn action QA");
    sessionStorage.setItem("sdr_v2_session_id", "session_linkedin_ci");
  });
  const task = {
    type: "Task", status: "Not started", detail: "Contact outreach", assignedTo: "Marita",
    occurredAt: "2026-10-13T10:00:00Z", metricAt: "2026-10-13T10:00:00Z", dueAt: "2026-10-13T10:00:00Z",
    dueBucket: "Today", isOpen: true, isHighPriority: true, opened: false, clicked: false, replied: false,
    relatedContactId: "123", relatedContactName: "QA Contact", relatedContactHasPhone: true,
    url: "https://app-eu1.hubspot.com/contacts/145742477/record/0-1/123",
  };
  await page.route("**/api/dashboard/records**", route => route.fulfill({ json: {
    rows: [
      { ...task, id: "qa-1", subject: "LinkedIn available task", relatedContactLinkedinUrl: "https://www.linkedin.com/in/qa-contact?trk=task" },
      { ...task, id: "qa-2", subject: "LinkedIn unavailable task", relatedContactLinkedinUrl: "https://linkedin.com.evil.test/in/qa-contact" },
    ], total: 2, offset: 0, limit: 25, version: "qa-linkedin",
  } }));
  // Verify destination without visiting LinkedIn or interacting with a real contact.
  await context.route("https://www.linkedin.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Profile destination QA</h1>" }));
  await page.goto("/?acq=marita&from=2026-10-01&to=2026-10-13");
  await page.getByRole("button", { name: /^Tasks due today/i }).click();
  const drawer = page.getByRole("dialog", { name: "Tasks due today", exact: true });
  await expect(drawer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  const available = drawer.getByRole("row").filter({ hasText: "LinkedIn available task" });
  const link = available.getByRole("link", { name: /Open QA Contact’s LinkedIn profile/ });
  await expect(link).toHaveAttribute("href", "https://www.linkedin.com/in/qa-contact");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(available.getByRole("link", { name: "Open WhatsApp with AI message" })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://www.linkedin.com/in/qa-contact");
  await popup.close();
  const unavailable = drawer.getByRole("row").filter({ hasText: "LinkedIn unavailable task" });
  const unavailableAction = unavailable.getByRole("img", { name: "LinkedIn profile unavailable" });
  await expect(unavailableAction).toBeVisible();
  await expect(unavailableAction).toHaveCSS("cursor", "default");
  await unavailableAction.hover();
  await expect(unavailableAction).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(unavailable.getByRole("link", { name: /LinkedIn/ })).toHaveCount(0);
});

test('task AI copy supports review, counts, cached reopening and provider errors', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sdr_v2_visitor_id', 'visitor_ai_message_ci');
    localStorage.setItem('sdr_v2_visitor_name', 'AI message QA');
    sessionStorage.setItem('sdr_v2_session_id', 'session_ai_message_ci');
  });
  const task = { id:'ai-task', type:'Task', subject:'AI outreach task', status:'Not started', detail:'Outreach', assignedTo:'Marita', occurredAt:'2026-10-13T10:00:00Z',metricAt:'2026-10-13T10:00:00Z',dueAt:'2026-10-13T10:00:00Z',dueBucket:'Today',isOpen:true,isHighPriority:true,relatedContactId:'123',relatedContactName:'Ahmad',url:'https://app.hubspot.com/contacts/1/contact/123' };
  await page.route('**/api/dashboard/records**', route=>route.fulfill({json:{rows:[task],total:1,offset:0,limit:25,version:'qa'}}));
  let calls=0;
  await page.route('**/api/ai/task-message', route=>{
    calls++;
    return calls===1 ? route.fulfill({status:503,json:{error:'CommandCode unavailable'}}) : route.fulfill({json:{brand:'Talentera',cached:false,evidence:{company:'QA company',title:'TA Manager'},draft:{hook:'كيف ترتبون متابعة المرشحين عندكم؟',connection:'السلام عليكم أحمد حبيت أتواصل معك بخصوص التوظيف',message:'يعطيك العافية أحمد وشكرًا لقبول الإضافة إذا مناسب أشاركك الفكرة باختصار'}}});
  });
  await page.goto('/?acq=marita&from=2026-10-01&to=2026-10-13');
  await page.getByRole('button',{name:/^Tasks due today/i}).click();
  const trigger=page.getByRole('button',{name:'Generate AI message for Ahmad'});
  await trigger.click();
  const modal=page.getByRole('dialog',{name:'Saudi Arabic AI messages'});
  await expect(modal.getByRole('alert')).toContainText('CommandCode unavailable');
  await modal.getByRole('button',{name:'Retry',exact:true}).click();
  const connection=modal.getByLabel('LinkedIn connection note');
  await expect(connection).toHaveAttribute('maxlength','200');
  await expect(connection).toHaveAttribute('lang','ar-SA');
  await connection.fill('رسالة معدلة للمراجعة');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(modal.getByLabel('LinkedIn connection note')).toHaveValue('رسالة معدلة للمراجعة');
  expect(calls).toBe(2);
  await page.setViewportSize({width:390,height:844});
  const bounds=await modal.boundingBox();
  if (!bounds) throw new Error('Message dialog is not visible');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.width).toBeLessThanOrEqual(390);
});
