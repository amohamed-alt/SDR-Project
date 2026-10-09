"use client";

import { useState, type ReactNode } from "react";
import styles from "./DashboardDisclosure.module.css";

// Mount detailed charts/tables only when requested. Native details keeps the
// summary keyboard accessible without a second navigation or data scope.
export function DashboardDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className={styles.disclosure} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}</summary>
    {open ? <div className={styles.body}>{children}</div> : null}
  </details>;
}
