// A narrow same-origin bridge. The page cannot request reveals, CRM writes or arbitrary URLs.
(() => {
  const ORIGIN = 'https://sdr.dashboardtalentera.tech';
  const allowed = new Set(['status', 'capture', 'read', 'stop']);
  if (location.origin !== ORIGIN) return;
  window.addEventListener('message', async event => {
    const input = event.data;
    if (event.source !== window || event.origin !== ORIGIN || input?.channel !== 'talentera-collector-request' || !allowed.has(input.action) || typeof input.id !== 'string' || input.id.length > 100) return;
    const body = { type: 'dashboard_collector', action: input.action, runId: input.runId, tabId: input.tabId };
    let result;
    try { result = await chrome.runtime.sendMessage(body); }
    catch { result = { ok: false, error: 'Collector connection lost. Reload this dashboard after reloading the extension.' }; }
    window.postMessage({ channel: 'talentera-collector-response', id: input.id, result }, ORIGIN);
  });
})();
