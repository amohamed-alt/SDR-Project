function profileUrlFromTab(raw) {
  try { const url = new URL(raw); return url.protocol === 'https:' && /^(www\.)?linkedin\.com$/.test(url.hostname) && /^\/(?:in\/[^/]+\/?|sales\/lead\/.+)$/.test(url.pathname) ? url.href : ''; }
  catch { return ''; }
}
(() => {
  let lead = null, state = null, working = false;
  const el = (id) => document.getElementById(id);
  const status = (message, kind = 'muted') => setStatus('liveProfileStatus', message, kind);
  async function api(body) {
    const { pairingToken } = await chrome.storage.local.get(['pairingToken']);
    if (!pairingToken) throw new Error('Save a pairing token first.');
    const response = await fetch('https://sdr.dashboardtalentera.tech/api/prospecting/salesnav/companion', { method: 'POST', headers: { Authorization: `Bearer ${pairingToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Profile operation failed.');
    return payload;
  }
  function render() {
    el('liveProfileResult').hidden = !lead || !state;
    if (lead) { el('liveProfileName').textContent = `${lead.name} · ${lead.title} · ${lead.company}`; el('liveProfileUrl').textContent = lead.linkedinUrl; el('liveProfileUrl').href = lead.linkedinUrl; }
    if (state) {
      el('liveProfileHubspot').textContent = state.check?.eligible ? 'Eligible new person' : 'Blocked';
      el('liveProfileHubspot').className = `badge ${state.check?.eligible ? 'ok' : 'bad'}`;
      el('liveProfileGate').textContent = state.check?.identityError || state.check?.company?.protectedReason || state.check?.company?.gateReason || '';
      el('liveProfileContacts').textContent = [state.prospect?.phone || state.prospect?.phones?.[0],state.prospect?.email].filter(Boolean).join(' · ') || 'No usable phone yet';
    }
    el('enrichProfile').disabled = working;
    el('revealProfile').disabled = working || !state?.check?.eligible || state?.hasPhone || state?.revealAttempted || !!state?.previousPush;
    el('pushProfile').disabled = working || !state?.check?.eligible || !state?.hasPhone || !el('liveProfileOwner').value || !!state?.previousPush;
  }
  document.addEventListener('DOMContentLoaded', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!profileUrlFromTab(tab?.url)) return;
    el('liveProfileCard').hidden = false; status('Read the profile and check HubSpot before revealing contact details.');
    const date = new Date(); date.setDate(date.getDate()+1); el('liveProfileDate').value = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    try { const data = await api({ action:'profile_options' }); el('liveProfileOwner').replaceChildren(); for (const owner of data.owners || []) { const option = document.createElement('option'); option.value = owner.id; option.textContent = owner.name; el('liveProfileOwner').append(option); } }
    catch(error) { status(error.message,'bad'); }
    el('liveProfileOwner').addEventListener('change',render);
    el('enrichProfile').addEventListener('click',async () => {
      working = true; lead = null; state = null; render(); status('Reading visible profile and checking HubSpot…');
      try { await chrome.scripting.executeScript({ target:{tabId:tab.id}, files:['profile-dom.js'] }); const values = await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:readVisibleLinkedInProfile }); const value = values?.[0]?.result; if (!value?.ok) throw new Error(value?.error || 'Could not read the profile.'); lead = value.lead; state = await api({ action:'profile_check',lead }); status(state.previousPush ? `Already pushed · task ${state.previousPush.taskId}` : 'HubSpot check complete', 'ok'); }
      catch(error) { status(error.message,'bad'); }
      finally { working = false; render(); }
    });
    el('revealProfile').addEventListener('click',async () => {
      if (!lead || !state?.check?.eligible || !confirm('Reveal this new person? A first-time successful reveal can use SignalHire credits.')) return;
      working = true; render(); status('Rechecking eligibility and revealing contact details…');
      try { state = await api({ action:'profile_reveal',lead,revealConfirmed:true }); state.revealAttempted = true; status(state.hasPhone ? 'Phone available. Review owner and time before push.' : 'No usable phone returned. Push is disabled.',state.hasPhone?'ok':'muted'); }
      catch(error) { state = null; status(`${error.message} Read + Check again before retrying.`,'bad'); }
      finally { working = false; render(); }
    });
    el('pushProfile').addEventListener('click',async () => {
      if (!lead || !state?.check?.eligible || !state?.hasPhone) return;
      const date = new Date(`${el('liveProfileDate').value}T${el('liveProfileTime').value}:00`);
      if (Number.isNaN(date.getTime())) { status('Choose a valid task date and time.','bad'); return; }
      const owner = el('liveProfileOwner').selectedOptions[0]?.textContent;
      if (!confirm(`Push ${lead.name} and create a CALL task for ${owner} on ${date.toLocaleString()}?`)) return;
      working = true; render(); status('Rechecking HubSpot and creating the task…');
      try { const payload = await api({ action:'profile_push',lead,taskOwnerId:el('liveProfileOwner').value,taskDueAt:date.toISOString(),pushConfirmed:true }); state.previousPush = payload; status(`Task ${payload.taskId} → ${payload.ownerName}`,'ok'); }
      catch(error) { state = null; status(`${error.message} Read + Check again to reconcile the result.`,'bad'); }
      finally { working = false; render(); }
    });
    render();
  });
})();
