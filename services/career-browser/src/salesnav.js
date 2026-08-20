'use strict';

const { getSharedBrowser } = require('./browser');

const SALESNAV_TIMEOUT_MS = Math.max(15000, Math.min(120000, Number(process.env.SALESNAV_TIMEOUT_MS || 60000)));
const SALESNAV_MAX_RESULTS = Math.max(1, Math.min(100, Number(process.env.SALESNAV_MAX_RESULTS || 50)));

function normalizeSalesNavSearchUrl(raw) {
  const url = new URL(String(raw || '').trim());
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) throw new Error('Enter a LinkedIn Sales Navigator search URL.');
  if (!/^\/sales\/search\/people\/?$/i.test(url.pathname)) throw new Error('Only Sales Navigator people-search URLs are supported.');
  url.protocol = 'https:';
  url.hostname = 'www.linkedin.com';
  url.hash = '';
  return url.toString();
}

function normalizePublicLinkedIn(raw) {
  try {
    const url = new URL(raw, 'https://www.linkedin.com');
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return '';
    if (!/^\/in\//i.test(url.pathname)) return '';
    url.protocol = 'https:';
    url.hostname = 'www.linkedin.com';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function effectiveSessionToken(provided) {
  return String(provided || process.env.LINKEDIN_LI_AT || '').trim();
}

function sessionConfigured(provided) {
  return Boolean(effectiveSessionToken(provided));
}

async function addLinkedInSession(context, providedLiAt, providedJsession) {
  const liAt = effectiveSessionToken(providedLiAt);
  if (!liAt) return false;
  const cookies = [{
    name: 'li_at', value: liAt, domain: '.linkedin.com', path: '/', httpOnly: true, secure: true, sameSite: 'None',
  }];
  const jsession = String(providedJsession || process.env.LINKEDIN_JSESSIONID || '').trim();
  if (jsession) cookies.push({
    name: 'JSESSIONID', value: jsession, domain: '.linkedin.com', path: '/', httpOnly: false, secure: true, sameSite: 'None',
  });
  await context.addCookies(cookies);
  return true;
}

async function blockedOrLoggedOut(page) {
  const url = page.url();
  if (/\/login|\/checkpoint|\/authwall/i.test(url)) return true;
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  return /sign in to linkedin|join linkedin|security verification|verify your identity|let(?:'|’)s do a quick security check|upgrade to sales navigator|start your sales navigator/i.test(body);
}

async function waitForSearchSurface(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => {
    const hasLeadLink = Boolean(document.querySelector('a[href*="/sales/lead/"],a[href*="/in/"]'));
    const hasResultSurface = Boolean(document.querySelector('[data-x-search-result],[class*="search-results"],[role="listitem"]'));
    const text = String(document.body?.innerText || '');
    const terminalText = /no results|0 results|sign in to linkedin|security verification|verify your identity|sales navigator/i.test(text);
    return hasLeadLink || hasResultSurface || terminalText;
  }, { timeout: 15000 }).catch(() => {});
}

async function settleVirtualizedResults(page) {
  for (let step = 0; step < 5; step += 1) {
    await page.evaluate((index) => {
      const scrollers = [...document.querySelectorAll('main,[role="main"],[class*="search-results"],[class*="result-list"],div')]
        .filter((node) => node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 300)
        .sort((a, b) => b.scrollHeight - a.scrollHeight);
      const target = scrollers[0] || document.scrollingElement || document.documentElement;
      const top = Math.min(target.scrollHeight, Math.max(0, (index + 1) * 700));
      if ('scrollTo' in target) target.scrollTo({ top, behavior: 'instant' });
      else window.scrollTo(0, top);
    }, step).catch(() => {});
    await page.waitForTimeout(450);
  }
}

async function extractionDiagnostics(page) {
  return page.evaluate(() => ({
    title: String(document.title || '').slice(0, 180),
    leadAnchors: document.querySelectorAll('a[href*="/sales/lead/"],a[href*="/in/"]').length,
    listItems: document.querySelectorAll('[role="listitem"],li').length,
    resultNodes: document.querySelectorAll('[data-x-search-result],[class*="search-results"],[class*="result-list"]').length,
    hasNoResultsText: /no results|0 results/i.test(String(document.body?.innerText || '')),
  })).catch(() => ({ title: '', leadAnchors: 0, listItems: 0, resultNodes: 0, hasNoResultsText: false }));
}

async function extractCards(page) {
  return page.evaluate(() => {
    const normalize = (href) => {
      try { return new URL(href, location.origin).toString(); } catch { return ''; }
    };
    const anchorSelector = [
      'a[href*="/sales/lead/"]',
      'a[href*="/in/"]',
      'a[data-control-name*="lead"]',
      'a[data-control-name*="profile"]',
    ].join(',');
    const anchors = [...document.querySelectorAll(anchorSelector)];
    const seen = new Set();
    const rows = [];
    for (const anchor of anchors) {
      const href = normalize(anchor.getAttribute('href') || '');
      if (!href || (!/\/sales\/lead\//i.test(href) && !/\/in\//i.test(href))) continue;
      const leadKey = href.match(/\/sales\/lead\/([^/?#]+)/i)?.[1] || href.match(/\/in\/([^/?#]+)/i)?.[1] || href;
      if (seen.has(leadKey)) continue;
      const card = anchor.closest('[data-x-search-result]')
        || anchor.closest('[role="listitem"]')
        || anchor.closest('li')
        || anchor.closest('[class*="search-results__result-item"]')
        || anchor.closest('[class*="result-list"]')
        || anchor.parentElement?.parentElement
        || anchor.parentElement;
      const rawText = String(card?.innerText || anchor.innerText || '').replace(/\n{3,}/g, '\n').trim();
      if (!rawText || rawText.length > 7000) continue;
      const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
      const anchorLabel = String(anchor.getAttribute('aria-label') || '').replace(/^view\s+/i, '').trim();
      const name = String(anchor.innerText || anchorLabel || lines[0] || '').trim();
      if (!name || name.length > 180 || /^(view|message|save|connect|more)$/i.test(name)) continue;
      const cardAnchors = [...(card?.querySelectorAll?.('a') || [])];
      const publicAnchor = cardAnchors.find((node) => /\/in\//i.test(String(node.getAttribute('href') || '')));
      const publicUrl = publicAnchor ? normalize(publicAnchor.getAttribute('href') || '') : (/\/in\//i.test(href) ? href : '');
      const salesAnchor = cardAnchors.find((node) => /\/sales\/lead\//i.test(String(node.getAttribute('href') || '')));
      const salesLeadUrl = salesAnchor ? normalize(salesAnchor.getAttribute('href') || '') : (/\/sales\/lead\//i.test(href) ? href : '');
      const connectionDegree = rawText.match(/\b(1st|2nd|3rd)\b/i)?.[1] || '';
      const locationLine = lines.find((line) => /Saudi|Riyadh|Jeddah|Dammam|Khobar|United Arab Emirates|Dubai|Abu Dhabi|Sharjah|Qatar|Doha|Bahrain|Oman|Muscat|Kuwait|Jordan|Egypt|Cairo/i.test(line)) || '';
      const secondary = lines.filter((line) => line !== name && !/^(1st|2nd|3rd)$/i.test(line) && !/^(save|message|connect|view profile|more)$/i.test(line) && line.length < 220);
      rows.push({
        name,
        publicUrl,
        salesLeadUrl,
        connectionDegree,
        title: secondary[0] || '',
        company: secondary[1] || '',
        location: locationLine,
        rawText: rawText.slice(0, 1800),
      });
      seen.add(leadKey);
    }
    return rows;
  });
}

async function collectCurrentPage(page, collected, limit) {
  await waitForSearchSurface(page);
  for (let pass = 0; pass < 6 && collected.size < limit; pass += 1) {
    const cards = await extractCards(page);
    for (const card of cards) {
      const key = card.salesLeadUrl || card.publicUrl || `${card.name}:${card.company}`;
      if (!key || collected.has(key)) continue;
      collected.set(key, card);
      if (collected.size >= limit) break;
    }
    if (collected.size >= limit) break;
    if (pass < 5) {
      await page.evaluate((offset) => {
        const scrollers = [...document.querySelectorAll('main,[role="main"],[class*="search-results"],[class*="result-list"],div')]
          .filter((node) => node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 300)
          .sort((a, b) => b.scrollHeight - a.scrollHeight);
        const target = scrollers[0] || document.scrollingElement || document.documentElement;
        const top = Math.min(target.scrollHeight, Math.max(0, offset * 750));
        if ('scrollTo' in target) target.scrollTo({ top, behavior: 'instant' });
        else window.scrollTo(0, top);
      }, pass + 1).catch(() => {});
      await page.waitForTimeout(550);
    }
  }
}

async function resolvePublicProfile(context, salesLeadUrl) {
  if (!salesLeadUrl) return '';
  const page = await context.newPage();
  try {
    await page.goto(salesLeadUrl, { waitUntil: 'domcontentloaded', timeout: SALESNAV_TIMEOUT_MS });
    if (await blockedOrLoggedOut(page)) return '';
    await page.waitForTimeout(900);
    const href = await page.locator('a[href*="linkedin.com/in/"],a[href^="/in/"]').first().getAttribute('href').catch(() => '');
    return normalizePublicLinkedIn(href || '');
  } finally {
    await page.close().catch(() => {});
  }
}

async function clickNext(page) {
  const next = page.locator('button[aria-label*="Next" i],button').filter({ hasText: /^Next$/i }).first();
  if (!await next.count()) return false;
  if (await next.isDisabled().catch(() => false)) return false;
  const before = page.url();
  await next.click({ timeout: 7000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {});
  await waitForSearchSurface(page);
  await page.waitForTimeout(700);
  return page.url() !== before || await next.count() > 0;
}

async function extractSalesNavSearch(rawUrl, requestedLimit = SALESNAV_MAX_RESULTS, sessionToken = '', jsessionToken = '') {
  const searchUrl = normalizeSalesNavSearchUrl(rawUrl);
  const limit = Math.max(1, Math.min(SALESNAV_MAX_RESULTS, Number(requestedLimit || SALESNAV_MAX_RESULTS)));
  if (!sessionConfigured(sessionToken)) {
    return { ok: false, status: 'session_required', error: 'LinkedIn session is not connected on the VPS.', configured: false, leads: [] };
  }

  const browser = await getSharedBrowser();
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(SALESNAV_TIMEOUT_MS);
  await addLinkedInSession(context, sessionToken, jsessionToken);
  const page = await context.newPage();

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SALESNAV_TIMEOUT_MS });
    await waitForSearchSurface(page);
    if (await blockedOrLoggedOut(page)) {
      return { ok: false, status: 'session_expired', error: 'LinkedIn session needs to be reconnected.', configured: true, leads: [] };
    }

    await settleVirtualizedResults(page);
    const collected = new Map();
    let pagesRead = 0;
    while (collected.size < limit && pagesRead < 2) {
      pagesRead += 1;
      await collectCurrentPage(page, collected, limit);
      if (collected.size >= limit || pagesRead >= 2) break;
      if (!await clickNext(page)) break;
    }

    if (collected.size === 0) {
      const diagnostics = await extractionDiagnostics(page);
      return {
        ok: false,
        status: diagnostics.hasNoResultsText ? 'no_results' : 'results_not_detected',
        error: diagnostics.hasNoResultsText
          ? 'Sales Navigator returned no people for this search.'
          : 'Sales Navigator opened successfully, but no lead cards were detected. Retry once; if it still returns 0, refresh the Sales Nav search in LinkedIn and save the session again.',
        configured: true,
        pagesRead,
        diagnostics,
        leads: [],
      };
    }

    const leads = [...collected.values()].slice(0, limit);
    let unresolved = 0;
    for (const lead of leads) {
      lead.linkedinUrl = normalizePublicLinkedIn(lead.publicUrl || '');
      if (!lead.linkedinUrl && lead.salesLeadUrl) lead.linkedinUrl = await resolvePublicProfile(context, lead.salesLeadUrl);
      if (!lead.linkedinUrl) unresolved += 1;
      delete lead.publicUrl;
    }

    return {
      ok: true,
      status: 'completed',
      configured: true,
      searchUrl,
      pagesRead,
      extracted: leads.length,
      resolvable: leads.length - unresolved,
      unresolved,
      limit,
      leads,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

module.exports = { extractSalesNavSearch, normalizeSalesNavSearchUrl, sessionConfigured };
