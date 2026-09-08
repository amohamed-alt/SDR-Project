const FULL_RUN_KEY = 'salesNavFullRunV1';
const CONTINUATION_TAB_KEY = 'salesNavFullRunContinuationTabV1';
const CONTINUE_ALARM = 'salesnav-full-run-continue-v1';
const DASHBOARD_DEFAULT = 'https://sdr.dashboardtalentera.tech';
const MAX_PAGES = 100;
const MAX_LEADS = 2500;
const CONTINUE_DELAY_MS = 8000;
const CLIENT_VERSION = chrome.runtime.getManifest().version;
const PARSER_VERSION = 'card-v3-full-search-bg';
let processing = false;

function leadKey(lead) {
  return lead.salesLeadUrl || lead.linkedinUrl || `${String(lead.name || '').toLowerCase()}:${String(lead.company || '').toLowerCase()}`;
}

function pageSignature(leads) {
  return (leads || []).slice(0, 5).map(leadKey).join('|');
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

function dedupe(leads, limit = 25) {
  const unique = new Map();
  for (const lead of leads || []) {
    const key = leadKey(lead);
    if (!key || unique.has(key)) continue;
    unique.set(key, lead);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

async function settings() {
  const stored = await chrome.storage.local.get(['dashboardUrl', 'pairingToken']);
  let dashboardUrl = DASHBOARD_DEFAULT;
  try {
    const parsed = new URL(String(stored.dashboardUrl || DASHBOARD_DEFAULT));
    if (parsed.protocol === 'https:') dashboardUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {}
  return { dashboardUrl, pairingToken: String(stored.pairingToken || '').trim() };
}

async function dashboardPost(body) {
  const { dashboardUrl, pairingToken } = await settings();
  if (!pairingToken) throw new Error('Companion pairing token is missing.');
  const response = await fetch(`${dashboardUrl}/api/prospecting/salesnav/companion`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pairingToken}`,
      'Content-Type': 'application/json',
      'X-Companion-Version': CLIENT_VERSION,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Dashboard returned HTTP ${response.status}`);
  return payload;
}

async function savePage(run, pageNumber, leads) {
  return dashboardPost({
    action: 'full_run_page',
    runId: run.runId,
    sourceUrl: run.sourceUrl,
    searchFingerprint: run.searchFingerprint,
    pageNumber,
    clientVersion: CLIENT_VERSION,
    parserVersion: PARSER_VERSION,
    leads: leads.map(compactLead),
  });
}

async function finishRun(run, stopReason) {
  return dashboardPost({ action: 'full_run_finish', runId: run.runId, stopReason });
}

function pageIsSalesNavPeopleSearch() {
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  return (host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /^\/sales\/search\/people\/?$/i.test(location.pathname);
}

async function verifySalesNavTab(tabId) {
  try {
    const result = await chrome.scripting.executeScript({ target: { tabId }, func: pageIsSalesNavPeopleSearch });
    return Boolean(result?.[0]?.result);
  } catch {
    return false;
  }
}

async function extractCurrentSalesNavPageBackground() {
  const sourceUrl = location.href;
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  if ((host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) || !/^\/sales\/search\/people\/?$/i.test(location.pathname)) {
    return { ok: false, error: 'Not a Sales Navigator People Search page.', sourceUrl, leads: [] };
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
  const locationFromCard = (card, lines) => {
    const structured = textOf(card.querySelector('[data-anonymize="location"]'));
    if (structured && !isNoise(structured)) return structured;
    return lines.find((line) => /Saudi|Riyadh|Jeddah|Dammam|Khobar|United Arab Emirates|Dubai|Abu Dhabi|Sharjah|Qatar|Doha|Bahrain|Oman|Muscat|Kuwait|Jordan|Egypt|Cairo/i.test(line)) || '';
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

  const selectors = ['a[href*="/sales/lead/"]', 'a[href*="/in/"]', '[data-anonymize="person-name"]'].join(',');
  const found = new Map();
  const scan = () => {
    for (const seed of [...document.querySelectorAll(selectors)]) {
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
      found.set(key, { name, title, company, location: locationText, connectionDegree, salesLeadUrl, linkedinUrl });
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

function clickNextSalesNavPageBackground() {
  const selectors = ['button[aria-label*="Next" i]', 'button[data-control-name*="next" i]', 'button[class*="pagination"]'];
  for (const selector of selectors) {
    for (const node of [...document.querySelectorAll(selector)]) {
      if (!(node instanceof HTMLButtonElement) || node.disabled) continue;
      const aria = String(node.getAttribute('aria-label') || '');
      const text = String(node.innerText || '').trim();
      if (!/next/i.test(`${aria} ${text}`)) continue;
      node.click();
      return true;
    }
  }
  const fallback = [...document.querySelectorAll('button')].find((node) => {
    const aria = String(node.getAttribute('aria-label') || '');
    const text = String(node.innerText || '').trim();
    return !node.disabled && /next/i.test(`${aria} ${text}`);
  });
  if (!fallback) return false;
  fallback.click();
  return true;
}

async function extractPage(tabId) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: extractCurrentSalesNavPageBackground });
  return result?.[0]?.result || { ok: false, error: 'Could not read this Sales Navigator page.', leads: [] };
}

async function clickNext(tabId) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: clickNextSalesNavPageBackground });
  return Boolean(result?.[0]?.result);
}

async function scheduleContinuation(tabId, delayMs = CONTINUE_DELAY_MS) {
  await chrome.storage.local.set({ [CONTINUATION_TAB_KEY]: tabId });
  await chrome.alarms.clear(CONTINUE_ALARM);
  chrome.alarms.create(CONTINUE_ALARM, { when: Date.now() + delayMs });
}

async function markComplete(run, stopReason) {
  const finished = await finishRun(run, stopReason);
  const complete = {
    ...run,
    total: Number(finished.total || run.total || 0),
    complete: true,
    completedAt: new Date().toISOString(),
    stopReason,
    backgroundStatus: `Finished: ${stopReason}`,
    backgroundUpdatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [FULL_RUN_KEY]: complete });
  await chrome.storage.local.remove([CONTINUATION_TAB_KEY]);
  await chrome.alarms.clear(CONTINUE_ALARM);
}

async function processContinuation(tabId) {
  if (processing) return;
  processing = true;
  try {
    const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
    let run = stored[FULL_RUN_KEY];
    if (!run || run.complete || !run.runId) return;
    if (Number(run.pagesRead || 0) >= MAX_PAGES) {
      await markComplete(run, `Reached ${MAX_PAGES}-page safety cap`);
      return;
    }
    if (Number(run.total || 0) >= MAX_LEADS) {
      await markComplete(run, `Reached ${MAX_LEADS}-lead safety cap`);
      return;
    }

    const current = await extractPage(tabId);
    if (!current.ok) {
      run = { ...run, backgroundError: current.error || 'Could not read Sales Navigator.', backgroundUpdatedAt: new Date().toISOString() };
      await chrome.storage.local.set({ [FULL_RUN_KEY]: run });
      return;
    }
    const signature = pageSignature(current.leads || []);
    if (!signature) {
      run = { ...run, backgroundError: 'No Sales Navigator lead cards found after navigation.', backgroundUpdatedAt: new Date().toISOString() };
      await chrome.storage.local.set({ [FULL_RUN_KEY]: run });
      return;
    }

    if (!run.signatures?.includes(signature)) {
      const clean = dedupe((current.leads || []).filter((lead) => String(lead.connectionDegree || '').toLowerCase() !== '1st'), 25);
      const nextPageNumber = Number(run.pagesRead || 0) + 1;
      const payload = await savePage(run, nextPageNumber, clean);
      run = {
        ...run,
        pagesRead: nextPageNumber,
        total: Number(payload.total || run.total || 0),
        signatures: [...(run.signatures || []), signature].slice(-MAX_PAGES),
        lastPageUrl: current.sourceUrl,
        backgroundError: '',
        backgroundStatus: `Saved page ${nextPageNumber} in background`,
        backgroundUpdatedAt: new Date().toISOString(),
      };
      await chrome.storage.local.set({ [FULL_RUN_KEY]: run });
    }

    if (Number(run.pagesRead || 0) >= MAX_PAGES) {
      await markComplete(run, `Reached ${MAX_PAGES}-page safety cap`);
      return;
    }
    if (Number(run.total || 0) >= MAX_LEADS) {
      await markComplete(run, `Reached ${MAX_LEADS}-lead safety cap`);
      return;
    }

    const moved = await clickNext(tabId);
    if (!moved) {
      await markComplete(run, 'No next page');
      return;
    }
    await scheduleContinuation(tabId);
  } catch (error) {
    const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
    const run = stored[FULL_RUN_KEY];
    if (run && !run.complete) {
      await chrome.storage.local.set({
        [FULL_RUN_KEY]: {
          ...run,
          backgroundError: error instanceof Error ? error.message : 'Background continuation failed.',
          backgroundUpdatedAt: new Date().toISOString(),
        },
      });
    }
  } finally {
    processing = false;
  }
}

async function maybeScheduleFromTab(tabId) {
  const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
  const run = stored[FULL_RUN_KEY];
  if (!run || run.complete || !run.runId) return;
  if (!await verifySalesNavTab(tabId)) return;
  await scheduleContinuation(tabId);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  void maybeScheduleFromTab(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CONTINUE_ALARM) return;
  void (async () => {
    const stored = await chrome.storage.local.get([CONTINUATION_TAB_KEY]);
    const tabId = Number(stored[CONTINUATION_TAB_KEY]);
    if (!Number.isFinite(tabId)) return;
    await processContinuation(tabId);
  })();
});
