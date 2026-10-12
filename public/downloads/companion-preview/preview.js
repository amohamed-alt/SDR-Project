// Read-only visual preview. No Chrome APIs, requests or real contact data.
const byId = (id) => document.getElementById(id);
byId('workQueueCard').hidden = false;
byId('versionStatus').textContent = 'Companion v1.6.1';
byId('workQueueStatus').textContent = 'Sample page loaded. Select people to see the intended workflow.';
byId('workQueueStatus').className = 'status muted';
byId('workQueueSource').textContent = 'Sample search page · design preview only';
byId('workQueueSelection').textContent = '2 selected · 1 needs reveal · 1 phone-ready';
byId('queueMetricTotal').textContent = '4';
byId('queueMetricEligible').textContent = '2';
byId('queueMetricReady').textContent = '1';
byId('queueMetricBlocked').textContent = '1';
byId('workQueueOwner').replaceChildren();
for (const name of ['Marita Chedid','Daniel Beaini']) { const option = document.createElement('option'); option.textContent = name; byId('workQueueOwner').append(option); }
byId('workQueueDate').value = '2026-10-14'; byId('workQueueTime').value = '09:00';
byId('workQueueReveal').textContent = 'Reveal selected (1)'; byId('workQueuePush').textContent = 'Push + CALL tasks (1)';
const samples = [
  ['Sample lead 01','Human Resources Director','Example company A','ready','Phone-ready','Eligible new person','Phone available · demo',true],
  ['Sample lead 02','Talent Acquisition Manager','Example company B','needs-reveal','Needs reveal','HubSpot check complete','No phone yet',true],
  ['Sample lead 03','Head of People','Example company C','blocked','Blocked','Existing company meeting','Reveal disabled',false],
  ['Sample lead 04','Recruitment Director','Example company D','pending','Not checked','Waiting for HubSpot Check','',false],
];
for (const [name,title,company,stage,label,reason,contact,selected] of samples) {
 const tr = document.createElement('tr'); tr.dataset.stage = stage;
 const selection = document.createElement('td'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected; selection.append(input);
 const person = document.createElement('td'), identity = document.createElement('div'), avatar = document.createElement('span'), copy = document.createElement('div'); identity.className = 'personCell'; avatar.className = 'personAvatar'; avatar.textContent = name.slice(-2); copy.className = 'personCopy';
 const n = document.createElement('strong'), t = document.createElement('small'), c = document.createElement('small'); n.textContent = name; t.textContent = title; c.textContent = company; c.className = 'companyLabel'; copy.append(n,t,c); identity.append(avatar,copy); person.append(identity);
 const outcome = document.createElement('td'), badge = document.createElement('strong'), note = document.createElement('small'), contacts = document.createElement('small'); badge.className = 'stageBadge'; badge.dataset.stage = stage; badge.textContent = label; note.textContent = reason; contacts.className = 'contactCopy'; contacts.textContent = contact; outcome.append(badge,note,contacts);
 tr.append(selection,person,outcome); byId('workQueueRows').append(tr);
}
// The preview is deliberately inert even when someone clicks a control.
for (const node of document.querySelectorAll('button,input,select')) node.disabled = true;
for (const link of document.querySelectorAll('a')) { link.removeAttribute('href'); link.setAttribute('aria-disabled','true'); }
