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

function sessionConfigured() {
  return Boolean(String(process.env.LINKEDIN_LI_AT || '').trim());
}

async function addLinkedInSession(context) {
  const liAt = String(process.env.LINKEDIN_LI_AT || '').trim();
  if (!liAt) return false;
  const cookies = [{
    name: 'li_at',
    value: liAt,
    domain: '.linkedin.com',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'None',
  }];
  const jsession = String(process.env.LINKEDIN_JSESSIONID || '').trim();
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
  return /sign in to linkedin|join linkedin|security verification|verify your identity|let(?:'|’)s do a quick security check/i.test(body);
}

async function extractCards(page) {
  return page.evaluate(() => {
    const normalize = (href) => {
      try { return new URL(href, location.origin).toString(); } catch { return ''; }
    };
    const anchors = [...document.querySelectorAll('a[href*="/sales/lead/"],a[href*="/in/"]')];
    const seen = new Set();
    const rows = [];
    for (const anchor of anchors) {
      const href = normalize(anchor.getAttribute('href') || '');
      if (!href) continue;
      const leadKey = href.match(/\/sales\/lead\/([^/?#]+)/i)?.[1] || href.match(/\/in\/([^/?#]+)/i)?.[1] || href;
      if (seen.has(leadKey)) continue;
      const card = anchor.closest('li') || anchor.closest('[data-x-search-result]') || anchor.closest('[class*="search-results__result-item"]') || anchor.parentElement?.parentElement || anchor.parentElement;
      const rawText = String(card?.innerText || anchor.innerText || '').replace(/\n{3,}/g, '\n').trim();
      if (!rawText || rawText.length > 5000) continue;
      const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
      const name = String(anchor.innerText || lines[0] || '').trim();
      if (!name || name.length > 160) continue;
      const publicAnchor = [...(card?.querySelectorAll?.('a[href*="/in/"]') || [])][0];
      const publicUrl = publicAnchor ? normalize(publicAnchor.getAttribute('href') || '') : '';
      const salesAnchor = [...(card?.querySelectorAll?.('a[href*="/sales/lead/"]') || [])][0];
      const salesLeadUrl = salesAnchor ? normalize(salesAnchor.getAttribute('href') || '') : (/\/sales\/lead\//i.test(href) ? href : '');
      const connectionDegree = rawText.match(/\b(1st|2nd|3rd)\b/i)?.[1] || '';
      const locationLine = lines.find((line) => /Saudi|Riyadh|Jeddah|Dammam|Khobar|United Arab Emirates|Dubai|Abu Dhabi|Sharjah|Qatar|Doha|Bahrain|Oman|Muscat|Kuwait|Jordan|Egypt|Cairo/i.test(line)) || '';
      const secondary = lines.filter((line) => line !== name && !/^(1st|2nd|3rd)$/i.test(line) && line.length < 220);
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

async function resolvePublicProfile(context, salesLeadUrl) {
  if (!salesLeadUrl) return '';
  const page = await context.newPage();
  try {
    await page.goto(salesLeadUrl, { waitUntil: 'domcontentloaded', timeout: SALESNAV_TIMEOUT_MS });
    if (await blockedOrLoggedOut(page)) return '';
    await page.waitForTimeout(700);
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
  await page.waitForTimeout(900);
  return page.url() !== before || await next.count() > 0;
}

async function extractSalesNavSearch(rawUrl, requestedLimit = SALESNAV_MAX_RESULTS) {
  const searchUrl = normalizeSalesNavSearchUrl(rawUrl);
  const limit = Math.max(1, Math.min(SALESNAV_MAX_RESULTS, Number(requestedLimit || SALESNAV_MAX_RESULTS)));
  if (!sessionConfigured()) {
    return { ok: false, status: 'session_required', error: 'LinkedIn session is not connected on the VPS.', configured: false, leads: [] };
  }

  const browser = await getSharedBrowser();
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(SALESNAV_TIMEOUT_MS);
  await addLinkedInSession(context);
  const page = await context.newPage();

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SALESNAV_TIMEOUT_MS });
    await page.waitForTimeout(1200);
    if (await blockedOrLoggedOut(page)) {
      return { ok: false, status: 'session_expired', error: 'LinkedIn session needs to be reconnected.', configured: true, leads: [] };
    }

    const collected = new Map();
    let pagesRead = 0;
    while (collected.size < limit && pagesRead < 2) {
      pagesRead += 1;
      const cards = await extractCards(page);
      for (const card of cards) {
        const key = card.salesLeadUrl || card.publicUrl || `${card.name}:${card.company}`;
        if (!key || collected.has(key)) continue;
        collected.set(key, card);
        if (collected.size >= limit) break;
      }
      if (collected.size >= limit || pagesRead >= 2) break;
      if (!await clickNext(page)) break;
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
