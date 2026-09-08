import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeSdr } from '../src/lib/sdr-comparison.ts';
import { meetingCreatorId } from '../src/lib/owner-attribution.ts';
import { SDR_OWNERS } from '../src/lib/sdr-owners.ts';

test('meeting attribution uses HubSpot user ID, not record owner ID', () => {
  const owners = [{ id: '37624223', name: 'Daniel Beaini', userId: '123456' }];
  assert.equal(meetingCreatorId(owners, '37624223'), '123456');
  assert.equal(meetingCreatorId(owners, '31644369'), undefined);
  assert.equal(meetingCreatorId([{ id: '37624223', name: 'Daniel' }], '37624223'), undefined);
});

test('team summaries preserve zero values and source warnings without contact payloads', () => {
  const data = { meta: { ownerId: SDR_OWNERS.daniel.ownerId, ownerName: 'Daniel Beaini', from: '2026-09-01', to: '2026-09-08', generatedAt: '2026-09-08T09:00:00Z', warnings: ['Meetings unavailable'], isDemo: false }, kpis: { calls: 0, bookedMeetings: 0 }, dailyActivities: [], priorityContacts: [{ email: 'private@example.test' }], recentActivities: [{ subject: 'Private call' }] };
  const result = summarizeSdr(data);
  assert.equal(result.meta.ownerId, '37624223');
  assert.equal(result.kpis.calls, 0);
  assert.deepEqual(result.meta.warnings, ['Meetings unavailable']);
  assert.equal('priorityContacts' in result, false);
  assert.equal('recentActivities' in result, false);
});
