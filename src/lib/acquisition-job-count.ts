function numericValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function verifiedActiveJobCount(input: Record<string, unknown>) {
  for (const value of [
    input.num_current_jobs,
    input.organization_num_jobs,
    input.current_jobs,
    input.job_postings_count,
    input.num_jobs,
  ]) {
    const parsed = numericValue(value);
    if (parsed !== null) return Math.max(0, Math.round(parsed));
  }
  return 0;
}
