"use client";
import { useEffect } from "react";
import { ToolAccessGate } from "@/components/ToolAccessGate";
function ResumeTool() {
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("returnTo") || "/";
    const destination = new URL(requested, window.location.origin);
    window.location.replace(destination.origin === window.location.origin && destination.pathname !== "/tools-unlock" ? destination.href : "/");
  }, []);
  return <p role="status">Opening your workspace…</p>;
}
export default function UnlockToolsPage() { return <ToolAccessGate><ResumeTool/></ToolAccessGate>; }
