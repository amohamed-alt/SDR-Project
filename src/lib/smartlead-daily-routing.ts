import type { OutreachProduct, RecipientLocale } from "./recipient-language-routing.ts";
import { laneFor, type OutreachLane } from "./smartlead-visible-sequences.ts";

export const DAILY_LANE_NEW_CAPS: Record<OutreachLane, number> = {
  talentera_ar: 15,
  talentera_en: 15,
  evalufy_ar: 10,
  evalufy_en: 10,
};

export type DailyRoutingLead = {
  email: string;
  product: OutreachProduct;
  locale: RecipientLocale;
  eligible: boolean;
  blockReason?: string;
};

const LANES = Object.keys(DAILY_LANE_NEW_CAPS) as OutreachLane[];

function nonNegativeInteger(value: number) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function proportionalTargets(caps: Record<OutreachLane, number>, total: number) {
  const safeTotal = Math.min(nonNegativeInteger(total), LANES.reduce((sum, lane) => sum + caps[lane], 0));
  const result = Object.fromEntries(LANES.map((lane) => [lane, 0])) as Record<OutreachLane, number>;
  if (!safeTotal) return result;

  const capTotal = LANES.reduce((sum, lane) => sum + caps[lane], 0);
  const ranked = LANES.map((lane, order) => {
    const exact = safeTotal * caps[lane] / capTotal;
    result[lane] = Math.floor(exact);
    return { lane, order, remainder: exact - result[lane] };
  }).sort((left, right) => right.remainder - left.remainder || left.order - right.order);

  let remaining = safeTotal - LANES.reduce((sum, lane) => sum + result[lane], 0);
  for (const item of ranked) {
    if (!remaining) break;
    if (result[item.lane] >= caps[item.lane]) continue;
    result[item.lane] += 1;
    remaining -= 1;
  }
  return result;
}

export function buildDailyLaneTargets(
  globalLimit: number,
  productLimits: Record<OutreachProduct, number>,
  laneCaps: Record<OutreachLane, number> = DAILY_LANE_NEW_CAPS,
) {
  const productConstrained = { ...laneCaps };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) {
    const productLanes = LANES.filter((lane) => lane.startsWith(product === "evalify" ? "evalufy_" : "talentera_"));
    const available = Object.fromEntries(LANES.map((lane) => [lane, productLanes.includes(lane) ? laneCaps[lane] : 0])) as Record<OutreachLane, number>;
    const allocated = proportionalTargets(available, productLimits[product]);
    for (const lane of productLanes) productConstrained[lane] = allocated[lane];
  }
  return proportionalTargets(productConstrained, globalLimit);
}

export function verificationCandidatesForLane<T extends DailyRoutingLead>(leads: T[], lane: OutreachLane) {
  const seen = new Set<string>();
  return leads.filter((lead) => {
    const email = String(lead.email || "").trim().toLowerCase();
    const linkedin = String((lead as T & { linkedinUrl?: string }).linkedinUrl || "").trim().toLowerCase();
    const identity = email || linkedin;
    if (!identity || seen.has(identity) || laneFor(lead.product, lead.locale) !== lane) return false;
    if (/(?:Sales activity|Already entered|Duplicate email)/i.test(lead.blockReason || "")) return false;
    seen.add(identity);
    return true;
  });
}

export function selectVerifiedDailyBatch<T extends DailyRoutingLead>(
  leads: T[],
  verifiedEmails: Set<string>,
  options: {
    globalLimit: number;
    productLimits: Record<OutreachProduct, number>;
    laneLimits?: Record<OutreachLane, number>;
  },
) {
  const globalLimit = nonNegativeInteger(options.globalLimit);
  const laneLimits = options.laneLimits || DAILY_LANE_NEW_CAPS;
  const productCounts: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  const laneCounts = Object.fromEntries(LANES.map((lane) => [lane, 0])) as Record<OutreachLane, number>;
  const selected: T[] = [];
  const usedEmails = new Set<string>();

  for (const lead of leads) {
    const email = String(lead.email || "").trim().toLowerCase();
    if (!lead.eligible || !email || usedEmails.has(email) || !verifiedEmails.has(email)) continue;
    const lane = laneFor(lead.product, lead.locale);
    if (laneCounts[lane] >= nonNegativeInteger(laneLimits[lane])) continue;
    if (productCounts[lead.product] >= nonNegativeInteger(options.productLimits[lead.product])) continue;
    selected.push(lead);
    usedEmails.add(email);
    laneCounts[lane] += 1;
    productCounts[lead.product] += 1;
    if (selected.length >= globalLimit) break;
  }

  return { selected, laneCounts, productCounts };
}
