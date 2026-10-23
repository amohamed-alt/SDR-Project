'use client';
import {ArrowUpRight} from 'lucide-react';
import type {JourneyRow} from '@/lib/rm-journey';
import {journeyStatus} from '@/lib/rm-journey-status';
import {contactReview,dealReview} from '@/lib/rm-review-core';
import styles from './RmJourneyWorkspace.module.css';
const date=(s:string)=>new Date(s).toLocaleDateString('en-GB',{timeZone:'Asia/Riyadh',day:'numeric',month:'short',year:'numeric'});
export function RmAccountRow({group,rmId,now,onOpen}:{group:JourneyRow[];rmId:string;now:string;onOpen:(r:JourneyRow,b:HTMLButtonElement,t?:'overview'|'update')=>void}){
 const r=group[0],s=journeyStatus(r,rmId,now);
 const cc=r.contacts.flatMap(c=>contactReview(c.properties)),dc=s.deal?dealReview(s.deal.properties,!s.followupRequired):[];
 const filled=(checks:typeof cc)=>checks.filter(c=>c.filled).length;
 return <tr><td><strong>{r.company?.name||r.contacts[0]?.name||r.title}</strong><small>{date(r.start)} · {group.length} meeting record{group.length===1?'':'s'}</small><small>{r.people.sdrs.map(p=>p.name).join(' / ')}</small><details className={styles.peopleDetails}><summary>People & ownership</summary>{r.people.rms.map(p=><p key={p.id}>{p.short}: {p.roles.join(' · ')}</p>)}</details></td>
 <td data-label="Follow-up SLA">{!s.followupRequired?<><span className={styles.pill}>Exempt</span><small>{s.stopReason}</small></>:!s.responsible?<small>Participant · no follow-up SLA assigned</small>:!s.slaApplicable?<span className={styles.muted}>Meeting upcoming</span>:<><span className={s.slaBreached?styles.slaLate:styles.slaOk}>{s.slaBreached?'SLA overdue':`${s.daysRemaining} days left`}</span><small>{s.idleDays} days since {s.lastFollowupAt?'last outreach':'meeting'}</small><small>Due {date(s.slaDueAt)}</small></>}</td>
 <td data-label="RM task">{s.overdue.length?<><span className={styles.slaLate}>{s.overdue.length} overdue task{s.overdue.length===1?'':'s'}</span><small>{s.overdue[0].title}</small><small>Due {date(s.overdue[0].due)}</small>{!s.followupRequired&&<small>Existing task · follow-up exempt</small>}</>:s.future[0]?<><span className={styles.pill}>Scheduled</span><small>{s.future[0].title}</small><small>Due {date(s.future[0].due)}</small></>:<span className={styles.muted}>{s.followupRequired?'No upcoming RM task recorded':'Follow-up exempt'}</span>}</td>
 <td data-label="Opportunity"><span className={styles.pill}>{s.deal?s.stage:'No linked deal'}</span>{s.deal?<><a className={styles.sourceLink} href={s.deal.url} target="_blank" rel="noreferrer">{s.deal.name} <ArrowUpRight size={12}/></a><small>{String(s.deal.properties.deal_next_step||s.deal.properties.next_steps_planned_by_rm||'Next step not recorded')}</small></>:<small>{s.linkReview}</small>}</td>
 <td data-label="Validation"><span className={styles.validationLine}>Contact <strong>{cc.length?`${filled(cc)}/${cc.length}`:'—'}</strong></span><span className={styles.validationLine}>Deal <strong>{dc.length?`${filled(dc)}/${dc.length}`:'—'}</strong></span><small>{cc.length+dc.length?'fields filled':'No linked review fields'}</small></td>
 <td><button className={styles.openButton} onClick={e=>onOpen(r,e.currentTarget)}>Open journey <ArrowUpRight size={14}/></button><button className={styles.rowEdit} onClick={e=>onOpen(r,e.currentTarget,'update')}>Update HubSpot</button></td></tr>;
}
