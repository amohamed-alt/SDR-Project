/** Fixed business reporting cohort; dates use the dashboard's Riyadh timezone. */
export const RM_REPORTING_START = '2026-07-13';
export function rmReportingToday(now = Date.now()) {
 return new Date(now + 3 * 3600000).toISOString().slice(0, 10);
}
export function validRmReportingRange(from: string, to: string, now = Date.now()) {
 const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
 return valid(from) && valid(to) && from >= RM_REPORTING_START && from <= to && to <= rmReportingToday(now);
}
