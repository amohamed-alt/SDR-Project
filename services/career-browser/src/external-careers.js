'use strict';

const { getDomain } = require('tldts');
const { CAREER_RE } = require('./patterns');

const COMPANY_STOPWORDS = new Set([
  'the', 'group', 'holding', 'holdings', 'company', 'companies', 'corporation',
  'corp', 'inc', 'limited', 'ltd', 'llc', 'pjsc', 'sa', 'plc', 'international',
  'global', 'hotels', 'hotel', 'resorts', 'resort', 'management', 'investment',
  'investments', 'bank', 'medical', 'healthcare', 'hospital', 'hospitals',
]);

function cleanToken(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function brandTokens(request = {}) {
  const out = [];
  const add = value => {
    const token = cleanToken(value);
    if (token.length < 3 || token.length > 32 || out.includes(token)) return;
    out.push(token);
  };
  const rawDomain = String(request.company_domain || request.official_website || '');
  const registrable = getDomain(rawDomain.includes('://') ? new URL(rawDomain).hostname : rawDomain) || '';
  if (registrable) add(registrable.split('.')[0]);
  const words = String(request.company_name || '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter(word => !COMPANY_STOPWORDS.has(word));
  for (const word of words.slice(0, 4)) add(word);
  return out.slice(0, 3);
}

function externalCareerRoots(request = {}) {
  const rawDomain = String(request.company_domain || request.official_website || '');
  const host = rawDomain.includes('://') ? new URL(rawDomain).hostname : rawDomain;
  const registrable = getDomain(host) || host.replace(/^www\./i, '');
  if (!registrable || !registrable.includes('.')) return [];
  const stem = registrable.split('.')[0];
  const suffix = registrable.slice(stem.length + 1);
  const suffixes = [...new Set([suffix, 'com'].filter(Boolean))];
  const urls = [];
  for (const token of brandTokens(request)) {
    if (!/^[a-z0-9-]+$/i.test(token)) continue;
    for (const ending of suffixes) {
      for (const label of [`${token}careers`, `${token}jobs`, `${token}-careers`, `${token}-jobs`]) {
        urls.push(`https://${label}.${ending}/`);
      }
    }
  }
  return [...new Set(urls)].slice(0, 16);
}

function officialHost(request = {}) {
  const raw = String(request.official_website || request.company_domain || '').trim();
  if (!raw) return '';
  try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase(); }
  catch { return raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase(); }
}

function sameDomainCareerLocation(url, request = {}) {
  try {
    const page = new URL(url);
    const official = officialHost(request);
    if (!official) return false;
    const pageDomain = getDomain(page.hostname) || page.hostname.replace(/^www\./i, '');
    const officialDomain = getDomain(official) || official.replace(/^www\./i, '');
    if (pageDomain !== officialDomain) return false;

    const host = page.hostname.toLowerCase();
    const base = officialDomain.toLowerCase();
    const subdomain = host === base || host === `www.${base}` ? '' : host.endsWith(`.${base}`) ? host.slice(0, -(base.length + 1)) : '';
    const careerSubdomain = subdomain.split('.').some(label => /^(?:careers?|jobs?|talents?|recruit(?:ment|ing)?|vacancies|employment|hiring|hire|apply)$/i.test(label));
    const path = decodeURIComponent(page.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
    const careerPath = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:careers?|jobs?|vacancies|join-us|join-our-team|work-with-us|talents?|recruitment|recruiting|employment|hiring|hire|apply|وظائف|التوظيف|فرص-العمل|انضم-إلينا)(?:\/|$)/iu.test(path);
    return careerSubdomain || careerPath;
  } catch {
    return false;
  }
}

function pageLooksLikeBrandCareer(html, url, request = {}) {
  let page;
  try { page = new URL(url); } catch { return false; }
  const hostname = page.hostname.toLowerCase();
  const compactHost = hostname.replace(/[^a-z0-9]/g, '');
  const text = String(html || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 2000000);
  const combined = `${hostname} ${page.pathname} ${text}`;
  const hasCareerSignal = CAREER_RE.test(combined) || /search and apply|post your cv|upload cv|submit (?:your )?(?:cv|resume)|open roles|job openings/i.test(combined);
  if (!hasCareerSignal) return false;

  const official = officialHost(request);
  if (official) {
    const pageDomain = getDomain(hostname) || hostname.replace(/^www\./i, '');
    const officialDomain = getDomain(official) || official.replace(/^www\./i, '');
    // A normal company homepage can mention jobs/careers in marketing copy or the footer.
    // Treat same-domain pages as career destinations only when the URL itself is a
    // career/job path or a dedicated career subdomain. External portals still use
    // brand-token proof below.
    if (pageDomain === officialDomain && !sameDomainCareerLocation(url, request)) return false;
  }

  const tokens = brandTokens(request);
  if (!tokens.length) return false;
  return tokens.some(token => compactHost.includes(token.replace(/[^a-z0-9]/g, '')) || text.includes(token));
}

module.exports = { brandTokens, externalCareerRoots, pageLooksLikeBrandCareer, sameDomainCareerLocation };
