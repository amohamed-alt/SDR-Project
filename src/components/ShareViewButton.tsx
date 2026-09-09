"use client";

import { Check, Link2 } from "lucide-react";
import { useRef, useState } from "react";

export function ShareViewButton() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copyView() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this dashboard view URL", window.location.href);
    }
  }

  return <button type="button" className="share-view-button" onClick={copyView} aria-label="Copy link to current dashboard view">
    {copied ? <Check size={15}/> : <Link2 size={15}/>}<span>{copied ? "Copied" : "Share view"}</span>
  </button>;
}
