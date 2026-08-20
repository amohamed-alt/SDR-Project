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

function extractCurrentSalesNavPage() {
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
  const selectors = [
    'a[href*="/sales/lead/"]',
    'a[href*="/in/"]',
    'a[data-control-name*="lead"]',
    'a[data-control-name*="profile"]',
  ].join(',');
  const anchors = [...document.querySelectorAll(selectors)];
  const seen = new Set();
  const leads = [];

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
    const linkedinUrl = publicAnchor ? normalize(publicAnchor.getAttribute('href') || '').replace(/[?#].*$/, '') : (/\/in\//i.test(href) ? href.replace(/[?#].*$/, '') : '');
    const key = salesLeadUrl || linkedinUrl;
    if (!key || seen.has(key)) continue;

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
    const ignored = /^(1st|2nd|3rd|save|message|connect|view profile|more|shared connections?|recently posted)$/i;
    const secondary = lines.filter((line) => line !== name && !ignored.test(line) && line.length < 240);

    leads.push({
      name,
      title: secondary[0] || '',
      company: secondary[1] || '',
      location: locationLine,
      connectionDegree,
      salesLeadUrl,
      linkedinUrl,
      rawText: rawText.slice(0, 2200),
    });
    seen.add(key);
    if (leads.length >= 25) break;
  }

  return { ok: true, sourceUrl, leads };
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
        await new Promise((resolve) => setTimeout(resolve, 2200));
        const second = await extractPage(tab.id);
        if (second.ok) {
          leads = dedupe([...leads, ...(second.leads || [])]);
          pagesRead = 2;
        }
        await clickPager(tab.id, 'previous').catch(() => false);
      }
    }

    leads = dedupe(leads);
    if (!leads.length) throw new Error('No Sales Navigator lead cards were found on the current results page.');
    const clean = leads.filter((lead) => String(lead.connectionDegree || '').toLowerCase() !== '1st');
    if (!clean.length) throw new Error('All extracted people are 1st-degree connections, so nothing was imported.');

    setStatus('runStatus', `Importing ${clean.length} clean leads to the SDR Dashboard…`);
    const payload = await importBatch(clean, first.sourceUrl, pagesRead);
    setStatus('runStatus', `Done · ${payload.imported} leads sent. Open the SDR Dashboard to watch enrichment.`, 'ok');
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
