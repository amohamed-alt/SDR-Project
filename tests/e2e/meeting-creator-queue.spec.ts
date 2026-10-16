import { expect, test } from "@playwright/test";

test("Meeting Creator queue displays review-only SDR candidates and never offers auto-push", async ({page}) => {
  await page.route("**/api/meeting-creator/queue?**", async (route) => {
    await route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify({
      generatedAt:"2026-10-17T08:00:00Z",previewOnly:true,
      summary:{readFromInventory:10,scanned:4,crmMatched:3,callReady:1,needsResearch:2,protected:1,maritaReady:1,danielReady:0},
      pagination:{offset:0,scan:60,nextOffset:60,sourceTotal:60},
      accounts:[{
        key:"test:contact",companyId:"123",companyName:"Saudi Sample Logistics",domain:"sample.sa",
        employeeCount:850,status:"call_ready",motion:"reactivation",reason:"Three unanswered attempts; a different HR director found.",
        recommendedProduct:"Talentera",talenteraScore:83,evalufyScore:65,priority:85,
        sdrId:"31644369",sdrName:"Marita",contactId:"456",
        contactName:"Example Director",contactTitle:"Human Resources Director",
        contactPhone:"+966552223344",phoneEvidence:"saudi_mobile_format_unverified",
        contactLinkedIn:"",attemptedCalls:3,connectedCalls:0,openTasks:0,
      }],
    })});
  });
  await page.goto("/meeting-creator");
  await expect(page.getByRole("heading",{name:/Meeting Creator/})).toBeVisible();
  await expect(page.getByText("Saudi Sample Logistics")).toBeVisible();
  await expect(page.getByText("+966552223344")).toBeVisible();
  await expect(page.getByText("Call-ready · review")).toBeVisible();
  await expect(page.getByRole("table").getByText("Marita",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:/Export call-ready review/})).toBeEnabled();
  await expect(page.getByText("No task creation, emails, LinkedIn requests, phone reveals")).toBeVisible();
  await expect(page.getByRole("button",{name:/Push to HubSpot|Create task/i})).toHaveCount(0);
});
