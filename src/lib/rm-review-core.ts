export const CONTACT_REVIEW_FIELDS=['hs_lead_status','unqualified_sub_reason','rm_meeting_outcome','rm_validation_reason','rm_feedback','rm_next_followup_date'];
type Properties=Record<string,string|null|undefined>;
export function contactDisposition(p:Properties={}) {
 const unqualified=p.hs_lead_status==='UNQUALIFIED'||p.rm_meeting_outcome==='Unqualified';
 const noNeed=p.rm_validation_reason==='No need'||p.unqualified_sub_reason==='No Need';
 return {stopped:unqualified||noNeed,reason:unqualified?`Unqualified${p.unqualified_sub_reason||p.rm_validation_reason?' · '+(p.unqualified_sub_reason||p.rm_validation_reason):''}`:noNeed?'No need':'Active / not reviewed'};
}
export function contactReview(p:Properties={}) {
 const stopped=contactDisposition(p).stopped;
 const fields=[{name:'rm_meeting_outcome',label:'RM outcome'},{name:'rm_feedback',label:'RM feedback'},...(stopped?[{name:'rm_validation_reason',label:'Validation / disqualification reason'}]:[{name:'rm_next_followup_date',label:'Next follow-up date'}])];
 return fields.map(f=>({...f,filled:Boolean(String(f.name==='rm_validation_reason'?(p.rm_validation_reason||p.unqualified_sub_reason||''):(p[f.name]||'')).trim()),value:String(p[f.name]|| (f.name==='rm_validation_reason'?p.unqualified_sub_reason:'')||'')}));
}
export function dealReview(p:Properties={},stopped=false) {
 return [{name:'deal_update_rm_notes',label:'RM notes'},...(!stopped?[{name:'deal_next_step',label:'Next step'},{name:'next_step_due_date',label:'Next step due'}]:[])].map(f=>({...f,filled:Boolean(String(p[f.name]||(f.name==='deal_next_step'?p.next_steps_planned_by_rm:'')||'').trim()),value:String(p[f.name]||(f.name==='deal_next_step'?p.next_steps_planned_by_rm:'')||'')}));
}
export function validReviewValue(field:{type:string;options?:Array<{value:string;hidden?:boolean}>},value:string){
 if(!value)return true;
 if(field.type==='enumeration')return Boolean(field.options?.some(o=>o.value===value&&!o.hidden));
 if(field.type==='date')return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 return field.type==='string';
}
