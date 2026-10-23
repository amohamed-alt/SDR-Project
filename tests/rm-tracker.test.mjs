import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trackerMeetingId,trackerRmId} from '../src/lib/rm-tracker-core.ts';
test('tracker RM names match exact aliases and do not guess substrings',()=>{
 assert.equal(trackerRmId(' Fadi Zanona '),'76369998');assert.equal(trackerRmId('Fadi'),'76369998');assert.equal(trackerRmId('Fadi / Zein'),'');assert.equal(trackerRmId('Other Fadi'),'');assert.equal(trackerRmId(''),'');
});
test('only meeting URLs from this portal reconcile tracker entries',()=>{
 assert.equal(trackerMeetingId('https://app-eu1.hubspot.com/contacts/145742477/record/0-47/123?x=y'),'123');
 for(const url of ['https://app-eu1.hubspot.com/contacts/145742477/record/0-1/123','https://app-eu1.hubspot.com/contacts/999/record/0-47/123','https://evil.test/contacts/145742477/record/0-47/123','123'])assert.equal(trackerMeetingId(url),'');
});
