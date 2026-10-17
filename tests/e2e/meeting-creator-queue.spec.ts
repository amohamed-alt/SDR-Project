import { expect, test } from "@playwright/test";

test("Meeting Creator shows review-only leads and pushes selected tasks only after explicit confirmation", async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_meeting_creator_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Meeting Creator CI");
    sessionStorage.setItem("sdr_v2_session_id", "session_meeting_creator_ci");
  });
  let pushes=0;
  await page.route("**/api/meeting-creator/push",async(route)=>{
    pushes+=1;
    const requestBody=route.request().postDataJSON() as {choices:Array<{companyId:string;contactId:string}>;action:string};
    expect(requestBody.action).toBe("push_selected");
    expect(requestBody.choices).toEqual([{companyId:"123",contactId:"456"}]);
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({created:1,skipped:0,results:[{companyId:"123",status:"created",taskId:"987"}]})});
  });
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
  const push=page.getByRole("button",{name:/Push .* selected to HubSpot/});
  await expect(push).toBeDisabled();
  await expect(page.getByText("Only contacts explicitly selected by the admin can create tasks")).toBeVisible();
  await page.getByRole("checkbox",{name:"Select Example Director at Saudi Sample Logistics for HubSpot task"}).check();
  await expect(push).toBeEnabled();
  page.on("dialog",async(dialog)=>{await dialog.accept();});
  await push.click();
  await expect(page.getByText("HubSpot: 1 created, 0 held for review. Only confirmed writes count.")).toBeVisible();
  expect(pushes).toBe(1);
});

test("wrong-number accounts can search for alternate people without exposing a failed mobile or creating a task",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("sdr_v2_visitor_id","visitor_wrong_number_ci");
    localStorage.setItem("sdr_v2_visitor_name","Wrong Number CI");
    sessionStorage.setItem("sdr_v2_session_id","session_wrong_number_ci");
  });
  let searches=0;
  await page.route("**/api/meeting-creator/queue?**",async(route)=>{
    const url=new URL(route.request().url());
    const wrong=url.searchParams.get("source")==="wrong_number";
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      generatedAt:"2026-10-17T08:00:00Z",previewOnly:true,
      summary:{readFromInventory:0,scanned:wrong?1:0,crmMatched:wrong?1:0,
        callReady:0,needsAlternate:wrong?1:0,needsResearch:0,protected:0,maritaReady:0,danielReady:0},
      pagination:{offset:0,scan:60,nextOffset:60,sourceTotal:60},
      accounts:wrong?[{
        key:"wrong:old",companyId:"450567535828",companyName:"AJA Pharma",domain:"ajapharma.com",
        employeeCount:300,status:"needs_alternate",motion:"reactivation",
        reason:"Wrong number on the previous contact; find a different HR decision maker.",
        recommendedProduct:"Talentera",talenteraScore:75,evalufyScore:64,priority:75,
        sdrId:"37624223",sdrName:"Daniel",contactId:"882223420622",
        contactName:"Salem Al-Twalah",contactTitle:"EHS and HR Manager",
        contactPhone:"",phoneEvidence:"missing",attemptedCalls:1,wrongNumberCalls:1,connectedCalls:0,openTasks:0,
      }]:[],
    })});
  });
  await page.route("**/api/meeting-creator/alternate",async(route)=>{
    searches++;
    const body=route.request().postDataJSON() as {companyId:string;action:string;source:string};
    expect(body.companyId).toBe("450567535828");
    expect(body.action).toBe("find_alternate");
    expect(body.source).toBe("wrong_number");
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      matchedAlternates:1,note:"Search-only. No contacts revealed.",
      people:[{uid:"new-hr",name:"Example New HR",title:"HR Director",currentCompany:"AJA Pharma",
        linkedinUrl:"",score:84,phoneStatus:"not_revealed"}],
    })});
  });
  await page.goto("/meeting-creator");
  await page.getByRole("combobox",{name:"Lead source"}).selectOption("wrong_number");
  await expect(page.getByText("AJA Pharma")).toBeVisible();
  await expect(page.getByRole("table").getByText("Find another person",{exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox",{name:/Select Salem Al-Twalah/})).toBeDisabled();
  await page.getByRole("button",{name:"Find alternate (free)"}).click();
  await expect(page.getByText("Example New HR")).toBeVisible();
  await expect(page.getByText(/No phone revealed/)).toBeVisible();
  expect(searches).toBe(1);
});
