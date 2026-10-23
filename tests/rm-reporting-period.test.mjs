import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RM_REPORTING_START,rmReportingToday,validRmReportingRange} from '../src/lib/rm-reporting-period.ts';
test('fixed July cohort remains valid beyond the previous 93 day limit',()=>{
 const now=Date.parse('2026-10-23T12:00:00Z');
 assert.equal(RM_REPORTING_START,'2026-07-13');
 assert.equal(validRmReportingRange(RM_REPORTING_START,'2026-10-23',now),true);
 assert.equal(validRmReportingRange('2026-07-12','2026-10-23',now),false);
 assert.equal(validRmReportingRange(RM_REPORTING_START,'2026-10-24',now),false);
 assert.equal(validRmReportingRange('2026-09-31','2026-10-23',now),false);
 assert.equal(validRmReportingRange('2026-10-23','2026-10-22',now),false);
});
test('reporting end rolls forward at Riyadh midnight and across years',()=>{
 assert.equal(rmReportingToday(Date.parse('2026-10-23T20:59:59Z')),'2026-10-23');
 assert.equal(rmReportingToday(Date.parse('2026-10-23T21:00:00Z')),'2026-10-24');
 assert.equal(validRmReportingRange(RM_REPORTING_START,'2027-01-01',Date.parse('2026-12-31T21:00:00Z')),true);
});
