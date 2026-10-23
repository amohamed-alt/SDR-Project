'use client';
import {contactDisposition} from '@/lib/rm-review-core';
import { useState } from 'react';
import type { JourneyRow } from '@/lib/rm-journey';
import type { RM_PROFILES } from '@/lib/rm-journey-core';
import styles from './RmJourneyWorkspace.module.css';

type TaskResult = { id: string; properties: Record<string, string> };
export function RmFollowupTaskForm({ row, rm, dealId, enabled, onBusy, onVerified }: {
  row: JourneyRow;
  rm: (typeof RM_PROFILES)[number];
  dealId: string;
  enabled: boolean;
  onBusy: (busy: boolean) => void;
  onVerified: (task: TaskResult) => Promise<void>;
}) {
  const [contactId, setContactId] = useState(row.contacts.length === 1 ? row.contacts[0].id : '');
  const [title, setTitle] = useState(`Follow up: ${row.company?.name || row.title}`.slice(0, 200));
  const [due, setDue] = useState('');
  const [reminder,setReminder]=useState('none');
  const [type, setType] = useState<'TODO' | 'CALL' | 'EMAIL'>('TODO');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');

  async function create() {
    const dueAt = new Date(`${due}:00+03:00`);
    if (!contactId || !title.trim() || !Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now()) { setMessage('Select a contact, title and future due time.'); return; }
    const reminderAt=reminder==='none'?undefined:new Date(dueAt.getTime()-Number(reminder)*60000).toISOString();
    if(reminderAt&&Date.parse(reminderAt)<=Date.now()){setMessage('Choose a reminder time in the future.');return;}
    const contact = row.contacts.find(c => c.id === contactId);
    if (!window.confirm(`Create a ${type.toLowerCase()} task for ${rm.name}?\nContact: ${contact?.name}\nDue: ${due.replace('T', ' ')} (Riyadh)\nReminder: ${reminderAt?new Date(reminderAt).toLocaleString('en-GB',{timeZone:'Asia/Riyadh'})+' Riyadh':'None'}\n${dealId ? 'Linked to the displayed opportunity and selected contact.' : 'Linked to the selected contact; no opportunity selected.'}`)) return;
    setBusy(true); onBusy(true); setMessage('');
    try {
      const response = await fetch('/api/rm-journey/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: row.id, rmId: rm.id, version: row.version, contactId, dealId, title: title.trim(), type, dueAt: dueAt.toISOString(),...(reminderAt?{reminderAt}:{}) }) });
      const result = await response.json();
      if (!response.ok || result.confirmed !== true || !result.task?.id) throw new Error(result.error || 'Task could not be verified. Review HubSpot before retrying.');
      setMessage(`Task ${result.taskId} ${result.reused ? 'already exists and was verified' : 'created and verified'} in HubSpot.`);
      await onVerified(result.task);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Task could not be confirmed. Review HubSpot before retrying.'); }
    finally { setBusy(false); onBusy(false); }
  }

  return <section aria-label="Create follow-up task">
    <h3>Create follow-up task</h3>
    <p className={styles.muted}>Assigned to {rm.name}. Due time uses Riyadh time (UTC+3).</p>
    {!enabled ? <p className={styles.warning}>Confirm follow-up ownership and opportunity linkage, or review the existing open task, before creating another.</p> : <>
      <label className={styles.formField}>Task contact<select disabled={busy} value={contactId} onChange={e => setContactId(e.target.value)}><option value="">Select contact</option>{row.contacts.filter(c=>!contactDisposition(c.properties).stopped).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className={styles.formField}>Task title<input disabled={busy} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className={styles.formField}>Task type<select disabled={busy} value={type} onChange={e => setType(e.target.value as typeof type)}><option value="TODO">To-do</option><option value="CALL">Call</option><option value="EMAIL">Email</option></select></label>
      <label className={styles.formField}>Task due time (Riyadh)<input disabled={busy} type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label>
      <label className={styles.formField}>HubSpot reminder<select disabled={busy} value={reminder} onChange={e=>setReminder(e.target.value)}><option value="none">No reminder</option><option value="0">At task due time</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label><p className={styles.muted}>Saved on the task for its RM owner. HubSpot handles reminder delivery using the owner’s notification settings.</p>
      <button className={styles.primary} disabled={busy || !contactId || !title.trim() || !due} onClick={() => void create()}>{busy ? 'Creating & verifying…' : 'Create & verify task'}</button>
    </>}
    {message && <p role="status" className={styles.warning}>{message}</p>}
  </section>;
}
