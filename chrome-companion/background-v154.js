importScripts('queue-v160.js', 'dashboard-controller.js');
const FULL_RUN_KEY = 'salesNavFullRunV1';
const CONTINUATION_TAB_KEY = 'salesNavFullRunContinuationTabV1';
const CONTINUE_ALARM = 'salesnav-full-run-v154-continue';
const WATCHDOG_ALARM = 'salesnav-full-run-v154-watchdog';
const DASHBOARD_DEFAULT = 'https://sdr.dashboardtalentera.tech';
const MAX_PAGES = 100;
const MAX_LEADS = 2500;
const CLIENT_VERSION = chrome.runtime.getManifest().version;
const PARSER_VERSION = 'card-v7-streaming-profiles';
const NORMAL_DELAY_MS = 6500;
const RETRY_DELAY_MS = 3000;
const MAX_STALE_RETRIES = 8;
let processing = false;
let starting = false;
let captureStopRequested = false;
globalThis.isSalesNavCaptureBusy = () => starting || processing;
globalThis.pauseSalesNavCapture = async () => {
  captureStopRequested = true;
  const saved = (await chrome.storage.local.get([FULL_RUN_KEY]))[FULL_RUN_KEY];
  if (saved && !saved.complete) await setRun({ ...saved, paused: true, backgroundStatus: 'Paused from dashboard' });
  await chrome.alarms.clear(CONTINUE_ALARM);
};

function leadKey(lead) {
  return lead.salesLeadUrl || lead.linkedinUrl || `${String(lead.name || '').toLowerCase()}:${String(lead.company || '').toLowerCase()}`;
}

function pageSignature(leads) {
  return (leads || []).slice(0, 5).map(leadKey).join('|');
}

function cleanUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    url.hash = '';
    return url.toString();
  } catch {
    return String(raw || '');
  }
}

function searchFingerprint(raw) {
  try {
    const url = new URL(String(raw || ''));
    url.hash = '';
    url.searchParams.delete('page');
    return url.toString();
  } catch {
    return String(raw || '').replace(/([?&])page=\d+(&|$)/i, '$1').replace(/[?&]$/, '');
  }
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
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok || !payload.ok) throw new Error(payload.error || text || `Dashboard returned HTTP ${response.status}`);
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

async function extractCurrentSalesNavPageV154() {
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
    return /(?:\b(?:1st|2nd|3rd)\b.*degree connection|linkedin premium member|shared connections?|recently posted|\bin role\b|\bin company\b|^[·•\s]*(?:1st|2nd|3rd)$|^viewed$|you[’\']ve already seen|^about:$|^…?\s*show more$|^save$|^message$|^connect$|^view profile$|^more$|^follow$)/i.test(text);
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
    const structured = textOf(card.querySelector('[data-anonymize="title"]'))
      || textOf(card.querySelector('[data-anonymize="job-title"]'));
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
      if (!found.has(key)) found.set(key, { name, title, company, location: locationText, connectionDegree, salesLeadUrl, linkedinUrl });
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

function clickNextSalesNavPageV154() {
  const candidates = [
    ...document.querySelectorAll('button[aria-label="Next" i], button[aria-label^="Next " i], button[data-control-name*="next" i]'),
  ];
  for (const node of candidates) {
    if (!(node instanceof HTMLButtonElement) || node.disabled) continue;
    const aria = String(node.getAttribute('aria-label') || '').trim();
    const text = String(node.innerText || '').trim();
    const containerText = String(node.closest('nav,[class*="pagination"]')?.innerText || '');
    if (!/^next\b/i.test(aria) && !/^next$/i.test(text) && !/next/i.test(containerText)) continue;
    node.click();
    return true;
  }
  return false;
}

async function extractPage(tabId) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: extractCurrentSalesNavPageV154 });
  return result?.[0]?.result || { ok: false, error: 'Could not read this Sales Navigator page.', leads: [] };
}

async function clickNext(tabId) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: clickNextSalesNavPageV154 });
  return Boolean(result?.[0]?.result);
}

async function scheduleContinuation(tabId, delayMs = NORMAL_DELAY_MS) {
  await chrome.storage.local.set({ [CONTINUATION_TAB_KEY]: tabId });
  await chrome.alarms.clear(CONTINUE_ALARM);
  chrome.alarms.create(CONTINUE_ALARM, { when: Date.now() + delayMs });
}

async function setRun(run, { resume = false } = {}) {
  const current = (await chrome.storage.local.get([FULL_RUN_KEY]))[FULL_RUN_KEY];
  const paused = Boolean(captureStopRequested || (!resume && (run.paused || (current?.runId === run.runId && current.paused))));
  await chrome.storage.local.set({ [FULL_RUN_KEY]: { ...run, paused, backgroundUpdatedAt: new Date().toISOString() } });
}

async function markComplete(run, stopReason) {
  const cardsComplete = {
    ...run,
    cardsComplete: true,
    complete: false,
    stopReason,
    navigationPending: false,
    backgroundError: '',
    backgroundStatus: 'Cards saved. Reading public profile URLs before dashboard handoff.',
  };
  await setRun(cardsComplete);
  await chrome.storage.local.remove([CONTINUATION_TAB_KEY]);
  await chrome.alarms.clear(CONTINUE_ALARM);
  if (run.readProfilesOnComplete && !captureStopRequested && !(await chrome.storage.local.get([FULL_RUN_KEY]))[FULL_RUN_KEY]?.paused) {
    try {
      const saved = await dashboardPost({ action: 'profile_read_run', runId: run.runId });
      if (captureStopRequested || (await chrome.storage.local.get([FULL_RUN_KEY]))[FULL_RUN_KEY]?.paused) return;
      if (saved.leads?.length) {
        await globalThis.startCapturedProfileChecks(saved.leads, saved.sourceUrl, run.runId, { afterCapture: true });
        await setRun({ ...cardsComplete, backgroundStatus: 'Cards saved. Reading missing public URLs automatically.' });
      } else await globalThis.finalizeSalesNavCapture(run.runId, { attempted: 0, failed: 0 });
    } catch (error) {
      const finished = await finishRun(run, `${stopReason} · URL reader could not start`);
      await setRun({ ...cardsComplete, total: Number(finished.total || run.total || 0), complete: true, completedAt: new Date().toISOString(), backgroundError: error instanceof Error ? error.message : 'Collector unavailable', backgroundStatus: 'Cards saved, but automatic URL reading needs retry.' });
    }
  } else {
    const finished = await finishRun(run, stopReason);
    await setRun({ ...cardsComplete, total: Number(finished.total || run.total || 0), complete: true, completedAt: new Date().toISOString(), backgroundStatus: `Finished: ${stopReason}` });
    await chrome.tabs.create({ url: `${DASHBOARD_DEFAULT}/signalhire-queue`, active: true });
  }
}

globalThis.finalizeSalesNavCapture = async (runId, { attempted = 0, failed = 0 } = {}) => {
  const saved = (await chrome.storage.local.get([FULL_RUN_KEY]))[FULL_RUN_KEY];
  if (!saved || saved.runId !== runId || saved.complete) return;
  if (failed > 0) {
    await setRun({
      ...saved,
      complete: false,
      cardsComplete: true,
      paused: true,
      backgroundError: `${failed} LinkedIn URL${failed === 1 ? '' : 's'} could not be read. Retry them before this batch can open in the dashboard.`,
      backgroundStatus: `Waiting for ${failed} public LinkedIn URL${failed === 1 ? '' : 's'}; the batch is not ready.`,
    });
    return;
  }
  const reason = `${saved.stopReason || 'Capture finished'} · profile URLs attempted ${attempted} · failed ${failed}`;
  const finished = await finishRun(saved, reason);
  const complete = { ...saved, total: Number(finished.total || saved.total || 0), complete: true, cardsComplete: true, paused: false, completedAt: new Date().toISOString(), backgroundError: '', backgroundStatus: 'Dashboard ready · all public LinkedIn URLs saved.' };
  await setRun(complete, { resume: true });
  const opened = (await chrome.storage.local.get(['salesNavDashboardOpenedRunV1'])).salesNavDashboardOpenedRunV1;
  if (opened !== runId) {
    await chrome.storage.local.set({ salesNavDashboardOpenedRunV1: runId });
    await chrome.tabs.create({ url: `${DASHBOARD_DEFAULT}/signalhire-queue`, active: true });
  }
};

async function persistCurrentPage(run, current) {
  const signature = pageSignature(current.leads || []);
  const clean = dedupe((current.leads || []).filter((lead) => String(lead.connectionDegree || '').toLowerCase() !== '1st'), 25);
  const nextPageNumber = Number(run.pagesRead || 0) + 1;
  const payload = await savePage(run, nextPageNumber, clean);
  const updated = {
    ...run,
    profileLeads: dedupe([...(run.profileLeads || []), ...clean], MAX_LEADS),
    pagesRead: nextPageNumber,
    total: Number(payload.total || run.total || 0),
    signatures: [...(run.signatures || []), signature].slice(-MAX_PAGES),
    lastSignature: signature,
    lastPageUrl: cleanUrl(current.sourceUrl),
    staleRetries: 0,
    navigationPending: false,
    backgroundError: '',
    backgroundStatus: `Saved page ${nextPageNumber} · ${Number(payload.total || run.total || 0)} unique leads`,
  };
  await setRun(updated);
  return updated;
}

async function advance(run, tabId) {
  if (captureStopRequested || (await chrome.storage.local.get([FULL_RUN_KEY]))[FULL_RUN_KEY]?.paused) return run;
  const maxPages = Math.max(1, Math.min(MAX_PAGES, Number(run.maxPages || MAX_PAGES)));
  const maxLeads = Math.max(1, Math.min(MAX_LEADS, Number(run.maxLeads || MAX_LEADS)));
  if (Number(run.pagesRead || 0) >= maxPages) return markComplete(run, `Reached ${maxPages}-page capture limit`);
  if (Number(run.total || 0) >= maxLeads) return markComplete(run, `Reached ${maxLeads}-lead capture limit`);
  const moved = await clickNext(tabId);
  if (!moved) return markComplete(run, 'No next page');
  const waiting = {
    ...run,
    navigationPending: true,
    staleRetries: 0,
    backgroundError: '',
    backgroundStatus: `Moving after saved page ${run.pagesRead} · waiting for fresh Sales Nav results`,
  };
  await setRun(waiting);
  await scheduleContinuation(tabId, NORMAL_DELAY_MS);
}

async function startOrResume(tabId, { readProfilesOnComplete = false, maxPages = MAX_PAGES, maxLeads = MAX_LEADS } = {}) {
  // Claim synchronously, before the first Chrome await, so two dashboard tabs
  // cannot replace one another's run while the initial page is loading.
  if (starting || processing) throw new Error('Search capture is already busy. Wait for the current page to finish.');
  starting = true;
  captureStopRequested = false;
  try {
  const queue = (await chrome.storage.local.get(['salesNavWorkQueueV160'])).salesNavWorkQueueV160;
  if (globalThis.isCapturedProfileReaderBusy?.() || (queue?.action === 'read' && queue.pending?.length && !queue.paused)) throw new Error('URL reading is running. Stop it before starting a search capture.');
  if (!await verifySalesNavTab(tabId)) throw new Error('Open a Sales Navigator People Search tab first.');
  const current = await extractPage(tabId);
  if (captureStopRequested) throw new Error('Search capture was stopped from the dashboard.');
  if (!current.ok) throw new Error(current.error || 'Could not read Sales Navigator.');
  const signature = pageSignature(current.leads || []);
  if (!signature) throw new Error('Sales Navigator is still loading. Wait for the people cards to appear, then press Capture FULL search again.');
  const fingerprint = searchFingerprint(current.sourceUrl);
  const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
  let run = stored[FULL_RUN_KEY];
  if (!run || run.complete || run.searchFingerprint !== fingerprint) {
    run = {
      runId: crypto.randomUUID(),
      searchFingerprint: fingerprint,
      sourceUrl: cleanUrl(current.sourceUrl),
      pagesRead: 0,
      total: 0,
      signatures: [],
      complete: false,
      maxPages: Math.max(1, Math.min(MAX_PAGES, Number(maxPages || MAX_PAGES))),
      maxLeads: Math.max(1, Math.min(MAX_LEADS, Number(maxLeads || MAX_LEADS))),
      startedAt: new Date().toISOString(),
      backgroundStatus: 'Starting full Sales Navigator capture',
    };
  }

  run.readProfilesOnComplete = readProfilesOnComplete;
  run.maxPages = Math.max(1, Math.min(MAX_PAGES, Number(maxPages || run.maxPages || MAX_PAGES)));
  run.maxLeads = Math.max(1, Math.min(MAX_LEADS, Number(maxLeads || run.maxLeads || MAX_LEADS)));
  run.paused = false;
  await setRun(run, { resume: true });
  if (!run.signatures?.includes(signature)) run = await persistCurrentPage(run, current);
  else {
    run = {
      ...run,
      lastSignature: signature,
      lastPageUrl: cleanUrl(current.sourceUrl),
      navigationPending: false,
      staleRetries: 0,
      backgroundError: '',
      backgroundStatus: `Resume armed · ${run.pagesRead} pages / ${run.total} leads`,
    };
    await setRun(run);
  }
  await chrome.storage.local.set({ [CONTINUATION_TAB_KEY]: tabId });
  await advance(run, tabId);
  return run;
  } catch (error) {
    const saved = (await chrome.storage.local.get([FULL_RUN_KEY]))[FULL_RUN_KEY];
    if (saved && !saved.complete) await setRun({ ...saved, paused: true, backgroundError: error instanceof Error ? error.message : 'Search capture failed.', backgroundStatus: 'Paused with error. Progress is saved; resume from the dashboard.' });
    throw error;
  } finally { starting = false; }
}

async function processContinuation(tabId) {
  if (processing) return;
  processing = true;
  try {
    const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
    let run = stored[FULL_RUN_KEY];
    if (!run || run.complete || run.cardsComplete || run.paused || !run.runId) return;
    if (!await verifySalesNavTab(tabId)) {
      await setRun({ ...run, paused: true, backgroundError: 'The saved Sales Navigator tab is no longer a People Search. Reopen the search and press Resume.', backgroundStatus: 'Paused' });
      return;
    }

    const current = await extractPage(tabId);
    if (searchFingerprint(current.sourceUrl) !== run.searchFingerprint) {
      await setRun({ ...run, paused: true, backgroundError: 'The search or filters changed during capture. No cards from the changed search were saved. Reopen the original search to resume, or start the new search from the dashboard.', backgroundStatus: 'Paused because the search changed' });
      return;
    }
    if (!current.ok) {
      const retries = Number(run.staleRetries || 0) + 1;
      await setRun({ ...run, paused: retries >= MAX_STALE_RETRIES, staleRetries: retries, backgroundError: current.error || 'Could not read Sales Navigator.', backgroundStatus: `Waiting for Sales Nav · retry ${retries}/${MAX_STALE_RETRIES}` });
      if (retries < MAX_STALE_RETRIES) await scheduleContinuation(tabId, RETRY_DELAY_MS);
      return;
    }

    const signature = pageSignature(current.leads || []);
    const currentUrl = cleanUrl(current.sourceUrl);
    if (!signature) {
      const retries = Number(run.staleRetries || 0) + 1;
      await setRun({ ...run, staleRetries: retries, backgroundError: '', backgroundStatus: `Sales Nav cards are loading · retry ${retries}/${MAX_STALE_RETRIES}` });
      if (retries < MAX_STALE_RETRIES) await scheduleContinuation(tabId, RETRY_DELAY_MS);
      else await setRun({ ...run, paused: true, staleRetries: retries, backgroundError: 'Sales Navigator kept showing a loading skeleton. Progress is saved; press Resume when the cards finish loading.', backgroundStatus: 'Paused on loading page' });
      return;
    }

    const sameSignature = Boolean(run.lastSignature && signature === run.lastSignature);
    const urlChanged = Boolean(run.lastPageUrl && currentUrl !== cleanUrl(run.lastPageUrl));

    if (run.navigationPending && sameSignature && urlChanged) {
      const retries = Number(run.staleRetries || 0) + 1;
      await setRun({ ...run, staleRetries: retries, backgroundError: '', backgroundStatus: `URL changed but LinkedIn is still showing the previous cards · retry ${retries}/${MAX_STALE_RETRIES}` });
      if (retries < MAX_STALE_RETRIES) await scheduleContinuation(tabId, RETRY_DELAY_MS);
      else await setRun({ ...run, paused: true, staleRetries: retries, backgroundError: 'LinkedIn changed page URL but kept stale cards too long. No page was skipped. Press Resume after the new cards appear.', backgroundStatus: 'Paused safely before next capture' });
      return;
    }

    if (run.navigationPending && sameSignature && !urlChanged) {
      const retries = Number(run.staleRetries || 0) + 1;
      if (retries < 4) {
        await setRun({ ...run, staleRetries: retries, backgroundError: '', backgroundStatus: `Waiting for LinkedIn pagination · retry ${retries}/4` });
        await scheduleContinuation(tabId, RETRY_DELAY_MS);
        return;
      }
      await setRun({ ...run, staleRetries: 0, navigationPending: false, backgroundStatus: 'Next click did not move; retrying once without skipping' });
      await advance({ ...run, staleRetries: 0, navigationPending: false }, tabId);
      return;
    }

    if (run.signatures?.includes(signature)) {
      await setRun({ ...run, lastSignature: signature, lastPageUrl: currentUrl, navigationPending: false, staleRetries: 0, backgroundStatus: 'Current page was already captured · moving to the next page' });
      await advance({ ...run, lastSignature: signature, lastPageUrl: currentUrl, navigationPending: false, staleRetries: 0 }, tabId);
      return;
    }

    run = await persistCurrentPage(run, current);
    await advance(run, tabId);
  } catch (error) {
    const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
    const run = stored[FULL_RUN_KEY];
    if (run && !run.complete) {
      await setRun({ ...run, paused: true, backgroundError: error instanceof Error ? error.message : 'Background continuation failed.', backgroundStatus: 'Paused with error. Progress is saved; resume from the dashboard.' });
    }
  } finally {
    processing = false;
  }
}

async function ensureWatchdog() {
  const existing = await chrome.alarms.get(WATCHDOG_ALARM);
  if (!existing) chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'salesnav_collector_stop') {
    void (async () => {
      await globalThis.stopCapturedProfileChecks?.();
      await globalThis.pauseSalesNavCapture();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message?.type === 'salesnav_v154_start') {
    void (async () => {
      try {
        const tabId = Number(message.tabId);
        if (!Number.isFinite(tabId)) throw new Error('Sales Navigator tab was not found.');
        const run = await startOrResume(tabId, { readProfilesOnComplete: message.readProfilesOnComplete === true, maxPages: message.maxPages, maxLeads: message.maxLeads });
        sendResponse({ ok: true, run });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Could not start full capture.' });
      }
    })();
    return true;
  }
  if (message?.type === 'salesnav_v154_kick') {
    void (async () => {
      const stored = await chrome.storage.local.get([CONTINUATION_TAB_KEY]);
      const tabId = Number(stored[CONTINUATION_TAB_KEY]);
      if (Number.isFinite(tabId)) await processContinuation(tabId);
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CONTINUE_ALARM) {
    void (async () => {
      const stored = await chrome.storage.local.get([CONTINUATION_TAB_KEY]);
      const tabId = Number(stored[CONTINUATION_TAB_KEY]);
      if (Number.isFinite(tabId)) await processContinuation(tabId);
    })();
    return;
  }
  if (alarm.name === WATCHDOG_ALARM) {
    void (async () => {
      const stored = await chrome.storage.local.get([FULL_RUN_KEY, CONTINUATION_TAB_KEY]);
      const run = stored[FULL_RUN_KEY];
      const tabId = Number(stored[CONTINUATION_TAB_KEY]);
      if (!run || run.complete || run.paused || !Number.isFinite(tabId)) return;
      const age = Date.now() - Date.parse(run.backgroundUpdatedAt || run.startedAt || 0);
      if (age > 45000) await processContinuation(tabId);
    })();
  }
});

chrome.runtime.onInstalled.addListener(() => { void ensureWatchdog(); });
chrome.runtime.onStartup.addListener(() => { void ensureWatchdog(); });
void ensureWatchdog();

