// Dashboard is the only work surface. Chrome only reads rendered LinkedIn pages.
(() => {
  const ORIGIN = 'https://sdr.dashboardtalentera.tech';
  const KEY = 'salesNavWorkQueueV160';
  const API = `${ORIGIN}/api/prospecting/salesnav/companion`;
  function trusted(sender) {
    try { const url = new URL(sender.url); return url.origin === ORIGIN && /^\/(signalhire-queue|salesnav-full-run|salesnav-prospecting)\/?$/.test(url.pathname); }
    catch { return false; }
  }
  async function post(body) {
    const { pairingToken } = await chrome.storage.local.get(['pairingToken']);
    if (!pairingToken) throw new Error('Save the pairing token in extension settings first.');
    const response = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${pairingToken}`, 'Content-Type': 'application/json', 'X-Companion-Version': chrome.runtime.getManifest().version }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Collector HTTP ${response.status}`);
    return payload;
  }
  async function state() {
    const stored = await chrome.storage.local.get([KEY, 'salesNavFullRunV1']);
    const queue = stored[KEY], capture = stored.salesNavFullRunV1;
    const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/sales/search/people*'] });
    return { ok: true, version: chrome.runtime.getManifest().version,
      permission: await chrome.permissions.contains({ origins: ['https://www.linkedin.com/sales/*'] }),
      tabs: tabs.sort((a,b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)).filter(tab => /^https:\/\/www\.linkedin\.com\/sales\/search\/people(?:[/?#]|$)/.test(tab.url || '')).map(tab => ({ id: tab.id, title: tab.title || 'Sales Navigator search' })),
      capture: capture ? { runId: capture.runId, running: !capture.complete && !capture.paused && !capture.backgroundError, paused: Boolean(capture.paused), total: capture.total || 0, pages: capture.pagesRead || 0, error: capture.backgroundError || '', message: capture.backgroundStatus || '' } : null,
      queue: queue?.action === 'read' ? { runId: queue.captureRunId, running: Boolean(queue.pending?.length && !queue.paused), paused: Boolean(queue.paused), done: queue.done || 0, total: queue.total || 0, updatedAt: queue.updatedAt,
        failed: (queue.rows || []).filter(row => row.status === 'error').map(row => ({ name: row.lead.name, error: row.error || 'Profile could not be read' })) } : null };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'dashboard_collector') return false;
    if (!trusted(sender)) { respond({ ok: false, error: 'Collector commands are only accepted from the dashboard.' }); return false; }
    void (async () => {
      try {
        if (message.action === 'capture') {
          if (!(await chrome.permissions.contains({ origins: ['https://www.linkedin.com/sales/*'] }))) throw new Error('Enable Sales Nav reading in extension settings once, then return to the dashboard.');
          const available = await state();
          if (!available.tabs.some(tab => tab.id === message.tabId)) throw new Error('Choose an open Sales Navigator People Search tab.');
          await startOrResume(message.tabId);
        } else if (message.action === 'read') {
          if (!(await chrome.permissions.contains({ origins: ['https://www.linkedin.com/sales/*'] }))) throw new Error('Enable Sales Nav reading in extension settings once, then return to the dashboard.');
          if (typeof message.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(message.runId)) throw new Error('Choose a saved capture first.');
          // Server supplies the saved leads. Never open a URL supplied by page script.
          const payload = await post({ action: 'profile_read_run', runId: message.runId });
          if (!payload.leads?.length) throw new Error('No missing public URLs in this capture.');
          await globalThis.startCapturedProfileChecks(payload.leads, payload.sourceUrl, message.runId, true);
        } else if (message.action === 'stop') {
          await globalThis.stopCapturedProfileChecks();
          const saved = await chrome.storage.local.get(['salesNavFullRunV1']);
          if (saved.salesNavFullRunV1 && !saved.salesNavFullRunV1.complete) {
            await chrome.storage.local.set({ salesNavFullRunV1: { ...saved.salesNavFullRunV1, paused: true, backgroundStatus: 'Paused from dashboard' } });
            await chrome.alarms.clear('salesnav-full-run-v154-continue');
          }
        } else if (message.action !== 'status') throw new Error('Unsupported collector command.');
        respond(await state());
      } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : 'Collector operation failed.' }); }
    })();
    return true;
  });
})();
