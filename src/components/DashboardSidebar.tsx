"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";

/** One navigation surface on desktop, an explicit menu on smaller screens. */
export function DashboardSidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  return <>
    <button ref={toggle} className="mobile-nav-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {open ? <X size={18}/> : <Menu size={18}/>}<span>{open ? "Close menu" : "Menu"}</span>
    </button>
    {open ? <button type="button" className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => { setOpen(false); toggle.current?.focus(); }}/> : null}
    <aside id={id} className="sidebar" data-mobile-open={open} onClickCapture={(event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest("nav button, nav a");
      if (action && !action.closest("form, [data-keep-navigation-open]")) {
        setOpen(false);
        if (toggle.current?.getClientRects().length) toggle.current.focus({ preventScroll: true });
      }
    }}>{children}</aside>
  </>;
}
