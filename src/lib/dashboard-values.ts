/** Missing CRM timing must never become a successful zero-duration response. */
export function responseMilliseconds(raw: string | null | undefined): number | null {
  if (raw == null || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function dashboardToday(now = new Date(), timezone = "Asia/Riyadh") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
