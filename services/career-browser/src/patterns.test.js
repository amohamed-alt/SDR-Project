'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ATS } = require('./patterns');

function detect(value) {
  for (const [name, , , score, tests] of ATS) {
    if (tests.some((pattern) => pattern.test(String(value)))) return { name, score };
  }
  return null;
}

test('detects KABi from HYRDD infrastructure', () => {
  assert.equal(detect('https://takamol.hyrddsa.com/jobs')?.name, 'KABi');
});

test('detects KABi from white-label candidate routes and branding', () => {
  assert.equal(detect('https://career.aecl.com/en/auth/jobseeker/signup Copyright © 2026 KABi. All rights reserved.')?.name, 'KABi');
});

test('detects Talentera from explicit white-label footer evidence', () => {
  assert.equal(detect('Recruitment portal powered by Talentera, a Bayt.com product')?.name, 'Talentera');
});

test('detects additional GCC recruitment platforms', () => {
  assert.equal(detect('https://myhrmax.myadrenalin.com/candidate/LoginPage.aspx')?.name, 'Adrenalin');
  assert.equal(detect('https://hunt.kayanhr.com/CareerSite/Index/abc')?.name, 'KayanHR');
  assert.equal(detect('https://attract.solvait.com/careers-portal/hadya-co')?.name, 'Solvait Attract');
  assert.equal(detect('https://walaa.jobsoid.com/')?.name, 'Jobsoid');
});

test('detects modern Workable and SAP custom hosted URL shapes', () => {
  assert.equal(detect('https://jobs.workable.com/company/abc/jobs-at-example')?.name, 'Workable');
  assert.equal(detect('https://career23.sapsf.com/career?company=example')?.name, 'SAP SuccessFactors');
});
