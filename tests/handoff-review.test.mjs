import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDOFF_START_DATE, reviewHandoff, accountReviewRows, matchesReview } from '../src/lib/handoff-review.ts';
const now = Date.parse('2026-10-05T09:00:00Z');
const event = overrides => ({ id: 'call-1', type: 'Call', at: '2026-10-02T12:00:00Z', detail: 'Follow-up', outcome: 'No answer', connected: false, url: 'https://example.com/contact', ...overrides });
const base = { endAt: '2026-10-01T12:00:00Z', outcome: 'COMPLETED', events: [], linked: true, closed: false, nextTask: false, overdueTask: false };
test('GTM handoff reporting starts July 13', () => assert.equal(HANDOFF_START_DATE, '2026-07-13'));
test('an unanswered attempt is effort, but not a connected call', () => {
  const review = reviewHandoff({ ...base, events: [event({})] }, now);
  assert.equal(review.callAttempts, 1);
  assert.equal(review.noFollowUp, false);
  assert.equal(review.noCallAttempts, false);
  assert.equal(review.noConnectedCall, true);
  assert.equal(review.noNextTask, true);
});
test('email follow-up does not manufacture a call attempt or connection', () => {
  const review = reviewHandoff({ ...base, events: [event({ type: 'Email' })], nextTask: true }, now);
  assert.equal(review.noFollowUp, false);
  assert.equal(review.noCallAttempts, true);
  assert.equal(review.noConnectedCall, true);
  assert.equal(review.noNextTask, false);
});
test('only post-meeting performed evidence counts', () => {
  const review = reviewHandoff({ ...base, events: [
    event({ id: 'before', at: '2026-09-30T12:00:00Z', connected: true }),
    event({ id: 'future', at: '2026-10-10T12:00:00Z', connected: true }),
    event({ id: 'scheduled', type: 'Meeting', outcome: 'SCHEDULED' }),
    event({ id: 'no-show', type: 'Meeting', outcome: 'NO_SHOW' }),
    event({ id: 'actual', connected: true }),
  ] }, now);
  assert.equal(review.events.length, 1);
  assert.equal(review.connectedCalls, 1);
  assert.equal(review.noConnectedCall, false);
});
test('future, canceled, rescheduled, incomplete, closed and unlinked records do not trigger follow-up gaps', () => {
  const variants = [
    { endAt: '2026-10-06T12:00:00Z' }, { outcome: 'CANCELED' }, { outcome: 'RESCHEDULED' },
    { outcome: 'SCHEDULED' }, { closed: true }, { linked: false }, { endAt: '2026-10-05T08:00:00Z' },
  ];
  for (const variant of variants) {
    const review = reviewHandoff({ ...base, ...variant }, now);
    assert.equal(review.eligible, false);
    assert.equal(review.noFollowUp, false);
    assert.equal(review.noCallAttempts, false);
    assert.equal(review.noNextTask, false);
  }
});
test('completed and no-show handoffs without evidence are reviewable after 24 hours', () => {
  for (const outcome of ['COMPLETED', 'NO_SHOW']) {
    const review = reviewHandoff({ ...base, outcome, overdueTask: true }, now);
    assert.equal(review.eligible, true);
    assert.equal(review.noFollowUp, true);
    assert.equal(review.overdueTask, true);
  }
});
const row = overrides => ({ id: 'm1', meetingDate: '2026-10-01T12:00:00Z', salesRep: { id: 'ursula', name: 'Ursula' }, company: { id: 'company1', name: 'One company' }, contacts: [{ id: 'contact1' }], deal: { stage: 'Proposal Shared' }, review: reviewHandoff(base, now), ...overrides });
test('management counts an account once per RM, rather than once per SDR meeting', () => {
  const latest = row({ id: 'm2', meetingDate: '2026-10-02T12:00:00Z' });
  const otherRep = row({ id: 'm3', salesRep: { id: 'zein', name: 'Zein' } });
  const result = accountReviewRows([row({}), latest, otherRep]);
  assert.deepEqual(result.map(item => item.id).sort(), ['m2', 'm3']);
  assert.equal(result.filter(item => matchesReview(item, 'noCallAttempts')).length, 2);
});
test('future or canceled later meetings do not hide an actionable previous SDR handoff', () => {
  for (const state of ['upcoming', 'excluded']) {
    const later = row({ id: 'm2', meetingDate: '2026-10-06T12:00:00Z', review: { ...reviewHandoff(base, now), state, eligible: false } });
    assert.equal(accountReviewRows([row({}), later])[0].id, 'm1');
  }
});
