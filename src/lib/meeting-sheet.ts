import "server-only";
import { createSign } from "node:crypto";
import { MEETING_SHEETS, parseMeetingTab, type SheetSnapshot } from "./meeting-sheet-data";
const TTL=120_000;
const state=globalThis as typeof globalThis & {__sdrMeetingSheets?: {cached:Map<string,{snapshot:SheetSnapshot;expires:number}>;pending:Map<string,Promise<SheetSnapshot>>}};
const {cached,pending}=state.__sdrMeetingSheets ??= {cached:new Map(),pending:new Map()};
let token:{value:string;expires:number}|undefined;
function credentials() {
  const raw=process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_B64;
  if (!raw) throw new Error("Google Sheets connection is not configured");
  let c: {client_email:string;private_key:string};
  try { c=JSON.parse(Buffer.from(raw,"base64").toString("utf8")); } catch { throw new Error("Google Sheets credentials are invalid"); }
  if(!c.client_email||!c.private_key) throw new Error("Google Sheets credentials are invalid");
  return c;
}
async function accessToken() {
  if(token&&token.expires>Date.now()) return token.value;
  const c=credentials(), now=Math.floor(Date.now()/1000);
  const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
  const input=`${enc({alg:"RS256",typ:"JWT"})}.${enc({iss:c.client_email,scope:"https://www.googleapis.com/auth/spreadsheets.readonly",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600})}`;
  const signature=createSign("RSA-SHA256").update(input).end().sign(c.private_key,"base64url");
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:`${input}.${signature}`}),cache:"no-store",signal:AbortSignal.timeout(10_000)});
  if(!response.ok) throw new Error(`Google Sheets authentication failed (${response.status})`);
  const body=await response.json() as {access_token:string;expires_in:number};
  if(!body.access_token) throw new Error("Google Sheets token missing");
  token={value:body.access_token,expires:Date.now()+Math.max(0,body.expires_in-60)*1000};return token.value;
}
async function googleRead(path:string) {
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`,{headers:{Authorization:`Bearer ${await accessToken()}`},cache:"no-store",signal:AbortSignal.timeout(15_000)});
  if(!response.ok) {
    if(response.status===401) token=undefined;
    throw new Error(response.status===403||response.status===404?`Tracker access unavailable (${response.status}); share this tracker as Viewer with ${credentials().client_email}`:`Google Sheets read failed (${response.status})`);
  }
  return response.json();
}
export async function readMeetingSheet(ownerId:string,force=false): Promise<SheetSnapshot|null> {
  const config=MEETING_SHEETS[ownerId as keyof typeof MEETING_SHEETS];if(!config)return null;
  const previous=cached.get(ownerId);if(!force&&previous&&previous.expires>Date.now())return previous.snapshot;
  const inflight=pending.get(ownerId);if(inflight)return previous?.snapshot ?? inflight;
  const url=`https://docs.google.com/spreadsheets/d/${config.id}/edit`;
  const job=(async():Promise<SheetSnapshot>=>{
    try {
      const meta=await googleRead(`${config.id}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`) as {sheets:{properties:{sheetId:number;title:string;gridProperties:{rowCount:number;columnCount:number}}}[]};
      const tabs=meta.sheets.map(s=>s.properties).filter(s=>config.monthly?/^[A-Za-z]{3} \d{4}$/.test(s.title):s.title==="Meetings Log");
      if(!tabs.length)throw new Error("Tracker meeting tabs are missing");
      const query=new URLSearchParams({valueRenderOption:"FORMATTED_VALUE",dateTimeRenderOption:"FORMATTED_STRING"});
      // Read every existing row, bounded by provider metadata; no fixed 505-row truncation.
      for(const tab of tabs)query.append("ranges",`'${tab.title.replaceAll("'","''")}'!A1:${config.monthly?"R":"O"}${tab.gridProperties.rowCount}`);
      const batch=await googleRead(`${config.id}/values:batchGet?${query}`) as {valueRanges:{values?:unknown[][]}[]};
      if(batch.valueRanges.length!==tabs.length)throw new Error("Incomplete meeting tracker response");
      const parsed=batch.valueRanges.map((r,i)=>{ const result=parseMeetingTab(r.values||[],config.id,tabs[i].sheetId,config.owner); return {...result,warnings:result.warnings.map(w=>`${tabs[i].title}: ${w}`)}; });
      const snapshot:SheetSnapshot={status:"ready",url,syncedAt:new Date().toISOString(),rows:parsed.flatMap(r=>r.rows),warnings:parsed.flatMap(r=>r.warnings)};
      cached.set(ownerId,{snapshot,expires:Date.now()+TTL});return snapshot;
    } catch(error) {
      const reason=error instanceof Error?error.message:"Unable to read tracker";
      const snapshot:SheetSnapshot=previous?.snapshot.status==="ready"?{...previous.snapshot,warnings:[...previous.snapshot.warnings,`Last successful sheet snapshot retained; sync failed: ${reason}`]}:{status:"unavailable",url,syncedAt:"",rows:[],warnings:[],error:reason};
      cached.set(ownerId,{snapshot,expires:Date.now()+30_000});return snapshot;
    }
  })().finally(()=>pending.delete(ownerId));pending.set(ownerId,job);
  // A warm read never waits for Google. Keep the last labelled source visible
  // while the deduplicated refresh updates it for the next poll.
  return previous?.snapshot ?? job;
}
