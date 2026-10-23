import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessMinutes, followupIssues } from '../src/lib/meeting-followup-core.ts';
test('SLA excludes Friday, Saturday and overnight hours',()=>{
 assert.equal(businessMinutes('2026-10-22T13:00:00Z','2026-10-25T06:30:00Z'),60);
 assert.equal(businessMinutes('bad','2026-10-25T06:30:00Z'),0);
});
const input={outcome:'COMPLETED',end:'2026-10-25T06:00:00Z',now:'2026-10-25T10:00:00Z',notes:'Discovery captured',nextStep:'Follow up',due:'2026-10-25',rm:'123',closed:false,tasks:[]};
test('A task belonging to another RM does not satisfy follow-up',()=>{
 assert.ok(followupIssues({...input,tasks:[{open:true,owner:'456',due:'2026-10-26'}]}).includes('No future RM task on this deal'));
 assert.deepEqual(followupIssues({...input,tasks:[{open:true,owner:'123',due:'2026-10-26'}]}),[]);
});
test('Next step is not overdue at midnight UTC on its due date',()=>{
 assert.ok(!followupIssues(input).includes('Next step overdue'));
 assert.ok(followupIssues({...input,due:'2026-10-24'}).includes('Next step overdue'));
});
test('Closed deals stop follow-up breaches and scheduled future meetings are not overdue',()=>{
 assert.deepEqual(followupIssues({...input,closed:true,notes:'',nextStep:''}),[]);
 assert.deepEqual(followupIssues({...input,outcome:'SCHEDULED',end:'2026-10-26T06:00:00Z'}),[]);
});
