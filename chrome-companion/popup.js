const $ = (id) => document.getElementById(id);
const DEFAULT_DASHBOARD = 'https://sdr.dashboardtalentera.tech';
const CLIENT_VERSION = chrome.runtime.getManifest().version;
const PARSER_VERSION = 'card-v3-full-search';
const FULL_RUN_KEY = 'salesNavFullRunV1';
const FULL_RUN_MAX_PAGES = 100;
const FULL_RUN_MAX_LEADS = 2500;
const FULL_RUN_PAGE_WAIT_MS = 2200;

function setStatus(id, message, state = 'muted') {
  const node = $(id);
  if (!node) return;
  node.textContent = message;
  node.className = `status ${state}`;
}

function cleanDashboard(raw) {
  try {
    const url = new URL(String(raw || '').trim() || DEFAULT_DASHBOARD);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_DASHBOARD;
  }
}

function searchFingerprint(raw) {
  try {
    const url = new URL(String(raw || ''));
    ['page', 'start', 'offset'].forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    return `${url.origin}${url.pathname}?${[...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
  } catch {
    return String(raw || '').trim();
  }
}

function leadKey(lead) {
  return lead.salesLeadUrl || lead.linkedinUrl || `${String(lead.name || '').toLowerCase()}:${String(lead.company || '').toLowerCase()}`;
}

function compactLead(lead) {
  return {
    name: String(lead.name || '').trim(),
    title: String(lead.title || '').trim(),
    company: String(lead.company || '').trim(),
    location: String(lead.location || '').trim(),
    connectionDegree: String(lead.connectionDegree || '').trim(),
    salesLeadUrl: String(lead.salesLeadUrl || '').trim(),
    linkedinUrl: String(lead.linkedinUrl || '').trim(),
  };
}

function pageSignature(leads) {
  return (leads || []).slice(0, 5).map(leadKey).join('|');
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['dashboardUrl', 'pairingToken', FULL_RUN_KEY]);
  $('dashboard').value = cleanDashboard(stored.dashboardUrl || DEFAULT_DASHBOARD);
  $('token').value = stored.pairingToken || '';
  setStatus('versionStatus', `Companion v${CLIENT_VERSION} · parser ${PARSER_VERSION}`);
  const run = stored[FULL_RUN_KEY];
  if (run && !run.complete) {
    $('extractFull').textContent = `Resume full search · ${Number(run.pagesRead || 0)} pages / ${Number(run.total || 0)} leads`;
    setStatus('fullRunStatus', `Saved run ready to resume · ${Number(run.pagesRead || 0)} pages · ${Number(run.total || 0)} unique leads.`);
  } else if (run?.complete) {
    setStatus('fullRunStatus', `Last full run finished · ${Number(run.pagesRead || 0)} pages · ${Number(run.total || 0)} unique leads.`, 'ok');
  }
}

async function saveSettings() {
  const dashboardUrl = cleanDashboard($('dashboard').value);
  const pairingToken = $('token').value.trim();
  await chrome.storage.local.set({ dashboardUrl, pairingToken });
  $('dashboard').value = dashboardUrl;
  setStatus('pairStatus', pairingToken ? 'Pairing saved locally in Chrome.' : 'Add a pairing token first.', pairingToken ? 'ok' : 'bad');
  return { dashboardUrl, pairingToken };
}

async function settings() {
  const stored = await chrome.storage.local.get(['dashboardUrl', 'pairingToken']);
  return {
    dashboardUrl: cleanDashboard(stored.dashboardUrl || $('dashboard').value || DEFAULT_DASHBOARD),
    pairingToken: String(stored.pairingToken || $('token').value || '').trim(),
  };
}

async function ping() {
  const { dashboardUrl, pairingToken } = await saveSettings();
  if (!pairingToken) return;
  setStatus('pairStatus', 'Testing connection…');
  try {
    const response = await fetch(`${dashboardUrl}/api/prospecting/salesnav/companion`, {
      headers: {
        Authorization: `Bearer ${pairingToken}`,
        'X-Companion-Version': CLIENT_VERSION,
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Pairing rejected');
    setStatus('pairStatus', `Connected to SDR Dashboard · v${CLIENT_VERSION}`, 'ok');
  } catch (error) {
    setStatus('pairStatus', error instanceof Error ? error.message : 'Connection failed.', 'bad');
  }
}

async function extractCurrentSalesNavPage() {
  const sourceUrl = location.href;
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  if ((host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) || !/^\/sales\/search\/people\/?$/i.test(location.pathname)) {
    return { ok: false, error: 'Open a Sales Navigator People Search page first.', sourceUrl, leads: [] };
  }

  const textOf = (node) => String(node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();

  const normalizeLinkedIn = (href) => {
    try {
      const url = new URL(String(href || ''), location.origin);
      const candidateHost = url.hostname.toLowerCase().replace(/^www\./, '');
      if (candidateHost !== 'linkedin.com') return '';
      url.protocol = 'https:';
      url.hostname = 'www.linkedin.com';
      url.hash = '';
      return url.toString();
    } catch { return ''; }
  };

  const normalizePublic = (href) => {
    const normalized = normalizeLinkedIn(href);
    if (!normalized) return '';
    try {
      const url = new URL(normalized);
      if (!/^\/in\/[^/?#]+/i.test(url.pathname)) return '';
      url.search = '';
      return url.toString().replace(/\/$/, '');
    } catch { return ''; }
  };

  const isNoise = (value) => {
    const text = String(value || '').trim();
    if (!text) return true;
    return /(?:\b(?:1st|2nd|3rd)\b.*degree connection|linkedin premium member|shared connections?|recently posted|^save$|^message$|^connect$|^view profile$|^more$|^follow$)/i.test(text);
  };

  const companyFromCard = (card, anchors, lines, name, locationText) => {
    const structured = textOf(card.querySelector('[data-anonymize="company-name"]'));
    if (structured && !isNoise(structured)) return structured;

    const companyAnchor = anchors.find((node) => {
      const href = String(node.getAttribute('href') || '');
      return /\/sales\/company\/|\/company\//i.test(href) && !/\/sales\/lead\//i.test(href);
    });
    const linked = textOf(companyAnchor);
    if (linked && !isNoise(linked)) return linked;

    const candidates = lines.filter((line) => line !== name && line !== locationText && !isNoise(line) && line.length <= 180);
    const companyLike = candidates.find((line) => /\bat\b|@/i.test(line));
    if (companyLike) {
      const match = companyLike.match(/(?:\bat\b|@)\s+(.+)$/i);
      if (match?.[1] && !isNoise(match[1])) return match[1].trim();
    }
    return '';
  };

  const titleFromCard = (card, lines, name, company, locationText) => {
    const structured = textOf(card.querySelector('[data-anonymize="job-title"]'));
    if (structured && !isNoise(structured)) return structured;

    const candidates = lines.filter((line) => line !== name && line !== company && line !== locationText && !isNoise(line) && line.length <= 240);
    let title = candidates[0] || '';
    if (company && title.toLowerCase().endsWith(company.toLowerCase())) {
      title = title.slice(0, -company.length).replace(/[·•,@\-\s]+$/g, '').trim();
    }
    return title;
  };

  const locationFromCard = (card, lines) => {
    const structured = textOf(card.querySelector('[data-anonymize="location"]'));
    if (structured && !isNoise(structured)) return structured;
    return lines.find((line) => /Saudi|Riyadh|Jeddah|Dammam|Khobar|United Arab Emirates|Dubai|Abu Dhabi|Sharjah|Qatar|Doha|Bahrain|Oman|Muscat|Kuwait|Jordan|Egypt|Cairo/i.test(line)) || '';
  };

  const nameFromCard = (card, anchors, fallbackAnchor, lines) => {
    const structured = textOf(card.querySelector('[data-anonymize="person-name"]'));
    if (structured && !isNoise(structured)) return structured;
    const candidate = anchors.find((node) => {
      const href = String(node.getAttribute('href') || '');
      const text = textOf(node);
      return /\/sales\/lead\/|\/in\//i.test(href) && text.length >= 2 && text.length <= 180 && !isNoise(text);
    });
    return textOf(candidate || fallbackAnchor) || lines.find((line) => !isNoise(line)) || '';
  };

  const selectors = [
    'a[href*="/sales/lead/"]',
    'a[href*="/in/"]',
    '[data-anonymize="person-name"]',
  ].join(',');
  const found = new Map();

  const scan = () => {
    const seeds = [...document.querySelectorAll(selectors)];
    for (const seed of seeds) {
      const card = seed.closest('[data-x-search-result]')
        || seed.closest('[role="listitem"]')
        || seed.closest('li')
        || seed.closest('[class*="search-results__result-item"]')
        || seed.closest('[class*="result-list"]')
        || seed.parentElement?.parentElement
        || seed.parentElement;
      if (!card) continue;

      const rawText = String(card.innerText || '').replace(/\n{3,}/g, '\n').trim();
      if (!rawText || rawText.length > 9000) continue;
      const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
      const anchors = [...card.querySelectorAll('a')];
      const salesAnchor = anchors.find((node) => /\/sales\/lead\//i.test(String(node.getAttribute('href') || '')));
      const publicAnchor = anchors.find((node) => /\/in\//i.test(String(node.getAttribute('href') || '')));
      const salesLeadUrl = salesAnchor ? normalizeLinkedIn(salesAnchor.getAttribute('href') || '') : '';
      const linkedinUrl = publicAnchor ? normalizePublic(publicAnchor.getAttribute('href') || '') : '';
      if (!salesLeadUrl && !linkedinUrl) continue;

      const name = nameFromCard(card, anchors, salesAnchor || publicAnchor || seed, lines).replace(/^view\s+/i, '').trim();
      if (!name || name.length > 200 || isNoise(name)) continue;
      const locationText = locationFromCard(card, lines);
      const company = companyFromCard(card, anchors, lines, name, locationText);
      const title = titleFromCard(card, lines, name, company, locationText);
      const connectionDegree = rawText.match(/\b(1st|2nd|3rd)\b/i)?.[1] || '';
      const key = salesLeadUrl || linkedinUrl || `${name}:${company}`;
      if (found.has(key)) continue;

      found.set(key, {
        name,
        title,
        company,
        location: locationText,
        connectionDegree,
        salesLeadUrl,
        linkedinUrl,
        rawText: rawText.slice(0, 2200),
      });
    }
  };

  const scrollers = [...document.querySelectorAll('main,[role="main"],[class*="search-results"],[class*="result-list"],div')]
    .filter((node) => node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 300)
    .sort((a, b) => b.scrollHeight - a.scrollHeight);
  const target = scrollers[0] || document.scrollingElement || document.documentElement;
  const originalTop = target.scrollTop || window.scrollY || 0;

  for (let step = 0; step < 7 && found.size < 25; step += 1) {
    scan();
    const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const top = Math.min(maxTop, Math.round(maxTop * (step + 1) / 7));
    if (typeof target.scrollTo === 'function') target.scrollTo({ top, behavior: 'auto' });
    else window.scrollTo(0, top);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  scan();
  if (typeof target.scrollTo === 'function') target.scrollTo({ top: originalTop, behavior: 'auto' });

  return { ok: true, sourceUrl, leads: [...found.values()].slice(0, 25) };
}

function clickSalesNavPager(direction) {
  const nextMode = direction === 'next';
  const preferred = nextMode
    ? ['button[aria-label*="Next" i]', 'button[data-control-name*="next" i]', 'button[class*="pagination"]']
    : ['button[aria-label*="Previous" i]', 'button[aria-label*="Prev" i]'];
  for (const selector of preferred) {
    const matches = [...document.querySelectorAll(selector)];
    const candidate = matches.find((node) => {
      if (!(node instanceof HTMLButtonElement) || node.disabled) return false;
      const aria = String(node.getAttribute('aria-label') || '');
      const text = String(node.innerText || '').trim();
      return nextMode ? /next/i.test(`${aria} ${text}`) : /previous|prev/i.test(`${aria} ${text}`);
    });
    if (candidate) {
      candidate.click();
      return true;
    }
  }
  const label = nextMode ? /next/i : /previous|prev/i;
  const buttons = [...document.querySelectorAll('button')];
  const button = buttons.find((node) => {
    const aria = String(node.getAttribute('aria-label') || '');
    const text = String(node.innerText || '').trim();
    return !node.disabled && (label.test(aria) || label.test(text));
  });
  if (!button) return false;
  button.click();
  return true;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active browser tab found.');
  return tab;
}

async function extractPage(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractCurrentSalesNavPage,
  });
  return result?.[0]?.result || { ok: false, error: 'Could not read this page.', leads: [] };
}

async function clickPager(tabId, direction) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickSalesNavPager,
    args: [direction],
  });
  return Boolean(result?.[0]?.result);
}

function dedupe(leads, limit = 50) {
  const map = new Map();
  for (const lead of leads) {
    const key = leadKey(lead);
    if (!map.has(key)) map.set(key, lead);
  }
  return [...map.values()].slice(0, limit);
}

async function importBatch(leads, sourceUrl, pagesRead) {
  const { dashboardUrl, pairingToken } = await settings();
  if (!pairingToken) throw new Error('Pair the companion with the SDR Dashboard first.');
  const response = await fetch(`${dashboardUrl}/api/prospecting/salesnav/companion`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pairingToken}`,
      'Content-Type': 'application/json',
      'X-Companion-Version': CLIENT_VERSION,
    },
    body: JSON.stringify({
      action: 'import',
      sourceUrl,
      pagesRead,
      clientVersion: CLIENT_VERSION,
      parserVersion: PARSER_VERSION,
      leads,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Dashboard returned HTTP ${response.status}`);
  return payload;
}

async function postFullRunPage({ runId, sourceUrl, fingerprint, pageNumber, leads }) {
  const { dashboardUrl, pairingToken } = await settings();
  if (!pairingToken) throw new Error('Pair the companion with the SDR Dashboard first.');
  const response = await fetch(`${dashboardUrl}/api/prospecting/salesnav/companion`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pairingToken}`,
      'Content-Type': 'application/json',
      'X-Companion-Version': CLIENT_VERSION,
    },
    body: JSON.stringify({
      action: 'full_run_page',
      runId,
      sourceUrl,
      searchFingerprint: fingerprint,
      pageNumber,
      clientVersion: CLIENT_VERSION,
      parserVersion: PARSER_VERSION,
      leads: leads.map(compactLead),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Dashboard returned HTTP ${response.status}`);
  return payload;
}

async function finishFullRun(runId, stopReason) {
  const { dashboardUrl, pairingToken } = await settings();
  if (!pairingToken) throw new Error('Pair the companion with the SDR Dashboard first.');
  const response = await fetch(`${dashboardUrl}/api/prospecting/salesnav/companion`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pairingToken}`,
      'Content-Type': 'application/json',
      'X-Companion-Version': CLIENT_VERSION,
    },
    body: JSON.stringify({ action: 'full_run_finish', runId, stopReason }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Dashboard returned HTTP ${response.status}`);
  return payload;
}

async function run(twoPages) {
  $('extract25').disabled = true;
  $('extract50').disabled = true;
  $('extractFull').disabled = true;
  setStatus('runStatus', 'Reading the visible Sales Navigator result cards…');
  try {
    const tab = await activeTab();
    const first = await extractPage(tab.id);
    if (!first.ok) throw new Error(first.error || 'Could not read Sales Navigator.');
    let leads = first.leads || [];
    let pagesRead = 1;

    if (twoPages && leads.length < 50) {
      setStatus('runStatus', `Page 1: ${leads.length}. Moving to page 2…`);
      const moved = await clickPager(tab.id, 'next');
      if (moved) {
        await new Promise((resolve) => setTimeout(resolve, FULL_RUN_PAGE_WAIT_MS));
        const second = await extractPage(tab.id);
        if (second.ok) {
          leads = dedupe([...leads, ...(second.leads || [])]);
          pagesRead = 2;
        }
      }
    }

    leads = dedupe(leads);
    if (!leads.length) throw new Error('No Sales Navigator lead cards were found on this search page.');
    const clean = leads.filter((lead) => String(lead.connectionDegree || '').toLowerCase() !== '1st');
    if (!clean.length) throw new Error('All extracted people are 1st-degree connections, so nothing was imported.');

    const directProfiles = clean.filter((lead) => Boolean(lead.linkedinUrl)).length;
    const withCompany = clean.filter((lead) => Boolean(lead.company)).length;
    setStatus('runStatus', `Importing ${clean.length} leads · ${withCompany} companies parsed · ${directProfiles} direct profile URLs visible…`);
    const payload = await importBatch(clean, first.sourceUrl, pagesRead);
    setStatus('runStatus', `Done · ${payload.imported} sent · v${CLIENT_VERSION}.`, 'ok');
  } catch (error) {
    setStatus('runStatus', error instanceof Error ? error.message : 'Extraction failed.', 'bad');
  } finally {
    $('extract25').disabled = false;
    $('extract50').disabled = false;
    $('extractFull').disabled = false;
  }
}

async function runFullSearch() {
  $('extract25').disabled = true;
  $('extract50').disabled = true;
  $('extractFull').disabled = true;
  $('resetFull').disabled = true;
  setStatus('fullRunStatus', 'Starting full Sales Navigator capture…');
  try {
    const tab = await activeTab();
    let first = await extractPage(tab.id);
    if (!first.ok) throw new Error(first.error || 'Could not read Sales Navigator.');
    const fingerprint = searchFingerprint(first.sourceUrl);
    const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
    let run = stored[FULL_RUN_KEY];
    if (!run || run.complete || run.searchFingerprint !== fingerprint) {
      run = {
        runId: crypto.randomUUID(),
        searchFingerprint: fingerprint,
        sourceUrl: first.sourceUrl,
        pagesRead: 0,
        total: 0,
        signatures: [],
        complete: false,
        startedAt: new Date().toISOString(),
      };
    }

    let current = first;
    let skipAlreadyCapturedPage = Boolean(run.signatures?.includes(pageSignature(current.leads || [])));
    if (skipAlreadyCapturedPage) {
      const moved = await clickPager(tab.id, 'next');
      if (!moved) {
        const finished = await finishFullRun(run.runId, 'Already captured final page');
        run = { ...run, complete: true, total: Number(finished.total || run.total), completedAt: new Date().toISOString() };
        await chrome.storage.local.set({ [FULL_RUN_KEY]: run });
        setStatus('fullRunStatus', `Finished · ${run.pagesRead} pages · ${run.total} unique leads.`, 'ok');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, FULL_RUN_PAGE_WAIT_MS));
      current = await extractPage(tab.id);
      if (!current.ok) throw new Error(current.error || 'Could not read the next Sales Navigator page.');
    }

    while (run.pagesRead < FULL_RUN_MAX_PAGES && run.total < FULL_RUN_MAX_LEADS) {
      const signature = pageSignature(current.leads || []);
      if (!signature) throw new Error('No Sales Navigator lead cards were found on this page.');
      if (run.signatures?.includes(signature)) {
        const moved = await clickPager(tab.id, 'next');
        if (!moved) break;
        await new Promise((resolve) => setTimeout(resolve, FULL_RUN_PAGE_WAIT_MS));
        current = await extractPage(tab.id);
        if (!current.ok) throw new Error(current.error || 'Could not read the next Sales Navigator page.');
        continue;
      }

      const pageLeads = dedupe((current.leads || []).filter((lead) => String(lead.connectionDegree || '').toLowerCase() !== '1st'), 25);
      const nextPageNumber = Number(run.pagesRead || 0) + 1;
      setStatus('fullRunStatus', `Page ${nextPageNumber}/${FULL_RUN_MAX_PAGES} · saving ${pageLeads.length} clean leads…`);
      const payload = await postFullRunPage({
        runId: run.runId,
        sourceUrl: run.sourceUrl || current.sourceUrl,
        fingerprint,
        pageNumber: nextPageNumber,
        leads: pageLeads,
      });
      run = {
        ...run,
        pagesRead: nextPageNumber,
        total: Number(payload.total || run.total || 0),
        signatures: [...(run.signatures || []), signature].slice(-FULL_RUN_MAX_PAGES),
        lastPageUrl: current.sourceUrl,
        updatedAt: new Date().toISOString(),
      };
      await chrome.storage.local.set({ [FULL_RUN_KEY]: run });
      $('extractFull').textContent = `Resume full search · ${run.pagesRead} pages / ${run.total} leads`;
      setStatus('fullRunStatus', `Saved page ${run.pagesRead} · ${run.total} unique leads. Moving to next page…`);

      if (run.pagesRead >= FULL_RUN_MAX_PAGES || run.total >= FULL_RUN_MAX_LEADS) break;
      const moved = await clickPager(tab.id, 'next');
      if (!moved) break;
      await new Promise((resolve) => setTimeout(resolve, FULL_RUN_PAGE_WAIT_MS));
      current = await extractPage(tab.id);
      if (!current.ok) throw new Error(current.error || 'Could not read the next Sales Navigator page.');
    }

    let stopReason = 'No next page';
    if (run.pagesRead >= FULL_RUN_MAX_PAGES) stopReason = `Reached ${FULL_RUN_MAX_PAGES}-page safety cap`;
    if (run.total >= FULL_RUN_MAX_LEADS) stopReason = `Reached ${FULL_RUN_MAX_LEADS}-lead safety cap`;
    const finished = await finishFullRun(run.runId, stopReason);
    run = {
      ...run,
      total: Number(finished.total || run.total || 0),
      complete: true,
      completedAt: new Date().toISOString(),
      stopReason,
    };
    await chrome.storage.local.set({ [FULL_RUN_KEY]: run });
    $('extractFull').textContent = 'Capture full search · up to 2,500';
    setStatus('fullRunStatus', `Finished · ${run.pagesRead} pages · ${run.total} unique leads saved · ${stopReason}.`, 'ok');
  } catch (error) {
    setStatus('fullRunStatus', `${error instanceof Error ? error.message : 'Full capture failed.'} Progress is saved; reopen the extension and press Resume.`, 'bad');
  } finally {
    $('extract25').disabled = false;
    $('extract50').disabled = false;
    $('extractFull').disabled = false;
    $('resetFull').disabled = false;
  }
}

async function resetFullSearch() {
  await chrome.storage.local.remove([FULL_RUN_KEY]);
  $('extractFull').textContent = 'Capture full search · up to 2,500';
  setStatus('fullRunStatus', 'Saved local run cleared. The server keeps the last completed run for review.');
}

$('save').addEventListener('click', () => void saveSettings());
$('ping').addEventListener('click', () => void ping());
$('extract25').addEventListener('click', () => void run(false));
$('extract50').addEventListener('click', () => void run(true));
$('extractFull').addEventListener('click', () => void runFullSearch());
$('resetFull').addEventListener('click', () => void resetFullSearch());
void loadSettings();