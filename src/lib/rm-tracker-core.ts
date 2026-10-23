import { RM_PROFILES } from './rm-journey-core.ts';
// Exact aliases only: company/title similarity is not sufficient attribution.
export function trackerRmId(name:string){
 const value=name.trim().toLowerCase().replace(/\s+/g,' ');
 return RM_PROFILES.find(p=>[p.name.toLowerCase(),p.short.toLowerCase(),p.slug,p.slug==='zein'?'zain':p.slug==='jehad'?'jihad':''].filter(Boolean).includes(value))?.id||'';
}
export function trackerMeetingId(link:string){
 try {const u=new URL(link);if(!['app.hubspot.com','app-eu1.hubspot.com'].includes(u.hostname)||u.protocol!=='https:')return '';return u.pathname.match(/^\/contacts\/145742477\/record\/0-47\/(\d+)\/?$/)?.[1]||'';}catch{return '';}
}
