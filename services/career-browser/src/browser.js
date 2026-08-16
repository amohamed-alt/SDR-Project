'use strict';

const { chromium } = require('playwright');
const { USER_AGENT, clean, unique, rootUrl, assertPublic, fingerprint, isJobDetailUrl, isJobListingUrl, evidenceRank, careerUrlScore, detected, scoreCareer, scoreJob } = require('./common');
const { pageLooksLikeBrandCareer } = require('./external-careers');
const { candidatesFromTakafoJson } = require('./takafo');

const BROWSER_TIMEOUT_MS = Number(process.env.BROWSER_TIMEOUT_MS || 50000);
const MAX_BROWSER_CONTEXTS = Math.max(1, Math.min(6, Number(process.env.MAX_BROWSER_CONTEXTS || 2)));
let sharedBrowserPromise = null;
let activeBrowserContexts = 0;
const browserContextWaiters = [];

async function getSharedBrowser() {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium.launch({ headless: true, chromiumSandbox: true }).then(browser => {
      browser.on('disconnected', () => { sharedBrowserPromise = null; });
      return browser;
    }).catch(error => { sharedBrowserPromise = null; throw error; });
  }
  const browser = await sharedBrowserPromise;
  if (!browser.isConnected()) { sharedBrowserPromise = null; return getSharedBrowser(); }
  return browser;
}
async function acquireBrowserContextSlot() {
  if (activeBrowserContexts < MAX_BROWSER_CONTEXTS) { activeBrowserContexts += 1; return () => releaseBrowserContextSlot(); }
  await new Promise(resolve => browserContextWaiters.push(resolve));
  activeBrowserContexts += 1;
  return () => releaseBrowserContextSlot();
}
function releaseBrowserContextSlot() { activeBrowserContexts = Math.max(0, activeBrowserContexts - 1); const next = browserContextWaiters.shift(); if (next) next(); }
async function renderedLinks(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href],iframe[src],form[action]')].map(e => ({ href: e.href || e.src || e.action || '', text: String(e.innerText || e.textContent || e.getAttribute('aria-label') || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0,400) })).filter(x => /^https?:\/\//i.test(x.href)));
}
async function renderedFingerprintText(page) {
  return page.evaluate(() => {
    const title = document.title || ''; const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') || ''; const body = (document.body?.innerText || '').slice(0,80000);
    const assets = [...document.querySelectorAll('script[src],link[href],iframe[src],form[action]')].map(e => e.src || e.href || e.action || '').filter(Boolean).slice(0,500).join(' ');
    return `${location.href}\n${title}\n${generator}\n${body}\n${assets}`.slice(0,14000);
  });
}
async function clickCareerButton(page) {
  const loc = page.locator('button,[role="button"]').filter({ hasText: /career|jobs?|vacanc|opportunit|talent|recruit|hiring|apply|join us|work with us|current openings|view jobs|search jobs|وظائف|التوظيف|انضم إلينا|انضم الينا|فرص عمل|فرص وظيفية|اعمل معنا/i }).first();
  if (!await loc.count()) return null;
  const before = page.url(); const popupWait = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
  await loc.click({ timeout: 5000 }); const popup = await popupWait;
  if (popup) { await popup.waitForLoadState('domcontentloaded', { timeout: BROWSER_TIMEOUT_MS }).catch(() => {}); return popup; }
  await page.waitForTimeout(1200); return page.url() !== before ? page : null;
}
function preferCareer(current, candidate, official) { if (!candidate) return current; if (!current) return candidate; return careerUrlScore(candidate, official) > careerUrlScore(current, official) ? candidate : current; }

async function browserDetect(request, result) {
  let current = result; current.playwright_used = true;
  const releaseSlot = await acquireBrowserContextSlot(); let context;
  try {
    const browser = await getSharedBrowser();
    context = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-US', viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
    context.setDefaultTimeout(8000); context.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
    const network = []; const hostCache = new Map(); const visited = new Set(); const apiJobCandidates = []; const responseTasks = [];
    context.on('request', r => { if (network.length < 1500) network.push(r.url()); });
    context.on('response', response => {
      const url = response.url(); if (!/\.takafo\.ai(?:\/|$)/i.test(url) || !/\/v1\/jobs\/external/i.test(url)) return;
      const task = (async () => {
        const headers = response.headers(); if (!/json/i.test(headers['content-type'] || '')) return;
        const body = await response.text(); if (!body || body.length > 3000000) return;
        const candidates = candidatesFromTakafoJson(JSON.parse(body), url);
        if (candidates.length) { apiJobCandidates.push(...candidates); current.candidate_urls.push(...candidates); current.trace.push({ stage: 'playwright_api_extract', response_url: url, candidates_found: candidates.length }); }
      })().catch(e => current.trace.push({ stage: 'playwright_api_extract', url, error: clean(e.message,250) }));
      responseTasks.push(task);
    });
    const flushResponses = async () => { while (responseTasks.length) await Promise.allSettled(responseTasks.splice(0)); };
    await context.route('**/*', async route => {
      const req = route.request(); if (['image','media','font'].includes(req.resourceType())) return route.abort();
      if (/^(data|blob|about):/i.test(req.url())) return route.continue();
      try { const h = new URL(req.url()).hostname.toLowerCase(); if (!hostCache.has(h)) { await assertPublic(req.url()); hostCache.set(h,true); } return route.continue(); }
      catch { return route.abort('blockedbyclient'); }
    });
    const visit = async (page, url, stage) => {
      await assertPublic(url); const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS }); await page.waitForTimeout(1800);
      current.pages_checked += 1; current.browser_pages_checked += 1; current.trace.push({ stage, requested_url: url, final_url: page.url(), status: r?.status() || null });
      return { final_url: page.url(), status: r?.status() || 0 };
    };
    const recordMatch = (match, evidence, method, reason, careerCandidate = '', quality = '') => {
      if (!match) return false;
      const rank = evidenceRank(evidence); const previousRank = evidenceRank(current.ats_evidence_url);
      const career = preferCareer(current.career_url, careerCandidate || (isJobListingUrl(evidence) ? evidence : ''), request.official_website);
      if (rank >= previousRank) current = detected(current, match, evidence, method, reason, career, isJobDetailUrl(evidence) ? evidence : current.job_url, quality); else if (career) current.career_url = career;
      return isJobDetailUrl(evidence) || (!request.require_job_detail && current.ats_status === 'detected');
    };
    const record = (url, method, reason, careerCandidate = '') => recordMatch(fingerprint(url), url, method, reason, careerCandidate);
    const inspectPage = async (page, stage, careerCandidate = '') => {
      const final = page.url(); if (record(final, `${stage}_redirect`, `Browser navigation reached ${new URL(final).hostname}.`, careerCandidate)) return { done: true, links: [] };
      const markerText = await renderedFingerprintText(page).catch(() => '');
      if (pageLooksLikeBrandCareer(markerText, final, request)) {
        current.career_url = preferCareer(current.career_url, final, request.official_website); current.ats_evidence_reason ||= `Rendered employer-branded career destination verified at ${final}.`;
        if (request.stop_on_career) { current.detection_method = fingerprint(markerText) ? `${stage}_career_ats_verified` : `${stage}_career_verified`; return { done: true, links: [] }; }
      }
      const markerMatch = fingerprint(markerText);
      if (markerMatch) { const done = recordMatch(markerMatch, final, `${stage}_page_content`, `The rendered career page contains explicit ${markerMatch.detected_ats} platform markers.`, careerCandidate || current.career_url || final, 'vendor_page'); if (done) return { done: true, links: [] }; }
      const links = await renderedLinks(page); current.candidate_urls.push(...links.map(x => x.href));
      const ordered = links.map(x => ({ ...x, score: scoreJob(x) })).sort((a,b) => b.score - a.score);
      for (const link of ordered) if (record(link.href, `${stage}_link`, `The rendered page ${final} contains a public ATS link.`, careerCandidate || current.career_url || final)) return { done: true, links: ordered };
      return { done: false, links: ordered };
    };
    const visitCandidates = async (urls, stage, careerCandidate = '') => {
      for (const url of unique(urls).filter(Boolean).slice(0,Math.max(request.max_browser_steps,15))) {
        if (visited.has(url)) continue; visited.add(url); let page;
        try {
          page = await context.newPage(); const nav = await visit(page,url,stage); if (nav.status >= 400) continue;
          const inspected = await inspectPage(page,stage,careerCandidate || (isJobListingUrl(url) ? url : '')); if (inspected.done) return true;
          const next = inspected.links.filter(x => x.score >= 60 && x.href !== page.url()).slice(0,8);
          for (const link of next) {
            if (visited.has(link.href)) continue; visited.add(link.href); let child;
            try { child = await context.newPage(); const childNav = await visit(child,link.href,`${stage}_child`); if (childNav.status >= 400) continue; const nested = await inspectPage(child,`${stage}_child`,careerCandidate || current.career_url || page.url()); if (nested.done) return true; }
            catch (e) { current.trace.push({ stage: `${stage}_child`, url: link.href, error: clean(e.message,250) }); }
            finally { await child?.close().catch(() => {}); }
          }
        } catch (e) { current.trace.push({ stage, url, error: clean(e.message,250) }); }
        finally { await page?.close().catch(() => {}); }
      }
      return false;
    };
    const tryApiCandidates = async () => { if (request.stop_on_career) return false; await flushResponses(); const candidates = unique(apiJobCandidates).filter(isJobDetailUrl); if (!candidates.length) return false; return visitCandidates(candidates,'browser_api_job_detail',current.career_url); };
    const seededAtsUrls = unique([current.ats_evidence_url,...(current.candidate_urls || [])]).filter(url => fingerprint(url)).sort((a,b) => evidenceRank(b)-evidenceRank(a));
    if (await visitCandidates(seededAtsUrls,'browser_seeded_ats',current.career_url)) return current;
    if (await tryApiCandidates()) return current;
    if (current.career_url) { if (request.stop_on_career) return current; if (await visitCandidates([current.career_url],'browser_known_career',current.career_url)) return current; if (await tryApiCandidates()) return current; }
    let homePage;
    try {
      homePage = await context.newPage(); const homeNav = await visit(homePage,rootUrl(request.official_website),'browser_home');
      if (homeNav.status < 400) {
        const homeInspection = await inspectPage(homePage,'browser_home',current.career_url); if (homeInspection.done) return current;
        const careers = homeInspection.links.map(x => ({ ...x, score: scoreCareer(x,request.official_website) })).filter(x => x.score >= 70).sort((a,b) => b.score-a.score).slice(0,10);
        if (await visitCandidates(careers.map(x => x.href),'browser_career',current.career_url)) return current;
        if (await tryApiCandidates()) return current;
        const clicked = await clickCareerButton(homePage).catch(() => null);
        if (clicked) {
          const final = clicked.url(); current.career_url = preferCareer(current.career_url,final,request.official_website);
          const inspected = await inspectPage(clicked,'browser_home_button',final); if (inspected.done) return current;
          if (request.stop_on_career && current.career_url) return current;
          if (await visitCandidates(inspected.links.filter(x => x.score >= 40).map(x => x.href),'browser_home_button_child',final)) return current;
          if (await tryApiCandidates()) return current;
        }
      }
    } catch (e) { current.trace.push({ stage: 'browser_home', url: rootUrl(request.official_website), error: clean(e.message,250) }); }
    finally { await homePage?.close().catch(() => {}); }
    if (current.career_url) { if (request.stop_on_career) return current; if (await visitCandidates([current.career_url],'browser_known_career_after_home',current.career_url)) return current; if (await tryApiCandidates()) return current; }
    await flushResponses();
    for (const url of unique(network).sort((a,b) => evidenceRank(b)-evidenceRank(a))) if (record(url,'playwright_network_fingerprint','The rendered careers journey loaded a request from an ATS host.',current.career_url)) return current;
    if (current.ats_status === 'detected' && !current.job_url) { current.detection_method = 'playwright_ats_verified_no_job_detail'; current.detection_error = 'ATS vendor verified, but no active public job detail URL was found.'; }
    else if (current.career_url) { current.ats_status = 'unclear'; current.detection_method = 'playwright_career_found_vendor_unclear'; }
    return current;
  } finally { await context?.close().catch(() => {}); releaseSlot(); }
}

module.exports = { browserDetect, getSharedBrowser };
