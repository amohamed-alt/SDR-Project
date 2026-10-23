import type { HubSpotOwner, HubSpotRecord } from './types.ts';
export const RM_PROFILES = [
  { slug:'zein', id:'31558980', name:'Zein Fares', short:'Zein', initials:'ZF' },
  { slug:'jehad', id:'76370000', name:'Mohammad Jehad Al-Barqawi', short:'Jehad', initials:'JA' },
  { slug:'fadi', id:'76369998', name:'Fadi Zanona', short:'Fadi', initials:'FZ' },
  { slug:'faizan', id:'76369995', name:'Mohammad Faizan', short:'Faizan', initials:'MF' },
  { slug:'ursula', id:'76369997', name:'Ursula Waked', short:'Ursula', initials:'UW' },
  { slug:'bassam', id:'75863674', name:'Bassam Hamed', short:'Bassam', initials:'BH' },
] as const;
export const SDR_PROFILES = [{id:'31644369',name:'Marita',key:'marita'},{id:'37624223',name:'Daniel',key:'daniel'}] as const;
export function attendeeIds(raw: string | null | undefined): string[] {
  return [...new Set(String(raw||'').split(/[;,\s\[\]"]+/).filter(id=>/^\d+$/.test(id)))];
}
export function participation(record: HubSpotRecord, owners: HubSpotOwner[]) {
  const p=record.properties;
  const attendees=attendeeIds(p.hs_attendee_owner_ids);
  const creator=owners.find(o=>o.userId && o.userId===p.hs_created_by_user_id)?.id||'';
  const assigned=String(p.hubspot_owner_id||'');
  const roles=(id:string)=>[...(creator===id?['Creator']:[]),...(assigned===id?['Assigned owner']:[]),...(attendees.includes(id)?['Attendee']:[])];
  const marker=String(p.hs_internal_meeting_notes||'').match(/\bbooked by\s+(marita|daniel)\b/i)?.[1].toLowerCase();
  const sdrs=SDR_PROFILES.flatMap(s=>{const evidence=roles(s.id);if(marker===s.key)evidence.push('Booking note');return evidence.length?[{...s,roles:evidence,booked:creator===s.id||marker===s.key}]:[];});
  const rms=RM_PROFILES.flatMap(r=>{const evidence=roles(r.id);return evidence.length?[{...r,roles:evidence}]:[];});
  return { creatorId:creator, assignedId:assigned, attendees, sdrs, rms };
}
export function plainText(value: unknown): string {
 return String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
}
export function afterMeeting(at:string, end:string, now:string) {
 const t=Date.parse(at);return Number.isFinite(t)&&t>Date.parse(end)+60000&&t<=Date.parse(now);
}

// CRM ownership establishes responsibility, never attendance or booking credit.
export function withResponsibleOwners(rms: Array<(typeof RM_PROFILES)[number] & {roles:string[]}>, ids:string[], source:string) {
 const result=rms.map(r=>({...r,roles:[...r.roles]}));
 for(const profile of RM_PROFILES) if(ids.includes(profile.id)&&!result.some(r=>r.id===profile.id)) result.push({...profile,roles:[source+' · attendance unverified']});
 return result;
}
