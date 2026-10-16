"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle2, ClipboardCopy, Download,
  Eye, Filter, LockKeyhole, Phone, Radar, RefreshCw, Search,
  ShieldCheck, Sparkles, UsersRound, XCircle,
} from "lucide-react";
import styles from "./MeetingCreatorQueue.module.css";

type Status = "call_ready" | "needs_research" | "protected";
type Motion = "new_contact" | "reactivation" | "blocked";
type Lead = {
  key: string;
  companyId: string;
  companyName: string;
  domain: string;
  employeeCount: number;
  status: Status;
  motion: Motion;
  reason: string;
  recommendedProduct: string;
  talenteraScore: number;
  evalufyScore: number;
  priority: number;
  sdrId: string;
  sdrName: string;
  contactId: string;
  contactName: string;
  contactTitle: string;
  contactPhone: string;
  phoneEvidence: string;
  contactLinkedIn: string;
  attemptedCalls: number;
  connectedCalls: number;
  openTasks: number;
};
type QueueData = {
  generatedAt: string;
  previewOnly: boolean;
  source?: string;
  note?: string;
  summary: {
    readFromInventory: number;
    scanned: number;
    crmMatched?: number;
    callReady: number;
    needsResearch: number;
    protected: number;
    maritaReady?: number;
    danielReady?: number;
  };
  pagination: {
    offset: number;
    scan: number;
    nextOffset: number;
    sourceTotal: number;
  };
  accounts: Lead[];
  policy?: { phoneNote?: string };
  error?: string;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n || 0);
}
function csvEscape(v: unknown) {
  const value = String(v ?? "");
  // Escaping quotation marks is not enough to prevent CSV formula injection.
  const safe = /^\s*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g,'""')}"`;
}
function humanStatus(status: Status) {
  if(status==="call_ready")return "Call-ready · review";
  if(status==="needs_research")return "Needs research";
  return "Protected";
}

export function MeetingCreatorQueue() {
  const [offset,setOffset] = useState(0);
  const [refresh,setRefresh] = useState(0);
  const [data,setData] = useState<QueueData|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [query,setQuery] = useState("");
  const [status,setStatus] = useState<Status|"all">("all");
  const [owner,setOwner] = useState("all");
  const [mode,setMode] = useState<"all"|"new_contact"|"reactivation">("all");
  const [selectedKeys,setSelectedKeys] = useState<string[]>([]);
  const [pushing,setPushing] = useState(false);

  const load = useCallback(async (signal: AbortSignal)=>{
    setLoading(true);setError("");
    try {
      const response = await fetch(`/api/meeting-creator/queue?offset=${offset}&scan=60&limit=50`,{cache:"no-store",signal});
      const payload=await response.json() as QueueData;
      if(!response.ok) throw new Error(payload.error || "Unable to load Meeting Creator preview.");
      if(!signal.aborted)setData(payload);
    }catch(cause) {
      if(!signal.aborted){
        setData(null);
        setError(cause instanceof Error?cause.message:"Read-only queue request failed.");
      }
    }finally {if(!signal.aborted)setLoading(false);}
  },[offset]);
  useEffect(()=>{
    const controller=new AbortController();
    const scheduled=window.setTimeout(()=>{void load(controller.signal);},0);
    return ()=>{window.clearTimeout(scheduled);controller.abort();};
  },[load,refresh]);

  const shown=useMemo(()=>{
    const text=query.trim().toLowerCase();
    return (data?.accounts||[]).filter((item)=>{
      if(status!=="all"&&item.status!==status)return false;
      if(owner!=="all"&&item.sdrName!==owner)return false;
      if(mode!=="all"&&item.motion!==mode)return false;
      return !text||[item.companyName,item.domain,item.contactName,item.contactTitle,item.reason,item.recommendedProduct].join(" ").toLowerCase().includes(text);
    });
  },[data,query,status,owner,mode]);

  function csv() {
    const rows=shown.filter((row)=>row.status==="call_ready");
    const headers=["Company","Domain","Product","Priority","Owner","Contact","Title","Phone","LinkedIn","Motion","Reason"];
    const lines=[headers, ...rows.map((x)=>[
      x.companyName,x.domain,x.recommendedProduct,String(x.priority),x.sdrName,
      x.contactName,x.contactTitle,x.contactPhone,x.contactLinkedIn,x.motion,x.reason,
    ])].map((row)=>row.map(csvEscape).join(",")).join("\n");
    const blob=new Blob(["\uFEFF"+lines],{type:"text/csv;charset=utf-8"});
    const href=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=href;a.download="meeting-creator-call-ready-review.csv";a.click();
    URL.revokeObjectURL(href);
    setNotice(`Exported ${rows.length} call-ready review candidates from this page. No HubSpot tasks were created.`);
  }
  function toggleLead(key:string,checked:boolean) {
    setSelectedKeys((previous)=>checked? [...new Set([...previous,key])].slice(0,10): previous.filter((item)=>item!==key));
  }
  async function pushSelected() {
    const candidates=(data?.accounts||[]).filter((item)=>selectedKeys.includes(item.key)&&item.status==="call_ready").slice(0,10);
    if(!candidates.length) {setError("Select a call-ready contact first.");return;}
    if(!window.confirm(`Create ${candidates.length} HubSpot CALL task(s) after a fresh live check of contacts, CRM history, ownership and duplicates? No Apollo or SignalHire credits will be spent.`))return;
    setError("");setNotice("");setPushing(true);
    try {
      const response=await fetch("/api/meeting-creator/push",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"push_selected",offset,choices:candidates.map((x)=>({companyId:x.companyId,contactId:x.contactId}))}),
      });
      const result=await response.json() as {error?:string;created?:number;skipped?:number;results?:Array<{companyId:string;status:string;reason?:string}>};
      if(!response.ok)throw new Error(result.error||"HubSpot push was rejected.");
      setSelectedKeys([]);
      setNotice(`HubSpot: ${result.created||0} created, ${result.skipped||0} held for review. Only confirmed writes count.`);
      if((result.skipped||0)>0)setError((result.results||[]).filter((x)=>x.status!=="created").map(x=>x.reason||"Needs review").slice(0,3).join(" · "));
      setRefresh(n=>n+1);
    }catch(cause) {
      setError(cause instanceof Error?cause.message:"Push failed. Reconcile before retrying.");
    }finally {setPushing(false);}
  }
  async function copy(number:string) {
    try{await navigator.clipboard.writeText(number);setNotice("Phone copied.");}
    catch{setNotice("Copy failed. You can select the phone number manually.");}
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.top}>
        <div className={styles.identity}>
          <Link className={styles.back} href="/best-accounts"><ArrowLeft size={15}/> Best Accounts</Link>
          <span className={styles.eyebrow}><Radar size={14}/> GTM EXECUTION · ZERO CREDIT MODE</span>
          <h1>Meeting Creator <span>Daily Queue</span></h1>
          <p>Saudi Arabia · Talentera + Evalufy · real HubSpot history · protected-account gating</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.readOnly}><LockKeyhole size={14}/> Admin-approved push</span>
          <button className={styles.refresh} type="button" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15} className={loading?styles.spin:""}/> Refresh</button>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span><Sparkles size={13}/> LEADS WITH CONTEXT, NOT JUST NAMES</span>
          <h2>Find the next reachable decision maker.</h2>
          <p>Existing company does not mean excluded. Unanswered old calls can become a new opportunity—only when there is a different valid HR contact, no connected conversation, no open task or deal, and no customer ownership conflict.</p>
        </div>
        <div className={styles.heroRight}>
          <div><span>Target throughput</span><strong>1,000 / mo</strong><small>Planning capacity, not a validated output</small></div>
          <div><span>Credit cost for this page</span><strong>$0</strong><small>Existing Postgres + HubSpot only</small></div>
        </div>
      </section>

      {error?<div className={styles.error}><XCircle size={17}/><div><strong>Queue unavailable</strong><p>{error}</p><small>For admin-protected records, unlock the dashboard tools session first. No leads were pushed.</small></div></div>:null}
      {notice?<div className={styles.notice} role="status"><CheckCircle2 size={16}/><span>{notice}</span><button onClick={()=>setNotice("")} aria-label="Dismiss notice"><XCircle size={15}/></button></div>:null}

      <section className={styles.kpis}>
        <article><span><Phone size={15}/> CALL-READY TO REVIEW</span><strong>{loading?"—":fmt(data?.summary.callReady||0)}</strong><small>Available in current scanned batch</small></article>
        <article><span><UsersRound size={15}/> MARITA / DANIEL</span><strong>{loading?"—":`${data?.summary.maritaReady||0} / ${data?.summary.danielReady||0}`}</strong><small>Preserve existing SDR ownership</small></article>
        <article><span><Search size={15}/> NEEDS RESEARCH</span><strong>{loading?"—":fmt(data?.summary.needsResearch||0)}</strong><small>Identity, phone, or activity uncertain</small></article>
        <article><span><ShieldCheck size={15}/> PROTECTED</span><strong>{loading?"—":fmt(data?.summary.protected||0)}</strong><small>Connected, customer, owner, deal, or task</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div><span><Filter size={13}/> QUEUE CONTROL</span><h3>Research candidates</h3><small>Reviewed from existing cached sources · No CRM writes</small></div>
          <div className={styles.batchActions}>
            <button type="button" className={styles.export} onClick={csv} disabled={loading||!shown.some(x=>x.status==="call_ready")}><Download size={15}/> Export call-ready review</button>
            <button type="button" className={styles.push} onClick={()=>void pushSelected()} disabled={loading||pushing||selectedKeys.length===0}><CheckCircle2 size={15}/> {pushing?"Rechecking CRM…":`Push ${selectedKeys.length} selected to HubSpot`}</button>
          </div>
        </div>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={15}/><input aria-label="Search companies or contacts" placeholder="Company, domain, title, product…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value as Status|"all")}><option value="all">All</option><option value="call_ready">Call-ready</option><option value="needs_research">Needs research</option><option value="protected">Protected</option></select></label>
          <label><span>SDR</span><select value={owner} onChange={e=>setOwner(e.target.value)}><option value="all">Both SDRs</option><option value="Marita">Marita</option><option value="Daniel">Daniel</option></select></label>
          <label><span>Motion</span><select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="all">All</option><option value="new_contact">Untouched</option><option value="reactivation">Reactivation</option></select></label>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>SELECT</th><th>ACCOUNT / ROUTE</th><th>DECISION MAKER</th><th>PHONE</th><th>QUALIFICATION</th><th>STATUS</th></tr></thead>
            <tbody>
              {shown.map((lead)=><tr key={lead.key}>
                <td><input type="checkbox" className={styles.selectLead} aria-label={`Select ${lead.contactName} at ${lead.companyName} for HubSpot task`} checked={selectedKeys.includes(lead.key)} disabled={lead.status!=="call_ready"||pushing||(!selectedKeys.includes(lead.key)&&selectedKeys.length>=10)} onChange={(event)=>toggleLead(lead.key,event.target.checked)}/></td>
                <td><strong>{lead.companyName}</strong><small>{lead.domain} · {fmt(lead.employeeCount)} employees</small><span className={styles.tinyPill}>{lead.recommendedProduct}</span><small>Talentera {lead.talenteraScore} · Evalufy {lead.evalufyScore} · Priority {lead.priority}</small></td>
                <td><strong>{lead.contactName||"Find HR decision maker"}</strong><small>{lead.contactTitle||"Profile pending"}</small><small>{lead.sdrName||"Owner under review"}</small></td>
                <td>{lead.contactPhone?<div className={styles.number}><span>{lead.contactPhone}</span><button type="button" onClick={()=>void copy(lead.contactPhone)} title="Copy phone"><ClipboardCopy size={14}/></button></div>:<span className={styles.muted}>Not verified for review</span>}<small>{lead.contactPhone?"Saudi mobile format · not dial-verified":""}</small></td>
                <td><small>{lead.reason}</small><span className={styles.context}>{lead.attemptedCalls} unanswered attempts · {lead.connectedCalls} connected · {lead.openTasks} open tasks</span></td>
                <td><span className={styles.status} data-kind={lead.status}>{humanStatus(lead.status)}</span>{lead.companyId?<a className={styles.crm} href={`https://app.hubspot.com/contacts/145742477/company/${lead.companyId}?utm_source=meeting_creator&utm_medium=dashboard`} target="_blank" rel="noopener noreferrer">HubSpot <Eye size={12}/></a>:null}</td>
              </tr>)}
              {!loading&&!shown.length?<tr><td colSpan={6} className={styles.empty}>No matching records on this inventory page. Adjust filters or scan the next batch.</td></tr>:null}
              {loading?<tr><td colSpan={6} className={styles.empty}>Checking existing company associations and SDR history…</td></tr>:null}
            </tbody>
          </table>
        </div>
        <footer className={styles.footer}>
          <small>Inventory page {Math.floor(offset/60)+1} · scanned {data?.summary.scanned||0} · total stored {fmt(data?.pagination.sourceTotal||0)} · page phone data is protected by the admin session</small>
          <div>
            <button type="button" onClick={()=>{setSelectedKeys([]);setOffset(Math.max(0,offset-60));}} disabled={loading||offset===0}><ArrowLeft size={14}/> Previous</button>
            <button type="button" onClick={()=>{setSelectedKeys([]);setOffset(data?.pagination.nextOffset||offset+60);}} disabled={loading||!data?.pagination||data.pagination.nextOffset>=data.pagination.sourceTotal}>Next batch <ArrowRight size={14}/></button>
          </div>
        </footer>
      </section>

      <p className={styles.disclaimer}><ShieldCheck size={14}/> Only contacts explicitly selected by the admin can create tasks, after fresh CRM checks. This page never sends emails, LinkedIn requests, phone reveals or paid enrichment. Phone format is not proof of reachability.</p>
    </div>
  </main>;
}
