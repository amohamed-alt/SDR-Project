import test from 'node:test';
import assert from 'node:assert/strict';
import { reportingOwnerScope } from '../src/lib/reporting-owner-scope.ts';

test('SDR reporting preserves creator-user attribution and SDR portfolio ownership', () => {
  for (const ownerId of ['31644369', '37624223']) {
    assert.deepEqual(reportingOwnerScope(ownerId, 'creator-user'), {isRm:false,contactProperty:'sdr_owner',meetingProperty:'hs_created_by_user_id',meetingOwner:'creator-user'});
    assert.equal(reportingOwnerScope(ownerId).meetingOwner, undefined);
  }
});
test('RM reporting includes assigned meetings even when an SDR created them', () => {
  for (const ownerId of ['76369997', '31558980']) {
    assert.deepEqual(reportingOwnerScope(ownerId, 'different-creator'), {isRm:true,contactProperty:'hubspot_owner_id',meetingProperty:'hubspot_owner_id',meetingOwner:ownerId});
    assert.equal(reportingOwnerScope(ownerId).meetingOwner, ownerId);
  }
});
