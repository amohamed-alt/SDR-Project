import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

test('classic fallback only selects a unique exact name and current company before paid reveal', () => {
  const source = fs.readFileSync('src/app/api/prospecting/resolve-companion/route.ts', 'utf8');
  const normalize = source.slice(source.indexOf('function normalize(value:'), source.indexOf('function normalizeLinkedIn('));
  const match = source.slice(source.indexOf('function bestSearchMatch('), source.indexOf('function contacts('));
  const context = {};
  vm.runInNewContext(stripTypeScriptTypes(normalize + match), context);
  const correct = { uid: 'correct', fullName: 'Test Person', experience: [{ company: 'Example Ltd' }] };
  const wrongCompany = { ...correct, uid: 'wrong-company', experience: [{ company: 'Other Co' }] };
  const wrongName = { ...correct, uid: 'wrong-name', fullName: 'Other Person' };
  assert.equal(context.bestSearchMatch([wrongName, wrongCompany, correct], 'Test Person', 'Example Ltd').uid, 'correct');
  for (const profiles of [[wrongCompany], [wrongName], [correct, { ...correct, uid: 'ambiguous' }], []]) {
    assert.equal(context.bestSearchMatch(profiles, 'Test Person', 'Example Ltd'), undefined);
  }
  assert.equal(context.bestSearchMatch([correct], 'Test Person', ''), undefined);
});

test('normal popup capture hands cards directly to Check without starting profile URL reading', () => {
  const popup = fs.readFileSync('chrome-companion/popup-dashboard.js', 'utf8');
  assert.match(popup, /readProfilesOnComplete: false/);
  assert.doesNotMatch(popup, /readProfilesOnComplete: true/);
});
