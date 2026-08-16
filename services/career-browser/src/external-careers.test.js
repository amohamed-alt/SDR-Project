'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pageLooksLikeBrandCareer, sameDomainCareerLocation } = require('./external-careers');

const request = {
  company_name: 'Example Holdings',
  company_domain: 'example.com',
  official_website: 'https://example.com/',
};

test('does not treat a normal homepage career mention as the career page', () => {
  const html = '<html><body><h1>Example Holdings</h1><footer><a href="/careers">Careers</a></footer></body></html>';
  assert.equal(pageLooksLikeBrandCareer(html, 'https://example.com/', request), false);
});

test('rejects a blank same-domain careers page even when the URL looks correct', () => {
  const html = '<html><head><title>Careers</title></head><body><div id="root"></div></body></html>';
  assert.equal(sameDomainCareerLocation('https://example.com/careers', request), true);
  assert.equal(pageLooksLikeBrandCareer(html, 'https://example.com/careers', request), false);
});

test('rejects rendered evidence that contains only the careers URL', () => {
  const rendered = 'https://example.com/careers\n\n\n\nhttps://cdn.example.com/app.js';
  assert.equal(pageLooksLikeBrandCareer(rendered, 'https://example.com/careers', request), false);
});

test('accepts an employer-branded same-domain careers path', () => {
  const html = '<html><body><h1>Careers at Example Holdings</h1><p>View jobs and join our team.</p></body></html>';
  assert.equal(sameDomainCareerLocation('https://example.com/careers', request), true);
  assert.equal(pageLooksLikeBrandCareer(html, 'https://example.com/careers', request), true);
});

test('accepts a dedicated same-domain jobs subdomain', () => {
  const html = '<html><body><h1>Example jobs</h1><p>Current openings</p></body></html>';
  assert.equal(sameDomainCareerLocation('https://jobs.example.com/', request), true);
  assert.equal(pageLooksLikeBrandCareer(html, 'https://jobs.example.com/', request), true);
});

test('supports Arabic career paths and signals', () => {
  const html = '<html lang="ar"><body><h1>وظائف Example Holdings</h1><p>انضم إلينا واطلع على فرص العمل</p></body></html>';
  assert.equal(sameDomainCareerLocation('https://example.com/وظائف', request), true);
  assert.equal(pageLooksLikeBrandCareer(html, 'https://example.com/وظائف', request), true);
});

test('accepts a branded external career portal with explicit career proof', () => {
  const html = '<html><body><h1>Example Holdings Careers</h1><p>Search jobs and apply.</p></body></html>';
  assert.equal(pageLooksLikeBrandCareer(html, 'https://example-careers.com/jobs', request), true);
});
