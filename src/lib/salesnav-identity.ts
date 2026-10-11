export type LeadIdentity = { linkedinUrl?: string; salesLeadUrl?: string; name?: string; company?: string };

/** Opaque Sales Navigator entity IDs keep their case; tracking parameters are not identity. */
export function salesNavAliases(identity: LeadIdentity): string[] {
  const aliases: string[] = [];
  for (const raw of [identity.salesLeadUrl, identity.linkedinUrl]) {
    try {
      const url = new URL(String(raw || ''));
      if (url.protocol !== 'https:' || !/(^|\.)linkedin\.com$/i.test(url.hostname)) continue;
      const sales = /^\/sales\/lead\/([^/,?#]+)/.exec(url.pathname);
      const publicProfile = /^\/in\/([^/?#]+)/i.exec(url.pathname);
      if (sales) aliases.push(`sales:${sales[1]}`);
      else if (publicProfile) aliases.push(`li:${publicProfile[1].toLowerCase()}`);
    } catch { /* A weak identity can be captured, but cannot spend or write. */ }
  }
  return [...new Set(aliases)];
}

export function salesNavLeadId(identity: LeadIdentity) {
  return salesNavAliases(identity)[0] || '';
}
export function captureLeadKey(identity: LeadIdentity) {
  return salesNavLeadId(identity) || `weak:${String(identity.name || '').trim().toLowerCase()}:${String(identity.company || '').trim().toLowerCase()}`;
}
