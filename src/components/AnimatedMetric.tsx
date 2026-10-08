"use client";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

export function AnimatedMetric({ value }: { value: string }) {
  const reduced = useReducedMotion();
  const numeric = Number(value.replace(/[^\d.-]/g,""));
  const amount = useMotionValue(Number.isFinite(numeric) ? numeric : 0);
  const spring = useSpring(amount, { stiffness:90, damping:24, mass:.7 });
  const decimals = value.match(/\.(\d+)/)?.[1].length ?? 0;
  const prefix = value.startsWith("$") ? "$" : "";
  const suffix = value.endsWith("%") ? "%" : "";
  const formatted = useTransform(spring, current => `${prefix}${new Intl.NumberFormat("en-US", {minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(current)}${suffix}`);
  useEffect(()=>{if(Number.isFinite(numeric))amount.set(numeric);},[numeric,amount]);
  if(reduced || !Number.isFinite(numeric) || value === "—")return <>{value}</>;
  return <span aria-label={value}><motion.span aria-hidden="true">{formatted}</motion.span></span>;
}
