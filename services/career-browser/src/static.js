'use strict';

const cheerio = require('cheerio');
const { clean, unique, rootUrl, domain, assertPublic, fingerprint, isJobDetailUrl, isJobListingUrl, evidenceRank, isOfficialCareerUrl, careerUrlScore, detected, resolveLink, scoreCareer, CAREER_RE } = require('./common');
const { externalCareerRoots, pageLooksLikeBrandCareer, visibleCareerText } = require('./external-careers');
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10000);

function linksFrom(html, base) {
  const $ = cheerio.load(html || ''); const out = [];
  $('a[href],iframe[src],form[action]').each((_, e) => {
    const tag = String(e.tagName || '').toLowerCase();
    const raw = $(e).attr(tag === 'iframe' ? 'src' : tag === 'form' ? 'action' : 'href');
    const href = resolveLink(raw, base); if (!href) return;
    out.push({ href, text: clean($(e).text() || $(e).attr('aria-label') || $(e).attr('title'), 400) });
  });
  const seen = new Set(); return out.filter(x => !seen.has(x.href) && seen.add(x.href));
}
function assetUrlsFrom(html, base) {
  const $ = cheerio.load(html || ''); const out = [];
  $('script[src],link[href]').each((_, e) => {
    const raw = $(e).attr(String(e.tagName || '').toLowerCase() === 'script' ? 'src' : 'href');
    const href = resolveLink(raw, base); if (href) out.push(href);
  });
  return unique(out).slice(0, 300);
}
function pageMarkerText(html, finalUrl) {
  const $ = cheerio.load(html || '');
  const title = $('title').first().text();
  const description = $('meta[name="description"]').attr('content') || '';
  const generator = $('meta[name="generator"]').attr('content') || '';
  const headings = $('h1,h2,h3').map((_, e) => $(e).text()).get().join(' ');
  const body = $('body').text().slice(0, 80000);
  const assets = assetUrlsFrom(html, finalUrl).join(' ');
  return clean(`${finalUrl}\n${title}\n${description}\n${generator}\n${headings}\n${body}\n${assets}`, 14000);
}
function pageHasCareerProof(html, finalUrl, request) {
  if (!html) return false;
  const markerText = pageMarkerText(html, finalUrl); const $ = cheerio.load(html || '');
  const hasApplicationForm = $('input[type="file"],form[action*="apply" i],form[action*="career" i],form[action*="job" i]').length > 0;
  const explicitSignals = /open (?:positions|roles|vacancies)|current (?:openings|vacancies)|search jobs|view jobs|job opportunities|join our team|upload (?:your )?(?:cv|resume)|submit (?:your )?(?:cv|resume)|فرص وظيفية|فرص عمل|وظائف شاغرة|انضم (?:إلينا|الينا|لفريقنا)|أرسل سيرتك|ارسل سيرتك|رفع السيرة/i.test(markerText);
  return Boolean(fingerprint(markerText) || hasApplicationForm || explicitSignals || (CAREER_RE.test(markerText) && pageLooksLikeBrandCareer(markerText, finalUrl, request)));
}
async function fetchPage(raw, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); let current = raw;
  try {
    for (let i = 0; i <= 5; i += 1) {
      await assertPublic(current);
      const r = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': require('./common').USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
      if ([301,302,303,307,308].includes(r.status)) { const loc = r.headers.get('location'); if (!loc) throw new Error('Redirect without location.'); current = new URL(loc, current).toString(); continue; }
      const ct = r.headers.get('content-type') || '';
      const html = /text|html|xml|json|javascript/i.test(ct) ? (await r.text()).slice(0, 2000000) : '';
      return { status: r.status, final_url: current, content_type: ct, html };
    }
    throw new Error('Too many redirects.');
  } finally { clearTimeout(timer); }
}
function preferCareer(current, candidate, official) { if (!candidate) return current; if (!current) return candidate; return careerUrlScore(candidate, official) > careerUrlScore(current, official) ? candidate : current; }

async function staticDetect(request, result) {
  const root = rootUrl(request.official_website); const d = domain(root);
  const paths = [root,'/careers','/career','/jobs','/join-us','/join-our-team','/work-with-us','/vacancies','/opportunities','/talent','/talents','/recruitment','/hiring','/apply','/employment','/en/careers','/en/jobs','/ar/careers','/ar/jobs','/ar/وظائف','/وظائف','/التوظيف','/انضم-إلينا','/فرص-العمل','/robots.txt','/sitemap.xml','/sitemap_index.xml'];
  const commonCareerHosts = ['careers','jobs','talent','talents','recruitment','hiring','apply'].map(prefix => `https://${prefix}.${d}/`);
  const queue = unique(paths.map(x => x.startsWith('http') ? x : new URL(x, root).toString()).concat(externalCareerRoots(request)).concat(commonCareerHosts));
  const seen = new Set();
  const record = (match, evidence, method, reason, careerCandidate = '', quality = '') => {
    const rank = evidenceRank(evidence); const previousRank = evidenceRank(result.ats_evidence_url); const career = preferCareer(result.career_url, careerCandidate, root);
    if (rank >= previousRank) result = detected(result, match, evidence, method, reason, career, isJobDetailUrl(evidence) ? evidence : result.job_url, quality); else if (career) result.career_url = career;
    return isJobDetailUrl(evidence) || (!request.require_job_detail && result.ats_status === 'detected');
  };
  while (queue.length && seen.size < request.max_static_pages) {
    const url = queue.shift(); if (seen.has(url)) continue; seen.add(url);
    try {
      const page = await fetchPage(url); result.pages_checked += 1; result.static_pages_checked += 1;
      result.trace.push({ stage: 'static', requested_url: url, final_url: page.final_url, status: page.status });
      const validPage = page.status >= 200 && page.status < 400;
      const brandedCareer = validPage && pageLooksLikeBrandCareer(page.html, page.final_url, request);
      const officialCareer = validPage && isOfficialCareerUrl(page.final_url, root) && pageHasCareerProof(page.html, page.final_url, request);
      const pageCareer = officialCareer || brandedCareer ? page.final_url : '';
      if (pageCareer) {
        const visible = visibleCareerText(page.html);
        result.career_evidence_text = clean(visible, 6000);
        result.career_visible_text_length = visible.length;
        result.career_url = preferCareer(result.career_url, pageCareer, root);
        if (request.stop_on_career) { result.detection_method = fingerprint(pageMarkerText(page.html, page.final_url)) ? 'static_career_ats_verified' : 'static_career_verified'; result.ats_evidence_reason ||= `Verified public career destination discovered at ${page.final_url}.`; return result; }
      }
      const redirectMatch = fingerprint(page.final_url);
      if (redirectMatch) { const done = record(redirectMatch, page.final_url, 'static_redirect_fingerprint', `Public careers navigation reached ${new URL(page.final_url).hostname}.`, pageCareer || (isJobListingUrl(page.final_url) ? page.final_url : '')); if (done) return result; }
      if (!page.html || page.status >= 400) continue;
      const markerText = pageMarkerText(page.html, page.final_url); const markerMatch = fingerprint(markerText);
      if (markerMatch) { const done = record(markerMatch, page.final_url, 'static_page_content_fingerprint', `The public career page contains explicit ${markerMatch.detected_ats} platform markers.`, pageCareer || result.career_url || page.final_url, 'vendor_page'); if (done) return result; }
      for (const asset of assetUrlsFrom(page.html, page.final_url)) { const match = fingerprint(asset); if (!match) continue; const done = record(match, asset, 'static_asset_fingerprint', `A script or stylesheet loaded by ${page.final_url} is hosted by ${match.detected_ats}.`, pageCareer || result.career_url || page.final_url); if (done) return result; }
      const links = linksFrom(page.html, page.final_url); result.candidate_urls.push(...links.map(x => x.href));
      for (const link of links) { const match = fingerprint(link.href); if (!match) continue; const done = record(match, link.href, 'static_link_fingerprint', `A public link on ${page.final_url} points to ${new URL(link.href).hostname}.`, pageCareer || (isJobListingUrl(link.href) ? link.href : '')); if (done) return result; if (isJobListingUrl(link.href)) queue.push(link.href); }
      if (/robots|sitemap|xml/i.test(`${url} ${page.content_type}`)) {
        for (const found of page.html.match(/https?:\/\/[^\s<>'"\]]+/gi) || []) {
          const link = { href: found.replace(/&amp;/g, '&'), text: '' }; const match = fingerprint(link.href);
          if (match) { const done = record(match, link.href, 'sitemap_fingerprint', 'Official robots or sitemap data contains an ATS-hosted URL.', result.career_url || (isJobListingUrl(link.href) ? link.href : '')); if (done) return result; if (isJobListingUrl(link.href)) queue.push(link.href); }
          if (scoreCareer(link, root) >= 70) queue.push(link.href);
        }
      }
      const ranked = links.map(x => ({ ...x, score: scoreCareer(x, root) })).filter(x => x.score >= 70).sort((a,b) => b.score - a.score).slice(0,12);
      for (const link of ranked) queue.push(link.href);
    } catch (e) { result.trace.push({ stage: 'static', url, error: clean(e.message, 250) }); }
  }
  result.candidate_urls = unique(result.candidate_urls).slice(0,200);
  if (result.ats_status === 'detected' && !result.job_url) result.detection_method = `${result.detection_method}:job_detail_pending`;
  else if (result.career_url) { result.ats_status = 'unclear'; result.detection_method = 'static_career_found_vendor_unclear'; }
  return result;
}

module.exports = { staticDetect, pageHasCareerProof };
