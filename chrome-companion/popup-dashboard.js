document.addEventListener('DOMContentLoaded', async () => {
  const el = id => document.getElementById(id);
  el('versionStatus').textContent = `Collector v${chrome.runtime.getManifest().version}`;
  const saved = await chrome.storage.local.get(['pairingToken']); el('token').value = saved.pairingToken || '';
  async function permission() { el('permissionStatus').textContent = await chrome.permissions.contains({ origins: ['https://www.linkedin.com/sales/*'] }) ? 'Sales Nav access enabled. Continue in the dashboard.' : 'Enable access once to read profiles from the dashboard.'; }
  await permission();
  el('allowLinkedIn').addEventListener('click', async () => { await chrome.permissions.request({ origins: ['https://www.linkedin.com/sales/*'] }); await permission(); });
  el('save').addEventListener('click', async () => { await chrome.storage.local.set({ pairingToken: el('token').value.trim() }); el('pairStatus').textContent = 'Pairing saved.'; });
  el('ping').addEventListener('click', async () => {
    try { const token = el('token').value.trim(); const response = await fetch('https://sdr.dashboardtalentera.tech/api/prospecting/salesnav/companion', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error('Pairing failed. Check the token.'); el('pairStatus').textContent = 'Server pairing verified. Worker progress is shown in the dashboard.'; }
    catch (error) { el('pairStatus').textContent = error.message || 'Connection failed'; }
  });
});
