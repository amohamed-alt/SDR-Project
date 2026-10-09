"use client";
import { useEffect, useRef, useState } from "react";
import type { SheetSnapshot, sheetMeetingPerformance } from "@/lib/meeting-sheet-data";
export type MeetingSheetResult=SheetSnapshot & {performance:ReturnType<typeof sheetMeetingPerformance>|null};
const pending=new Map<string,Promise<MeetingSheetResult>>();
const cache=new Map<string,MeetingSheetResult>();
async function read(key:string) {
  const previous=pending.get(key);if(previous)return previous;
  const job=fetch(`/api/dashboard/meeting-sheet?${key}`,{cache:"no-store",signal:AbortSignal.timeout(45_000)}).then(async r=>{if(!r.ok)throw new Error("Unable to read meeting tracker");return await r.json() as MeetingSheetResult;}).finally(()=>pending.delete(key));pending.set(key,job);return job;
}
export function useMeetingSheet(ownerId:string,from:string,to:string,refreshKey:number,enabled=true) {
  const key=new URLSearchParams({ownerId,from,to}).toString();
  const consumedRefresh=useRef(0);
  const [state,setState]=useState<{key:string;data?:MeetingSheetResult;error?:string}>({key,data:cache.get(key)});
  useEffect(()=>{
    if(!enabled)return;
    let alive=true, timer:ReturnType<typeof setTimeout>;
    const force=refreshKey>consumedRefresh.current;consumedRefresh.current=refreshKey;
    const update=async(refresh=false)=>{
      if(document.hidden){timer=setTimeout(()=>void update(),30_000);return;}
      try { const data=await read(`${key}${refresh?"&refresh=1":""}`);cache.set(key,data);while(cache.size>12)cache.delete(cache.keys().next().value!);if(alive)setState({key,data}); }
      catch(e){if(alive)setState(old=>({key,data:old.key===key?old.data:undefined,error:e instanceof Error?e.message:"Tracker unavailable"}));}
      if(alive)timer=setTimeout(()=>void update(),30_000);
    };
    void update(force);return()=>{alive=false;clearTimeout(timer);};
  },[key,enabled,refreshKey]);
  return state.key===key?state:{key,data:cache.get(key)};
}
