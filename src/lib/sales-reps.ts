export const BASSAM_OWNER_ID = "75863674";

export const SALES_REP_OWNER_IDS = [
  "76369995", // Mohammed Faizan
  "76369998", // Fadi Zanona
  "76370000", // Mohammad Jehad Al-Barqawi
  BASSAM_OWNER_ID, // Bassam Hamed
  "76369997", // Ursula Waked
  "31558980", // Zein Fares
] as const;

export const SALES_REP_SELECTION_LABEL = "Faizan, Fadi, Jehad, Bassam, Ursula, or Zein";

export const SALES_REP_OWNER_ID_SET = new Set<string>(SALES_REP_OWNER_IDS);
