// Persistent, user-triggered queue actions. Never starts reveal or push on capture.
importScripts('profile-dom.js');
(() => {
  const KEY = 'salesNavWorkQueueV160', ALARM = 'salesnav-work-queue-v160';
  const API = 'https://sdr.dashboardtalentera.tech/api/prospecting/salesnav/companion';
  let busy = false;
  const identity = (lead) => {
    try { const url = new URL(lead.salesLeadUrl || lead.linkedinUrl); return url.pathname.split(',')[0]; }
    catch { return `${lead.name}:${lead.company}`; }
  };
  const persist = (queue) => chrome.storage.local.set({ [KEY]: { ...queue, updatedAt: new Date().toISOString() } });
  async function api(body) {
    const { pairingToken } = await chrome.storage.local.get(['pairingToken']);
    if (!pairingToken) throw new Error('Save a pairing token first.');
    const response = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${pairingToken}`, 'Content-Type': 'application/json', 'X-Companion-Version': chrome.runtime.getManifest().version }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Server returned ${response.status}`);
    return payload;
  }
  async function profile(lead) {
    if (lead.linkedinUrl && lead.title && !/in role|in company/.test(lead.title)) return lead;
    const allowed = await chrome.permissions.contains({ origins: ['https://www.linkedin.com/sales/*'] });
    if (!allowed) throw new Error('Allow LinkedIn profile reading from the extension first.');
    const url = new URL(lead.salesLeadUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.linkedin.com' || !/^\/sales\/lead\//.test(url.pathname)) throw new Error('Invalid Sales Navigator profile link.');
    // Ordinary temporary tab, no hidden fetches or session/cookie reads.
    const tab = await chrome.tabs.create({ url: url.href, active: false });
    try {
      for (let attempt = 0; attempt < 45; attempt++) {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === 'complete') break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['profile-dom.js'] });
      let result;
      for (let attempt = 0; attempt < 5; attempt++) {
        const values = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readVisibleLinkedInProfile });
        result = values?.[0]?.result;
        if (result?.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      if (!result?.ok) throw new Error(result?.error || 'Could not read this profile.');
      if (result.lead.name.normalize('NFKC').trim().toLowerCase() !== lead.name.normalize('NFKC').trim().toLowerCase()) throw new Error('Opened profile identity differs from the search card.');
      return { ...lead, ...result.lead, location: result.lead.location || lead.location };
    } finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
  }
  globalThis.startCapturedProfileChecks = async (leads, sourceUrl) => {
    const stored = (await chrome.storage.local.get([KEY]))[KEY];
    if (busy || stored?.pending?.length) throw new Error('Wait for the current profile checks to finish before starting another capture.');
    const rows = dedupe(leads.filter(lead => lead.connectionDegree !== '1st'), 2500).map(lead => ({ key: identity(lead), lead, status: 'pending' }));
    const queue = { sourceUrl, rows, action: 'check', pending: rows.map(row => row.key), done: 0, total: rows.length, paused: false };
    await persist(queue);
    chrome.alarms.create(ALARM, { when: Date.now() + 1000 }); setTimeout(() => void step(), 100);
    return queue;
  };
  globalThis.ensureCapturedProfileQueueIdle = async () => {
    const stored = (await chrome.storage.local.get([KEY]))[KEY];
    if (busy || stored?.pending?.length) throw new Error('Profile checks are still running. Wait or stop them before capturing another search.');
  };
  async function step() {
    if (busy) return;
    busy = true;
    try {
      let { [KEY]: queue } = await chrome.storage.local.get([KEY]);
      if (!queue?.pending?.length || queue.paused) return;
      const key = queue.pending[0], row = queue.rows.find((item) => item.key === key);
      if (!row) { queue.pending.shift(); await persist(queue); return; }
      row.status = 'working'; row.error = ''; await persist(queue);
      try {
        if (queue.action === 'check') {
          row.lead = await profile(row.lead);
          const payload = await api({ action: 'profile_check', lead: row.lead });
          Object.assign(row, { check: payload.check, prospect: payload.prospect, cached: payload.cached, revealAttempted: payload.revealAttempted, hasPhone: payload.hasPhone, previousPush: payload.previousPush });
          row.status = payload.previousPush ? 'pushed' : !payload.check?.eligible ? 'blocked' : payload.hasPhone ? 'ready' : payload.revealAttempted ? 'no-phone' : 'needs-reveal';
        } else if (queue.action === 'reveal') {
          if (!row.check?.eligible || row.statusBefore !== 'needs-reveal') throw new Error('Check this new person before reveal.');
          const payload = await api({ action: 'profile_reveal', lead: row.lead, revealConfirmed: true });
          Object.assign(row, { check: payload.check, prospect: payload.prospect, hasPhone: payload.hasPhone, cached: payload.cached, revealAttempted: true });
          row.status = !payload.check?.eligible ? 'blocked' : payload.hasPhone ? 'ready' : 'no-phone';
        } else if (queue.action === 'push') {
          if (!row.check?.eligible || !row.hasPhone || row.statusBefore !== 'ready') throw new Error('Only checked new people with a phone can be pushed.');
          const payload = await api({ action: 'profile_push', lead: row.lead, taskOwnerId: queue.ownerId, taskDueAt: queue.dueAt, pushConfirmed: true });
          row.status = 'pushed'; row.previousPush = payload; row.message = `Task ${payload.taskId} → ${payload.ownerName}`;
        }
      } catch (error) { row.status = 'error'; row.error = error instanceof Error ? error.message : 'Queue operation failed.'; if (/verification|sign-in|unusual traffic|pairing token/i.test(row.error)) queue.paused = true; }
      queue.pending.shift(); queue.done = (queue.done || 0) + 1;
      const stopped = (await chrome.storage.local.get([KEY]))[KEY]?.paused;
      if (stopped) { queue.paused = true; queue.pending = []; }
      await persist(queue);
      const fresh = (await chrome.storage.local.get([KEY]))[KEY];
      if (fresh?.paused) { queue.paused = true; queue.pending = []; await persist(queue); }
      if (queue.pending.length && !queue.paused) { chrome.alarms.create(ALARM, { when: Date.now() + 1500 }); setTimeout(() => void step(), 1500); }
    } finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!String(message?.type || '').startsWith('work_queue_')) return false;
    void (async () => {
      try {
        let { [KEY]: queue } = await chrome.storage.local.get([KEY]);
        if (message.type === 'work_queue_capture') {
          if (!(await chrome.storage.local.get(['pairingToken'])).pairingToken) throw new Error('Save pairing before working this page.');
          if ((await chrome.storage.local.get(['salesNavFullRunV1'])).salesNavFullRunV1?.complete === false) throw new Error('Full-search capture is running. Wait for it to finish before loading Current 25.');
          if (busy || queue?.pending?.length) throw new Error('Finish or pause the current operation before loading another page.');
          if (message.readProfiles === true) await api({ action: 'profile_options' });
          const values = await chrome.scripting.executeScript({ target: { tabId: message.tabId }, func: extractCurrentSalesNavPageV154 });
          const captured = values?.[0]?.result;
          if (!captured?.ok || !captured.leads?.length) throw new Error(captured?.error || 'No lead cards found.');
          const previous = new Map((queue?.rows || []).map((row) => [row.key, row]));
          queue = { sourceUrl: captured.sourceUrl, rows: dedupe(captured.leads.filter((lead) => lead.connectionDegree !== '1st'), 25).map((lead) => ({ ...previous.get(identity(lead)), key: identity(lead), lead: { ...lead, ...(previous.get(identity(lead))?.lead?.linkedinUrl ? previous.get(identity(lead)).lead : {}) }, status: previous.get(identity(lead))?.status || 'pending' })), pending: [], done: 0, paused: false };
          await persist(queue);
          if (message.readProfiles === true) {
            await api({ action: 'import', sourceUrl: captured.sourceUrl, pagesRead: 1, clientVersion: chrome.runtime.getManifest().version, parserVersion: 'card-v6-public-profile-handoff', leads: queue.rows.map(row => row.lead) });
            queue = await globalThis.startCapturedProfileChecks(queue.rows.map(row => row.lead), captured.sourceUrl);
          }
        } else if (message.type === 'work_queue_start') {
          if (busy || !queue?.rows?.length || queue.pending?.length) throw new Error('Load a page first or wait for the current operation.');
          if (!['check','reveal','push'].includes(message.action)) throw new Error('Invalid queue action.');
          if (['reveal','push'].includes(message.action) && message.confirmed !== true) throw new Error('Confirm this action first.');
          const selected = queue.rows.filter((row) => message.keys?.includes(row.key));
          const allowed = selected.filter((row) => message.action === 'check' ? row.status !== 'pushed' : message.action === 'reveal' ? row.status === 'needs-reveal' && row.check?.eligible : row.status === 'ready' && row.check?.eligible && row.hasPhone);
          if (!allowed.length) throw new Error('No selected rows are eligible for this action.');
          allowed.forEach((row) => { row.statusBefore = row.status; });
          queue = { ...queue, action: message.action, pending: allowed.map((row) => row.key), done: 0, total: allowed.length, paused: false, ownerId: message.ownerId, dueAt: message.dueAt };
          await persist(queue); chrome.alarms.create(ALARM, { when: Date.now() + 1000 }); setTimeout(() => void step(), 100);
        } else if (message.type === 'work_queue_options') { const payload = await api({ action: 'profile_options' }); respond(payload); return; }
        else if (message.type === 'work_queue_stop') { if (queue) { queue.paused = true; queue.pending = []; await persist(queue); } await chrome.alarms.clear(ALARM); }
        else if (message.type === 'work_queue_kick') { if (!queue?.rows?.some((row) => row.status === 'working') || Date.now() - Date.parse(queue.updatedAt || 0) > 180000) void step(); }
        respond({ ok: true, queue });
      } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : 'Queue failed.' }); }
    })();
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void step(); if (alarm.name === `${ALARM}-watchdog`) void (async () => { const value = (await chrome.storage.local.get([KEY]))[KEY]; if (value?.pending?.length && !value.paused && Date.now() - Date.parse(value.updatedAt || 0) > 180000) await step(); })(); });
  void chrome.alarms.create(`${ALARM}-watchdog`, { periodInMinutes: 1 });
})();
