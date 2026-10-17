import { test, expect } from "@playwright/test";

test("dashboard controls missing URL reads, surfaces profile errors and checks arriving links without paid actions", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("sdr_v2_visitor_id","dashboard_collector_qa");localStorage.setItem("sdr_v2_visitor_name","Collector QA"); });
  await page.request.post("/api/sdr-admin",{data:{password:"playwright-tools-only-password"}});
  const runId="00000000-0000-4000-8000-000000000041";
  let synced=false,started=false,reads=0,checks=0,paid=0;
  const leads=[{name:"Reader Success",company:"Example A",title:"HR Director",location:"Riyadh",connectionDegree:"2nd",salesLeadUrl:"https://www.linkedin.com/sales/lead/READER1",linkedinUrl:""},{name:"Reader Failed",company:"Example B",title:"HR Director",location:"Riyadh",connectionDegree:"2nd",salesLeadUrl:"https://www.linkedin.com/sales/lead/READER2",linkedinUrl:""}];
  const run={id:runId,startedAt:"2026-10-17T08:00:00Z",updatedAt:"2026-10-17T08:00:00Z",completedAt:"2026-10-17T08:01:00Z",complete:true,stopReason:"Done",sourceUrl:"https://www.linkedin.com/sales/search/people",searchFingerprint:"collector-qa",pagesRead:1,total:2};
  await page.exposeFunction("collectorCommand",async(action:string)=>{
    if(action==="read"){reads++;started=true;setTimeout(()=>{synced=true;},150);}
    return {ok:true,version:"1.8.0",permission:true,tabs:[{id:4,title:"HR Saudi"}],queue:synced?{runId,running:false,paused:false,done:2,total:2,failed:[{name:"Reader Failed",error:"Profile name differs from the captured person."}]}:started?{runId,running:true,paused:false,done:0,total:2,failed:[]}:null};
  });
  await page.addInitScript(()=>window.addEventListener("message",async event=>{
    if(event.source!==window||event.data?.channel!=="talentera-collector-request")return;
    const result=await (window as unknown as {collectorCommand:(action:string)=>Promise<unknown>}).collectorCommand(event.data.action);
    window.postMessage({channel:"talentera-collector-response",id:event.data.id,result},window.location.origin);
  }));
  await page.route("**/api/prospecting/salesnav/full-run*",route=>route.fulfill({json:{run:{...run,leads:leads.map((lead,index)=>({...lead,linkedinUrl:synced&&index===0?"https://www.linkedin.com/in/reader-success":""}))},history:[run]}}));
  await page.route("**/api/prospecting/salesnav/companion",route=>route.fulfill({json:{ok:true,paired:true,unlocked:true,latestFullRun:{...run,id:"00000000-0000-4000-8000-000000000099",profilesAvailable:0}}}));
  await page.route("**/api/prospecting/salesnav/task-options",route=>route.fulfill({json:{owners:[]}}));
  await page.route("**/api/prospecting/salesnav/precheck-v2",route=>{checks++;return route.fulfill({json:{contact:{inHubSpot:false},company:{protected:false,inHubSpot:false}}});});
  await page.route(/\/api\/prospecting\/salesnav\/(reveal-fast|push-ready-v2)/,route=>{paid++;return route.fulfill({status:500,json:{error:"No paid actions in this test"}});});
  await page.goto("/signalhire-queue");
  await expect(page.getByText("Collector 1.8.0 connected",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Read / retry 2 missing URLs",exact:true}).click();
  await expect(page.getByRole("row").filter({hasText:"Reader Success"})).toContainText("Needs reveal");
  await expect(page.getByRole("link",{name:"LinkedIn",exact:true})).toHaveAttribute("href","https://www.linkedin.com/in/reader-success");
  await page.getByText("1 profile read errors · retry missing URLs above",{exact:true}).click();
  await expect(page.getByText("Profile name differs from the captured person.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Read / retry 1 missing URLs",exact:true})).toBeEnabled();
  expect(reads).toBe(1);expect(checks).toBe(1);expect(paid).toBe(0);
});

test("server pairing alone never claims Chrome collector is connected",async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem("sdr_v2_visitor_id","offline_collector_qa");localStorage.setItem("sdr_v2_visitor_name","Offline QA");});
  await page.request.post("/api/sdr-admin",{data:{password:"playwright-tools-only-password"}});
  await page.route("**/api/prospecting/salesnav/full-run*",route=>route.fulfill({json:{run:null,history:[]}}));
  await page.route("**/api/prospecting/salesnav/companion",route=>route.fulfill({json:{ok:true,paired:true,unlocked:true}}));
  await page.route("**/api/prospecting/salesnav/task-options",route=>route.fulfill({json:{owners:[]}}));
  await page.goto("/signalhire-queue");
  await expect(page.getByText(/Collector 1.8.0 is not connected to this tab/)).toBeVisible();
  await expect(page.getByText("Extension: 25 / 50 / Full → Dashboard: Check → Reveal → Push",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Scrape search",exact:true})).toHaveCount(0);
});
