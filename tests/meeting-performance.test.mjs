import test from 'node:test';
import assert from 'node:assert/strict';
import { acquisitionMotion, meetingPerformance, monthlyPacing, verifiedEmailStatus, testedPhoneStatus } from '../src/lib/meeting-performance.ts';

test('future bookings, prior-month bookings held now, backfills, and missing outcomes use separate cohorts',()=>{
 const rows=[
 {createdAt:'2026-10-02T08:00:00Z',startAt:'2026-10-12T09:00:00Z',outcome:'SCHEDULED',motion:'Inbound'},
 {createdAt:'2026-09-28T08:00:00Z',startAt:'2026-10-05T09:00:00Z',outcome:'COMPLETED',motion:'Outbound'},
 {createdAt:'2026-10-06T08:00:00Z',startAt:'2026-09-20T09:00:00Z',outcome:'COMPLETED',motion:'Outbound'},
 {createdAt:'2026-10-02T08:00:00Z',startAt:'2026-10-06T09:00:00Z',outcome:'SCHEDULED',motion:'Unknown'},
 {createdAt:'2026-10-02T08:00:00Z',startAt:'2026-10-07T09:00:00Z',outcome:'CANCELED',motion:'Unknown'}];
 const result=meetingPerformance(rows,'2026-10-01','2026-10-08',new Date('2026-10-08T12:00:00Z'));
 assert.equal(result.booked,3);assert.equal(result.held,1);assert.equal(result.elapsed,2);assert.equal(result.attendanceRate,50);assert.equal(result.missingOutcomes,1);assert.equal(result.backfilled,1);assert.equal(result.upcoming,1);assert.equal(result.inbound,1);assert.equal(result.outbound,0);assert.equal(result.unknown,2);
});
test('classification never infers outbound from imports or ambiguous sources',()=>{
 assert.equal(acquisitionMotion('SDR Outbound'),'Outbound');assert.equal(acquisitionMotion('Inbound Marketing'),'Inbound');assert.equal(acquisitionMotion('','API import'),'Unknown');assert.equal(acquisitionMotion('Inbound Marketing','Outbound'),'Unknown');
});
test('negative verification statuses cannot match positive substrings',()=>{
 for(const raw of ['invalid','unverified','not valid','unknown',''])assert.equal(verifiedEmailStatus(raw),false);
 assert.equal(verifiedEmailStatus(' Valid '),true);assert.equal(testedPhoneStatus('invalid'),false);assert.equal(testedPhoneStatus('Correct'),true);
});
test('monthly pacing follows Sun–Thu and includes the current working day',()=>{
 assert.deepEqual(monthlyPacing('2026-10','2026-10-08'),{total:21,elapsed:6,fraction:6/21});
 assert.equal(monthlyPacing('2026-10','2026-09-30').elapsed,0);assert.equal(monthlyPacing('2026-10','2026-11-01').fraction,1);
});
