const SIGNALHIRE_PARSER_VERSION = 'signalhire-list-v2';

function signalHireSetStatus(message, state = 'muted') {
  const node = document.getElementById('signalHireStatus');
  if (!node) return;
  node.textContent = message;
  node.className = `status ${state}`;
}

function signalHireCleanDashboard(raw) {
  try {
    const url = new URL(String(raw || '').trim() || 'https://sdr.dashboardtalentera.tech');
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://sdr.dashboardtalentera.tech';
  }
}

async function signalHireSettings() {
  const stored = await chrome.storage.local.get(['dashboardUrl', 'pairingToken']);
  return {
    dashboardUrl: signalHireCleanDashboard(stored.dashboardUrl || 'https://sdr.dashboardtalentera.tech'),
    pairingToken: String(stored.pairingToken || '').trim(),
  };
}

function extractCurrentSignalHireList() {
  const sourceUrl = location.href;
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'signalhire.com' && !host.endsWith('.signalhire.com')) {
    return { ok: false, error: 'Open the SignalHire Lead List first.', sourceUrl, listName: '', leads: [] };
  }

  const textOf = (node) => String(node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
  const visible = (node) => {
    if (!(node instanceof Element)) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const unique = (values) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const phoneRegex = /(?:\+?\d[\d\s().-]{7,}\d)/g;
  const monthRange = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\s*[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|present|current)\b/i;
  const resumeNoise = /^(?:contact info|contact information|personal emails?|work emails?|emails?|phone numbers?|phones?|experience|employment|education|skills?|languages?|certifications?|licenses?|projects?|publications?|interests?|summary|about|show \d+ more|expert no pdf|company|lead tracker beta)$/i;

  const normalizeLinkedIn = (href) => {
    try {
      const url = new URL(String(href || ''), location.origin);
      const candidateHost = url.hostname.toLowerCase().replace(/^www\./, '');
      if ((candidateHost !== 'linkedin.com' && !candidateHost.endsWith('.linkedin.com')) || !/^\/in\/[^/?#]+/i.test(url.pathname)) return '';
      url.protocol = 'https:';
      url.hostname = 'www.linkedin.com';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch { return ''; }
  };

  const normalizeSignalHireProfile = (href) => {
    try {
      const url = new URL(String(href || ''), location.origin);
      const candidateHost = url.hostname.toLowerCase().replace(/^www\./, '');
      if (candidateHost !== 'signalhire.com' && !candidateHost.endsWith('.signalhire.com')) return '';
      const path = url.pathname.toLowerCase();
      if (/lead[-_ ]?lists?|lists?\//i.test(path)) return '';
      if (!/(?:candidate|profile|resume|people|person)/i.test(path)) return '';
      url.hash = '';
      return url.toString();
    } catch { return ''; }
  };

  const isNoise = (value) => {
    const text = String(value || '').trim();
    if (!text) return true;
    if (resumeNoise.test(text) || monthRange.test(text)) return true;
    return /^(?:lead lists?|people|companies|projects?|sequences?|search|filter|filters|reveal contacts?|add contacts?|export|delete|more|select all|actions?|credits?|inbox|settings?|show more|show less)$/i.test(text);
  };

  const looksLikeName = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3 || text.length > 120 || isNoise(text)) return false;
    if (/@|\+?\d{5,}|https?:|www\.|\.(?:com|net|org|io)\b/i.test(text)) return false;
    if (/\b(?:bachelor|master|mba|degree|university|college|school|director|manager|specialist|coordinator|executive|officer|consultant|founder|current time)\b/i.test(text) && monthRange.test(text)) return false;
    if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(text)) return false;
    const words = text.split(/\s+/).filter(Boolean);
    return words.length >= 2 && words.length <= 7;
  };

  const looksLikeLocation = (value) => /Saudi|Riyadh|Jeddah|Dammam|Khobar|United Arab Emirates|Dubai|Abu Dhabi|Sharjah|Qatar|Doha|Bahrain|Manama|Oman|Muscat|Kuwait|Jordan|Amman|Egypt|Cairo/i.test(value || '');
  const identityLinks = (container) => [...container.querySelectorAll('a[href]')]
    .map((anchor) => normalizeSignalHireProfile(anchor.getAttribute('href') || '') || normalizeLinkedIn(anchor.getAttribute('href') || ''))
    .filter(Boolean);

  const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
    .filter(visible)
    .map(textOf)
    .filter((value) => value && value.length <= 180 && !/^(?:Lead Lists?|SignalHire|People)$/i.test(value));
  const listName = headings.find((value) => /abdullah/i.test(value)) || headings[0] || 'SignalHire Lead List';
  const found = new Map();

  const parseContainer = (container) => {
    if (!(container instanceof HTMLElement) || !visible(container)) return;
    const rawMultiline = String(container.innerText || '').replace(/\n{3,}/g, '\n').trim();
    if (!rawMultiline || rawMultiline.length < 5 || rawMultiline.length > 4200) return;
    const lines = rawMultiline.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (lines.length < 2) return;

    const anchors = [...container.querySelectorAll('a[href]')];
    const linkedinUrl = anchors.map((anchor) => normalizeLinkedIn(anchor.getAttribute('href') || '')).find(Boolean) || '';
    const signalHireProfileUrl = anchors.map((anchor) => normalizeSignalHireProfile(anchor.getAttribute('href') || '')).find(Boolean) || '';

    // Hard boundary: a real lead row must expose a candidate/profile identity link.
    // This prevents experience, education and contact-detail rows in an opened profile drawer
    // from ever being interpreted as separate people.
    if (!linkedinUrl && !signalHireProfileUrl) return;
    const identities = unique(identityLinks(container));
    if (identities.length > 2) return;

    const mailtos = anchors.filter((anchor) => /^mailto:/i.test(anchor.getAttribute('href') || '')).map((anchor) => (anchor.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]);
    const tels = anchors.filter((anchor) => /^tel:/i.test(anchor.getAttribute('href') || '')).map((anchor) => (anchor.getAttribute('href') || '').replace(/^tel:/i, ''));
    const emails = unique([...mailtos, ...(rawMultiline.match(emailRegex) || [])]);
    const phones = unique([...tels, ...(rawMultiline.match(phoneRegex) || [])])
      .filter((value) => String(value).replace(/\D/g, '').length >= 8)
      .slice(0, 10);

    const structuredName = textOf(container.querySelector('[data-testid*="name" i],[class*="name" i]'));
    const profileAnchor = anchors.find((anchor) => {
      const normalized = normalizeSignalHireProfile(anchor.getAttribute('href') || '') || normalizeLinkedIn(anchor.getAttribute('href') || '');
      return Boolean(normalized) && looksLikeName(textOf(anchor));
    });
    const name = (looksLikeName(structuredName) ? structuredName : textOf(profileAnchor)) || lines.find(looksLikeName) || '';
    if (!name || resumeNoise.test(name) || monthRange.test(name)) return;

    const locationText = lines.find((line) => line !== name && looksLikeLocation(line)) || '';
    emailRegex.lastIndex = 0;
    const candidates = lines.filter((line) => {
      emailRegex.lastIndex = 0;
      return line !== name
        && line !== locationText
        && !isNoise(line)
        && !emailRegex.test(line)
        && !/^\+?[\d\s().-]{8,}$/.test(line)
        && !monthRange.test(line);
    });
    emailRegex.lastIndex = 0;

    const companyAnchor = anchors.find((anchor) => /company/i.test(String(anchor.getAttribute('href') || '')) && textOf(anchor) && textOf(anchor) !== name);
    let company = textOf(companyAnchor);
    let title = '';

    const atLine = candidates.find((line) => /\s(?:at|@)\s/i.test(line));
    if (atLine) {
      const match = atLine.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
      if (match) {
        title = match[1].trim();
        if (!company) company = match[2].trim();
      }
    }
    if (!title) title = candidates.find((line) => line !== company && line.length <= 180) || '';
    if (!company) {
      const afterTitle = candidates.findIndex((line) => line === title);
      company = candidates.slice(Math.max(0, afterTitle + 1)).find((line) => line !== title && line.length <= 180) || '';
    }

    const key = linkedinUrl || signalHireProfileUrl || emails[0] || `${name.toLowerCase()}:${company.toLowerCase()}`;
    if (!key || found.has(key)) return;
    found.set(key, {
      name,
      title,
      company,
      location: locationText,
      linkedinUrl,
      signalHireProfileUrl,
      email: emails[0] || '',
      emails: emails.slice(0, 10),
      phone: phones[0] || '',
      phones,
      rawText: rawMultiline.slice(0, 2800),
    });
  };

  const candidateContainer = (seed) => {
    const strong = seed.closest('tr,[role="row"],[role="listitem"],[data-testid*="candidate" i],[data-testid*="lead" i],[class*="candidate-card" i],[class*="candidate-row" i],[class*="lead-card" i],[class*="lead-row" i]');
    if (strong) return strong;
    let node = seed.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const text = String(node.innerText || '').trim();
      const identities = unique(identityLinks(node));
      if (text.length >= 20 && text.length <= 4200 && identities.length === 1) return node;
    }
    return null;
  };

  const scan = () => {
    const seeds = [...document.querySelectorAll('a[href]')]
      .filter(visible)
      .filter((anchor) => Boolean(normalizeSignalHireProfile(anchor.getAttribute('href') || '') || normalizeLinkedIn(anchor.getAttribute('href') || '')));
    for (const seed of seeds) {
      const container = candidateContainer(seed);
      if (container) parseContainer(container);
    }
  };

  return (async () => {
    const scrollers = [...document.querySelectorAll('main,[role="main"],section,div')]
      .filter((node) => node instanceof HTMLElement && visible(node) && node.scrollHeight > node.clientHeight + 300)
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
    const target = scrollers[0] || document.scrollingElement || document.documentElement;
    const originalTop = target.scrollTop || window.scrollY || 0;

    for (let step = 0; step < 10 && found.size < 100; step += 1) {
      scan();
      const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
      const top = Math.min(maxTop, Math.round(maxTop * (step + 1) / 10));
      if (typeof target.scrollTo === 'function') target.scrollTo({ top, behavior: 'auto' });
      else window.scrollTo(0, top);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    scan();
    if (typeof target.scrollTo === 'function') target.scrollTo({ top: originalTop, behavior: 'auto' });

    return { ok: true, sourceUrl, listName, leads: [...found.values()].slice(0, 100) };
  })();
}

async function syncSignalHireList() {
  const button = document.getElementById('extractSignalHire');
  if (button) button.disabled = true;
  signalHireSetStatus('Reading only candidate rows from the SignalHire Lead List…');
  try {
    const { dashboardUrl, pairingToken } = await signalHireSettings();
    if (!pairingToken) throw new Error('Pair the companion with the SDR Dashboard first.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab found.');

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractCurrentSignalHireList,
    });
    const extracted = await Promise.resolve(result?.[0]?.result);
    if (!extracted?.ok) throw new Error(extracted?.error || 'Could not read this SignalHire page.');
    if (!extracted.leads?.length) throw new Error('No candidate rows were found. Open the SignalHire Lead List and make sure the lead cards are visible.');

    signalHireSetStatus(`Found ${extracted.leads.length} validated candidate rows in “${extracted.listName}”. Sending them to the dashboard…`);
    const response = await fetch(`${dashboardUrl}/api/prospecting/signalhire/companion`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pairingToken}`,
        'Content-Type': 'application/json',
        'X-Companion-Version': chrome.runtime.getManifest().version,
      },
      body: JSON.stringify({
        action: 'import',
        sourceUrl: extracted.sourceUrl,
        listName: extracted.listName,
        clientVersion: chrome.runtime.getManifest().version,
        parserVersion: SIGNALHIRE_PARSER_VERSION,
        leads: extracted.leads,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Dashboard returned HTTP ${response.status}`);
    signalHireSetStatus(`Done · ${payload.imported} validated leads synced from “${payload.listName}”. Open SignalHire Queue in the dashboard.`, 'ok');
  } catch (error) {
    signalHireSetStatus(error instanceof Error ? error.message : 'SignalHire sync failed.', 'bad');
  } finally {
    if (button) button.disabled = false;
  }
}

const signalHireButton = document.getElementById('extractSignalHire');
if (signalHireButton) signalHireButton.addEventListener('click', () => void syncSignalHireList());
