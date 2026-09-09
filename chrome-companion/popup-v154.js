(() => {
  const FULL_RUN_KEY = 'salesNavFullRunV1';

  function setFullStatus(message, kind = '') {
    const el = document.getElementById('fullRunStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok', 'bad');
    if (kind) el.classList.add(kind);
  }

  function buttonLabel(run) {
    if (run && !run.complete && run.runId) {
      return `Resume FULL search · ${Number(run.pagesRead || 0)} pages / ${Number(run.total || 0)} leads`;
    }
    return 'Capture FULL search · up to 2,500';
  }

  async function refreshFromStorage() {
    const stored = await chrome.storage.local.get([FULL_RUN_KEY]);
    const run = stored[FULL_RUN_KEY];
    const button = document.getElementById('extractFull');
    if (button) button.textContent = buttonLabel(run);
    if (!run) return;
    if (run.backgroundError) {
      setFullStatus(`${run.backgroundStatus || 'Paused'} · ${run.backgroundError}`, 'bad');
    } else if (run.complete) {
      setFullStatus(`Finished · ${Number(run.pagesRead || 0)} pages · ${Number(run.total || 0)} unique leads · ${run.stopReason || 'complete'}.`, 'ok');
    } else {
      setFullStatus(`${run.backgroundStatus || 'Capture running'} · ${Number(run.pagesRead || 0)} pages / ${Number(run.total || 0)} leads.`, 'ok');
    }
  }

  async function activeSalesNavTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id || !/^https:\/\/[^/]*linkedin\.com\/sales\/search\/people\/?/i.test(String(tab.url || ''))) {
      throw new Error('Open a Sales Navigator People Search tab first.');
    }
    return tab;
  }

  async function startSingleEngineCapture() {
    const button = document.getElementById('extractFull');
    if (button) button.disabled = true;
    setFullStatus('Handing the search to the background capture engine…');
    try {
      const tab = await activeSalesNavTab();
      const response = await chrome.runtime.sendMessage({ type: 'salesnav_v154_start', tabId: tab.id });
      if (!response?.ok) throw new Error(response?.error || 'Could not start full capture.');
      const run = response.run || {};
      setFullStatus(`Background capture armed · ${Number(run.pagesRead || 0)} pages / ${Number(run.total || 0)} leads. You can close this popup; keep the Sales Navigator tab open.`, 'ok');
      await refreshFromStorage();
    } catch (error) {
      setFullStatus(error instanceof Error ? error.message : 'Could not start full capture.', 'bad');
    } finally {
      const current = document.getElementById('extractFull');
      if (current) current.disabled = false;
    }
  }

  function replaceFullButton() {
    const oldButton = document.getElementById('extractFull');
    if (!oldButton || oldButton.dataset.singleEngine === 'true') return;
    const button = oldButton.cloneNode(true);
    button.dataset.singleEngine = 'true';
    oldButton.replaceWith(button);
    button.addEventListener('click', () => void startSingleEngineCapture());
  }

  replaceFullButton();
  void refreshFromStorage();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[FULL_RUN_KEY]) return;
    void refreshFromStorage();
  });
})();
