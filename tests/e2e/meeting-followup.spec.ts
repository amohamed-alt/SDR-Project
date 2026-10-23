import { expect, test } from '@playwright/test';
test('CRM conflict keeps the draft and never displays a successful save', async ({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sdr_v2_visitor_id','visitor_meeting_followup_ci');localStorage.setItem('sdr_v2_visitor_name','Meeting Followup CI');sessionStorage.setItem('sdr_v2_session_id','session_meeting_followup_ci');});
 await page.request.post('/api/sdr-admin',{data:{password:'playwright-tools-only-password'}});
 await page.route('**/api/meeting-followup?**',r=>r.fulfill({json:{rows:[{id:'1',title:'Example demo',start:'2026-10-25T08:00:00Z',outcome:'COMPLETED',sdr:'Marita',sdrId:'31644369',rm:'Example RM',rmId:'22',dealId:'33',deal:'Example opportunity',stage:'Demo Done',product:'Talentera',properties:{hs_lastmodifieddate:'v1',deal_update_rm_notes:'Old note'},meetingVersion:'v1',issues:['Next step / date missing'],url:'https://app-eu1.hubspot.com/contacts/145742477/deal/33'},],fields:[{name:'deal_update_rm_notes',label:'RM notes',type:'string'}],outcomes:[],updatedAt:'2026-10-25T09:00:00Z',policy:'Working hours',coverage:'Synthetic test fixture',writesEnabled:true}}));
 await page.route('**/api/meeting-followup',r=>r.fulfill({status:409,json:{error:'This deal changed in HubSpot. Reload before saving.'}}));
 await page.goto('/meeting-followup');
 await page.getByRole('button',{name:'Load / refresh'}).click();
 await expect(page.getByText('Example demo')).toBeVisible();
 await page.getByRole('button',{name:'Update deal'}).click();
 await page.getByLabel('RM notes').fill('Draft retained');
 page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Save & verify in HubSpot'}).click();
 await expect(page.getByRole('status')).toContainText('Reload before saving');
 await expect(page.getByLabel('RM notes')).toHaveValue('Draft retained');
 await expect(page.getByText('Saved and verified by reading HubSpot.')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('heading',{name:'Meeting follow-up',exact:true})).toBeVisible();
});
