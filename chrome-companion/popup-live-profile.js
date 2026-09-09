// Live single-profile lookup: works on one LinkedIn profile page at a time,
// using the exact same server-side resolve/push endpoints the batch flow
// already relies on. Deliberately does not scrape the LinkedIn page DOM —
// only reads the tab's URL — to avoid depending on LinkedIn's markup, which
// changes without notice and can't be verified outside a live browser.

function profileUrlFromTab(url) {
  try {
    const parsed = new URL(String(url || ''));
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'linkedin.com') return '';
    if (/^\/in\/[^/]+\/?$/i.test(parsed.pathname)) return parsed.href;
    if (/^\/sales\/lead\//i.test(parsed.pathname)) return parsed.href;
    return '';
  } catch {
    return '';
  }
}

function setLiveStatus(message, state = 'muted') {
  const node = document.getElementById('liveProfileStatus');
  if (!node) return;
  node.textContent = message;
  node.className = `status ${state}`;
}

function setBadge(id, label, state) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = label;
  node.className = `badge ${state}`;
}

async function liveSettings() {
  const stored = await chrome.storage.local.get(['dashboardUrl']);
  const raw = String(stored.dashboardUrl || 'https://sdr.dashboardtalentera.tech').trim();
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://sdr.dashboardtalentera.tech';
  }
}

let currentProfileUrl = '';
let currentProspect = null;

async function initLiveProfile() {
  const card = document.getElementById('liveProfileCard');
  const enrichButton = document.getElementById('enrichProfile');
  const pushButton = document.getElementById('pushProfile');
  const resultBox = document.getElementById('liveProfileResult');
  if (!card || !enrichButton || !pushButton || !resultBox) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentProfileUrl = profileUrlFromTab(tab?.url);
  if (!currentProfileUrl) return; // Not a single profile page — leave the card hidden.

  card.hidden = false;
  setLiveStatus('Ready to check this profile', 'muted');

  enrichButton.addEventListener('click', async () => {
    enrichButton.disabled = true;
    resultBox.hidden = true;
    setLiveStatus('Checking HubSpot and hiring status…', 'muted');
    try {
      const dashboardUrl = await liveSettings();
      const response = await fetch(`${dashboardUrl}/api/prospecting/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedinUrl: currentProfileUrl, source: 'Chrome Companion — Live Profile' }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.prospect) {
        throw new Error(payload.error || 'Could not resolve this profile.');
      }
      currentProspect = payload.prospect;
      document.getElementById('liveProfileName').textContent =
        [currentProspect.fullName, currentProspect.title, currentProspect.company].filter(Boolean).join(' · ') || 'Profile resolved';
      setBadge(
        'liveProfileHubspot',
        currentProspect.hubspot?.inHubSpot ? 'In HubSpot' : 'Not in HubSpot',
        currentProspect.hubspot?.inHubSpot ? 'ok' : 'muted',
      );
      const hiringStatus = currentProspect.hiring?.status || 'Unknown';
      setBadge('liveProfileHiring', hiringStatus, hiringStatus === 'Hiring Now' ? 'ok' : 'muted');
      resultBox.hidden = false;
      pushButton.disabled = false;
      pushButton.textContent = 'Push to Marita';
      setLiveStatus('Profile resolved', 'ok');
    } catch (error) {
      setLiveStatus(error instanceof Error ? error.message : 'Could not resolve this profile.', 'bad');
    } finally {
      enrichButton.disabled = false;
    }
  });

  pushButton.addEventListener('click', async () => {
    if (!currentProspect) return;
    pushButton.disabled = true;
    pushButton.textContent = 'Pushing…';
    try {
      const dashboardUrl = await liveSettings();
      const response = await fetch(`${dashboardUrl}/api/prospecting/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentProspect),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'HubSpot push failed.');
      pushButton.textContent = payload.duplicate ? 'Already queued' : 'Pushed ✓';
      setLiveStatus(payload.duplicate ? 'Already queued for Marita' : 'Task created for Marita', 'ok');
    } catch (error) {
      pushButton.disabled = false;
      pushButton.textContent = 'Push to Marita';
      setLiveStatus(error instanceof Error ? error.message : 'HubSpot push failed.', 'bad');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => { void initLiveProfile(); });
