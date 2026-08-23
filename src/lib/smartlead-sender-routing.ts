import { senderBrand, type OutreachProduct, type SenderBrand } from "@/lib/recipient-language-routing";

export type SenderProvider = "google" | "microsoft" | "smtp" | "unknown";

export type SenderRoutingInput = {
  from_email?: unknown;
  email?: unknown;
  username?: unknown;
  smtp_host?: unknown;
  imap_host?: unknown;
  provider?: unknown;
  email_provider?: unknown;
  connection_type?: unknown;
  platform?: unknown;
  account_type?: unknown;
  type?: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function senderEmail(input: SenderRoutingInput) {
  return clean(input.from_email || input.email || input.username);
}

export function senderDomain(email: string) {
  const value = clean(email);
  return value.includes("@") ? value.split("@").pop() ?? "" : value;
}

export function senderProvider(input: SenderRoutingInput): SenderProvider {
  const fingerprint = [
    input.smtp_host,
    input.imap_host,
    input.provider,
    input.email_provider,
    input.connection_type,
    input.platform,
    input.account_type,
    input.type,
  ].map(clean).filter(Boolean).join(" ");

  if (/gmail|google|google workspace/.test(fingerprint)) return "google";
  if (/outlook|office365|office 365|microsoft|smtp\.office365\.com|hotmail/.test(fingerprint)) return "microsoft";
  if (/smtp|imap/.test(fingerprint)) return "smtp";
  return "unknown";
}

export function senderRoute(input: SenderRoutingInput): { email: string; domain: string; brand: SenderBrand; provider: SenderProvider } {
  const email = senderEmail(input);
  return { email, domain: senderDomain(email), brand: senderBrand(email), provider: senderProvider(input) };
}

export function senderMatchesProduct(input: SenderRoutingInput, product: OutreachProduct) {
  return senderRoute(input).brand === product;
}

export function senderInventory<T extends SenderRoutingInput>(rows: T[]) {
  const grouped = new Map<string, { domain: string; brand: SenderBrand; provider: SenderProvider; count: number }>();
  for (const row of rows) {
    const route = senderRoute(row);
    const key = `${route.domain}|${route.brand}|${route.provider}`;
    const current = grouped.get(key);
    if (current) current.count += 1;
    else grouped.set(key, { domain: route.domain || "unknown", brand: route.brand, provider: route.provider, count: 1 });
  }
  return [...grouped.values()].sort((a, b) => `${a.brand}-${a.provider}-${a.domain}`.localeCompare(`${b.brand}-${b.provider}-${b.domain}`));
}
