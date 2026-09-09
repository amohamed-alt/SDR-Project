"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  DatabaseZap,
  Import,
  Search,
  Sparkles,
  Target,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

type Command = {
  label: string;
  description: string;
  href: string;
  keywords: string;
  icon: LucideIcon;
};

const COMMANDS: Command[] = [
  { label: "SDR Command Center", description: "Open the live SDR analytics dashboard", href: "/", keywords: "dashboard analytics sdr overview", icon: BarChart3 },
  { label: "Daily SDR Workspace", description: "Jump directly to the execution workspace", href: "/?workspace=1", keywords: "workspace tasks meetings daily execution", icon: UsersRound },
  { label: "Account Intelligence", description: "Research and inspect account-level intelligence", href: "/account-intelligence", keywords: "account intelligence research company", icon: BrainCircuit },
  { label: "Best Accounts", description: "Open prioritized accounts and ranking signals", href: "/best-accounts", keywords: "best accounts ranking priority signals", icon: Sparkles },
  { label: "Prospecting", description: "Open the GTM prospecting workspace", href: "/prospecting", keywords: "prospecting leads linkedin salesnav", icon: Target },
  { label: "Net New Accounts", description: "Inspect net-new companies and account opportunities", href: "/net-new-accounts", keywords: "new accounts companies market", icon: Building2 },
  { label: "Company Enrichment", description: "Open company enrichment and data-quality tooling", href: "/company-enrichment", keywords: "company enrichment ats data quality", icon: DatabaseZap },
  { label: "Lead Import", description: "Open lead import and CRM ingestion", href: "/lead-import", keywords: "lead import upload hubspot crm", icon: Import },
  { label: "Sales Navigator Prospecting", description: "Open the Sales Navigator prospecting workflow", href: "/salesnav-prospecting", keywords: "sales navigator linkedin prospecting", icon: Search },
];

export function GtmCommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return COMMANDS;
    return COMMANDS.filter((command) => `${command.label} ${command.description} ${command.keywords}`.toLowerCase().includes(term));
  }, [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [activeIndex, filtered.length]);

  function run(command: Command) {
    setOpen(false);
    router.push(command.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!filtered.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % filtered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(filtered[activeIndex]);
    }
  }

  if (!open) {
    return (
      <button className="gtm-command-trigger" type="button" onClick={() => setOpen(true)} aria-label="Open GTM command palette">
        <Search size={15}/><span>Search GTM</span><kbd>⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="gtm-command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="gtm-command-palette" role="dialog" aria-modal="true" aria-label="GTM command palette">
        <div className="gtm-command-search">
          <Search size={18}/>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={onInputKeyDown}
            placeholder="Search dashboard, accounts, prospecting…"
            aria-label="Search GTM commands"
          />
          <button type="button" onClick={() => setOpen(false)} aria-label="Close command palette"><X size={16}/></button>
        </div>
        <div className="gtm-command-results" role="listbox" aria-label="Commands">
          {filtered.length ? filtered.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                key={command.href + command.label}
                type="button"
                className={index === activeIndex ? "active" : ""}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run(command)}
                role="option"
                aria-selected={index === activeIndex}
              >
                <span className="gtm-command-icon"><Icon size={17}/></span>
                <span className="gtm-command-copy"><strong>{command.label}</strong><small>{command.description}</small></span>
                <span className="gtm-command-enter">↵</span>
              </button>
            );
          }) : <div className="gtm-command-empty">No matching GTM command</div>}
        </div>
        <footer className="gtm-command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>
  );
}
