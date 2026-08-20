const $ = (id) => document.getElementById(id);
const DEFAULT_DASHBOARD = 'https://sdr.dashboardtalentera.tech';
const CLIENT_VERSION = chrome.runtime.getManifest().version;
const PARSER_VERSION = 'card-v2';

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

async function loadSettings() {
  const stored = await chrome.storage.local.get(['dashboardUrl', 'pairingToken']);
  $('dashboard').value = cleanDashboard(stored.dashboardUrl || DEFAULT_DASHBOARD);
  $('token').value = stored.pairingToken || '';
  setStatus('versionStatus', `Companion v${CLIENT_VERSION} · parser ${PARSER_VERSION}`);
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
  const label = direction === 'next' ? /next/i : /previous|prev/i;
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

function dedupe(leads) {
  const map = new Map();
  for (const lead of leads) {
    const key = lead.salesLeadUrl || lead.linkedinUrl || `${lead.name}:${lead.company}`;
    if (!map.has(key)) map.set(key, lead);
  }
  return [...map.values()].slice(0, 50);
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

async function run(twoPages) {
  $('extract25').disabled = true;
  $('extract50').disabled = true;
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
        await new Promise((resolve) => setTimeout(resolve, 2200));
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
    setStatus('runStatus', `Done · ${payload.imported} sent · v${CLIENT_VERSION}. Dashboard will resolve missing profile URLs through SignalHire, not extra LinkedIn requests.`, 'ok');
  } catch (error) {
    setStatus('runStatus', error instanceof Error ? error.message : 'Extraction failed.', 'bad');
  } finally {
    $('extract25').disabled = false;
    $('extract50').disabled = false;
  }
}

$('save').addEventListener('click', () => void saveSettings());
$('ping').addEventListener('click', () => void ping());
$('extract25').addEventListener('click', () => void run(false));
$('extract50').addEventListener('click', () => void run(true));
void loadSettings();
