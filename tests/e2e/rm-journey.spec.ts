import { expect, test } from '@playwright/test';
const profiles=[{slug:'zein',id:'31558980',name:'Zein Fares',short:'Zein',initials:'ZF'},{slug:'bassam',id:'75863674',name:'Bassam Hamed',short:'Bassam',initials:'BH'}];
const fixture={rows:[{responsibleRmIds:['31558980'],responsibleRmNames:['Zein Fares'],responsibilitySource:'Contact owner',id:'1',title:'Example discovery',start:'2026-10-20T08:00:00Z',end:'2026-10-20T09:00:00Z',outcome:'COMPLETED',version:'v1',people:{creatorId:'31558980',assignedId:'31558980',attendees:['31644369'],sdrs:[{id:'31644369',name:'Marita',roles:['Attendee'],booked:false}],rms:[{...profiles[0],roles:['Creator','Assigned owner']}]},creatorName:'Zein Fares',assignedName:'Zein Fares',company:{id:'company',name:'Example Logistics',domain:'example.invalid',url:'https://example.invalid'},contacts:[{id:'contact',name:'Example Director',email:'director@example.invalid',title:'HR Director',createdAt:'2026-10-01T08:00:00Z',source:'OFFLINE',url:'https://example.invalid'}],deals:[],tasks:[],notes:'Discovery recorded.',summary:'Assessment discussion.',description:'',hasTranscript:true,recordUrl:'https://example.invalid',prospectKey:'company:company',followups:[]}],profiles,fields:[],outcomes:[],updatedAt:'2026-10-23T10:00:00Z',from:'2026-09-23',to:'2026-10-23',counts:{scannedMeetings:1,matchedMeetings:1},coverage:'Explicit CRM evidence',warnings:[]};
async function setup(page:import('@playwright/test').Page){
 await page.addInitScript(()=>{localStorage.setItem('sdr_v2_visitor_id','visitor_rm_journey_ci');localStorage.setItem('sdr_v2_visitor_name','RM Journey CI');sessionStorage.setItem('sdr_v2_session_id','session_rm_journey_ci');});
 await page.request.post('/api/sdr-admin',{data:{password:'playwright-tools-only-password'}});
 await page.route('**/api/rm-journey/trackers?**',r=>r.fulfill({json:{sources:[]}}));
 await page.route('**/api/rm-journey?**',r=>r.fulfill({json:fixture}));
 await page.route('**/api/rm-journey/detail?**',r=>r.fulfill({json:{events:[{id:'call1',type:'Call',title:'Follow-up attempt',body:'Customer asked for pricing',at:'2026-10-21T08:00:00Z',ownerId:'31558980',owner:'Zein',status:'COMPLETED',followup:true,scope:'Contact-linked'}],warnings:[],coverage:'Contact-linked events may relate to another opportunity.',generatedAt:'2026-10-23T10:00:00Z'}}));
}
test('separate RM URLs preserve reverse participant evidence and open the complete journey',async({page})=>{
 await setup(page);await page.goto('/rm/zein');await expect(page.getByRole('heading',{name:'Zein’s workspace'})).toBeVisible();await expect(page.getByText('Example Logistics',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open journey'}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await dialog.getByRole('tab',{name:'Notes & transcript'}).click();await expect(dialog.getByText('participation only; not booking credit',{exact:false})).toBeVisible();await expect(dialog.getByRole('link',{name:'Open meeting / transcript in HubSpot'})).toBeVisible();
 await dialog.getByRole('tab',{name:'Activity timeline'}).click();await expect(dialog.getByText('Follow-up attempt')).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Open journey'})).toBeFocused();
 await page.getByRole('link',{name:'BH Bassam'}).click();await expect(page).toHaveURL(/\/rm\/bassam$/);await expect(page.getByRole('heading',{name:'Bassam’s workspace'})).toBeVisible();await expect(page.getByText('Example Logistics',{exact:true})).toHaveCount(0);
});
test('team navigation remains usable on mobile and search filters prospects',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});await page.goto('/rm');await expect(page.getByRole('navigation',{name:'Relationship managers'})).toBeVisible();await expect(page.getByRole('heading',{name:'Every handoff. One clear next step.'})).toBeVisible();await page.getByRole('textbox',{name:'Search prospects'}).fill('No matching company');await expect(page.getByRole('heading',{name:'No matching prospect meetings'})).toBeVisible();
});
test('an RM invited as an attendee is visible without being blamed for another RM follow-up',async({page})=>{
 await setup(page);
 const shared=structuredClone(fixture);
 shared.rows[0].people.rms.push({...profiles[1],roles:['Attendee']});
 await page.route('**/api/rm-journey?**',r=>r.fulfill({json:shared}));
 await page.goto('/rm/bassam');
 await expect(page.getByText('Example Logistics',{exact:true})).toBeVisible();
 await expect(page.getByText('Participant · no follow-up SLA assigned',{exact:true})).toBeVisible();
 await expect(page.getByRole('article').filter({hasText:'Assigned SLA exceptions'})).toContainText('0');
 await page.getByRole('button',{name:'Open journey'}).click();
 await expect(page.getByRole('dialog').getByText('attendance alone does not assign follow-up SLA.',{exact:false})).toBeVisible();
});

test('follow-up task confirms owner, time and contact and displays success only after server verification', async ({page}) => {
 await setup(page);
 let creates = 0;
 await page.route('**/api/rm-journey/task', async route => {
   creates++;
   const body = route.request().postDataJSON();
   expect(body).toMatchObject({meetingId:'1',rmId:'31558980',contactId:'contact',dealId:'',type:'TODO',title:'Follow up with HR'});
   expect(body.dueAt).toBe('2027-10-25T06:30:00.000Z');
   expect(body.reminderAt).toBe('2027-10-25T05:30:00.000Z');
   await route.fulfill({json:{confirmed:true,taskId:'9001',reused:false,task:{id:'9001',properties:{hs_task_subject:body.title,hs_timestamp:body.dueAt,hubspot_owner_id:body.rmId,hs_task_type:body.type,hs_task_status:'NOT_STARTED'}}}});
 });
 await page.goto('/rm/zein');
 await page.getByRole('button',{name:'Open journey'}).click();
 await page.getByRole('tab',{name:'Update HubSpot'}).click();
 await page.getByLabel('Task title',{exact:true}).fill('Follow up with HR');
 await page.getByLabel('HubSpot reminder',{exact:true}).selectOption('60');
 await page.getByLabel('Task due time (Riyadh)',{exact:true}).fill('2027-10-25T09:30');
 page.on('dialog', async dialog => { expect(dialog.message()).toContain('Zein Fares'); expect(dialog.message()).toContain('Example Director'); await dialog.accept(); });
 await page.getByRole('button',{name:'Create & verify task'}).click();
 await expect(page.getByRole('status')).toContainText('Task 9001 created and verified in HubSpot.');
 await expect(page.getByRole('button',{name:'Create & verify task'})).toHaveCount(0);
 expect(creates).toBe(1);
});

test('failed task create preserves the draft on mobile and never claims success', async ({page}) => {
 await setup(page);
 await page.route('**/api/rm-journey/task', route => route.fulfill({status:502,json:{error:'Task creation could not be confirmed. Review HubSpot before retrying.'}}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/rm/zein');
 await page.getByRole('button',{name:'Open journey'}).click();
 await page.getByRole('tab',{name:'Update HubSpot'}).click();
 await page.getByLabel('Task title',{exact:true}).fill('Retain this task draft');
 await page.getByLabel('Task due time (Riyadh)',{exact:true}).fill('2027-10-25T09:30');
 page.on('dialog', dialog => dialog.accept());
 await page.getByRole('button',{name:'Create & verify task'}).click();
 await expect(page.getByRole('status')).toContainText('Review HubSpot before retrying');
 await expect(page.getByLabel('Task title',{exact:true})).toHaveValue('Retain this task draft');
 await expect(page.getByText('created and verified in HubSpot.',{exact:false})).toHaveCount(0);
});

test('task creation API rejects cross-origin writes and demo-mode writes', async ({page,baseURL}) => {
 await setup(page);
 const locked = await page.request.post('/api/rm-journey/task',{data:{}});
 expect(locked.status()).toBe(401);
 // next start uses a Secure cookie. Exercise the route's authenticated guards
 // with the existing test-only automation credential over the isolated HTTP server.
 const auth = {'x-acquisition-owner-token':'playwright-tools-only-password'};
 const cross = await page.request.post('/api/rm-journey/task',{headers:{...auth,origin:'https://untrusted.invalid'},data:{}});
 expect(cross.status()).toBe(403);
 const demo = await page.request.post('/api/rm-journey/task',{headers:{...auth,origin:baseURL!},data:{}});
 expect(demo.status()).toBe(403);
 expect((await demo.json()).error).toContain('demo mode');
});

 test('Fadi tracker meetings remain visible without CRM participation and never invent SLA',async({page})=>{
 await setup(page);
 await page.route('**/api/rm-journey/trackers?**',r=>r.fulfill({json:{sources:[{owner:'Marita',ownerId:'31644369',status:'ready',syncedAt:'2026-10-23T10:00:00Z',url:'https://docs.google.com/spreadsheets/d/example/edit',warnings:[],rows:[{id:'sheet-1',date:'2026-10-20',company:'Tracker-only Company',salesRep:'Fadi',product:'Talentera',status:'Completed',motion:'Inbound',sheetUrl:'https://docs.google.com/spreadsheets/d/example/edit#range=A2',hubspotUrl:'',rmId:'76369998',meetingId:'',sdrId:'31644369',sdr:'Marita'}]}]}}));
 await page.goto('/rm/fadi');
 await page.getByText('View tracker meetings · 1 entries',{exact:true}).click();
 await expect(page.getByText('Tracker-only Company',{exact:true})).toBeVisible();
 await expect(page.getByText('Follow-up and SLA unverified for this entry')).toBeVisible();
 await expect(page.getByRole('img',{name:'Talentera',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByText('Tracker-only Company',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/rm-mobile-review.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'/tmp/rm-desktop-review.png',fullPage:true});
 });


test('contact validation saves only changed fields and immediately exempts an unqualified contact',async({page})=>{
 await setup(page);
 const data={...structuredClone(fixture),contactFields:[{name:'rm_meeting_outcome',label:'RM Meeting Outcome',type:'enumeration',options:[{value:'Unqualified',label:'Unqualified'}]},{name:'rm_validation_reason',label:'RM Validation Reason',type:'enumeration',options:[{value:'No need',label:'No need'}]},{name:'rm_feedback',label:'RM Feedback',type:'string'}]};
 Object.assign(data.rows[0].contacts[0],{ownerId:'31558980',version:'contact-v1',properties:{}});
 await page.route('**/api/rm-journey?**',r=>r.fulfill({json:data}));
 let writes=0;
 await page.route('**/api/rm-journey/contact',async r=>{writes++;const b=r.request().postDataJSON();expect(b).toMatchObject({id:'contact',rmId:'31558980',version:'contact-v1',properties:{rm_meeting_outcome:'Unqualified',rm_validation_reason:'No need',rm_feedback:'No recruitment need'}});await r.fulfill({json:{confirmed:true,record:{id:'contact',properties:{...b.properties,lastmodifieddate:'contact-v2'}}}});});
 await page.goto('/rm/zein');await page.getByRole('button',{name:'Open journey',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('CRM validation')).toContainText('0 / 3 filled');
 await dialog.getByRole('button',{name:'Review contact fields'}).click();
 await dialog.getByLabel('RM Meeting Outcome',{exact:true}).selectOption('Unqualified');await dialog.getByLabel('RM Validation Reason',{exact:true}).selectOption('No need');await dialog.getByLabel('RM Feedback',{exact:true}).fill('No recruitment need');
 page.on('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Save & verify contact'}).click();await expect(dialog.getByRole('status')).toContainText('Contact saved and verified');
 await dialog.getByRole('tab',{name:'Overview',exact:true}).click();await expect(dialog.getByLabel('CRM validation')).toContainText('3 / 3 filled');await expect(dialog.getByText('No follow-up required · Unqualified · No need',{exact:true})).toHaveCount(2);expect(writes).toBe(1);
});

test('contact update endpoint rejects cross-origin and demo writes',async({page})=>{
 await setup(page);const auth={'x-acquisition-owner-token':'playwright-tools-only-password'};
 expect((await page.request.post('/api/rm-journey/contact',{headers:{...auth,origin:'https://untrusted.invalid'},data:{}})).status()).toBe(403);
 expect((await page.request.post('/api/rm-journey/contact',{headers:auth,data:{}})).status()).toBe(403);
});

test('RM reporting starts July 13 and ends on the current Riyadh day',async({page})=>{
 await setup(page);
 const requests:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/rm-journey?')||r.url().includes('/api/rm-journey/trackers?'))requests.push(r.url());});
 await page.goto('/rm/zein');
 await expect(page.getByRole('heading',{name:'Zein’s workspace'})).toBeVisible();
 await expect(page.getByText('Fixed start · updates through today · Riyadh')).toBeVisible();
 await expect(page.getByRole('button',{name:'Last 30 days'})).toHaveCount(0);
 await expect.poll(()=>requests.length).toBeGreaterThanOrEqual(2);
 const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
 for(const request of requests){const u=new URL(request);expect(u.searchParams.get('from')).toBe('2026-07-13');expect(u.searchParams.get('to')).toBe(today);}
 await page.getByRole('button',{name:'Open journey',exact:true}).click();
 await page.getByRole('tab',{name:'Update HubSpot'}).click();
 await expect(page.getByRole('region',{name:'Where changes are saved'})).toContainText('Saved directly to HubSpot');
 await expect(page.getByRole('region',{name:'Where changes are saved'}).getByRole('link',{name:'Contact: Example Director'})).toHaveAttribute('href','https://example.invalid');
});

test('long RM queues paginate without changing totals and reset pages after filtering',async({page})=>{
 await setup(page);
 const many=structuredClone(fixture);
 many.rows=Array.from({length:21},(_,i)=>({...structuredClone(fixture.rows[0]),id:String(i+1),prospectKey:`company:${i}`,company:{...fixture.rows[0].company,id:String(i),name:`Review account ${i+1}`}}));
 await page.route('**/api/rm-journey?**',r=>r.fulfill({json:many}));
 await page.goto('/rm/zein');
 await expect(page.getByRole('button',{name:'Open journey',exact:true})).toHaveCount(20);
 await expect(page.getByRole('article').filter({hasText:'Linked CRM prospects'})).toContainText('21');
 const pages=page.getByRole('navigation',{name:'Account pages'});
 await pages.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open journey',exact:true})).toHaveCount(1);
 await expect(page.getByText('Review account 21',{exact:true})).toBeVisible();
 await expect(pages.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
 await page.getByRole('textbox',{name:'Search prospects'}).fill('Review account 1');
 await expect(pages).toHaveCount(0);
 await expect(page.getByText('Review account 1',{exact:true})).toBeVisible();
 const row=page.getByRole('row').filter({has:page.getByText('Review account 1',{exact:true})});
 await expect(row.getByText('No upcoming RM task recorded',{exact:true})).toHaveCount(1);
 await row.getByRole('button',{name:'Update HubSpot',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Update HubSpot',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('region',{name:'Where changes are saved'})).toBeVisible();
});
