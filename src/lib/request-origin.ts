function normalizeHost(value: string | null | undefined) {
  if (!value) return "";
  const first = value.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return "";
  try {
    if (/^https?:\/\//i.test(first)) return new URL(first).host.toLowerCase();
  } catch {
    return "";
  }
  return first.replace(/\.$/, "");
}

export function originMatchesRequestHosts(input: {
  origin?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  requestHost?: string | null;
  extraHosts?: Array<string | null | undefined>;
}) {
  const origin = input.origin?.trim();
  if (!origin) return true;

  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }

  const allowedHosts = new Set([
    normalizeHost(input.forwardedHost),
    normalizeHost(input.host),
    normalizeHost(input.requestHost),
    ...(input.extraHosts ?? []).map((item) => normalizeHost(item)),
  ].filter(Boolean));

  return allowedHosts.has(originHost);
}
