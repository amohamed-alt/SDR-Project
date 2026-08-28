"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Spotlight({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div className="absolute -left-20 -top-28 h-[34rem] w-[34rem] rounded-full bg-sdr-400/20 blur-[100px]"/>
      <div className="absolute -right-24 top-6 h-[30rem] w-[30rem] rounded-full bg-violet-500/15 blur-[110px]"/>
      <div className="absolute bottom-[-16rem] left-[30%] h-[30rem] w-[30rem] rounded-full bg-blue-500/10 blur-[120px]"/>
    </div>
  );
}

export function AnimatedGrid() {
  const style = {
    backgroundImage:
      "linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)",
    backgroundSize: "42px 42px",
    maskImage: "linear-gradient(to bottom, black 0%, rgba(0,0,0,.78) 45%, transparent 100%)",
  } satisfies CSSProperties;

  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60" style={style}/>;
}

export function BentoCard({
  children,
  className,
  glow = "green",
}: {
  children: ReactNode;
  className?: string;
  glow?: "green" | "blue" | "violet" | "amber";
}) {
  const glowClass = {
    green: "before:bg-sdr-400/20",
    blue: "before:bg-blue-500/16",
    violet: "before:bg-violet-500/16",
    amber: "before:bg-amber-400/16",
  }[glow];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.055] shadow-[0_24px_80px_rgba(0,0,0,.28)] backdrop-blur-2xl",
        "before:pointer-events-none before:absolute before:-right-14 before:-top-14 before:h-40 before:w-40 before:rounded-full before:blur-3xl before:transition-transform before:duration-500 group-hover:before:scale-125",
        glowClass,
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent opacity-70"/>
      {children}
    </div>
  );
}

export function LiveDot({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-sdr-300/15 bg-sdr-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-sdr-200">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-sdr-300 opacity-60"/>
        <span className="relative inline-flex size-2 rounded-full bg-sdr-300"/>
      </span>
      {label}
    </span>
  );
}
