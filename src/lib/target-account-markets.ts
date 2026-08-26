export const TARGET_ACCOUNT_MARKETS = [
  {
    country: "Saudi Arabia",
    code: "SA",
    phase: "Core",
    marketSize: 2256,
    priority: 100,
    industries: ["Healthcare", "Hospitality", "Retail", "Logistics", "Construction", "Real Estate", "Education", "Financial Services", "Technology", "Manufacturing", "Aviation"],
    naics: ["62", "72", "44", "45", "48", "49", "23", "531", "61", "52", "5415", "31", "32", "33", "481"],
  },
  {
    country: "United Arab Emirates",
    code: "AE",
    phase: "Core",
    marketSize: 2692,
    priority: 96,
    industries: ["Healthcare", "Hospitality", "Retail", "Logistics", "Construction", "Real Estate", "Financial Services", "Technology", "Manufacturing", "Aviation"],
    naics: ["62", "72", "44", "45", "48", "49", "23", "531", "52", "5415", "31", "32", "33", "481"],
  },
  {
    country: "Egypt",
    code: "EG",
    phase: "Core",
    marketSize: 1098,
    priority: 90,
    industries: ["Healthcare", "Retail", "FMCG", "Manufacturing", "Banking & Fintech", "Telecom", "BPO", "Hospitality", "Large Real Estate"],
    naics: ["62", "44", "45", "31", "32", "33", "52", "517", "5614", "72", "531"],
  },
  {
    country: "South Africa",
    code: "ZA",
    phase: "Core",
    marketSize: 1646,
    priority: 88,
    industries: ["Manufacturing", "Financial Services", "Retail", "Healthcare", "Logistics", "Hospitality", "Construction", "Real Estate", "Telecom"],
    naics: ["31", "32", "33", "52", "44", "45", "62", "48", "49", "72", "23", "531", "517"],
  },
  {
    country: "Morocco",
    code: "MA",
    phase: "Expansion",
    marketSize: 356,
    priority: 78,
    industries: ["Manufacturing", "Retail", "Hospitality", "Healthcare", "Logistics", "Construction", "Real Estate", "Telecom"],
    naics: ["31", "32", "33", "44", "45", "72", "62", "48", "49", "23", "531", "517"],
  },
  {
    country: "Qatar",
    code: "QA",
    phase: "Expansion",
    marketSize: 364,
    priority: 76,
    industries: ["Hospitality", "Construction", "Real Estate", "Financial Services", "Healthcare", "Retail", "Logistics", "Aviation"],
    naics: ["72", "23", "531", "52", "62", "44", "45", "48", "49", "481"],
  },
  {
    country: "Kuwait",
    code: "KW",
    phase: "Expansion",
    marketSize: 280,
    priority: 74,
    industries: ["Retail", "Hospitality", "Real Estate", "Financial Services", "Healthcare", "Construction", "Logistics", "Manufacturing"],
    naics: ["44", "45", "72", "531", "52", "62", "23", "48", "49", "31", "32", "33"],
  },
  {
    country: "Jordan",
    code: "JO",
    phase: "Selective",
    marketSize: 198,
    priority: 65,
    industries: ["Financial Services", "Healthcare", "Retail", "Construction", "Telecom", "Hospitality", "Manufacturing", "Technology"],
    naics: ["52", "62", "44", "45", "23", "517", "72", "31", "32", "33", "5415"],
  },
  {
    country: "Oman",
    code: "OM",
    phase: "Selective",
    marketSize: 182,
    priority: 62,
    industries: ["Construction", "Logistics", "Hospitality", "Healthcare", "Retail", "Manufacturing", "Financial Services", "Real Estate"],
    naics: ["23", "48", "49", "72", "62", "44", "45", "31", "32", "33", "52", "531"],
  },
  {
    country: "Bahrain",
    code: "BH",
    phase: "Selective",
    marketSize: 123,
    priority: 60,
    industries: ["Financial Services", "Hospitality", "Retail", "Healthcare", "Real Estate", "Construction", "Logistics"],
    naics: ["52", "72", "44", "45", "62", "531", "23", "48", "49"],
  },
  {
    country: "Iraq",
    code: "IQ",
    phase: "Selective",
    marketSize: 97,
    priority: 58,
    industries: ["Financial Services", "Construction", "Logistics", "Healthcare", "Telecom", "Manufacturing", "Retail", "Hospitality"],
    naics: ["52", "23", "48", "49", "62", "517", "31", "32", "33", "44", "45", "72"],
  },
] as const;

export type TargetAccountCountry = typeof TARGET_ACCOUNT_MARKETS[number]["country"];

export const TARGET_ACCOUNT_TOTAL = TARGET_ACCOUNT_MARKETS.reduce((sum, market) => sum + market.marketSize, 0);

export const TARGET_EMPLOYEE_RANGES = [
  "201,500",
  "501,1000",
  "1001,5000",
  "5001,10000",
  "10001,100000",
] as const;

export function targetMarket(country: string) {
  const market = TARGET_ACCOUNT_MARKETS.find((item) => item.country === country);
  return market ? { ...market, marketSize: Number(market.marketSize), priority: Number(market.priority) } : null;
}

export function targetMarketNames() {
  return TARGET_ACCOUNT_MARKETS.map((market) => market.country);
}
