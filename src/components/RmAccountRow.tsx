'use client';
import { ArrowUpRight } from 'lucide-react';
import type { JourneyRow } from '@/lib/rm-journey';
import { journeyStatus } from '@/lib/rm-journey-status';
import { latestAccountUpdate, isOpenDeal, followupHealth } from '@/lib/rm-workspace-summary';
import styles from './RmJourneyWorkspace.module.css';
const date = (s: string) => Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded';
export function RmAccountRow({ group, rmId, now, canEdit, partial = false, onOpen }: { group: JourneyRow[]; rmId: string; now: string; canEdit: boolean; partial?: boolean; onOpen: (r: JourneyRow, b: HTMLButtonElement, t?: 'overview' | 'update') => void }) {
  const r = group[0], s = journeyStatus(r, rmId, now);
  const latest = latestAccountUpdate(group, rmId, now);
  const health = followupHealth(s, partial);
  const deals = [...new Map(group.flatMap(row => row.deals.filter(d => d.ownerId === rmId)).map(d => [d.id, d])).values()];
  const openDeals = deals.filter(isOpenDeal);
  return <tr>
    <td><strong>{r.company?.name || r.contacts[0]?.name || r.title}</strong><small>{r.contacts.map(c => c.name).join(' · ')}</small><small>{group.length} meeting{group.length === 1 ? '' : 's'} · {r.people.sdrs.map(p => p.name.split(' ')[0]).join(' / ')}</small><details className={styles.peopleDetails}><summary>People & ownership</summary>{r.people.rms.map(p => <p key={p.id}>{p.short}: {p.roles.join(' · ')}</p>)}</details></td>
    <td data-label="Latest update">{latest ? <><span className={styles.updateType}>{latest.title}</span><p className={styles.updateExcerpt}>{latest.text}</p><small>{date(latest.at)}</small></> : <><span className={styles.muted}>No update recorded</span><small>Latest meeting {date(r.start)}</small></>}</td>
    <td data-label="Follow-up"><span className={s.slaBreached || s.overdue.length ? styles.slaLate : health === 'On track' ? styles.slaOk : styles.pill}>{health}</span>{!s.followupRequired ? <small>{s.stopReason}</small> : <><small>{s.lastFollowupAt ? `Last outreach ${date(s.lastFollowupAt)}` : 'No outreach recorded after meeting'}</small>{s.slaApplicable && <small>Follow-up due {date(s.slaDueAt)}</small>}</>}</td>
    <td data-label="Next action">{s.overdue[0] && <div className={styles.taskLate}><strong>{s.overdue.length} overdue task{s.overdue.length === 1 ? '' : 's'}</strong><small>{s.overdue[0].title}</small><small>Was due {date(s.overdue[0].due)}</small></div>}{s.future[0] ? <><span className={styles.updateType}>Next scheduled task</span><small>{s.future[0].title}</small><small>Due {date(s.future[0].due)}</small></> : <span className={styles.muted}>{s.followupRequired ? 'No upcoming task' : 'No follow-up required'}</span>}</td>
    <td data-label="Open deal / stage"><span className={openDeals.length ? styles.slaOk : styles.pill}>{openDeals.length ? `${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'}` : deals.length ? 'No confirmed open deal' : 'No linked deal'}</span>{(openDeals.length ? openDeals : deals).slice(0, 2).map(d => <div key={d.id}><a className={styles.sourceLink} href={d.url} target="_blank" rel="noreferrer">{d.name}<ArrowUpRight size={12}/></a><small>{d.stage}</small></div>)}{deals.length > 2 && <small>{deals.length} linked deals · view all in details</small>}</td>
    <td><button className={styles.openButton} onClick={e => onOpen(r, e.currentTarget)}>View account <ArrowUpRight size={14}/></button><button className={styles.rowEdit} onClick={e => onOpen(r, e.currentTarget, 'update')}>{canEdit ? 'Update HubSpot' : 'Open CRM records'}</button></td>
  </tr>;
}
