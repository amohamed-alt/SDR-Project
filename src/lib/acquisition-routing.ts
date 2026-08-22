export type AcquisitionOwner = {
  id: string;
  name: string;
  weight: number;
};

export type CandidateProfile = {
  uid: string;
  fullName: string;
  title: string;
  currentCompany: string;
  location: string;
  linkedinUrl?: string;
};

const DEFAULT_OWNERS: AcquisitionOwner[] = [
  { id: "31644369", name: "Marita Chedid", weight: 1 },
  { id: "76369997", name: "Ursula Waked", weight: 1 },
  { id: "31558980", name: "Zein Fares", weight: 1 },
  { id: "76370000", name: "Mohammad Jehad Al-Barqawi", weight: 1 },
  { id: "76369995", name: "Mohammed Faizan", weight: 1 },
  { id: "76369998", name: "Fadi Zanona", weight: 1 },
];

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalized(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
}

function configuredOwnerIds() {
  const value = clean(process.env.ACQUISITION_OWNER_IDS);
  if (!value) return null;
  const ids = value.split(",").map((item) => item.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function configuredWeights() {
  const map = new Map<string, number>();
  const raw = clean(process.env.ACQUISITION_OWNER_WEIGHTS);
  for (const part of raw.split(",")) {
    const [id, rawWeight] = part.split(":").map((item) => item.trim());
    const weight = Number(rawWeight);
    if (id && Number.isFinite(weight) && weight > 0) map.set(id, Math.min(20, weight));
  }
  return map;
}

export function acquisitionOwners() {
  const allowed = configuredOwnerIds();
  const weights = configuredWeights();
  return DEFAULT_OWNERS
    .filter((owner) => !allowed || allowed.has(owner.id))
    .map((owner) => ({ ...owner, weight: weights.get(owner.id) ?? owner.weight }));
}

export function signalHirePersonaQuery(primaryPersona: string, secondaryPersona = "") {
  const source = `${primaryPersona} ${secondaryPersona}`.toLowerCase();
  if (/hris|hr systems|people systems|hr technology|people technology/.test(source)) {
    return '(HRIS OR "HR Systems" OR "People Systems" OR "HR Technology" OR "People Technology") AND (Manager OR Head OR Director OR Lead)';
  }
  if (/talent acquisition|recruit|talent operations/.test(source)) {
    return '("Talent Acquisition" OR Recruitment OR Recruiting OR "Talent Operations") AND (Head OR Director OR Manager OR Lead OR VP)';
  }
  if (/chro|chief|vp|vice president/.test(source)) {
    return '(CHRO OR "Chief Human Resources" OR "Chief People Officer" OR "VP Human Resources" OR "VP People")';
  }
  return '("Talent Acquisition" OR Recruitment OR "Human Resources" OR HR) AND (Head OR Director OR Manager OR VP)';
}

function titleScore(title: string, primaryPersona: string, secondaryPersona: string) {
  const value = normalized(title);
  const primary = normalized(primaryPersona);
  const secondary = normalized(secondaryPersona);
  let score = 0;
  if (/\b(head|director|vp|vice president|chief|chro)\b/.test(value)) score += 28;
  else if (/\b(manager|lead)\b/.test(value)) score += 18;

  if (/talent acquisition/.test(primary) && /talent acquisition/.test(value)) score += 38;
  else if (/recruit/.test(primary) && /recruit/.test(value)) score += 35;
  else if (/hris|hr systems|people systems/.test(primary) && /hris|hr systems|people systems|hr technology|people technology/.test(value)) score += 42;
  else if (/human resources|\bhr\b|people/.test(primary) && /human resources|\bhr\b|people/.test(value)) score += 30;

  if (secondary && secondary.split(" ").some((word) => word.length > 4 && value.includes(word))) score += 8;
  if (/assistant|coordinator|intern|trainee|specialist/.test(value)) score -= 16;
  return score;
}

function companyScore(candidateCompany: string, accountName: string) {
  const candidate = normalized(candidateCompany);
  const account = normalized(accountName);
  if (!candidate || !account) return 0;
  if (candidate === account) return 35;
  if (candidate.includes(account) || account.includes(candidate)) return 28;
  const candidateWords = new Set(candidate.split(" ").filter((word) => word.length > 2));
  const accountWords = account.split(" ").filter((word) => word.length > 2);
  const overlap = accountWords.filter((word) => candidateWords.has(word)).length;
  return Math.min(22, overlap * 7);
}

function geographyScore(location: string, country: string) {
  const value = normalized(location);
  const market = normalized(country);
  if (/saudi|ksa|riyadh|jeddah|dammam|khobar/.test(market) && /saudi|riyadh|jeddah|dammam|khobar|ksa/.test(value)) return 10;
  if (/uae|united arab emirates|emirates|dubai|abu dhabi/.test(market) && /uae|united arab emirates|dubai|abu dhabi|sharjah/.test(value)) return 10;
  return 0;
}

export function rankAcquisitionCandidates(
  candidates: CandidateProfile[],
  input: { accountName: string; country: string; primaryPersona: string; secondaryPersona: string },
) {
  return candidates
    .map((candidate) => {
      const persona = titleScore(candidate.title, input.primaryPersona, input.secondaryPersona);
      const employer = companyScore(candidate.currentCompany, input.accountName);
      const geography = geographyScore(candidate.location, input.country);
      const score = Math.max(0, Math.min(100, persona + employer + geography));
      return {
        ...candidate,
        score,
        reason: [
          persona >= 35 ? "Strong persona match" : persona >= 20 ? "Relevant HR / TA seniority" : "Adjacent persona",
          employer >= 28 ? "Current company confirmed" : employer > 0 ? "Company name partially matched" : "Company needs verification",
          geography ? "Priority-market location" : "Location not used as a strong signal",
        ].join(" · "),
      };
    })
    .sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName));
}

function stableTieBreaker(accountKey: string, ownerId: string) {
  let value = 2166136261;
  for (const character of `${accountKey}:${ownerId}`) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function chooseAcquisitionOwner(
  accountKey: string,
  openTaskCounts: Record<string, number>,
  existingOwnerId = "",
) {
  const owners = acquisitionOwners();
  if (existingOwnerId) {
    const preserved = owners.find((owner) => owner.id === existingOwnerId);
    if (preserved) return { ...preserved, reason: "Preserved existing account ownership" };
  }
  if (!owners.length) throw new Error("No acquisition owners are configured.");

  const ranked = owners
    .map((owner) => ({
      ...owner,
      openTasks: Math.max(0, Number(openTaskCounts[owner.id] || 0)),
      normalizedLoad: Math.max(0, Number(openTaskCounts[owner.id] || 0)) / owner.weight,
      tie: stableTieBreaker(accountKey, owner.id),
    }))
    .sort((a, b) => a.normalizedLoad - b.normalizedLoad || a.openTasks - b.openTasks || a.tie - b.tie);

  const winner = ranked[0];
  return {
    id: winner.id,
    name: winner.name,
    weight: winner.weight,
    reason: `Lowest weighted open-task load (${winner.openTasks} open)`,
  };
}
