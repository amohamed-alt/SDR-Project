'use client';
import {useState} from 'react';
import type {JourneyRow,RmJourneyData} from '@/lib/rm-journey';
import {contactDisposition,contactReview,dealReview} from '@/lib/rm-review-core';
import styles from './RmJourneyWorkspace.module.css';
type Contact=JourneyRow['contacts'][number];
type Check={name:string;label:string;filled:boolean;value:string};
function Checklist({checks}:{checks:Check[]}){return <ul className={styles.reviewList}>{checks.map(f=><li key={f.name}><span>{f.label}</span><strong className={f.filled?styles.good:styles.issue}>{f.filled?'Filled out':'Missing'}</strong></li>)}</ul>}
export function RmReviewCards({row,deal,stopped,onEdit}:{row:JourneyRow;deal?:JourneyRow['deals'][number];stopped:boolean;onEdit:()=>void}){
 const checks=row.contacts.flatMap(c=>contactReview(c.properties));const filled=checks.filter(f=>f.filled).length;
 const dc=deal?dealReview(deal.properties,stopped):[];
 return <div className={styles.reviewGrid} aria-label="CRM validation"><article><div className={styles.reviewHead}><span>CONTACT VALIDATION</span><strong>{checks.length?`${filled} / ${checks.length} filled`:'No contact linked'}</strong></div>{row.contacts.map(c=><div key={c.id}><a href={c.url} target="_blank" rel="noreferrer">{c.name}</a><p className={styles.muted}>{contactDisposition(c.properties).reason}</p><Checklist checks={contactReview(c.properties)}/></div>)}<button className={styles.openButton} onClick={onEdit}>Review contact fields</button></article><article><div className={styles.reviewHead}><span>DEAL VALIDATION</span><strong>{deal?`${dc.filter(f=>f.filled).length} / ${dc.length} filled`:'No unique opportunity'}</strong></div>{deal?<><a href={deal.url} target="_blank" rel="noreferrer">{deal.name}</a><p className={styles.muted}>{deal.stage}</p><Checklist checks={dc}/>{stopped&&<p className={styles.good}>Next step and date are not required for follow-up.</p>}<button className={styles.openButton} onClick={onEdit}>Review deal fields</button></>:<p className={styles.muted}>A missing deal is a linkage review, not an overdue follow-up field.</p>}</article></div>;
}
export function RmContactEditor({contact,row,rmId,fields,onBusy,onVerified}:{contact:Contact;row:JourneyRow;rmId:string;fields:RmJourneyData['contactFields'];onBusy:(b:boolean)=>void;onVerified:(id:string,p:Record<string,string>)=>Promise<void>}){
 const [draft,setDraft]=useState<Record<string,string>>(()=>Object.fromEntries(fields.map(f=>[f.name,String(contact.properties?.[f.name]||'').slice(0,f.type==='date'?10:10000)])));
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function save(){
 const properties=Object.fromEntries(fields.filter(f=>draft[f.name]!==String(contact.properties?.[f.name]||'').slice(0,f.type==='date'?10:10000)).map(f=>[f.name,draft[f.name]]));
 if(!Object.keys(properties).length){setMessage('No changes to save.');return;}
 const preview=Object.entries(properties).map(([k,v])=>`${fields.find(f=>f.name===k)?.label}: ${v||'(clear)'}`).join('\n');
 if(!window.confirm(`Save contact review for ${contact.name} to HubSpot?\n${preview}`))return;
 setBusy(true);onBusy(true);setMessage('');
 try{const res=await fetch('/api/rm-journey/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({meetingId:row.id,rmId,id:contact.id,version:contact.version,properties})});const result=await res.json();if(!res.ok||result.confirmed!==true)throw new Error(result.error||'Save not verified');setMessage('Contact saved and verified in HubSpot.');await onVerified(contact.id,result.record.properties);}catch(e){setMessage(e instanceof Error?e.message:'Save not confirmed. Reload before retrying.');}finally{setBusy(false);onBusy(false);}
 }
 return <section className={styles.editorCard}><h3>{contact.name} · contact review</h3><p className={styles.muted}>Updates the original HubSpot contact. Unqualified / No need removes follow-up requirements; missing review fields remain visible.</p>{fields.map(f=><label className={styles.formField} key={f.name}>{f.label}{f.type==='enumeration'?<select aria-label={f.label} disabled={busy} value={draft[f.name]} onChange={e=>setDraft({...draft,[f.name]:e.target.value})}><option value="">Not set</option>{f.options?.filter(o=>!o.hidden).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==='date'?<input aria-label={f.label} type="date" disabled={busy} value={draft[f.name]} onChange={e=>setDraft({...draft,[f.name]:e.target.value})}/>:<textarea aria-label={f.label} disabled={busy} maxLength={10000} value={draft[f.name]} onChange={e=>setDraft({...draft,[f.name]:e.target.value})}/>}</label>)}<button className={styles.primary} disabled={busy} onClick={()=>void save()}>{busy?'Saving & verifying…':'Save & verify contact'}</button>{message&&<p role="status" className={styles.warning}>{message}</p>}</section>;
}
