"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Shared record/account modal behavior. A later modal (such as command
 * search) owns Escape and focus until it closes. Layout is left to callers. */
export function useModalFocus({ open, panelRef, initialFocusRef, onClose }: {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const alreadyLocked = document.body.classList.contains("drawer-open");
    const isTopDialog = () => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      return dialogs[dialogs.length - 1] === panel;
    };
    const focusableElements = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
    const keepFocusInside = (event: FocusEvent) => {
      if (isTopDialog() && event.target instanceof Node && !panel.contains(event.target)) initialFocusRef.current?.focus({ preventScroll: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); panel.focus({ preventScroll: true }); return; }
      const active = document.activeElement;
      if (!panel.contains(active) || active === panel || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", keepFocusInside);
    document.body.classList.add("drawer-open");
    initialFocusRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", keepFocusInside);
      if (!alreadyLocked) document.body.classList.remove("drawer-open");
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, panelRef, initialFocusRef]);
}
