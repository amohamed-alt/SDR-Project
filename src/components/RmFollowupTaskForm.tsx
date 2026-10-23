'use client';
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
  const [type, setType] = useState<'TODO' | 'CALL' | 'EMAIL'>('TODO');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');

  async function create() {
    const dueAt = new Date(`${due}:00+03:00`);
    if (!contactId || !title.trim() || !Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now()) { setMessage('Select a contact, title and future due time.'); return; }
    const contact = row.contacts.find(c => c.id === contactId);
    if (!window.confirm(`Create a ${type.toLowerCase()} task for ${rm.name}?\nContact: ${contact?.name}\nDue: ${due.replace('T', ' ')} (Riyadh)\n${dealId ? 'Linked to the displayed opportunity and selected contact.' : 'Linked to the selected contact; no opportunity selected.'}`)) return;
    setBusy(true); onBusy(true); setMessage('');
    try {
      const response = await fetch('/api/rm-journey/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: row.id, rmId: rm.id, version: row.version, contactId, dealId, title: title.trim(), type, dueAt: dueAt.toISOString() }) });
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
      <label className={styles.formField}>Task contact<select disabled={busy} value={contactId} onChange={e => setContactId(e.target.value)}><option value="">Select contact</option>{row.contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className={styles.formField}>Task title<input disabled={busy} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className={styles.formField}>Task type<select disabled={busy} value={type} onChange={e => setType(e.target.value as typeof type)}><option value="TODO">To-do</option><option value="CALL">Call</option><option value="EMAIL">Email</option></select></label>
      <label className={styles.formField}>Task due time (Riyadh)<input disabled={busy} type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label>
      <button className={styles.primary} disabled={busy || !contactId || !title.trim() || !due} onClick={() => void create()}>{busy ? 'Creating & verifying…' : 'Create & verify task'}</button>
    </>}
    {message && <p role="status" className={styles.warning}>{message}</p>}
  </section>;
}
