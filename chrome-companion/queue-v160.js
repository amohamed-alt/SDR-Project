// Persistent URL-only reader. No HubSpot requests, paid reveals or CRM writes.
importScripts('profile-dom.js');
(() => {
  const KEY = 'salesNavWorkQueueV160', PROGRESS = 'salesNavReaderProgressV1', ALARM = 'salesnav-work-queue-v160';
  const API = 'https://sdr.dashboardtalentera.tech/api/prospecting/salesnav/companion';
  let busy = false, starting = false, stopRequested = false;
  globalThis.isCapturedProfileReaderBusy = () => busy || starting;
  const persist = queue => chrome.storage.local.set({ [KEY]: { ...queue, updatedAt: new Date().toISOString() } });
  const nameKey = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const identity = lead => new URL(lead.salesLeadUrl).pathname.split(',')[0];
  async function sync(lead, runId) {
    const { pairingToken } = await chrome.storage.local.get(['pairingToken']);
    if (!pairingToken) throw new Error('Save a pairing token first.');
    const response = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${pairingToken}`, 'Content-Type': 'application/json', 'X-Companion-Version': chrome.runtime.getManifest().version }, body: JSON.stringify({ action: 'profile_sync', runId, lead }), signal: AbortSignal.timeout(20000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.profileSynced) throw new Error(payload.error || 'URL was read but could not be saved to its capture.');
  }
  async function profile(lead, phase) {
    const allowed = await chrome.permissions.contains({ origins: ['https://www.linkedin.com/sales/*'] });
    if (!allowed) throw new Error('Enable Sales Nav reading in extension settings, then retry from the dashboard.');
    const url = new URL(lead.salesLeadUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.linkedin.com' || url.port || url.username || url.password || !/^\/sales\/lead\//.test(url.pathname)) throw new Error('Invalid Sales Navigator profile link.');
    const tab = await chrome.tabs.create({ url: url.href, active: false });
    try {
      let result;
      // Start reading as soon as the rendered profile is usable. Waiting for
      // every background resource to report "complete" made each lead much
      // slower than the old collector.
      for (let attempt = 0; attempt < 30; attempt++) {
        const current = await chrome.tabs.get(tab.id);
        if (/\/(login|checkpoint|authwall)(?:\/|\?|$)/.test(current.url || '')) throw new Error('LinkedIn sign-in or verification is required.');
        if (current.status === 'complete' || attempt >= 3) {
          const values = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readVisibleLinkedInProfile, args: [lead] });
          result = values?.[0]?.result;
          if (result?.ok || /sign-in|verification|unusual traffic/i.test(result?.error || '')) break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      await phase('reading profile menu');
      if (!result?.ok) throw new Error(result?.error || 'Profile did not finish loading. Retry from the dashboard.');
      if (nameKey(result.lead.name) !== nameKey(lead.name)) throw new Error('Profile name differs from the captured person. Review before retrying.');
      // Preserve capture identity; do not replace it with navigation tracking parameters.
      return { ...lead, ...result.lead, salesLeadUrl: lead.salesLeadUrl, location: result.lead.location || lead.location };
    } finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
  }
  async function step() {
    if (busy) return;
    busy = true;
    try {
      let queue = (await chrome.storage.local.get([KEY]))[KEY];
      if (!queue?.pending?.length || queue.paused || queue.action !== 'read') return;
      // Drain continuously. Timers/alarms are recovery paths, rather than a
      // lifecycle boundary between every person in a suspended MV3 worker.
      while (queue.pending.length && !queue.paused) {
      const key = queue.pending[0], row = queue.rows.find(item => item.key === key);
      if (!row) { queue.pending.shift(); await persist(queue); continue; }
      const startedAt = new Date().toISOString();
      const phase = value => chrome.storage.local.set({ [PROGRESS]: { runId: queue.captureRunId, name: row.lead.name, phase: value, startedAt, phaseStartedAt: new Date().toISOString() } });
      row.status = 'reading'; row.error = ''; await persist(queue);
      await phase('loading profile');
      try { row.lead = await profile(row.lead, phase); await phase('saving URL'); await sync(row.lead, queue.captureRunId); row.status = 'synced'; }
      catch (error) { row.status = 'error'; row.error = error instanceof Error ? error.message : 'Profile read failed.'; if (/sign-in|verification|unusual traffic|pairing token|enable Sales Nav/i.test(row.error)) queue.paused = true; }
      queue.pending.shift(); queue.done = (queue.done || 0) + 1;
      if (stopRequested || (await chrome.storage.local.get([KEY]))[KEY]?.paused) queue.paused = true;
      await persist(queue);
      await phase(queue.paused ? 'paused' : queue.pending.length ? 'next profile' : 'finished');
      if (queue.pending.length && !queue.paused) await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!queue.pending.length && !queue.paused && queue.finalizeCapture && typeof globalThis.finalizeSalesNavCapture === 'function') {
        const failed = queue.rows.filter(row => row.status === 'error').length;
        await globalThis.finalizeSalesNavCapture(queue.captureRunId, { attempted: queue.done || 0, failed });
        queue.finalizeCapture = false;
        await persist(queue);
      }
    } finally {
      busy = false;
      const queue = (await chrome.storage.local.get([KEY]))[KEY];
      if (queue?.action === 'read' && queue.pending?.length && !queue.paused) chrome.alarms.create(ALARM, { when: Date.now() + 1000 });
    }
  }
  globalThis.startCapturedProfileChecks = async (leads, sourceUrl, captureRunId, { afterCapture = false } = {}) => {
    if (starting || busy) throw new Error('URL reading is already running. Stop or wait before starting another run.');
    starting = true; stopRequested = false;
    try {
    const capture = (await chrome.storage.local.get(['salesNavFullRunV1'])).salesNavFullRunV1;
    const finishingSameCapture = afterCapture && capture?.complete && capture.runId === captureRunId;
    if ((!finishingSameCapture && globalThis.isSalesNavCaptureBusy?.()) || (capture && !capture.complete && !capture.paused)) throw new Error('Search capture is running. Stop it before reading profile URLs.');
    const previous = (await chrome.storage.local.get([KEY]))[KEY];
    if (previous?.pending?.length && !previous.paused && previous.action === 'read') throw new Error('URL reading is already running. Stop or wait before starting another run.');
    const rows = [...new Map(leads.filter(lead => lead.connectionDegree !== '1st').map(lead => [identity(lead), lead])).entries()].slice(0,2500).map(([key, lead]) => ({ key, lead, status: 'pending' }));
    const queue = { sourceUrl, captureRunId, rows, action: 'read', pending: rows.map(row => row.key), done: 0, total: rows.length, paused: stopRequested, finalizeCapture: afterCapture };
    await persist(queue); chrome.alarms.create(ALARM, { when: Date.now() + 1000 }); setTimeout(() => void step(), 100);
    if (!queue.pending.length && afterCapture && typeof globalThis.finalizeSalesNavCapture === 'function') await globalThis.finalizeSalesNavCapture(captureRunId, { attempted: 0, failed: 0 });
    return queue;
    } finally { starting = false; }
  };
  globalThis.stopCapturedProfileChecks = async () => { stopRequested = true; const queue = (await chrome.storage.local.get([KEY]))[KEY]; if (queue) await persist({ ...queue, paused: true }); await chrome.alarms.clear(ALARM); };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!String(message?.type || '').startsWith('work_queue_')) return false;
    respond({ ok: false, error: 'All work has moved to the dashboard. Update the collector and open the prospecting dashboard.' });
    return false;
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) void step();
    if (alarm.name === `${ALARM}-watchdog`) void (async () => { const value = (await chrome.storage.local.get([KEY]))[KEY]; if (value?.action === 'read' && value.pending?.length && !value.paused && Date.now() - Date.parse(value.updatedAt || 0) > 45000) await step(); })();
  });
  // An old queue mixed CRM checks with reading; do not silently restart it after update.
  void (async () => { const old = (await chrome.storage.local.get([KEY]))[KEY]; if (old && old.action !== 'read') await persist({ ...old, paused: true }); })();
  void chrome.alarms.create(`${ALARM}-watchdog`, { periodInMinutes: 1 });
})();
