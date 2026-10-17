document.addEventListener('DOMContentLoaded', async () => {
  const el = id => document.getElementById(id);
  const buttons = ['capture25','capture50','captureFull'].map(el);
  const setStatus = (text, kind = 'muted') => { el('captureStatus').textContent = text; el('captureStatus').className = `status ${kind}`; };
  el('versionStatus').textContent = `Collector v${chrome.runtime.getManifest().version}`;
  const saved = await chrome.storage.local.get(['pairingToken']); el('token').value = saved.pairingToken || '';

  async function hasPermission() { return chrome.permissions.contains({ origins: ['https://www.linkedin.com/sales/*'] }); }
  async function activeSalesNavTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/www\.linkedin\.com\/sales\/search\/people\/?/i.test(tab.url || '')) throw new Error('Open the Sales Navigator People Search you want to capture first.');
    return tab;
  }
  async function render() {
    const data = await chrome.storage.local.get(['salesNavFullRunV1','salesNavWorkQueueV160','salesNavReaderProgressV1']);
    const run = data.salesNavFullRunV1, queue = data.salesNavWorkQueueV160, progress = data.salesNavReaderProgressV1;
    const capturing = Boolean(run && !run.complete && !run.cardsComplete && !run.paused);
    const reading = Boolean(queue?.action === 'read' && queue.pending?.length && !queue.paused);
    buttons.forEach(button => { button.disabled = capturing || reading; });
    el('stop').disabled = !capturing && !reading;
    if (reading) {
      setStatus(`Reading profile URLs ${queue.done || 0}/${queue.total || 0}. Keep Chrome open.`, 'working');
      el('profileStatus').textContent = progress?.name ? `${progress.name} · ${progress.phase}` : '';
    } else if (capturing) {
      setStatus(`Capturing ${run.pagesRead || 0} page${run.pagesRead === 1 ? '' : 's'} · ${run.total || 0} people.`, 'working');
      el('profileStatus').textContent = run.backgroundStatus || '';
    } else if (run?.complete) {
      const failed = (queue?.rows || []).filter(row => row.status === 'error').length;
      setStatus(failed ? `Dashboard ready · ${failed} profile URL${failed === 1 ? '' : 's'} need retry.` : `Dashboard ready · ${run.total || 0} people with profile reading completed.`, failed ? 'bad' : 'ok');
      el('profileStatus').textContent = run.backgroundStatus || '';
    } else if (run?.paused) {
      setStatus(run.backgroundError || 'Capture paused. Start the same size to resume.', 'bad');
    }
  }
  async function start(maxPages, maxLeads) {
    try {
      if (!el('token').value.trim()) throw new Error('Save the dashboard pairing token first.');
      if (!await hasPermission()) {
        const granted = await chrome.permissions.request({ origins: ['https://www.linkedin.com/sales/*'] });
        if (!granted) throw new Error('Sales Nav reading permission is required.');
      }
      const tab = await activeSalesNavTab();
      buttons.forEach(button => { button.disabled = true; });
      setStatus('Starting capture…', 'working');
      const result = await chrome.runtime.sendMessage({ type: 'salesnav_v154_start', tabId: tab.id, readProfilesOnComplete: true, maxPages, maxLeads });
      if (!result?.ok) throw new Error(result?.error || 'Capture could not start.');
      await render();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Capture failed.', 'bad'); buttons.forEach(button => { button.disabled = false; }); }
  }
  el('capture25').addEventListener('click', () => void start(1,25));
  el('capture50').addEventListener('click', () => void start(2,50));
  el('captureFull').addEventListener('click', () => void start(100,2500));
  el('stop').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'salesnav_collector_stop' }); await render(); });
  el('allowLinkedIn').addEventListener('click', async () => { const granted = await chrome.permissions.request({ origins: ['https://www.linkedin.com/sales/*'] }); el('pairStatus').textContent = granted ? 'Sales Nav reading enabled.' : 'Permission was not enabled.'; });
  el('save').addEventListener('click', async () => { await chrome.storage.local.set({ pairingToken: el('token').value.trim() }); el('pairStatus').textContent = 'Pairing saved.'; });
  el('ping').addEventListener('click', async () => {
    try { const token = el('token').value.trim(); const response = await fetch('https://sdr.dashboardtalentera.tech/api/prospecting/salesnav/companion', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || 'Pairing failed.'); el('pairStatus').textContent = 'Connected to the dashboard.'; }
    catch (error) { el('pairStatus').textContent = error instanceof Error ? error.message : 'Connection failed.'; }
  });
  await render(); window.setInterval(() => void render(), 1000);
});
