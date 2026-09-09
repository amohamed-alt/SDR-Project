import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const manifest = JSON.parse(fs.readFileSync('chrome-companion/manifest.json', 'utf8'));
const popupHtml = fs.readFileSync('chrome-companion/popup.html', 'utf8');
const popupController = fs.readFileSync('chrome-companion/popup-v154.js', 'utf8');
const background = fs.readFileSync('chrome-companion/background-v154.js', 'utf8');
const popupLiveProfile = fs.readFileSync('chrome-companion/popup-live-profile.js', 'utf8');

test('Chrome Companion v1.5.5 uses one background full-search engine', () => {
  assert.equal(manifest.version, '1.5.5');
  assert.equal(manifest.background?.service_worker, 'background-v154.js');
  assert.match(popupHtml, /popup-v154\.js/);
  assert.doesNotMatch(background, /importScripts\(['"]background\.js/);
  assert.match(popupController, /replaceWith\(button\)/);
  assert.match(popupController, /salesnav_v154_start/);
});

test('v1.5.4 refuses to skip ahead while LinkedIn still shows stale cards', () => {
  assert.match(background, /navigationPending && sameSignature && urlChanged/);
  assert.match(background, /URL changed but LinkedIn is still showing the previous cards/);
  assert.match(background, /Sales Nav cards are loading/);
  assert.doesNotMatch(background, /document\.querySelectorAll\(['"]button['"]\).*\/next/i);
});

test('v1.5.4 extension scripts are syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(background, { filename: 'background-v154.js' }));
  assert.doesNotThrow(() => new vm.Script(popupController, { filename: 'popup-v154.js' }));
  assert.doesNotThrow(() => new vm.Script(popupLiveProfile, { filename: 'popup-live-profile.js' }));
});
