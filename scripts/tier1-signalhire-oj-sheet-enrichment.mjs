import crypto from "node:crypto";

const spreadsheetId = process.env.TIER1_SPREADSHEET_ID;
const signalHireKey = process.env.SIGNALHIRE_API_KEY;
const serviceAccountRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const maxCompanies = Math.max(1, Number(process.env.MAX_COMPANIES || 50));
const sheetName = "Tier 1 Contacts";
const contactsSheetId = 625047448;
const readRange = `${sheetName}!A1:T2500`;
const searchUrl = "https://www.signalhire.com/api/v1/candidate/searchByQuery";
const personUrl = "https://www.signalhire.com/api/v1/candidate/search";
const HR_QUERY = "(HR OR \"Human Resources\" OR \"Human Capital\" OR Payroll OR Compensation OR Benefits OR CHRO OR HRBP OR People)";
const EXEC_QUERY = "(CEO OR \"Chief Executive\" OR Founder OR Owner OR \"General Manager\" OR \"Managing Director\")";
const HR_LEVELS = ["Senior", "Lead", "Head", "VP", "C-Level", "Directors"];
const EXEC_LEVELS = ["C-Level", "Founder / Owner", "Directors", "Head"];
const WRITE_CHUNK_SIZE = 10;
const MAX_PROFILES_PER_PATH = 5;

let serviceAccount;
let stopRequested = false;

function fail(message, status = null) {
  const error = new Error(message);
  if (status) error.status = status;
  return error;
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function makeGoogleJwt() {
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(serviceAccount.private_key, "base64url")}`;
}

async function googleToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: makeGoogleJwt()
    })
  });
  const body = await response.text();
  if (!response.ok) throw fail(`Google auth failed (${response.status}): ${body}`, response.status);
  return JSON.parse(body).access_token;
}

async function sheetsRequest(path, options, googleAccessToken) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`,
    {
      ...options,
      headers: {
        authorization: `Bearer ${googleAccessToken}`,
        "content-type": "application/json",
        ...(options?.headers || {})
      }
    }
  );
  const body = await response.text();
  if (!response.ok) throw fail(`Sheets ${response.status}: ${body}`, response.status);
  return body ? JSON.parse(body) : {};
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function signalHireRequest(url, body, label) {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: signalHireKey,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (response.ok) return parsed;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 2) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    throw fail(`SignalHire ${label} ${response.status}: ${text}`, response.status);
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\\b(limited|ltd|llc|inc|company|co|corp|corporation|saudi|arabia)\\b/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function companyMatches(profile, companyName) {
  const target = normalize(companyName);
  if (!target) return false;
  const experiences = Array.isArray(profile?.experience) ? profile.experience : [];
  const companyNames = experiences
    .map(item => typeof item?.company === "string" ? item.company : item?.company?.name)
    .filter(Boolean)
    .map(normalize);
  if (!companyNames.length) return true;
  return companyNames.some(name =>
    name === target || name.includes(target) || target.includes(name)
  );
}

function currentExperience(profile) {
  const experiences = Array.isArray(profile?.experience) ? profile.experience : [];
  return experiences.find(item => item?.current === true) || experiences[0] || {};
}

function titleFromProfile(profile) {
  const experience = currentExperience(profile);
  return String(
    experience.position ||
    experience.title ||
    profile?.title ||
    profile?.headline ||
    profile?.headLine ||
    ""
  ).trim();
}

function isQualifiedTitle(title, kind) {
  const value = String(title || "").toLowerCase();
  if (!value) return false;

  const excluded = /vendor|procurement|purchasing|supply chain|warehouse|logistics|operations performance|\\boperations manager\\b|executive assistant|\\bassistant\\b|\\bcoordinator\\b|\\badministrator\\b|\\badmin\\b|recruiter|recruitment|talent acquisition/;
  if (excluded.test(value)) return false;

  if (kind === "hr") {
    return /\\bhr\\b|human resources|human capital|\\bpeople\\b|payroll|compensation|benefits|personnel|employee services|shared services|\\bchro\\b|\\bhrbp\\b|people operations/.test(value);
  }

  return /chief executive|\\bceo\\b|founder|co-founder|\\bowner\\b|managing director|general manager|\\bgm\\b/.test(value) &&
    !/deputy|advisor|consultant/.test(value);
}

function profileRank(profile, kind, companyName) {
  const title = titleFromProfile(profile).toLowerCase();
  let score = companyMatches(profile, companyName) ? 30 : 0;
  if (kind === "hr") {
    if (/payroll|compensation|benefits|chro|head of hr|chief human|human resources director/.test(title)) score += 25;
    if (/human resources|human capital|people/.test(title)) score += 15;
    if (/head|chief|director|vp|lead|manager/.test(title)) score += 10;
  } else {
    if (/ceo|chief executive/.test(title)) score += 25;
    if (/founder|owner/.test(title)) score += 20;
    if (/general manager|managing director|\\bgm\\b/.test(title)) score += 15;
  }
  if (profile?.location) score += 1;
  return score;
}

function dedupeProfiles(profiles, kind, companyName) {
  const seen = new Set();
  return (Array.isArray(profiles) ? profiles : [])
    .filter(profile => {
      const uid = String(profile?.uid || "").trim();
      const title = titleFromProfile(profile);
      if (!uid || seen.has(uid) || !isQualifiedTitle(title, kind)) return false;
      seen.add(uid);
      return true;
    })
    .sort((a, b) => profileRank(b, kind, companyName) - profileRank(a, kind, companyName))
    .slice(0, MAX_PROFILES_PER_PATH);
}

function extractEmail(candidate) {
  const contacts = Array.isArray(candidate?.contacts) ? candidate.contacts : [];
  const emails = contacts
    .filter(contact => contact?.type === "email" && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(contact?.value || "")))
    .map(contact => ({
      value: String(contact.value).trim(),
      subType: String(contact.subType || "").toLowerCase(),
      rating: Number(contact.rating || 0)
    }))
    .sort((a, b) => {
      const workA = a.subType === "work" ? 1 : 0;
      const workB = b.subType === "work" ? 1 : 0;
      return workB - workA || b.rating - a.rating;
    });
  return emails[0] || null;
}

function splitName(candidate, fallbackProfile) {
  const fullName = String(candidate?.fullName || fallbackProfile?.fullName || "").trim();
  const parts = fullName.split(/\\s+/).filter(Boolean);
  return {
    fullName,
    firstName: String(candidate?.firstName || candidate?.first_name || parts[0] || "").trim(),
    lastName: String(candidate?.lastName || candidate?.last_name || parts.slice(1).join(" ") || "").trim()
  };
}

function linkedinFrom(candidate, profile) {
  const social = Array.isArray(candidate?.social) ? candidate.social : [];
  const linkedin = social.find(item => {
    const type = String(item?.type || "").toLowerCase();
    const link = String(item?.link || item?.url || "");
    return type === "li" || type.includes("linkedin") || link.includes("linkedin.com");
  });
  return String(linkedin?.link || linkedin?.url || profile?.linkedin || profile?.linkedinUrl || "").trim();
}

function makeSheetValues(profile, candidate, fallback) {
  const title = titleFromProfile(candidate) || titleFromProfile(profile);
  const names = splitName(candidate, profile);
  const email = extractEmail(candidate);
  const persona = fallback ? "CEO / founder decision maker" : "HR/payroll decision maker";
  const emailStatus = email
    ? (email.subType === "work" ? (email.rating >= 90 ? "verified" : "likely") : "personal_email")
    : "no_email_found";
  return [
    names.fullName,
    names.firstName,
    names.lastName,
    title,
    persona,
    email?.value || "",
    emailStatus,
    linkedinFrom(candidate, profile),
    String(candidate?.uid || profile?.uid || ""),
    fallback
      ? "SignalHire_Oj current-company match; HR path empty; executive fallback; synchronous enrichment"
      : "SignalHire_Oj current-company match; HR/payroll decision-maker match; synchronous enrichment",
    "SignalHire_Oj",
    `signalhire_oj_enriched${email ? "" : "_no_email"}`
  ];
}

async function searchCandidates(companyName, kind) {
  const query = kind === "hr" ? HR_QUERY : EXEC_QUERY;
  const level = kind === "hr" ? HR_LEVELS : EXEC_LEVELS;
  const body = {
    currentTitle: query,
    currentCompany: `"${String(companyName).replace(/["\\\\]/g, " ").trim()}"`,
    location: "Saudi Arabia",
    level,
    size: 10
  };
  if (kind === "hr") body.department = ["HR & Recruitment"];
  const result = await signalHireRequest(searchUrl, body, `search (${kind})`);
  return dedupeProfiles(result?.profiles, kind, companyName);
}

async function enrichProfiles(profiles) {
  if (!profiles.length) return [];
  const result = await signalHireRequest(
    personUrl,
    { items: profiles.map(profile => profile.uid), withoutWaterfall: true },
    "person"
  );
  return Array.isArray(result) ? result : [];
}

function candidateFromResult(result, profile) {
  return result?.status === "success" && result?.candidate
    ? result.candidate
    : null;
}

async function findBestForCompany(target) {
  for (const kind of ["hr", "exec"]) {
    const profiles = await searchCandidates(target.company, kind);
    if (!profiles.length) continue;
    const results = await enrichProfiles(profiles);
    const byUid = new Map(results.map(result => [String(result?.item || ""), result]));
    const enriched = profiles
      .map(profile => ({ profile, candidate: candidateFromResult(byUid.get(String(profile.uid)), profile) }))
      .filter(item => item.candidate);
    const withEmail = enriched.find(item => extractEmail(item.candidate));
    const selected = withEmail || enriched[0];
    if (selected) return { ...selected, fallback: kind === "exec" };
  }
  return null;
}

async function processOne(target) {
  try {
    if (stopRequested) return null;
    const found = await findBestForCompany(target);
    if (!found) return null;
    return {
      row: target.row,
      company: target.company,
      values: makeSheetValues(found.profile, found.candidate, found.fallback)
    };
  } catch (error) {
    console.error(JSON.stringify({
      stage: "company",
      row: target.row,
      company: target.company,
      status: error.status || null,
      error: String(error.message || error)
    }));
    if (error.status === 402) stopRequested = true;
    return null;
  }
}

function cellData(value) {
  return { userEnteredValue: { stringValue: String(value ?? "") } };
}

async function writeResults(results, googleAccessToken) {
  if (!results.length) return;
  const requests = results.map(result => ({
    updateCells: {
      range: {
        sheetId: contactsSheetId,
        startRowIndex: result.row - 1,
        endRowIndex: result.row,
        startColumnIndex: 8,
        endColumnIndex: 20
      },
      rows: [{ values: result.values.map(cellData) }],
      fields: "userEnteredValue"
    }
  }));
  await sheetsRequest(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests })
  }, googleAccessToken);
}

async function main() {
  if (!spreadsheetId) throw fail("TIER1_SPREADSHEET_ID is missing");
  if (!signalHireKey) throw fail("SIGNALHIRE_API_KEY is missing. Expected GitHub secret SignalHire_Oj.");
  if (!serviceAccountRaw) throw fail("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  try {
    serviceAccount = JSON.parse(serviceAccountRaw);
  } catch (error) {
    throw fail(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
  }

  const googleAccessToken = await googleToken();
  const data = await sheetsRequest(`/values/${encodeURIComponent(readRange)}`, {}, googleAccessToken);
  const rows = Array.isArray(data?.values) ? data.values : [];
  const targets = rows.slice(1).map((row, index) => ({
    row: index + 2,
    company: String(row?.[0] || "").trim(),
    contactName: String(row?.[8] || "").trim(),
    email: String(row?.[13] || "").trim(),
    personId: String(row?.[16] || "").trim()
  })).filter(target =>
    target.company &&
    !target.contactName &&
    !target.email &&
    !target.personId
  ).slice(0, maxCompanies);

  console.log(JSON.stringify({
    stage: "start",
    requested: maxCompanies,
    eligibleCompanies: targets.length,
    source: "SignalHire_Oj"
  }));

  const results = [];
  let processed = 0;
  for (let index = 0; index < targets.length && !stopRequested; index += 3) {
    const group = targets.slice(index, index + 3);
    const groupResults = await Promise.all(group.map(processOne));
    results.push(...groupResults.filter(Boolean));
    processed += group.length;
    await writeResults(groupResults.filter(Boolean), googleAccessToken);
    console.log(JSON.stringify({
      stage: "checkpoint",
      processed,
      total: targets.length,
      writtenThisCheckpoint: groupResults.filter(Boolean).length,
      written: results.length,
      writtenWithEmail: results.filter(result => Boolean(result.values[5])).length,
      remainingInRun: Math.max(0, targets.length - processed),
      stoppedByQuota: stopRequested
    }));
  }

  const withEmail = results.filter(result => Boolean(result.values[5])).length;
  const withoutEmail = results.length - withEmail;
  console.log(JSON.stringify({
    stage: "complete",
    considered: processed,
    foundPerson: results.length,
    written: results.length,
    writtenWithEmail: withEmail,
    writtenWithoutEmail: withoutEmail,
    eligibleRemainingAfterRun: Math.max(0, targets.length - processed),
    stoppedByQuota: stopRequested
  }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
