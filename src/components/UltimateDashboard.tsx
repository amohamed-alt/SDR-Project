"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  Database,
  Gauge,
  Layers3,
  LoaderCircle,
  MailCheck,
  Orbit,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  WandSparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AnimatedGrid, BentoCard, LiveDot, Spotlight } from "@/components/ultimate/AceternityEffects";
import { EChartsPulse } from "@/components/ultimate/EChartsPulse";
import { RevenueOrb } from "@/components/ultimate/RevenueOrb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData } from "@/lib/types";

const OWNER_ID = "31644369";
const CHART_COLORS = ["#4bd59a", "#4f8cff", "#8b6cff", "#f4b740", "#ef6b78", "#55d6d0"];

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: isoDay(from), to: isoDay(to) };
}

function number(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function timeAgo(value: string) {
  const date = new Date(value).getTime();
  const delta = Math.max(0, Date.now() - date);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Metric({
  label,
  value,
  helper,
  icon: Icon,
  tone = "green",
}: {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone?: "green" | "blue" | "violet" | "amber";
}) {
  const toneClass = {
    green: "from-sdr-400/20 to-sdr-400/0 text-sdr-200 border-sdr-300/15",
    blue: "from-blue-500/20 to-blue-500/0 text-blue-200 border-blue-300/15",
    violet: "from-violet-500/20 to-violet-500/0 text-violet-200 border-violet-300/15",
    amber: "from-amber-400/20 to-amber-400/0 text-amber-100 border-amber-300/15",
  }[tone];

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.012 }}
      transition={{ type: "spring", stiffness: 330, damping: 24 }}
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${toneClass} p-4 backdrop-blur-xl`}
    >
      <div className="absolute -right-7 -top-7 size-24 rounded-full bg-current opacity-[0.06] blur-xl"/>
      <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/52">
        <span>{label}</span>
        <Icon size={16} className="text-current"/>
      </div>
      <strong className="mt-4 block font-display text-[27px] font-extrabold tracking-[-0.05em] text-white">{value}</strong>
      <span className="mt-2 block text-[10px] leading-4 text-white/48">{helper}</span>
    </motion.div>
  );
}

function StackChip({ children }: { children: string }) {
  return <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-[9px] font-bold tracking-[0.08em] text-white/58 backdrop-blur-xl">{children}</span>;
}

function DarkTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-sdr-950/95 px-3 py-2 text-[10px] text-white shadow-2xl backdrop-blur-xl">
      {label ? <strong className="mb-1 block text-white/75">{label}</strong> : null}
      {payload.map((item, index) => (
        <div className="flex min-w-32 items-center gap-2 py-0.5" key={`${item.name ?? "value"}-${index}`}>
          <span className="size-1.5 rounded-full" style={{ background: item.color }}/>
          <span className="text-white/52">{item.name}</span>
          <b className="ml-auto text-white">{number(item.value ?? 0)}</b>
        </div>
      ))}
    </div>
  );
}

export function UltimateDashboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const range = useMemo(defaultRange, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ from: range.from, to: range.to, ownerId: OWNER_ID });
      if (refreshKey) query.set("refresh", "1");
      const response = await fetch(`/api/dashboard?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load dashboard intelligence");
      setData(payload as DashboardData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load dashboard intelligence");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, refreshKey]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (reducedMotion) return;
    const lenis = new Lenis({ duration: 0.95, smoothWheel: true });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion || !rootRef.current || !data) return;
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-gsap-reveal]").forEach((element) => {
        gsap.fromTo(
          element,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.72,
            ease: "power3.out",
            scrollTrigger: { trigger: element, start: "top 90%", once: true },
          },
        );
      });
    }, rootRef);
    ScrollTrigger.refresh();
    return () => context.revert();
  }, [data, reducedMotion]);

  const model = useMemo(() => {
    if (!data) return null;
    const qualityAverage = data.quality.length
      ? Math.round(data.quality.reduce((sum, item) => sum + item.rate, 0) / data.quality.length)
      : 0;
    const priority = [...data.priorityContacts].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 6);
    const alerts = data.alerts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
    const totalExecution = data.dailyActivities.reduce(
      (sum, item) => sum + item.calls + item.tasksCompleted + item.meetingsBooked + item.emailsSent + item.whatsAppMessages,
      0,
    );
    const meetingYield = data.kpis.connectedCalls
      ? Math.round((data.kpis.bookedMeetings / data.kpis.connectedCalls) * 1000) / 10
      : 0;
    return { qualityAverage, priority, alerts, totalExecution, meetingYield };
  }, [data]);

  const entrance = reducedMotion ? false : { opacity: 0, y: 16 };

  return (
    <main ref={rootRef} className="min-h-screen bg-[#061511] text-white selection:bg-sdr-400/25">
      <section className="relative min-h-[720px] overflow-hidden border-b border-white/8">
        <Spotlight/>
        <AnimatedGrid/>
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#061511] to-transparent"/>

        <div className="relative z-10 mx-auto w-[min(1560px,calc(100%-32px))] px-1 pb-12 pt-5 md:px-3 md:pt-7">
          <motion.header
            initial={entrance}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.04] p-3 backdrop-blur-xl md:flex-row md:items-center md:justify-between"
          >
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={15}/>Dashboard</Button>
              <div className="h-6 w-px bg-white/10"/>
              <div>
                <div className="flex items-center gap-2"><Sparkles size={15} className="text-sdr-300"/><strong className="font-display text-sm">Ultimate SDR Command Center</strong></div>
                <span className="mt-0.5 block text-[9px] text-white/38">Experimental premium interface · read-only analytics</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data ? <LiveDot label={data.meta.isDemo ? "Demo data" : "HubSpot live"}/> : null}
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[9px] text-white/45">30-day window</span>
              <Button variant="secondary" size="sm" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""}/>Refresh
              </Button>
            </div>
          </motion.header>

          <div className="grid min-h-[590px] items-center gap-8 py-12 lg:grid-cols-[1.08fr_.92fr] lg:py-8">
            <motion.div
              initial={entrance}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.62, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10"
            >
              <div className="mb-5 flex flex-wrap gap-2">
                <StackChip>Next.js 16</StackChip><StackChip>React 19</StackChip><StackChip>Tailwind CSS</StackChip>
                <StackChip>Motion</StackChip><StackChip>GSAP</StackChip><StackChip>Lenis</StackChip>
              </div>
              <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-sdr-300"><WandSparkles size={15}/>Revenue intelligence, redesigned</span>
              <h1 className="mt-5 max-w-[880px] text-balance font-display text-[clamp(42px,6vw,82px)] font-extrabold leading-[0.95] tracking-[-0.065em] text-white">
                Your SDR operation as a <span className="bg-gradient-to-r from-sdr-300 via-sdr-400 to-cyan-300 bg-clip-text text-transparent">living system.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-[13px] leading-7 text-white/48">
                The same verified HubSpot data, rendered as a fast executive cockpit with layered motion, real-time execution signals, 3D intelligence and dense operational drill-downs.
              </p>
              {data?.meta.warnings.length ? <div className="mt-5 max-w-2xl rounded-xl border border-amber-300/15 bg-amber-300/7 px-4 py-3 text-[10px] leading-5 text-amber-100/70">{data.meta.warnings.join(" · ")}</div> : null}
            </motion.div>

            <motion.div
              initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="relative min-h-[420px]"
            >
              <div className="absolute inset-10 rounded-full bg-sdr-400/10 blur-[70px]"/>
              <RevenueOrb/>
              <div className="absolute left-4 top-8 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl">
                <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-white/38">Pipeline</span>
                <strong className="mt-1 block font-display text-xl tracking-[-0.04em]">{data ? money(data.kpis.pipelineValue) : "—"}</strong>
              </div>
              <div className="absolute bottom-10 right-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl">
                <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-white/38">Connection rate</span>
                <strong className="mt-1 block font-display text-xl tracking-[-0.04em] text-sdr-300">{data ? `${data.kpis.connectionRate}%` : "—"}</strong>
              </div>
            </motion.div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-300/20 bg-rose-400/8 p-5 text-sm text-rose-100">
              <strong>Dashboard data could not load.</strong><span className="ml-2 text-rose-100/65">{error}</span>
              <Button className="ml-4" variant="secondary" size="sm" onClick={() => void load()}>Retry</Button>
            </div>
          ) : null}

          {loading && !data ? (
            <div className="flex min-h-[180px] items-center justify-center gap-3 text-white/55"><LoaderCircle className="animate-spin"/><span className="text-sm">Building the ultimate view from HubSpot…</span></div>
          ) : null}
        </div>
      </section>

      {data && model ? (
        <div className="mx-auto w-[min(1560px,calc(100%-32px))] space-y-6 py-8 pb-24">
          <section data-gsap-reveal className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Portfolio" value={number(data.kpis.portfolioContacts)} helper={`${number(data.kpis.newContacts)} created in period`} icon={UsersRound}/>
            <Metric label="Connected" value={number(data.kpis.connectedCalls)} helper={`${data.kpis.connectionRate}% connection rate`} icon={PhoneCall} tone="blue"/>
            <Metric label="Meetings" value={number(data.kpis.bookedMeetings)} helper={`${model.meetingYield}% of connected calls`} icon={Target} tone="violet"/>
            <Metric label="Open deals" value={number(data.kpis.openDeals)} helper={money(data.kpis.pipelineValue)} icon={BriefcaseBusiness} tone="amber"/>
            <Metric label="Execution" value={number(model.totalExecution)} helper="Tracked actions in 30 days" icon={Zap}/>
            <Metric label="Data quality" value={`${model.qualityAverage}%`} helper={`${data.quality.length} quality dimensions`} icon={ShieldCheck} tone="blue"/>
          </section>

          <section data-gsap-reveal className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
            <BentoCard className="p-5" glow="green">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div><span className="text-[9px] font-black uppercase tracking-[0.18em] text-sdr-300">ECharts pulse</span><h2 className="mt-1 font-display text-lg font-extrabold tracking-[-0.035em]">Connected calls vs meetings</h2><p className="mt-1 text-[10px] text-white/40">High-density trend rendering over the latest 21 days.</p></div>
                <TrendingUp className="text-sdr-300" size={20}/>
              </div>
              <EChartsPulse data={data.dailyActivities}/>
            </BentoCard>

            <BentoCard className="p-5" glow="violet">
              <div className="flex items-start justify-between gap-3"><div><span className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-200">Action radar</span><h2 className="mt-1 font-display text-lg font-extrabold tracking-[-0.035em]">What needs attention</h2></div><Gauge className="text-violet-200" size={20}/></div>
              <div className="mt-5 space-y-2.5">
                {model.alerts.length ? model.alerts.map((alert) => (
                  <div key={alert.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.035] p-3">
                    <span className={`size-2 rounded-full ${alert.severity === "critical" ? "bg-rose-400" : alert.severity === "warning" ? "bg-amber-300" : "bg-blue-300"}`}/>
                    <div className="min-w-0 flex-1"><strong className="block truncate text-[10px] text-white/80">{alert.title}</strong><span className="mt-1 block truncate text-[8px] text-white/34">{alert.detail}</span></div>
                    <b className="font-display text-lg text-white">{number(alert.count)}</b>
                  </div>
                )) : <div className="grid min-h-[240px] place-items-center text-center text-white/36"><div><BadgeCheck className="mx-auto mb-3 text-sdr-300"/><span className="text-xs">No active operational alerts</span></div></div>}
              </div>
            </BentoCard>
          </section>

          <section data-gsap-reveal className="grid gap-4 lg:grid-cols-2">
            <BentoCard className="p-5" glow="blue">
              <div className="mb-5 flex items-center justify-between"><div><span className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-200">Recharts execution</span><h2 className="mt-1 font-display text-lg font-extrabold">Daily activity velocity</h2></div><Activity size={20} className="text-blue-200"/></div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.dailyActivities.slice(-21)} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ultimateCalls" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4bd59a" stopOpacity={0.36}/><stop offset="100%" stopColor="#4bd59a" stopOpacity={0}/></linearGradient>
                    <linearGradient id="ultimateTasks" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f8cff" stopOpacity={0.26}/><stop offset="100%" stopColor="#4f8cff" stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,.06)"/>
                  <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.35)", fontSize: 9 }}/>
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.3)", fontSize: 9 }}/>
                  <Tooltip content={<DarkTooltip/>}/>
                  <Area type="monotone" dataKey="calls" name="Calls" stroke="#4bd59a" strokeWidth={2.5} fill="url(#ultimateCalls)"/>
                  <Area type="monotone" dataKey="tasksCompleted" name="Tasks" stroke="#4f8cff" strokeWidth={2} fill="url(#ultimateTasks)"/>
                </AreaChart>
              </ResponsiveContainer>
            </BentoCard>

            <BentoCard className="p-5" glow="amber">
              <div className="mb-5 flex items-center justify-between"><div><span className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-100">Conversion architecture</span><h2 className="mt-1 font-display text-lg font-extrabold">SDR funnel</h2></div><BarChart3 size={20} className="text-amber-200"/></div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.funnel} layout="vertical" margin={{ left: 4, right: 16, top: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke="rgba(255,255,255,.055)"/>
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.3)", fontSize: 9 }}/>
                  <YAxis type="category" dataKey="name" width={76} axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.46)", fontSize: 9 }}/>
                  <Tooltip content={<DarkTooltip/>}/>
                  <Bar dataKey="value" name="Contacts" radius={[0, 8, 8, 0]}>
                    {data.funnel.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]}/>) }
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </BentoCard>
          </section>

          <section data-gsap-reveal className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]">
            <Card className="border-slate-200/70 bg-[#f8fbf9] text-slate-900">
              <CardHeader>
                <div><CardTitle className="flex items-center gap-2"><BrainCircuit size={17} className="text-sdr-600"/>Modern stack map</CardTitle><CardDescription>Every visual layer is isolated from CRM write logic.</CardDescription></div>
                <Layers3 size={18} className="text-slate-400"/>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3">
                  {["Next.js + React", "Tailwind CSS", "shadcn/ui", "Motion", "GSAP + ScrollTrigger", "Lenis", "Lucide", "Aceternity patterns", "Recharts", "ECharts", "Three.js + R3F", "Figma tokens"].map((tool) => (
                    <div key={tool} className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-sm"><BadgeCheck size={14} className="text-sdr-600"/><span className="font-semibold text-slate-600">{tool}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/70 bg-white text-slate-900">
              <CardHeader>
                <div><CardTitle className="flex items-center gap-2"><Target size={17} className="text-sdr-600"/>Priority accounts & people</CardTitle><CardDescription>Highest current priority scores from the existing HubSpot-backed model.</CardDescription></div>
                <Button variant="light" size="sm" onClick={onBack}>Open operations <ArrowUpRight size={14}/></Button>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  {model.priority.map((contact, index) => (
                    <a key={contact.id} href={contact.url} target="_blank" rel="noreferrer" className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-3 py-3 transition-colors last:border-0 hover:bg-sdr-50">
                      <span className="grid size-8 place-items-center rounded-lg bg-sdr-100 text-[10px] font-black text-sdr-700">{index + 1}</span>
                      <div className="min-w-0"><strong className="block truncate text-[11px] text-slate-800">{contact.name || "Unnamed contact"}</strong><span className="mt-1 block truncate text-[9px] text-slate-400">{contact.company || "No company"} · {contact.title || "No title"}</span></div>
                      <div className="text-right"><strong className="font-display text-base text-sdr-700">{contact.priorityScore}</strong><span className="block text-[8px] text-slate-400">priority</span></div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section data-gsap-reveal className="grid gap-4 md:grid-cols-3">
            <Card className="bg-white text-slate-900"><CardContent className="flex items-center gap-4 p-5"><span className="grid size-11 place-items-center rounded-2xl bg-sdr-100 text-sdr-700"><Database size={20}/></span><div><span className="text-[9px] uppercase tracking-[0.14em] text-slate-400">Source of truth</span><strong className="mt-1 block text-sm">HubSpot remains untouched</strong></div></CardContent></Card>
            <Card className="bg-white text-slate-900"><CardContent className="flex items-center gap-4 p-5"><span className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-blue-600"><Building2 size={20}/></span><div><span className="text-[9px] uppercase tracking-[0.14em] text-slate-400">Companies</span><strong className="mt-1 block text-sm">{number(data.kpis.companies)} represented</strong></div></CardContent></Card>
            <Card className="bg-white text-slate-900"><CardContent className="flex items-center gap-4 p-5"><span className="grid size-11 place-items-center rounded-2xl bg-violet-50 text-violet-600"><MailCheck size={20}/></span><div><span className="text-[9px] uppercase tracking-[0.14em] text-slate-400">Freshness</span><strong className="mt-1 block text-sm">Generated {timeAgo(data.meta.generatedAt)}</strong></div></CardContent></Card>
          </section>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-white/8 pt-5 text-center text-[9px] text-white/30 sm:flex-row sm:text-left">
            <span className="flex items-center gap-2"><Orbit size={13}/>Ultimate view is presentation-only; production CRM rules remain owned by the existing SDR system.</span>
            <span>Motion + GSAP + Lenis + Recharts + ECharts + Three.js</span>
          </div>
        </div>
      ) : null}
    </main>
  );
}
