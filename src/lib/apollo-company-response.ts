export function apolloCompanyRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(payload.organizations) && !Array.isArray(payload.accounts)) throw new Error("Apollo company response has no result buckets");
  const organizations = Array.isArray(payload.organizations) ? payload.organizations : [];
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  return [...organizations, ...accounts].map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Apollo company record");
    const record = value as Record<string, unknown>;
    const nested = record.organization && typeof record.organization === "object" ? record.organization as Record<string, unknown> : {};
    return { ...nested, ...record,
      organization_id: record.organization_id || nested.id,
      country: record.country || nested.country,
      estimated_num_employees: record.estimated_num_employees ?? nested.estimated_num_employees,
      industry: record.industry || nested.industry,
      primary_domain: record.primary_domain || nested.primary_domain || record.domain,
    };
  });
}

export function apolloSaudiScopeEcho(breadcrumbs: unknown) {
  if (!Array.isArray(breadcrumbs)) return false;
  const has = (field: string, value: string) => breadcrumbs.some((item) => item && typeof item === "object"
    && String(item.signal_field_name || "").replace(/\[\]$/, "") === field
    && String(item.value || "").toLowerCase().includes(value.toLowerCase()));
  return has("organization_locations", "Saudi Arabia") && has("organization_num_employees_ranges", "200,1000000000");
}
