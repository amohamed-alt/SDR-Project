export type SenderBrand = "talentera" | "evalify" | "unknown";
export type OutreachProduct = "talentera" | "evalify";
export type SenderProvider = "google" | "microsoft" | "smtp" | "unknown";

export const APPROVED_SENDING_DOMAINS = {
  talentera: ["jointalentera.com", "usetalentera.com", "talenteramena.com"],
  evalify: ["getevalufy.com", "evalufyhq.com"],
} as const satisfies Record<OutreachProduct, readonly string[]>;

export const EXPECTED_MAILBOXES_PER_DOMAIN = 3;
export const EXPECTED_SENDING_MAILBOXES = 15;
export const OUTREACH_SENDER_NAME = "Marita Chedid";

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

export type SenderAccountInput = SenderRoutingInput & Record<string, unknown>;

export type SenderIdentityInput = {
  from_name?: unknown;
  signature?: unknown;
};

export type SenderAccountSafety = {
  email: string;
  domain: string;
  brand: SenderBrand;
  provider: SenderProvider;
  warmupEnabled: boolean;
  warmupKnown: boolean;
  smtpConnected: boolean;
  imapConnected: boolean;
  dailyLimit: number;
  capacity: number;
  eligible: boolean;
  reasons: string[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function displayClean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function visibleSenderSignature(value: unknown) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function inspectSenderIdentity(input: SenderIdentityInput) {
  const fromName = displayClean(input.from_name);
  const visibleSignature = visibleSenderSignature(input.signature);
  return {
    fromName,
    visibleSignature,
    healthy: fromName === OUTREACH_SENDER_NAME && visibleSignature === "",
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolLike(value: unknown) {
  if (value === true || value === 1 || String(value).toLowerCase() === "true") return true;
  if (value === false || value === 0 || String(value).toLowerCase() === "false") return false;
  return null;
}

function positiveNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "string"
      ? Number(value.trim().replace(/%$/, ""))
      : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function senderEmail(input: SenderRoutingInput) {
  return clean(input.from_email || input.email || input.username);
}

export function senderDomain(email: string) {
  const value = clean(email);
  return value.includes("@") ? value.split("@").pop() ?? "" : value;
}

export function senderBrandForDomain(email: string): SenderBrand {
  const domain = senderDomain(email);
  if ((APPROVED_SENDING_DOMAINS.talentera as readonly string[]).includes(domain)) return "talentera";
  if ((APPROVED_SENDING_DOMAINS.evalify as readonly string[]).includes(domain)) return "evalify";
  return "unknown";
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
  return { email, domain: senderDomain(email), brand: senderBrandForDomain(email), provider: senderProvider(input) };
}

export function senderMatchesProduct(input: SenderRoutingInput, product: OutreachProduct) {
  return senderRoute(input).brand === product;
}

export function inspectSenderAccount(input: SenderAccountInput, maxCampaignEmailsPerMailbox = 20): SenderAccountSafety {
  const route = senderRoute(input);
  const warmup = object(input.warmup_details || input.warmup);
  const warmupFlag = boolLike(input.warmup_enabled ?? warmup.enabled ?? warmup.warmup_enabled);
  const warmupStatus = clean(warmup.status || input.warmup_status);
  const warmupReputation = positiveNumber(input.warmup_reputation, warmup.reputation, warmup.reputation_score);
  const smtpFlag = boolLike(input.is_smtp_success ?? input.smtp_success ?? input.smtp_connected);
  const imapFlag = boolLike(input.is_imap_success ?? input.imap_success ?? input.imap_connected);
  const smtpStatus = clean(input.smtp_status);
  const imapStatus = clean(input.imap_status);
  const accountStatus = clean(input.status || input.connection_status);
  const badStatus = /disconnect|fail|error|invalid|suspend|block/.test(`${accountStatus} ${smtpStatus} ${imapStatus}`);
  const warmupStateHealthy = /(?:active|enabled|ready|warmed|complete|completed|in[_ -]?progress)/.test(warmupStatus) || warmupReputation >= 90;
  const warmupEnabled = warmupFlag !== false && warmupStateHealthy && !/fail|error|disabled|paused|inactive|not[_ -]?(?:active|started)/.test(warmupStatus);
  const smtpConnected = smtpFlag === true || /connect|success|active|ready/.test(smtpStatus);
  const imapConnected = imapFlag === true || /connect|success|active|ready/.test(imapStatus);
  const dailyLimit = positiveNumber(input.message_per_day, input.max_email_per_day, input.daily_limit, input.max_emails_per_day);
  const campaignLimit = Math.max(1, Math.min(20, Math.floor(maxCampaignEmailsPerMailbox || 20)));
  const capacity = Math.min(Math.floor(dailyLimit), campaignLimit);
  const reasons: string[] = [];
  if (route.brand === "unknown") reasons.push("domain is not on the approved sending-domain allowlist");
  if (badStatus) reasons.push("account connection status is unhealthy");
  if (!smtpConnected) reasons.push("SMTP connection is not explicitly healthy");
  if (!imapConnected) reasons.push("IMAP connection is not explicitly healthy");
  if (!warmupEnabled) reasons.push("warmup is not explicitly enabled and healthy");
  if (capacity < 1) reasons.push("daily sending limit is missing or zero");
  return {
    ...route,
    warmupEnabled,
    warmupKnown: warmupFlag !== null || Boolean(warmupStatus),
    smtpConnected,
    imapConnected,
    dailyLimit,
    capacity,
    eligible: reasons.length === 0,
    reasons,
  };
}

export function validateApprovedSenderInventory(senders: Array<{ email: string; eligible: boolean; reasons?: string[] }>) {
  const eligible = senders.filter((sender) => sender.eligible);
  const counts = Object.fromEntries(
    [...APPROVED_SENDING_DOMAINS.talentera, ...APPROVED_SENDING_DOMAINS.evalify].map((domain) => [
      domain,
      eligible.filter((sender) => senderDomain(sender.email) === domain).length,
    ]),
  ) as Record<string, number>;
  const warnings: string[] = [];
  const duplicates = [...new Set(eligible.map((sender) => clean(sender.email)).filter((email, index, rows) => rows.indexOf(email) !== index))];
  if (duplicates.length) warnings.push(`${duplicates.length} duplicate eligible mailbox address(es) detected.`);
  for (const [domain, count] of Object.entries(counts)) {
    if (count !== EXPECTED_MAILBOXES_PER_DOMAIN) warnings.push(`${domain} has ${count}/${EXPECTED_MAILBOXES_PER_DOMAIN} eligible mailboxes.`);
  }
  if (eligible.length !== EXPECTED_SENDING_MAILBOXES) warnings.push(`Eligible sender inventory is ${eligible.length}/${EXPECTED_SENDING_MAILBOXES}.`);
  const approvedButUnsafe = senders.filter((sender) => senderBrandForDomain(sender.email) !== "unknown" && !sender.eligible);
  if (approvedButUnsafe.length) warnings.push(`${approvedButUnsafe.length} approved-domain mailbox(es) failed connection, warmup, or limit checks.`);
  const reasonCounts = new Map<string, number>();
  for (const sender of approvedButUnsafe) {
    for (const reason of sender.reasons || []) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    warnings.push(`${count} approved-domain mailbox(es): ${reason}.`);
  }
  return {
    healthy: warnings.length === 0,
    expectedTotal: EXPECTED_SENDING_MAILBOXES,
    expectedPerDomain: EXPECTED_MAILBOXES_PER_DOMAIN,
    eligibleTotal: eligible.length,
    counts,
    warnings,
  };
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
