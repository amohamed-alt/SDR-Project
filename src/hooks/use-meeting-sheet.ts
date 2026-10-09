"use client";
import { useEffect, useState } from "react";
import type { SheetSnapshot, sheetMeetingPerformance } from "@/lib/meeting-sheet-data";
export type MeetingSheetResult=SheetSnapshot & {performance:ReturnType<typeof sheetMeetingPerformance>|null};
const pending=new Map<string,Promise<MeetingSheetResult>>();
async function read(key:string) {
  const previous=pending.get(key);if(previous)return previous;
  const job=fetch(`/api/dashboard/meeting-sheet?${key}`,{cache:"no-store",signal:AbortSignal.timeout(45_000)}).then(async r=>{if(!r.ok)throw new Error("Unable to read meeting tracker");return await r.json() as MeetingSheetResult;}).finally(()=>pending.delete(key));pending.set(key,job);return job;
}
export function useMeetingSheet(ownerId:string,from:string,to:string,refreshKey:number,enabled=true) {
  const key=new URLSearchParams({ownerId,from,to}).toString();
  const [state,setState]=useState<{key:string;data?:MeetingSheetResult;error?:string}>({key});
  useEffect(()=>{
    if(!enabled)return;
    let alive=true, timer:ReturnType<typeof setTimeout>;
    const update=async()=>{
      try { const data=await read(key);if(alive)setState({key,data}); }
      catch(e){if(alive)setState(old=>({key,data:old.key===key?old.data:undefined,error:e instanceof Error?e.message:"Tracker unavailable"}));}
      if(alive)timer=setTimeout(()=>{if(!document.hidden)void update();else timer=setTimeout(update,30_000);},30_000);
    };
    void update();return()=>{alive=false;clearTimeout(timer);};
  },[key,enabled,refreshKey]);
  return state.key===key?state:{key};
}
