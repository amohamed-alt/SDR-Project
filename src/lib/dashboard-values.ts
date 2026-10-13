/** Missing CRM timing must never become a successful zero-duration response. */
export function responseMilliseconds(raw: string | null | undefined): number | null {
  if (raw == null || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function dashboardToday(now = new Date(), timezone = "Asia/Riyadh") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Keep the source outcome as the grouping/filter key; format only its visible label. */
export function outcomeDisplayLabel(name: string, kind: "Call" | "Meeting" = "Call") {
  return /^[a-f\d]{32}$/i.test(name.replace(/[\s-]/g, "")) ? `Unmapped ${kind.toLowerCase()} outcome` : name;
}

export function qualityRateLabel(rate: number, total: number) {
  return total > 0 ? `${rate}%` : "N/A";
}
