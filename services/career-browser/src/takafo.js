'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_KEYS = /^(?:id|uuid|jobid|job_id|jobuuid|job_uuid|externaljobid|external_job_id|vacancyid|vacancy_id)$/i;
const URL_KEYS = /(?:url|href|link|details?|apply)/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function explicitUrls(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) explicitUrls(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && URL_KEYS.test(key) && /^https?:\/\//i.test(child)) out.push(child);
    explicitUrls(child, out);
  }
  return out;
}

function jobIds(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) jobIds(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && ID_KEYS.test(key) && UUID_RE.test(child)) out.push(child);
    jobIds(child, out);
  }
  return out;
}

function candidatesFromTakafoJson(json, responseUrl) {
  let origin = '';
  try { origin = new URL(responseUrl).origin; } catch { return []; }
  const urls = explicitUrls(json).filter(url => {
    try { return new URL(url).hostname.endsWith('takafo.ai'); } catch { return false; }
  });
  for (const id of jobIds(json)) urls.push(`${origin}/external-job/details/${id}`);
  return unique(urls);
}

module.exports = { candidatesFromTakafoJson };
