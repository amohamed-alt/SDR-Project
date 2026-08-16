'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deterministicEvidenceScore, shouldUseAiJudge, combineJudgments, evidencePayload } = require('./judge');

const request = {
  company_name: 'Example Holdings',
  company_domain: 'example.com',
  official_website: 'https://example.com/',
};

function strongResult(overrides = {}) {
  return {
    career_url: 'https://example.com/careers',
    detected_ats: 'Workday',
    ats_status: 'detected',
    ats_confidence: 'high',
    ats_evidence_url: 'https://example.wd3.myworkdayjobs.com/jobs',
    ats_evidence_reason: 'Verified career destination with public job listings.',
    detection_method: 'static_career_ats_verified',
    pages_checked: 5,
    static_pages_checked: 4,
    browser_pages_checked: 1,
    playwright_used: true,
    job_detail_found: true,
    job_url: 'https://example.wd3.myworkdayjobs.com/en-US/jobs/job/Test/Role_R1',
    candidate_urls: [],
    trace: [],
    detection_error: '',
    ...overrides,
  };
}

test('scores strong same-employer career evidence highly', () => {
  assert.ok(deterministicEvidenceScore(request, strongResult()) >= 90);
});

test('sends external or weak career candidates to AI review', () => {
  const external = strongResult({
    career_url: 'https://example-careers.com/jobs',
    ats_status: 'unclear',
    detected_ats: '',
    job_detail_found: false,
    job_url: '',
  });
  assert.equal(shouldUseAiJudge(request, external), true);
});

test('requires both verifier and adversarial critic to verify', () => {
  const yes = { decision: 'verified', confidence: 94, same_company: true, is_recruiting_page: true };
  const critic = { decision: 'verified', confidence: 88, same_company: true, is_recruiting_page: true };
  assert.equal(combineJudgments(yes, critic), 'verified');
  assert.equal(combineJudgments(yes, { ...critic, same_company: false }), 'manual_review');
  assert.equal(combineJudgments(yes, { ...critic, decision: 'reject' }), 'manual_review');
});

test('judge evidence never asks the model to discover a replacement URL', () => {
  const payload = evidencePayload(request, strongResult());
  assert.equal(payload.candidate_career_url, 'https://example.com/careers');
  assert.equal(payload.company_domain, 'example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'search_query'), false);
});
