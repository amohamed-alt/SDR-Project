"use client";

import { MaqsamCallsDashboard } from "@/components/MaqsamCallsDashboard";

export function MaritaCallsPage() {
  return <MaqsamCallsDashboard onBack={() => { window.location.href = "/"; }} />;
}
