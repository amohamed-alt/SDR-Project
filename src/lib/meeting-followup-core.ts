export const SDRS: Record<string, string> = { '31644369': 'Marita Chedid', '37624223': 'Daniel Beaini' };
// Sunday–Thursday, 09:00–16:30 Riyadh. SLA measures working minutes, not elapsed time.
export function businessMinutes(start: string, end: string): number {
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  let total = 0;
  const day = new Date(from); day.setUTCHours(0, 0, 0, 0);
  for (let d = day.getTime(); d < to; d += 86400000) {
    if ([5, 6].includes(new Date(d).getUTCDay())) continue;
    total += Math.max(0, Math.min(to, d + 13.5 * 3600000) - Math.max(from, d + 6 * 3600000)) / 60000;
  }
  return total;
}
export function followupIssues(input: { outcome: string; end: string; now: string; notes: string; nextStep: string; due: string; tasks: { open: boolean; due: string; owner: string }[]; closed: boolean; rm: string }) {
  const issues: string[] = [];
  if (input.closed) return issues;
  const age = businessMinutes(input.end, input.now);
  if (!input.rm) issues.push('RM missing');
  if (Date.parse(input.end) > Date.parse(input.now)) return issues;
  if (age >= 120 && !['COMPLETED', 'NO_SHOW', 'CANCELED', 'RESCHEDULED'].includes(input.outcome)) issues.push('Meeting outcome overdue');
  if (input.outcome === 'COMPLETED' && age >= 180) {
    if (!input.notes.trim()) issues.push('RM notes missing');
    if (!input.nextStep.trim() || !input.due) issues.push('Next step / date missing');
    if (!input.tasks.some(t => t.open && t.owner === input.rm && Date.parse(t.due) >= Date.parse(input.now))) issues.push('No future RM task on this deal');
  }
  // Date-only HubSpot property expires at the END of its Riyadh day.
  if (input.due && input.due.slice(0, 10) < new Date(Date.parse(input.now) + 3 * 3600000).toISOString().slice(0, 10)) issues.push('Next step overdue');
  return issues;
}
