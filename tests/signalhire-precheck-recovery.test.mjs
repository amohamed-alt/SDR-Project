import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const next = require('next/server');
const source = ts.transpileModule(fs.readFileSync('src/app/api/prospecting/signalhire/precheck/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const input = { name: 'Test Person', company: 'Example', linkedinUrl: 'https://www.linkedin.com/in/test-person' };

function fixture({ available = ['gtm_linkedin_url'], metadataFails = false, matchedProperty = '', failFirstEngagement = false } = {}) {
  const calls = { search: [], associations: [], metadata: 0 };
  class HubSpotApiError extends Error {
    constructor(status) { super(`HubSpot HTTP ${status}`); this.status = status; }
  }
  let failed = false;
  const hubspot = {
    HubSpotApiError,
    availablePropertyNames: async () => {
      calls.metadata += 1;
      if (metadataFails) throw new Error('Property metadata temporarily unavailable');
      return new Set(available);
    },
    searchAll: async (object, properties, filters) => {
      calls.search.push({ object, filters });
      if (object === 'companies') return failFirstEngagement ? [{ id: 'company-1', properties: { name: input.company } }] : [];
      const filter = filters[0];
      if (filter.propertyName.includes('linkedin')) {
        if (!available.includes(filter.propertyName)) throw new HubSpotApiError(400);
        if (filter.propertyName === matchedProperty && filter.value.endsWith('/')) return [{ id: 'contact-1', properties: { firstname: 'Test', lastname: 'Person' } }];
      }
      return [];
    },
    readAssociations: async (from, to, ids) => {
      calls.associations.push({ from, to, ids });
      if (failFirstEngagement && !failed && to === 'calls') { failed = true; throw new HubSpotApiError(500); }
      return new Map(ids.map(id => [id, []]));
    },
    batchRead: async () => [],
  };
  const exports = {};
  const modules = {
    'next/server': next,
    zod: require('zod'),
    '@/lib/hubspot': hubspot,
    '@/lib/prospecting-company-intelligence': { normalizeCompanyDomain: () => '' },
  };
  vm.runInNewContext(source, { exports, require: id => modules[id], URL, Date, Set, Map, Promise, console: { error() {}, warn() {} } });
  return {
    calls,
    post: async (overrides = {}) => {
      const response = await exports.POST(new next.NextRequest('https://example.test/api/prospecting/signalhire/precheck', { method: 'POST', body: JSON.stringify({...input, ...overrides}) }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('a transient company engagement failure is rechecked on the next free check', async () => {
  const f = fixture({ failFirstEngagement: true });
  const first = await f.post();
  assert.equal(first.status, 200);
  assert.equal(first.body.company.engagementChecked, false);
  assert.equal(first.body.company.protected, true);
  const callsAfterFailure = f.calls.associations.length;
  const retry = await f.post();
  assert.equal(retry.body.company.engagementChecked, true);
  assert.equal(retry.body.company.protected, false);
  assert.ok(f.calls.associations.length > callsAfterFailure);
  const callsAfterSuccess = f.calls.associations.length;
  await f.post();
  assert.equal(f.calls.associations.length, callsAfterSuccess, 'successful checks retain the existing engagement cache');
  await f.post({freshCompanyEngagement: true});
  assert.ok(f.calls.associations.length > callsAfterSuccess, 'final paid/write checks bypass successful cached engagement');
});

test('metadata avoids failed searches for absent mappings and preserves every supported LinkedIn mapping', async () => {
  for (const property of ['gtm_linkedin_url', 'linkedin_url', 'hs_linkedin_url']) {
    const f = fixture({ available: [property], matchedProperty: property });
    const result = await f.post();
    assert.equal(result.status, 200);
    assert.equal(result.body.contact.id, 'contact-1');
    assert.equal(result.body.contact.matchedBy, `linkedin:${property}`);
    const lookups = f.calls.search.filter(call => call.object === 'contacts' && call.filters[0].propertyName.includes('linkedin'));
    assert.equal(lookups.length, 2);
    assert.ok(lookups.every(call => call.filters[0].propertyName === property));
  }
});

test('a net-new person does not repeat invalid searches for absent optional LinkedIn fields', async () => {
  const f = fixture({ available: ['gtm_linkedin_url'] });
  const result = await f.post();
  assert.equal(result.body.contact.inHubSpot, false);
  const lookups = f.calls.search.filter(call => call.object === 'contacts' && call.filters[0].propertyName.includes('linkedin'));
  assert.equal(lookups.length, 2);
  assert.ok(lookups.every(call => call.filters[0].propertyName === 'gtm_linkedin_url'));
});

test('property metadata outage falls back to the existing LinkedIn searches', async () => {
  const f = fixture({ metadataFails: true, available: ['hs_linkedin_url'], matchedProperty: 'hs_linkedin_url' });
  const result = await f.post();
  assert.equal(result.status, 200);
  assert.equal(result.body.contact.id, 'contact-1');
  assert.equal(result.body.contact.matchedBy, 'linkedin:hs_linkedin_url');
});
