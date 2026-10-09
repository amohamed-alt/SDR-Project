import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetDate, parseMeetingTab, sheetMeetingPerformance, applyMeetingSheet } from '../src/lib/meeting-sheet-data.ts';
function createMockDashboard(from,to,ownerId) {
 return {meta:{from,to,ownerId,ownerName:'Daniel',warnings:[]}, kpis:{bookedMeetings:99,completedMeetings:5,calls:20,connectedCalls:10,dealsCreated:2},recentActivities:[{id:'crm-meeting',type:'Meeting'},{id:'call',type:'Call'}],dailyActivities:[{date:'2026-10-05',meetingsBooked:99}],intelligence:{}};
}
const header=['Meeting Date','Meeting Time','Company','Contact Name','Contact Email','Booked By','Sales Rep','Product ','Meeting Status','Lead Source','HubSpot Meeting Link / ID','Notes'];
const row=(date,status,source='Outbound',owner='Daniel')=>[date,'10:00 AM','Example Co','Person','private@example.com',owner,'Zain','Evalufy',status,source,'','private notes'];
test('dates parse both trackers and reject impossible dates',()=>{
  for(const raw of ['13-0ct-2026','13 Oct 2026','13- Oct -2026','2026-10-13','10/13/2026'])assert.equal(sheetDate(raw),'2026-10-13');
  for(const raw of ['31 Feb 2026','2026-13-01','unknown',''])assert.equal(sheetDate(raw),'');
});
test('reads headers by name, preserves row provenance and owner, excludes private fields',()=>{
  const p=parseMeetingTab([['title'],header,row('05-Oct-2026','Attended'),row('06-Oct-2026','Scheduled','Inbound','Marita'),row('bad','Attended')],'abc',12,'Daniel');
  assert.equal(p.rows.length,1);assert.equal(p.rows[0].status,'Completed');assert.ok(p.rows[0].sheetUrl.endsWith('gid=12&range=A3'));
  assert.equal(JSON.stringify(p).includes('private@'),false);assert.equal(JSON.stringify(p).includes('private notes'),false);assert.equal(p.warnings.length,1);
  assert.throws(()=>parseMeetingTab([['bad']], 'abc',12,'Daniel'));
});
test('future, canceled, rescheduled and missing outcomes have distinct reporting semantics',()=>{
  const p=parseMeetingTab([header,row('05-Oct-2026','Attended'),row('13-Oct-2026','Scheduled'),row('06-Oct-2026','Canceled'),row('06-Oct-2026','Rescheduled'),row('08-Oct-2026',''),row('07-Oct-2026','No Show','Inbound')],'abc',12,'Daniel');
  const all=sheetMeetingPerformance(p.rows,'2026-10-01','2026-10-31','2026-10-09');
  assert.deepEqual({booked:all.booked,out:all.outbound,inbound:all.inbound,held:all.held,elapsed:all.elapsed,upcoming:all.upcoming,missing:all.missingOutcomes},{booked:6,out:3,inbound:1,held:1,elapsed:3,upcoming:1,missing:1});
  assert.equal(sheetMeetingPerformance(p.rows,'2026-10-01','2026-10-09','2026-10-09').booked,5);
});
test('aggregate and drilldown rows use the same sheet; CRM signals retain their evidence',()=>{
  const data=createMockDashboard('2026-10-01','2026-10-09','37624223');
  const rows=parseMeetingTab([header,row('05-Oct-2026','Attended'),row('13-Oct-2026','Scheduled')],'abc',12,'Daniel').rows;
  const before=data.recentActivities.filter(r=>r.type==='Meeting');
  const out=applyMeetingSheet(data,{rows,status:'ready',syncedAt:'2026-10-09T00:00:00Z',warnings:[],url:'https://docs.google.com/spreadsheets/d/abc/edit'},{from:'2026-10-01',to:'2026-10-09',ownerId:'37624223'},'2026-10-09');
  assert.equal(out.kpis.bookedMeetings,1);assert.equal(out.kpis.completedMeetings,1);assert.equal(out.recentActivities.filter(r=>r.type==='Meeting').length,1);assert.equal(out.dailyActivities.reduce((n,r)=>n+r.meetingsBooked,0),1);assert.deepEqual(out.hubspotMeetingEvidence,before);assert.equal(out.kpis.calls,data.kpis.calls);
});
test('unavailable sheet never yields fake sheet zero totals',()=>{
  const data=createMockDashboard('2026-10-01','2026-10-09','37624223');
  const out=applyMeetingSheet(data,{rows:[],status:'unavailable',syncedAt:'',warnings:[],url:'x',error:'403'},{from:'2026-10-01',to:'2026-10-09',ownerId:'37624223'},'2026-10-09');
  assert.equal(out.meetingPerformance,undefined);assert.equal(out.kpis.bookedMeetings,data.kpis.bookedMeetings);assert.match(out.meta.warnings.at(-1),/falls back to HubSpot/);
});
