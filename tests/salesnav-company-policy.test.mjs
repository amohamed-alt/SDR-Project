import assert from 'node:assert/strict';
import test from 'node:test';
import { scanSalesNavCompany, salesNavGate, salesNavSdrOwner, usableSalesNavPhone } from '../src/lib/salesnav-company-policy.ts';

function reader({ connected = false, retention = false, partial = false, failure = false } = {}) {
  return {
    async associations(from, to, ids) {
      if (failure) throw new Error('HubSpot unavailable');
      if (from === 'companies' && to === 'contacts') return new Map([['company', Array.from({ length: 151 }, (_, i) => String(i))]]);
      if (from === 'contacts' && to === 'calls' && ids.includes('150')) return new Map([['150', ['call']]]);
      if (from === 'contacts' && to === 'deals' && retention) return new Map([['150', ['deal']]]);
      return new Map(ids.map(id => [id, []]));
    },
    async records(type, ids) {
      if (partial) return [];
      return ids.map(id => ({ id, properties: type === 'calls' ? { hs_call_disposition: connected ? 'f240bbac-87c9-4f6e-bf70-924b57d47db7' : 'no-answer' } : { pipeline: '1026934003', hs_is_closed: 'true' } }));
    },
  };
}

test('contact 151 connected call blocks net-new even without a meeting', async () => {
  const scan = await scanSalesNavCompany('company', reader({ connected: true }));
  assert.equal(scan.contactsChecked, 151);
  assert.equal(scan.connectedCallCount, 1);
  assert.match(salesNavGate({}, { inHubSpot: true, ...scan }, true), /connected call/);
});
test('Retention deal linked only to a contact blocks even when company account type is blank', async () => {
  const scan = await scanSalesNavCompany('company', reader({ retention: true }));
  assert.equal(scan.retentionDealCount, 1);
  assert.match(salesNavGate({}, { inHubSpot: true, ...scan }, true), /Retention/);
});
test('no-answer is eligible; incomplete reads and upstream failures are never clean', async () => {
  const scan = await scanSalesNavCompany('company', reader());
  assert.equal(salesNavGate({}, { inHubSpot: true, ...scan }, true), '');
  await assert.rejects(scanSalesNavCompany('company', reader({ partial: true })), /Incomplete/);
  await assert.rejects(scanSalesNavCompany('company', reader({ failure: true })), /unavailable/);
  assert.match(salesNavGate({}, { inHubSpot: true, engagementChecked: false }, true), /incomplete/);
});
test('existing person, missing identity, meetings and open deals block', () => {
  assert.match(salesNavGate({ inHubSpot: true }, {}, true), /Existing HubSpot person/);
  assert.match(salesNavGate({}, { identityAmbiguous: true }, true), /Multiple HubSpot companies/);
  assert.match(salesNavGate({}, {}, false), /identity missing/);
  assert.match(salesNavGate({}, { meetingCount: 1 }, true), /meeting/);
  assert.match(salesNavGate({}, { openDealCount: 1 }, true), /Open deal/);
});
test('automatic split needs affirmative ATS evidence; unknown never defaults to Marita', () => {
  assert.equal(salesNavSdrOwner('Workday', 'Detected'), '37624223');
  assert.equal(salesNavSdrOwner('', 'No ATS'), '31644369');
  assert.equal(salesNavSdrOwner('', ''), '');
  assert.equal(salesNavSdrOwner('Workday', 'Unknown'), '');
});

test('phone eligibility rejects placeholders and stores an available secondary phone as primary', () => {
  assert.equal(usableSalesNavPhone('N/A'), '');
  assert.equal(usableSalesNavPhone('12345'), '');
  assert.equal(usableSalesNavPhone('+966 50 123 4567'), '+966 50 123 4567');
});
