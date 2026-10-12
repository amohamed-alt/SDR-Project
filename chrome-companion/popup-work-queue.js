(() => {
  const KEY = 'salesNavWorkQueueV160';
  let queue = null, selected = new Set(), rendering = false;
  const el = (id) => document.getElementById(id);
  const send = async (message) => { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || 'Companion did not respond.'); return result; };
  const status = (message, state = 'muted') => setStatus('workQueueStatus', message, state);
  function render(value) {
    queue = value || null;
    const rows = queue?.rows || [], running = Boolean(queue?.pending?.length);
    if (queue?.sourceUrl) { try { const page = new URL(queue.sourceUrl).searchParams.get('page') || '1'; el('workQueueSource').textContent = `Saved search page ${page}. Load current page to replace this list.`; } catch {} }
    const existing = new Set(rows.map((row) => row.key)); selected = new Set([...selected].filter((key) => existing.has(key)));
    el('workQueueRows').replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr'), choice = document.createElement('input'); choice.type = 'checkbox'; choice.checked = selected.has(row.key); choice.disabled = running || row.status === 'pushed';
      choice.addEventListener('change', () => { if (choice.checked) selected.add(row.key); else selected.delete(row.key); updateButtons(); });
      const td = document.createElement('td'); td.append(choice); tr.append(td);
      const person = document.createElement('td'), name = document.createElement('strong'), detail = document.createElement('small'), url = document.createElement('a');
      name.textContent = row.lead.name; detail.textContent = `${row.lead.title} · ${row.lead.company}`; person.append(name,detail);
      if (row.lead.linkedinUrl) { url.href = row.lead.linkedinUrl; url.target = '_blank'; url.rel = 'noreferrer'; url.textContent = 'LinkedIn'; person.append(url); }
      const outcome = document.createElement('td'), label = document.createElement('strong'), note = document.createElement('small');
      label.textContent = row.status;
      note.textContent = row.error || row.message || row.check?.identityError || row.check?.company?.protectedReason || row.check?.company?.gateReason || 'Not checked';
      const contacts = [row.prospect?.phone || row.prospect?.phones?.[0],row.prospect?.email].filter(Boolean).join(' · ');
      if (contacts) { const data = document.createElement('small'); data.textContent = contacts; outcome.append(data); }
      outcome.prepend(label,note); tr.append(person,outcome); el('workQueueRows').append(tr);
    }
    if (running) status(`${queue.action}: ${queue.done || 0}/${queue.total} completed. You can close the popup; progress is saved.`);
    else if (rows.length) status(`${rows.length} captured · ${rows.filter((row) => row.status === 'ready').length} ready · ${rows.filter((row) => row.status === 'pushed').length} pushed`, 'ok');
    updateButtons();
  }
  function updateButtons() {
    const rows = (queue?.rows || []).filter((row) => selected.has(row.key)), running = Boolean(queue?.pending?.length);
    el('workQueueCapture').disabled = running || rendering;
    el('workQueueCheck').disabled = running || !rows.some((row) => row.status !== 'pushed');
    const reveal = rows.filter((row) => row.status === 'needs-reveal' && row.check?.eligible).length;
    const ready = rows.filter((row) => row.status === 'ready' && row.check?.eligible && row.hasPhone).length;
    el('workQueueReveal').disabled = running || !reveal; el('workQueueReveal').textContent = `Reveal selected (${reveal})`;
    el('workQueuePush').disabled = running || !ready || !el('workQueueOwner').value; el('workQueuePush').textContent = `Push + CALL tasks (${ready})`;
    el('workQueueSelect').disabled = running || !(queue?.rows?.length); el('workQueueStop').disabled = !running;
    el('workQueueSelection').textContent = `${selected.size} selected · ${reveal} need reveal · ${ready} phone-ready`;
  }
  async function start(action) {
    try {
      if (action === 'check') {
        // Request access only on this explicit click, never on startup/capture.
        const granted = await chrome.permissions.request({ origins: ['https://www.linkedin.com/sales/*'] });
        if (!granted) throw new Error('LinkedIn profile access was declined. Capture remains available; profile checks need this permission.');
      }
      const rows = (queue?.rows || []).filter((row) => selected.has(row.key));
      let dueAt = '';
      if (action === 'reveal' && !confirm(`Reveal contact details for ${rows.filter((row) => row.status === 'needs-reveal').length} checked new people? First-time successful reveals can use SignalHire credits. Cached results are reused.`)) return;
      if (action === 'push') {
        const due = new Date(`${el('workQueueDate').value}T${el('workQueueTime').value}:00`);
        if (Number.isNaN(due.getTime())) throw new Error('Choose a valid task date and time.');
        dueAt = due.toISOString();
        const owner = el('workQueueOwner').selectedOptions[0]?.textContent;
        if (!confirm(`Push ${rows.filter((row) => row.status === 'ready').length} new people with phones and create CALL tasks for ${owner} on ${due.toLocaleString()}? The server rechecks eligibility before each write.`)) return;
      }
      const result = await send({ type: 'work_queue_start', action, keys: [...selected], ownerId: el('workQueueOwner').value, dueAt, confirmed: true });
      render(result.queue);
    } catch (error) { status(error.message || 'Operation failed.', 'bad'); }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https:\/\/www\.linkedin\.com\/sales\/search\/people(?:[/?#]|$)/.test(tab?.url || '')) return;
    el('workQueueCard').hidden = false;
    const date = new Date(); date.setDate(date.getDate()+1); el('workQueueDate').value = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const stored = await chrome.storage.local.get([KEY]); render(stored[KEY]);
    el('workQueueCapture').addEventListener('click', async () => {
      rendering = true; updateButtons(); status('Reading the current page…');
      try { const result = await send({ type: 'work_queue_capture', tabId: tab.id }); selected = new Set(); render(result.queue); }
      catch (error) { status(error.message, 'bad'); }
      finally { rendering = false; updateButtons(); }
    });
    el('workQueueSelect').addEventListener('click', () => { const selectable = (queue?.rows || []).filter((row) => row.status !== 'pushed'); const all = selectable.every((row) => selected.has(row.key)); selected = all ? new Set() : new Set(selectable.map((row) => row.key)); render(queue); });
    el('workQueueCheck').addEventListener('click', () => void start('check'));
    el('workQueueReveal').addEventListener('click', () => void start('reveal'));
    el('workQueuePush').addEventListener('click', () => void start('push'));
    el('workQueueStop').addEventListener('click', async () => { try { const result = await send({ type: 'work_queue_stop' }); render(result.queue); status('Stopped after the current request. Completed results are saved.'); } catch (error) { status(error.message,'bad'); } });
    el('workQueueOwner').addEventListener('change', updateButtons);
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[KEY]) render(changes[KEY].newValue); });
    try {
      const result = await send({ type: 'work_queue_options' });
      el('workQueueOwner').replaceChildren();
      for (const owner of result.owners || []) { const option = document.createElement('option'); option.value = owner.id; option.textContent = owner.name; el('workQueueOwner').append(option); }
      updateButtons();
    } catch (error) { status(`Task owners unavailable: ${error.message}`,'bad'); }
    if (stored[KEY]?.pending?.length) void send({ type: 'work_queue_kick' });
  });
})();
