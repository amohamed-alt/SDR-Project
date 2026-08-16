'use strict';

const express = require('express');
const { clean, unique, now, normalizeUrl, rootUrl, domain, assertPublic, fingerprint, isJobDetailUrl, scoreCareer, baseResult, readCache, writeCache } = require('./common');
const { staticDetect } = require('./static');
const { browserDetect } = require('./browser');

const PORT = Number(process.env.PORT || 3000);
const CACHE_TTL_DAYS = Number(process.env.CACHE_TTL_DAYS || 30);
const MAX_STATIC_PAGES = Number(process.env.MAX_STATIC_PAGES || 30);
const MAX_BROWSER_STEPS = Number(process.env.MAX_BROWSER_STEPS || 8);
const VERSION = '1.6.0';
let cacheWriteQueue = Promise.resolve();

function terminalCareerStatus(status) { return ['found_verified','no_public_career_page','website_domain_invalid','insufficient_company_data'].includes(String(status || '')); }
function ttlForCareerStatus(status) { if (status === 'website_domain_invalid' || status === 'insufficient_company_data') return 90; if (status === 'no_public_career_page') return 21; if (status === 'found_verified') return 30; return 7; }
function finalizeCareer(result) {
  const statuses = (result.trace || []).map(item => Number(item.status || 0));
  const traceErrors = (result.trace || []).map(item => String(item.error || '')).filter(Boolean);
  const blocked = statuses.some(status => [401,403,429].includes(status)) || traceErrors.some(error => /captcha|cloudflare|forbidden|blocked|timeout|aborted/i.test(error));
  if (result.career_url) { result.career_status = 'found_verified'; result.career_confidence_score = result.ats_status === 'detected' ? 98 : 92; result.career_evidence_url = result.career_url; result.career_evidence_reason = result.ats_evidence_reason || 'Verified employer career destination discovered from the official website journey.'; return result; }
  if (result.detection_method === 'input_missing_website') { result.career_status = 'insufficient_company_data'; result.career_confidence_score = 99; result.career_evidence_reason = 'No usable company website or domain was supplied.'; return result; }
  if (result.detection_method === 'website_validation_failed') { result.career_status = 'website_domain_invalid'; result.career_confidence_score = 98; result.career_evidence_reason = result.detection_error || 'The supplied website could not be resolved as a public HTTP(S) destination.'; return result; }
  if (blocked || result.pages_checked === 0) { result.career_status = 'needs_manual_review'; result.career_confidence_score = Math.max(35,Math.min(70,45 + Number(result.pages_checked || 0))); result.career_evidence_reason = blocked ? 'Automated verification was blocked or timed out before the site could be ruled out.' : 'The automated crawler could not collect enough public evidence to reach a safe conclusion.'; return result; }
  result.career_status = 'no_public_career_page'; result.career_confidence_score = result.browser_pages_checked > 0 ? 90 : Math.min(88,72 + Math.min(16,Number(result.static_pages_checked || 0))); result.career_evidence_reason = `Checked ${result.pages_checked} public page${result.pages_checked === 1 ? '' : 's'} without verifying an employer-owned career destination.`; return result;
}
function cacheEntryFresh(entry, fallbackTtlDays = CACHE_TTL_DAYS) { if (!entry?.cached_at) return false; const ttlDays = Number(entry.ttl_days || fallbackTtlDays); return Date.now() - Date.parse(entry.cached_at) <= ttlDays * 86400000; }
async function persistCacheEntry(key, result, ttlDays = CACHE_TTL_DAYS) {
  cacheWriteQueue = cacheWriteQueue.then(async () => { const cache = await readCache(); cache[key] = { cached_at: now(), ttl_days: ttlDays, result }; await writeCache(cache); }).catch(error => console.error('cache_persist_failed',error.message));
  await cacheWriteQueue;
}
async function detect(input, mode = 'career') {
  const careerOnly = mode === 'career' || input.career_only === true;
  const raw = input.company_website || input.signalhire_website || input.apollo_website || input.official_website || input.company_domain;
  const website = rootUrl(normalizeUrl(raw));
  const request = {
    company_name: clean(input.company_name,300), company_domain: clean(input.company_domain,500) || domain(website), official_website: website,
    force_refresh: Boolean(input.force_refresh), force_browser: Boolean(input.force_browser), career_only: careerOnly,
    stop_on_career: careerOnly || Boolean(input.stop_on_career), require_job_detail: careerOnly ? false : input.require_job_detail !== false,
    max_static_pages: Math.max(5,Math.min(60,Number(input.max_static_pages || MAX_STATIC_PAGES))),
    max_browser_steps: Math.max(3,Math.min(20,Number(input.max_browser_steps || MAX_BROWSER_STEPS))),
  };
  let result = baseResult(website);
  if (!website) { result.detection_method = 'input_missing_website'; result.detection_error = 'company_website or company_domain is required'; return { request, result: finalizeCareer(result) }; }
  const key = domain(website);
  try { await assertPublic(website); }
  catch (e) { result.detection_method = 'website_validation_failed'; result.detection_error = clean(e.message,500); result = finalizeCareer(result); await persistCacheEntry(key,result,ttlForCareerStatus(result.career_status)); return { request, result }; }
  const cache = await readCache(); const cached = cache[key];
  if (!request.force_refresh && cached && cacheEntryFresh(cached)) {
    const complete = terminalCareerStatus(cached.result?.career_status) || Boolean(cached.result?.career_url);
    if (complete) return { request, result: { ...cached.result, cache_hit: true, detection_method: `cache:${cached.result.detection_method}` } };
  }
  if (!request.force_browser) result = await staticDetect(request,result);
  if (request.force_browser || !result.career_url) {
    try { result = await browserDetect(request,result); }
    catch (e) { result.detection_error = clean(e.message,500); result.detection_method = result.career_url ? 'playwright_failed_after_career_found' : 'playwright_failed'; result.trace.push({ stage: 'playwright', error: result.detection_error }); }
  }
  result.job_detail_found = isJobDetailUrl(result.job_url || '');
  result.candidate_urls = unique(result.candidate_urls).filter(url => isJobDetailUrl(url) || fingerprint(url) || scoreCareer({ href: url, text: '' },website) >= 70).slice(0,120);
  result.trace = result.trace.slice(0,120);
  result = finalizeCareer(result);
  await persistCacheEntry(key,result,ttlForCareerStatus(result.career_status));
  return { request, result };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.get('/health', (_req,res) => res.json({ ok: true, service: 'gtm-career-browser', version: VERSION, capabilities: ['career-detect','negative-cache','arabic-career-signals','browser-pool'], time: now() }));
app.post('/career-detect', async (req,res) => {
  const started = Date.now();
  try { const payload = await detect(req.body || {},'career'); res.json({ ok: true, service: 'gtm-career-browser', version: VERSION, duration_ms: Date.now() - started, ...payload }); }
  catch (e) { res.status(500).json({ ok: false, service: 'gtm-career-browser', version: VERSION, duration_ms: Date.now() - started, error: clean(e.message,1000) }); }
});
app.use((_req,res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.listen(PORT,'0.0.0.0',() => console.log(`gtm-career-browser listening on :${PORT}`));

module.exports = { detect, finalizeCareer };
