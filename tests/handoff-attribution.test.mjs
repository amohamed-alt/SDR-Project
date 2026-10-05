import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingSdr } from '../src/lib/handoff-attribution.ts';
const sdrs = [{ id: 'marita', name: 'Marita Chedid', creatorId: '11' }, { id: 'daniel', name: 'Daniel Beaini', creatorId: '22' }];
const record = properties => ({ id: '1', properties });
test('booking notes attribute both SDRs even when an integration creates the meeting', () => {
  assert.equal(bookingSdr([record({ hs_internal_meeting_notes: 'Booked by Daniel Beaini through SDR Command Center.', hs_created_by_user_id: '11' })], sdrs)?.id, 'daniel');
  assert.equal(bookingSdr([record({ hs_internal_meeting_notes: 'BOOKED BY MARITA Chedid' })], sdrs)?.id, 'marita');
});
test('creator IDs resolve bookings without notes across deduplicated records', () => {
  assert.equal(bookingSdr([record({}), record({ hs_created_by_user_id: '22' })], sdrs)?.id, 'daniel');
});
test('unknown or conflicting attribution does not invent an SDR booking', () => {
  assert.equal(bookingSdr([record({ hubspot_owner_id: 'marita', hs_created_by_user_id: 'unknown' })], sdrs), null);
  assert.equal(bookingSdr([record({ hs_created_by_user_id: '11' }), record({ hs_created_by_user_id: '22' })], sdrs), null);
});
