import {test,expect} from '@playwright/test';
const baseLead={name:'Saved Ready Person',title:'HR Director',company:'Example',location:'Riyadh',connectionDegree:'2nd',salesLeadUrl:'https://www.linkedin.com/sales/lead/PERSIST1',linkedinUrl:'https://www.linkedin.com/in/saved-ready-person'};
const run={id:'00000000-0000-4000-8000-000000000071',startedAt:'2026-10-17T08:00:00Z',updatedAt:'2026-10-17T08:00:00Z',completedAt:'2026-10-17T08:01:00Z',complete:true,stopReason:'Done',sourceUrl:'https://www.linkedin.com/sales/search/people',searchFingerprint:'persisted-state',pagesRead:1,total:3};
test('reload restores revealed phones, no-phone results and completed pushes without paid requests',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sdr_v2_visitor_id','persisted_state_qa');localStorage.setItem('sdr_v2_visitor_name','Persisted QA');});
 await page.request.post('/api/sdr-admin',{data:{password:'playwright-tools-only-password'}});
 let paid=0,checks=0,metadataChanged=false;
 const leads=[baseLead,{...baseLead,name:'Saved Pushed Person',salesLeadUrl:'https://www.linkedin.com/sales/lead/PERSIST2',linkedinUrl:'https://www.linkedin.com/in/saved-pushed-person'},{...baseLead,name:'Saved No Phone Person',salesLeadUrl:'https://www.linkedin.com/sales/lead/PERSIST3',linkedinUrl:'https://www.linkedin.com/in/saved-no-phone-person'}];
 const states=leads.map((lead,index)=>({prospect:{fullName:lead.name,company:lead.company,linkedinUrl:lead.linkedinUrl,phone:index<2?`+96279123456${index}`:''},revealStatus:'completed',...(index===1?{lastPushAt:'2026-10-17T09:00:00Z',taskId:'saved-task-2'}:{})}));
 await page.route('**/api/prospecting/salesnav/full-run*',route=>route.fulfill({json:{run:{...run,leads:leads.map(lead=>({...lead,title:metadataChanged?'Updated HR Director':lead.title})),leadStates:states},history:[run]}}));
 await page.route('**/api/prospecting/salesnav/companion',route=>route.fulfill({json:{ok:true,paired:true,unlocked:true,latestFullRun:run}}));
 await page.route('**/api/prospecting/salesnav/task-options',route=>route.fulfill({json:{owners:[]}}));
 await page.route('**/api/prospecting/salesnav/precheck-v2',route=>{checks++;return route.fulfill({json:{contact:{inHubSpot:false},company:{inHubSpot:false,protected:false}}});});
 await page.route(/\/api\/prospecting\/salesnav\/(reveal-fast|push-ready-v2)/,route=>{paid++;return route.fulfill({status:500,json:{error:'No paid or CRM actions in this test'}});});
 await page.goto('/signalhire-queue');
 const ready=page.getByRole('row').filter({hasText:'Saved Ready Person'}),pushed=page.getByRole('row').filter({hasText:'Saved Pushed Person'}),noPhone=page.getByRole('row').filter({hasText:'Saved No Phone Person'});
 await expect(ready).toContainText('Ready NEW');await expect(ready).toContainText('+962791234560');await expect(pushed).toContainText('Saved HubSpot task saved-task-2');await expect(noPhone).toContainText('No phone');
 await page.reload();await expect(ready).toContainText('Ready NEW');await expect(pushed).toContainText('Saved HubSpot task saved-task-2');
 metadataChanged=true;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('salesnav:profiles-synced')));await expect(ready).toContainText('Updated HR Director');await expect(ready).toContainText('Ready NEW');await expect(noPhone).toContainText('No phone');await expect(pushed).toContainText('Pushed');
 expect(checks).toBeGreaterThanOrEqual(4);expect(paid).toBe(0);
});
test('a new capture cannot replace an active check; idle new-run events open the saved capture',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sdr_v2_visitor_id','new_run_qa');localStorage.setItem('sdr_v2_visitor_name','New Run QA');});await page.request.post('/api/sdr-admin',{data:{password:'playwright-tools-only-password'}});
 const nextId='00000000-0000-4000-8000-000000000072';let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/prospecting/salesnav/full-run*',route=>{const next=new URL(route.request().url()).searchParams.get('id')===nextId;return route.fulfill({json:{run:{...run,id:next?nextId:run.id,total:1,leads:[{...baseLead,name:next?'New Capture Person':'Original Check Person',linkedinUrl:''}]},history:[run,{...run,id:nextId}]}});});
 await page.route('**/api/prospecting/salesnav/companion',route=>route.fulfill({json:{ok:true,paired:true,unlocked:true,latestFullRun:run}}));await page.route('**/api/prospecting/salesnav/task-options',route=>route.fulfill({json:{owners:[]}}));await page.route('**/api/prospecting/salesnav/precheck-v2',async route=>{await gate;return route.fulfill({json:{contact:{inHubSpot:false},company:{inHubSpot:false,protected:false}}});});
 await page.goto('/signalhire-queue');await page.getByRole('button',{name:'HubSpot Check',exact:true}).click();await expect(page.getByRole('combobox',{name:'Search history'})).toBeDisabled();
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('salesnav:new-run',{detail:{runId:id}})),nextId);await expect(page.getByText('A new capture is saved. Open it when this batch finishes.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Open new capture'})).toBeDisabled();await expect(page.getByRole('table')).toContainText('Original Check Person');
 release();await expect(page.getByRole('button',{name:'HubSpot Check',exact:true})).toBeEnabled();await expect(page.getByRole('table')).toContainText('Original Check Person');
 await page.getByRole('button',{name:'Open new capture'}).click();await expect(page.getByRole('table')).toContainText('New Capture Person');
});

test('only the server-attested partial contact can resume Push after refresh and a failed retry',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sdr_v2_visitor_id','partial_push_qa');localStorage.setItem('sdr_v2_visitor_name','Partial Push QA');});await page.request.post('/api/sdr-admin',{data:{password:'playwright-tools-only-password'}});
 page.on('dialog',dialog=>dialog.accept());let pushes=0;
 const leads=[{...baseLead,name:'Partial Own Person'},{...baseLead,name:'Other Existing Person',salesLeadUrl:'https://www.linkedin.com/sales/lead/OTHER',linkedinUrl:'https://www.linkedin.com/in/other-existing'},{...baseLead,name:'Retention Own Person',salesLeadUrl:'https://www.linkedin.com/sales/lead/RETENTION',linkedinUrl:'https://www.linkedin.com/in/retention-existing'}];
 await page.route('**/api/prospecting/salesnav/full-run*',route=>route.fulfill({json:{run:{...run,leads,leadStates:leads.map((lead,index)=>({prospect:{fullName:lead.name,company:lead.company,linkedinUrl:lead.linkedinUrl,phone:'+962791234567'},revealStatus:'completed',pushRetryable:true,resumeContactId:index===1?'different-contact':`own-${index}`}))},history:[run]}}));
 await page.route('**/api/prospecting/salesnav/companion',route=>route.fulfill({json:{ok:true,paired:true,unlocked:true,latestFullRun:run}}));await page.route('**/api/prospecting/salesnav/task-options',route=>route.fulfill({json:{owners:[{id:'31644369',name:'Marita'}]}}));
 await page.route('**/api/prospecting/salesnav/precheck-v2',route=>{const index=leads.findIndex(lead=>lead.name===route.request().postDataJSON().name);return route.fulfill({json:{contact:{inHubSpot:true,id:`own-${index}`},company:{protected:true,inHubSpot:true,gateReason:'Existing person blocked',accountType:index===2?'Retention':'',engagementChecked:true,meetingCount:0,connectedCallCount:0}}});});
 await page.route('**/api/prospecting/salesnav/push-ready-v2',route=>{pushes++;return pushes===1?route.fulfill({status:503,json:{error:'Task service unavailable',retryable:true,contactId:'own-0'}}):route.fulfill({json:{ok:true,taskId:'recovered-task',ownerName:'Marita'}});});
 await page.goto('/signalhire-queue');const own=page.getByRole('row').filter({hasText:'Partial Own Person'});
 await expect(own).toContainText('Resume Push');await expect(page.getByRole('row').filter({hasText:'Other Existing Person'})).toContainText('Blocked');await expect(page.getByRole('row').filter({hasText:'Retention Own Person'})).toContainText('Blocked');
 await page.reload();await expect(own).toContainText('Resume Push');await page.getByRole('button',{name:'Select visible',exact:true}).click();await page.getByRole('button',{name:'Push NEW Ready + Tasks (1)',exact:true}).click();await expect(own).toContainText('Task service unavailable');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('salesnav:profiles-synced')));await expect(own).toContainText('Resume Push');await page.getByRole('button',{name:'Select visible',exact:true}).click();await page.getByRole('button',{name:'Push NEW Ready + Tasks (1)',exact:true}).click();await expect(page.getByRole('table')).toContainText('Task recovered-task');expect(pushes).toBe(2);
});
