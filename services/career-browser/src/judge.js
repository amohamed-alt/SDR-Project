'use strict';

const { clean, domain, careerUrlScore, unique } = require('./common');

const AI_JUDGE_ENABLED = String(process.env.AI_JUDGE_ENABLED || 'true').toLowerCase() === 'true';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://career-judge-ollama:11434/api/chat';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
const AI_JUDGE_TIMEOUT_MS = Math.max(5_000, Number(process.env.AI_JUDGE_TIMEOUT_MS || 45_000));
const AI_JUDGE_AUDIT_PERCENT = Math.max(0, Math.min(100, Number(process.env.AI_JUDGE_AUDIT_PERCENT || 10)));
const AI_JUDGE_MIN_RULE_SCORE = Math.max(50, Math.min(100, Number(process.env.AI_JUDGE_MIN_RULE_SCORE || 90)));

let judgeQueue = Promise.resolve();

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['verified', 'manual_review', 'reject'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    same_company: { type: 'boolean' },
    is_recruiting_page: { type: 'boolean' },
    evidence: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    contradictions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    reason: { type: 'string' },
  },
  required: ['decision', 'confidence', 'same_company', 'is_recruiting_page', 'evidence', 'contradictions', 'reason'],
};

function stablePercent(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

function deterministicEvidenceScore(request, result) {
  if (!result?.career_url) return 0;
  let score = 0;
  const official = request.official_website || request.company_domain || '';
  const sameDomain = domain(result.career_url) && domain(result.career_url) === domain(official);
  if (sameDomain) score += 30;
  if (careerUrlScore(result.career_url, official) >= 180) score += 20;
  else if (careerUrlScore(result.career_url, official) >= 100) score += 10;
  if (result.ats_status === 'detected') score += 25;
  if (result.job_detail_found || result.job_url) score += 10;
  if (result.playwright_used) score += 8;
  if (/career_(?:ats_)?verified|career_found/i.test(String(result.detection_method || ''))) score += 7;
  if (/verified|career|jobs?|vacanc|opening|recruit/i.test(String(result.ats_evidence_reason || ''))) score += 5;
  const visibleLength = Number(result.career_visible_text_length || String(result.career_evidence_text || '').length || 0);
  if (visibleLength >= 80) score += 10;
  else if (visibleLength > 0 && visibleLength < 20) score -= 60;
  if (/search jobs?|view jobs?|open (?:roles|positions|vacancies)|current openings|join our team|وظائف|فرص عمل/i.test(String(result.career_evidence_text || ''))) score += 5;
  if (result.detection_error) score -= 20;
  return Math.max(0, Math.min(100, score));
}

function shouldUseAiJudge(request, result) {
  if (!AI_JUDGE_ENABLED || !result?.career_url) return false;
  const score = deterministicEvidenceScore(request, result);
  const official = request.official_website || request.company_domain || '';
  const external = domain(result.career_url) !== domain(official);
  const weak = score < AI_JUDGE_MIN_RULE_SCORE || result.ats_status !== 'detected' || external;
  const audit = stablePercent(`${request.company_name}|${request.company_domain}`) < AI_JUDGE_AUDIT_PERCENT;
  return weak || audit;
}

function compactTrace(trace = []) {
  return trace.slice(-24).map(item => ({
    stage: clean(item.stage, 80),
    requested_url: clean(item.requested_url || item.url, 500),
    final_url: clean(item.final_url, 500),
    status: Number(item.status || 0) || null,
    visible_chars: Number(item.visible_chars || 0) || null,
    error: clean(item.error, 180),
  }));
}

function evidencePayload(request, result) {
  return {
    company_name: clean(request.company_name, 250),
    company_domain: clean(request.company_domain, 300),
    official_website: clean(request.official_website, 500),
    candidate_career_url: clean(result.career_url, 700),
    visible_text_excerpt: clean(result.career_evidence_text, 6000),
    visible_text_length: Number(result.career_visible_text_length || String(result.career_evidence_text || '').length || 0),
    detected_ats: clean(result.detected_ats, 120),
    ats_status: clean(result.ats_status, 80),
    ats_confidence: clean(result.ats_confidence, 80),
    ats_evidence_url: clean(result.ats_evidence_url, 700),
    evidence_reason: clean(result.ats_evidence_reason, 1200),
    detection_method: clean(result.detection_method, 180),
    pages_checked: Number(result.pages_checked || 0),
    static_pages_checked: Number(result.static_pages_checked || 0),
    browser_pages_checked: Number(result.browser_pages_checked || 0),
    playwright_used: Boolean(result.playwright_used),
    job_detail_found: Boolean(result.job_detail_found || result.job_url),
    job_url: clean(result.job_url, 700),
    candidate_urls: unique(result.candidate_urls || []).slice(0, 18),
    trace: compactTrace(result.trace || []),
    deterministic_score: deterministicEvidenceScore(request, result),
  };
}

async function ollamaJson(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_JUDGE_TIMEOUT_MS);
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        think: false,
        keep_alive: '30s',
        format: JUDGE_SCHEMA,
        options: { temperature: 0, num_ctx: 4096, num_predict: 320 },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Ollama returned HTTP ${response.status}`);
    const content = payload?.message?.content;
    if (!content) throw new Error('Ollama returned no structured judge content');
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (!['verified', 'manual_review', 'reject'].includes(parsed.decision)) throw new Error('Invalid AI judge decision');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function combineJudgments(verifier, critic) {
  const bothVerified = verifier.decision === 'verified'
    && critic.decision === 'verified'
    && verifier.same_company === true
    && critic.same_company === true
    && verifier.is_recruiting_page === true
    && critic.is_recruiting_page === true
    && Number(verifier.confidence || 0) >= 85
    && Number(critic.confidence || 0) >= 80;
  return bothVerified ? 'verified' : 'manual_review';
}

async function runTwoPassJudge(evidence) {
  const schemaText = JSON.stringify(JUDGE_SCHEMA);
  const verifier = await ollamaJson([
    {
      role: 'system',
      content: `You are a strict employer career-page verifier. The candidate URL is fixed: never invent or substitute another URL. Judge only the supplied evidence, especially the visible rendered page text. A valid result must be a recruiting/careers destination for the same employer, not a customer, seller, supplier, university admissions, generic contact, news, social network, job aggregator, or unrelated brand page. Empty/white/error/login-only pages are not verified. If evidence is insufficient, choose manual_review. Return JSON matching this schema exactly: ${schemaText}`,
    },
    { role: 'user', content: JSON.stringify(evidence) },
  ]);

  const critic = await ollamaJson([
    {
      role: 'system',
      content: `Act as an adversarial second reviewer. Try to falsify the first review. Re-read the visible rendered text and trace. Look for brand mismatch, misleading /careers URLs, generic marketing text, third-party aggregators, single unrelated job pages, redirects, blank/blocked pages, and weak evidence. Only return verified if the supplied evidence independently proves this is the same employer's public recruiting destination. Otherwise choose manual_review or reject. Return JSON matching this schema exactly: ${schemaText}`,
    },
    { role: 'user', content: JSON.stringify({ evidence, first_review: verifier }) },
  ]);

  return { verifier, critic, decision: combineJudgments(verifier, critic) };
}

async function applyAiJudge(request, result) {
  if (!result?.career_url) return result;
  const score = deterministicEvidenceScore(request, result);
  if (!shouldUseAiJudge(request, result)) {
    result.ai_judge = { used: false, status: 'rules_high_confidence', deterministic_score: score, model: OLLAMA_MODEL };
    return result;
  }

  const evidence = evidencePayload(request, result);
  const run = async () => {
    try {
      const { verifier, critic, decision } = await runTwoPassJudge(evidence);
      result.ai_judge = {
        used: true,
        status: decision === 'verified' ? 'cross_verified' : 'manual_review',
        deterministic_score: score,
        model: OLLAMA_MODEL,
        verifier,
        critic,
      };
      result.trace.push({
        stage: 'ai_judge',
        model: OLLAMA_MODEL,
        decision,
        verifier_confidence: verifier.confidence,
        critic_confidence: critic.confidence,
      });

      if (decision === 'verified') {
        const aiReason = clean(`AI cross-verification passed. ${verifier.reason} Critic: ${critic.reason}`, 1200);
        result.ats_evidence_reason = clean(`${result.ats_evidence_reason || ''} ${aiReason}`, 1800);
        result.detection_method = `${result.detection_method || 'career_verified'}:ai_cross_verified`;
        return result;
      }

      const rejected = result.career_url;
      result.rejected_career_url = rejected;
      result.candidate_urls = unique([...(result.candidate_urls || []), rejected]);
      result.career_url = '';
      result.ai_requires_manual_review = true;
      result.detection_method = 'ai_judge_manual_review';
      result.detection_error = clean(`AI cross-check did not independently verify ${rejected}. ${verifier.reason} Critic: ${critic.reason}`, 1200);
      return result;
    } catch (error) {
      const message = clean(error instanceof Error ? error.message : error, 500);
      result.ai_judge = { used: false, status: 'unavailable', deterministic_score: score, model: OLLAMA_MODEL, error: message };
      result.trace.push({ stage: 'ai_judge', model: OLLAMA_MODEL, status: 'unavailable', error: message });
      // Never let a local-model outage turn a weak candidate into an automatic approval.
      if (score < 85) {
        const rejected = result.career_url;
        result.rejected_career_url = rejected;
        result.candidate_urls = unique([...(result.candidate_urls || []), rejected]);
        result.career_url = '';
        result.ai_requires_manual_review = true;
        result.detection_method = 'ai_judge_unavailable_manual_review';
        result.detection_error = `Candidate held for manual review because AI cross-verification was unavailable and deterministic evidence scored ${score}/100.`;
      }
      return result;
    }
  };

  const task = judgeQueue.then(run, run);
  judgeQueue = task.then(() => undefined, () => undefined);
  return task;
}

module.exports = {
  deterministicEvidenceScore,
  shouldUseAiJudge,
  combineJudgments,
  applyAiJudge,
  evidencePayload,
};
