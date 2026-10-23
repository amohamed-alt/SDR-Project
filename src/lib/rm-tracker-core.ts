import { RM_PROFILES } from './rm-journey-core.ts';
// Exact aliases only: company/title similarity is not sufficient attribution.
export function trackerRmId(name:string){
 const value=name.trim().toLowerCase().replace(/\s+/g,' ');
 return RM_PROFILES.find(p=>[p.name.toLowerCase(),p.short.toLowerCase(),p.slug,p.slug==='zein'?'zain':p.slug==='jehad'?'jihad':''].filter(Boolean).includes(value))?.id||'';
}
export function trackerMeetingId(link:string){
 try {const u=new URL(link);if(!['app.hubspot.com','app-eu1.hubspot.com'].includes(u.hostname)||u.protocol!=='https:')return '';return u.pathname.match(/^\/contacts\/145742477\/record\/0-47\/(\d+)\/?$/)?.[1]||'';}catch{return '';}
}

export function trackerCandidates(row:{company:string;date:string;meetingId:string;rmId:string},crm:Array<{id:string;company:{name:string}|null;start:string;people:{rms:Array<{id:string}>}}>){
 const normalize=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
 const eligible=crm.filter(c=>c.people.rms.some(p=>p.id===row.rmId));
 if(row.meetingId)return eligible.filter(c=>c.id===row.meetingId);
 return eligible.filter(c=>c.company&&normalize(c.company.name)===normalize(row.company)&&new Date(Date.parse(c.start)+3*3600000).toISOString().slice(0,10)===row.date);
}
