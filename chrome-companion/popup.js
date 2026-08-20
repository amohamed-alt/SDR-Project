const $ = (id) => document.getElementById(id);
const DEFAULT_DASHBOARD = 'https://sdr.dashboardtalentera.tech';

function setStatus(id, message, state = 'muted') {
  const node = $(id);
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
      headers: { Authorization: `Bearer ${pairingToken}` },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Pairing rejected');
    setStatus('pairStatus', 'Connected to SDR Dashboard.', 'ok');
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

  const normalize = (href) => {
    try {
      const url = new URL(href, location.origin);
      if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'linkedin.com') return '';
      url.hash = '';
      return url.toString();
    } catch { return ''; }
  };
  const normalizePublic = (href) => {
    try {
      const url = new URL(href, location.origin);
      const candidateHost = url.hostname.toLowerCase().replace(/^www\./, '');
      if (candidateHost !== 'linkedin.com' || !/^\/in\/[^/?#]+/i.test(url.pathname)) return '';
      url.protocol = 'https:';
      url.hostname = 'www.linkedin.com';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch { return ''; }
  };
  const publicFromMarkup = (markup) => {
    if (!markup) return '';
    const variants = [
      String(markup),
      String(markup).replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&'),
    ];
    for (const value of variants) {
      const absolute = value.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+/i)?.[0];
      if (absolute) {
        const normalized = normalizePublic(absolute);
        if (normalized) return normalized;
      }
      const relative = value.match(/\/in\/[A-Za-z0-9_%.-]+/i)?.[0];
      if (relative) {
        const normalized = normalizePublic(relative);
        if (normalized) return normalized;
      }
    }
    return '';
  };
  const selectors = [
    'a[href*="/sales/lead/"]',
    'a[href*="/in/"]',
    'a[data-control-name*="lead"]',
    'a[data-control-name*="profile"]',
  ].join(',');
  const found = new Map();

  const scan = () => {
    const anchors = [...document.querySelectorAll(selectors)];
    for (const anchor of anchors) {
      const href = normalize(anchor.getAttribute('href') || '');
      if (!href || (!/\/sales\/lead\//i.test(href) && !/\/in\//i.test(href))) continue;
      const card = anchor.closest('[data-x-search-result]')
        || anchor.closest('[role="listitem"]')
        || anchor.closest('li')
        || anchor.closest('[class*="search-results__result-item"]')
        || anchor.closest('[class*="result-list"]')
        || anchor.parentElement?.parentElement
        || anchor.parentElement;
      if (!card) continue;

      const rawText = String(card.innerText || '').replace(/\n{3,}/g, '\n').trim();
      if (!rawText || rawText.length > 8000) continue;
      const cardAnchors = [...card.querySelectorAll('a')];
      const salesAnchor = cardAnchors.find((node) => /\/sales\/lead\//i.test(String(node.getAttribute('href') || '')));
      const publicAnchor = cardAnchors.find((node) => /\/in\//i.test(String(node.getAttribute('href') || '')));
      const salesLeadUrl = salesAnchor ? normalize(salesAnchor.getAttribute('href') || '') : (/\/sales\/lead\//i.test(href) ? href : '');
      const linkedinUrl = publicAnchor
        ? normalizePublic(publicAnchor.getAttribute('href') || '')
        : (/\/in\//i.test(href) ? normalizePublic(href) : publicFromMarkup(card.outerHTML));
      const key = salesLeadUrl || linkedinUrl;
      if (!key || found.has(key)) continue;

      const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
      const candidateAnchors = cardAnchors.filter((node) => /\/sales\/lead\/|\/in\//i.test(String(node.getAttribute('href') || '')));
      const nameAnchor = candidateAnchors.find((node) => {
        const text = String(node.innerText || node.getAttribute('aria-label') || '').trim();
        return text.length >= 2 && text.length <= 160 && !/^(view|save|message|connect|more)$/i.test(text);
      }) || anchor;
      let name = String(nameAnchor.innerText || nameAnchor.getAttribute('aria-label') || '').replace(/^view\s+/i, '').trim();
      if (!name) name = lines[0] || '';
      if (!name || name.length > 180 || /^(view|save|message|connect|more)$/i.test(name)) continue;

      const connectionDegree = rawText.match(/\b(1st|2nd|3rd)\b/i)?.[1] || '';
      const locationLine = lines.find((line) => /Saudi|Riyadh|Jeddah|Dammam|Khobar|United Arab Emirates|Dubai|Abu Dhabi|Sharjah|Qatar|Doha|Bahrain|Oman|Muscat|Kuwait|Jordan|Egypt|Cairo/i.test(line)) || '';
      const ignored = /(?:\b(?:1st|2nd|3rd)\b.*degree connection|linkedin premium member|^save$|^message$|^connect$|^view profile$|^more$|shared connections?|recently posted)/i;
      const secondary = lines.filter((line) => line !== name && line !== locationLine && !ignored.test(line) && line.length < 240);
      const likelyTitle = secondary[0] || '';
      let likelyCompany = secondary[1] || '';
      if (/degree connection|premium member|^[·•\s-]*(?:1st|2nd|3rd)\b/i.test(likelyCompany)) likelyCompany = '';

      found.set(key, {
        name,
        title: likelyTitle,
        company: likelyCompany,
        location: locationLine,
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

  for (let step = 0; step < 8 && found.size < 25; step += 1) {
    scan();
    const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const top = Math.min(maxTop, Math.round(maxTop * (step + 1) / 8));
    if (typeof target.scrollTo === 'function') target.scrollTo({ top, behavior: 'auto' });
    else window.scrollTo(0, top);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  scan();
  if (typeof target.scrollTo === 'function') target.scrollTo({ top: originalTop, behavior: 'auto' });

  return { ok: true, sourceUrl, leads: [...found.values()].slice(0, 25) };
}

async function resolvePublicLinkedInFromSalesLeadPages(salesLeadUrls) {
  const normalizePublic = (href) => {
    try {
      const url = new URL(href, location.origin);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'linkedin.com' || !/^\/in\/[^/?#]+/i.test(url.pathname)) return '';
      url.protocol = 'https:';
      url.hostname = 'www.linkedin.com';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch { return ''; }
  };
  const fromText = (text) => {
    if (!text) return '';
    const variants = [
      String(text),
      String(text).replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&'),
    ];
    for (const value of variants) {
      const absolute = value.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+/i)?.[0];
      if (absolute) {
        const normalized = normalizePublic(absolute);
        if (normalized) return normalized;
      }
      const relative = value.match(/\/in\/[A-Za-z0-9_%.-]+/i)?.[0];
      if (relative) {
        const normalized = normalizePublic(relative);
        if (normalized) return normalized;
      }
    }
    return '';
  };
  const result = {};
  for (const salesLeadUrl of salesLeadUrls.slice(0, 50)) {
    try {
      const url = new URL(salesLeadUrl, location.origin);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'linkedin.com' || !/^\/sales\/lead\//i.test(url.pathname)) continue;
      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
      });
      if (!response.ok) continue;
      const html = await response.text();
      let profile = fromText(html);
      if (!profile) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const anchor = doc.querySelector('a[href*="linkedin.com/in/"],a[href^="/in/"]');
        profile = normalizePublic(anchor?.getAttribute('href') || '');
      }
      if (profile) result[salesLeadUrl] = profile;
    } catch {
      // Keep this lead unresolved; the caller will skip it rather than guessing.
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  return result;
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

async function resolveMissingProfileUrls(tabId, leads) {
  const missing = leads.filter((lead) => !lead.linkedinUrl && lead.salesLeadUrl).map((lead) => lead.salesLeadUrl);
  if (!missing.length) return leads;
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: resolvePublicLinkedInFromSalesLeadPages,
    args: [missing],
  });
  const mapping = result?.[0]?.result || {};
  return leads.map((lead) => ({
    ...lead,
    linkedinUrl: lead.linkedinUrl || mapping[lead.salesLeadUrl] || '',
  }));
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
    },
    body: JSON.stringify({ action: 'import', sourceUrl, pagesRead, leads }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Dashboard returned HTTP ${response.status}`);
  return payload;
}

async function run(twoPages) {
  $('extract25').disabled = true;
  $('extract50').disabled = true;
  setStatus('runStatus', 'Reading Sales Navigator…');
  try {
    const tab = await activeTab();
    const first = await extractPage(tab.id);
    if (!first.ok) throw new Error(first.error || 'Could not read Sales Navigator.');
    let leads = first.leads || [];
    let pagesRead = 1;

    if (twoPages && leads.length < 50) {
      setStatus('runStatus', `Page 1: ${leads.length}. Opening page 2…`);
      const moved = await clickPager(tab.id, 'next');
      if (moved) {
        await new Promise((resolve) => setTimeout(resolve, 2400));
        const second = await extractPage(tab.id);
        if (second.ok) {
          leads = dedupe([...leads, ...(second.leads || [])]);
          pagesRead = 2;
        }
        await clickPager(tab.id, 'previous').catch(() => false);
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }

    leads = dedupe(leads);
    if (!leads.length) throw new Error('No Sales Navigator lead cards were found on the current results page.');
    let clean = leads.filter((lead) => String(lead.connectionDegree || '').toLowerCase() !== '1st');
    if (!clean.length) throw new Error('All extracted people are 1st-degree connections, so nothing was imported.');

    const alreadyResolved = clean.filter((lead) => Boolean(lead.linkedinUrl)).length;
    const missingProfiles = clean.length - alreadyResolved;
    if (missingProfiles > 0) {
      setStatus('runStatus', `Resolving ${missingProfiles} public LinkedIn profile URL${missingProfiles === 1 ? '' : 's'} inside your current Chrome session…`);
      clean = await resolveMissingProfileUrls(tab.id, clean);
    }

    const directProfiles = clean.filter((lead) => Boolean(lead.linkedinUrl));
    const unresolved = clean.length - directProfiles.length;
    if (!directProfiles.length) {
      throw new Error('Sales Nav leads were found, but no public LinkedIn /in/ profile URLs could be resolved. Refresh the Sales Nav results and try again.');
    }

    setStatus('runStatus', `Importing ${directProfiles.length} leads with direct LinkedIn profile URLs${unresolved ? ` · ${unresolved} unresolved skipped` : ''}…`);
    const payload = await importBatch(directProfiles, first.sourceUrl, pagesRead);
    setStatus('runStatus', `Done · ${payload.imported} direct LinkedIn profiles sent${unresolved ? ` · ${unresolved} skipped safely` : ''}. Open the SDR Dashboard to watch enrichment.`, 'ok');
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
