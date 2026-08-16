'use strict';

const { getDomain } = require('tldts');
const dns = require('node:dns').promises;
const net = require('node:net');
const fs = require('node:fs').promises;
const path = require('node:path');
const { ATS, CAREER_RE, JOB_RE, BLOCKED_HOSTS } = require('./patterns');

const CACHE_FILE = process.env.CACHE_FILE || '/data/cache.json';
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';
const clean = (v, max = 2000) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const unique = (a) => [...new Set(a.filter(Boolean))];
const now = () => new Date().toISOString();

function normalizeUrl(value) {
  let raw = clean(value, 1000);
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try { const u = new URL(raw); u.hash = ''; return u.toString(); } catch { return ''; }
}
function rootUrl(value) { try { const u = new URL(value); return `${u.protocol}//${u.host}/`; } catch { return ''; } }
function domain(value) {
  try { const host = value.includes('://') ? new URL(value).hostname : value; return getDomain(host) || host.replace(/^www\./i, ''); }
  catch { return clean(value).replace(/^www\./i, ''); }
}
function isPrivate4(ip) {
  const p = ip.split('.').map(Number); if (p.length !== 4) return false;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}
function isPrivate6(ip) {
  const x = ip.toLowerCase();
  return x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80:') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.') || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(x);
}
async function assertPublic(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP(S) is allowed.');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Local host blocked.');
  if (net.isIP(host)) { if (isPrivate4(host) || isPrivate6(host)) throw new Error('Private IP blocked.'); return; }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(r => r.family === 4 ? isPrivate4(r.address) : isPrivate6(r.address))) throw new Error('Private or unresolved host blocked.');
}
function fingerprint(value) {
  const text = clean(value, 12000);
  for (const [name, vendor, category, score, tests] of ATS) {
    if (tests.some(t => t.test(text))) return { detected_ats: name, ats_vendor: vendor, ats_category: category, ats_confidence: score >= 97 ? 'high' : 'medium', ats_confidence_score: score };
  }
  return null;
}
function isJobDetailUrl(value) {
  try {
    const u = new URL(value); const h = u.hostname.toLowerCase(); const p = u.pathname;
    if (/\/external-job\/details\/[^/?#]+/i.test(p)) return true;
    if (/myworkdayjobs\.com$/i.test(h) && /\/job\/[^/]+\/.+/i.test(p)) return true;
    if (/oraclecloud\.com$/i.test(h) && /CandidateExperience.*\/job\/[^/?#]+/i.test(p)) return true;
    if (/greenhouse\.io$/i.test(h) && /\/jobs\/\d+/i.test(p)) return true;
    if (/jobs\.lever\.co$/i.test(h) && /^\/[^/]+\/[a-z0-9-]{8,}/i.test(p)) return true;
    if (/smartrecruiters\.com$/i.test(h) && /^\/[^/]+\/\d+/i.test(p)) return true;
    if (/icims\.com$/i.test(h) && /\/jobs\/\d+(?:\/|$)/i.test(p)) return true;
    if (/workable\.com$/i.test(h) && /\/j\/[A-Za-z0-9_-]+/i.test(p)) return true;
    if (/ashbyhq\.com$/i.test(h) && /^\/[^/]+\/[a-f0-9-]{16,}/i.test(p)) return true;
    if (/jobvite\.com$/i.test(h) && /\/job\/[^/?#]+/i.test(p)) return true;
    if (/taleo\.net$/i.test(h) && /jobdetail\.ftl/i.test(`${p}${u.search}`)) return true;
    if (/applytojob\.com$/i.test(h) && p.split('/').filter(Boolean).length >= 2) return true;
    if (/pinpointhq\.com$/i.test(h) && /\/postings\//i.test(p)) return true;
    if (/breezy\.hr$/i.test(h) && /\/p\/[a-z0-9-]+/i.test(p)) return true;
    if (/zenats\.com$/i.test(h) && /\/(?:jobs?|vacancies|career)\/[^/?#]+/i.test(p)) return true;
    if (/jisr\.net$/i.test(h) && /\/careers\/[a-f0-9-]{16,}/i.test(p)) return true;
    if (/palmhr\.io$/i.test(h) && /\/jobs?\/[^/?#]+/i.test(p)) return true;
    if (/ibeehire\.com$/i.test(h) && /\/(?:jobs?|vacancies)\/[^/?#]+/i.test(p)) return true;
    if (/sniperhire\.net$/i.test(h) && /\/vacancy\/\d+/i.test(p)) return true;
    if (/\/vacancy\/\d+/i.test(p) && /\bcazar\b/i.test(u.search)) return true;
    return false;
  } catch { return false; }
}
function isJobListingUrl(value) {
  try {
    const u = new URL(value); const p = `${u.pathname}${u.search}`;
    if (!fingerprint(value) || isJobDetailUrl(value)) return false;
    if (u.pathname === '/' && !u.search) return false;
    return /jobs?|careers?|positions?|vacanc|openings?|CandidateExperience|careersection|external/i.test(p);
  } catch { return false; }
}
function evidenceRank(value) { if (isJobDetailUrl(value)) return 3; if (isJobListingUrl(value)) return 2; return fingerprint(value) ? 1 : 0; }
function pathWithoutLocale(value) {
  try { const p = new URL(value).pathname.toLowerCase().replace(/\/+$/, '') || '/'; return p.replace(/^\/(?:[a-z]{2}(?:-[a-z]{2})?)(?=\/)/i, '') || '/'; }
  catch { return ''; }
}
function isCareerSubdomain(value, official) {
  try {
    if (!value || domain(value) !== domain(official)) return false;
    const host = new URL(value).hostname.toLowerCase(); const base = domain(official).toLowerCase();
    if (host === base || host === `www.${base}` || !host.endsWith(`.${base}`)) return false;
    const prefix = host.slice(0, -(base.length + 1));
    return prefix.split('.').some(label => /^(?:careers?|jobs?|talents?|recruit(?:ment|ing)?|vacancies|employment|hiring|hire|apply)$/i.test(label));
  } catch { return false; }
}
function isOfficialCareerUrl(value, official) {
  if (!value || domain(value) !== domain(official)) return false;
  if (isCareerSubdomain(value, official)) return true;
  const p = pathWithoutLocale(value);
  if (/^\/(?:news|media|our-impact|who-we-are|investors?|about)(?:\/|$)/i.test(p)) return false;
  return /^\/(?:careers?|jobs?|vacancies|join-us|work-with-us|talent|talents|recruitment|recruiting|employment|hiring|hire|apply)(?:\/|$)/i.test(p);
}
function careerUrlScore(value, official) {
  if (!value) return -1000;
  try {
    const u = new URL(value); const p = pathWithoutLocale(value); let score = 0;
    if (domain(value) === domain(official)) score += 100;
    if (isOfficialCareerUrl(value, official)) score += 150;
    if (isCareerSubdomain(value, official)) score += 90;
    if (/^\/careers$/i.test(p)) score += 100; else if (/^\/careers\//i.test(p)) score += 70; else if (/^\/jobs$/i.test(p)) score += 80; else if (/^\/(?:talent|talents|recruitment|recruiting|hiring|hire|apply)$/i.test(p)) score += 65; else if (/^\/career$/i.test(p)) score += 20;
    if (isJobListingUrl(value)) score += 60;
    if (isJobDetailUrl(value)) score -= 20;
    if (/^\/(?:news|media|our-impact|who-we-are|investors?)(?:\/|$)/i.test(p)) score -= 300;
    score -= Math.max(0, p.split('/').filter(Boolean).length - 2) * 5;
    if (u.hash) score -= 5;
    return score;
  } catch { return -1000; }
}
function baseResult(website) {
  return { ats_status: 'not_checked', detected_ats: '', ats_vendor: '', ats_category: 'unknown', ats_confidence: 'unknown', ats_confidence_score: 0, official_website: website, career_url: '', job_url: '', ats_evidence_url: '', ats_evidence_reason: '', ats_evidence_quality: '', detection_method: 'all_methods_exhausted', pages_checked: 0, static_pages_checked: 0, browser_pages_checked: 0, playwright_used: false, cache_hit: false, candidate_urls: [], trace: [], detection_error: '' };
}
function detected(result, match, evidence, method, reason, career = '', job = '', evidenceQuality = '') {
  const inferredQuality = isJobDetailUrl(evidence) ? 'job_detail' : isJobListingUrl(evidence) ? 'job_listing' : fingerprint(evidence) ? 'vendor_host' : 'vendor_page';
  return { ...result, ...match, ats_status: 'detected', career_url: career || result.career_url, job_url: job || result.job_url, ats_evidence_url: evidence, ats_evidence_reason: reason, ats_evidence_quality: evidenceQuality || inferredQuality, detection_method: method, detection_error: '' };
}
function resolveLink(raw, base) {
  try { if (!raw || /^(mailto:|tel:|javascript:|#)/i.test(raw)) return ''; const u = new URL(raw, base); u.hash = ''; return /^https?:$/.test(u.protocol) ? u.toString() : ''; }
  catch { return ''; }
}
function scoreCareer(link, official) {
  const text = `${link.href} ${link.text}`; let score = CAREER_RE.test(text) ? 60 : 0;
  if (isJobListingUrl(link.href)) score += 120; else if (fingerprint(link.href)) score += 45;
  if (domain(link.href) === domain(official)) score += 15;
  if (isOfficialCareerUrl(link.href, official)) score += 80;
  try { const p = pathWithoutLocale(link.href); if (/^\/(?:news|media|our-impact|who-we-are|investors?)(?:\/|$)/i.test(p)) score -= 200; if (BLOCKED_HOSTS.some(h => new URL(link.href).hostname.endsWith(h))) score -= 100; }
  catch { score -= 100; }
  return score;
}
function scoreJob(link) {
  let score = isJobDetailUrl(link.href) ? 220 : isJobListingUrl(link.href) ? 90 : JOB_RE.test(link.href) ? 60 : 0;
  if (/view job|job details|open role|position|vacanc|current openings/i.test(link.text)) score += 35;
  if (/apply now|submit application|upload cv|create account/i.test(link.text)) score -= 80;
  return score;
}
async function readCache() { try { return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch { return {}; } }
async function writeCache(cache) { try { await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }); await fs.writeFile(CACHE_FILE, JSON.stringify(cache), 'utf8'); } catch (e) { console.error('cache_write_failed', e.message); } }

module.exports = { USER_AGENT, clean, unique, now, normalizeUrl, rootUrl, domain, assertPublic, fingerprint, isJobDetailUrl, isJobListingUrl, evidenceRank, isOfficialCareerUrl, careerUrlScore, baseResult, detected, resolveLink, scoreCareer, scoreJob, readCache, writeCache, CAREER_RE, JOB_RE };
