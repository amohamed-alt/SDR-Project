export type AcquisitionCoverageCountry =
  | "Saudi Arabia"
  | "United Arab Emirates"
  | "Qatar"
  | "Kuwait"
  | "Bahrain"
  | "Oman"
  | "Egypt";

export type AcquisitionCoverageSector =
  | "Government / Semi-Government"
  | "Banking / Financial Services"
  | "Insurance"
  | "Healthcare / Pharma"
  | "Education"
  | "Construction / Engineering"
  | "Real Estate / Facilities"
  | "Energy / Oil & Gas"
  | "Mining / Metals"
  | "Manufacturing / Industrial"
  | "Technology / IT"
  | "Telecom"
  | "Logistics / Transport / Aviation"
  | "Retail / FMCG / Food"
  | "Hospitality / Tourism / Entertainment"
  | "Professional / Business Services"
  | "BPO / Outsourcing"
  | "Media / Sports"
  | "Agriculture / Fisheries / Food Security";

export const ACQUISITION_COVERAGE_COUNTRIES: AcquisitionCoverageCountry[] = [
  "Saudi Arabia",
  "United Arab Emirates",
  "Qatar",
  "Kuwait",
  "Bahrain",
  "Oman",
  "Egypt",
];

// Engagement data shows the strongest repeatable pool at 251–5,000 employees,
// while 5,001–50,000 remains a valuable enterprise extension. Keeping discovery
// at 251–50,000 avoids spending credits on the weakest very-small-company pool.
export const ACQUISITION_COVERAGE_EMPLOYEE_RANGES = [
  "251,500",
  "501,1000",
  "1001,2000",
  "2001,5000",
  "5001,10000",
  "10001,50000",
] as const;

const ALL_CORE_SECTORS: AcquisitionCoverageSector[] = [
  "Government / Semi-Government",
  "Banking / Financial Services",
  "Insurance",
  "Healthcare / Pharma",
  "Education",
  "Construction / Engineering",
  "Real Estate / Facilities",
  "Energy / Oil & Gas",
  "Manufacturing / Industrial",
  "Technology / IT",
  "Telecom",
  "Logistics / Transport / Aviation",
  "Retail / FMCG / Food",
  "Hospitality / Tourism / Entertainment",
  "Professional / Business Services",
];

export const ACQUISITION_COUNTRY_SECTORS: Record<AcquisitionCoverageCountry, AcquisitionCoverageSector[]> = {
  "Saudi Arabia": [
    ...ALL_CORE_SECTORS,
    "Mining / Metals",
    "BPO / Outsourcing",
    "Media / Sports",
    "Agriculture / Fisheries / Food Security",
  ],
  "United Arab Emirates": [
    ...ALL_CORE_SECTORS,
    "BPO / Outsourcing",
    "Media / Sports",
  ],
  Qatar: [
    ...ALL_CORE_SECTORS,
    "Media / Sports",
    "Agriculture / Fisheries / Food Security",
  ],
  Kuwait: [
    ...ALL_CORE_SECTORS,
    "BPO / Outsourcing",
  ],
  Bahrain: [
    ...ALL_CORE_SECTORS,
    "BPO / Outsourcing",
  ],
  Oman: [
    ...ALL_CORE_SECTORS,
    "Mining / Metals",
    "Agriculture / Fisheries / Food Security",
  ],
  Egypt: [
    ...ALL_CORE_SECTORS,
    "Mining / Metals",
    "BPO / Outsourcing",
    "Media / Sports",
    "Agriculture / Fisheries / Food Security",
  ],
};

const SECTOR_PATTERNS: Array<{ sector: AcquisitionCoverageSector; pattern: RegExp }> = [
  {
    sector: "Government / Semi-Government",
    pattern: /\b(government|government administration|public sector|public authority|ministry|municipality|municipal|federal authority|royal commission|sovereign wealth|state[- ]owned|government[- ]owned|government backed|pif|وزارة|هيئة|حكوم|بلدية|أمانة)\b/i,
  },
  {
    sector: "Banking / Financial Services",
    pattern: /\b(bank|banking|financial service|fintech|investment bank|investment management|asset management|capital market|payments?|lending|finance company|credit)\b/i,
  },
  { sector: "Insurance", pattern: /\b(insurance|insurtech|takaful|reinsurance)\b/i },
  {
    sector: "Healthcare / Pharma",
    pattern: /\b(health|hospital|medical|clinic|pharma|pharmaceutical|life sciences?|biotech|diagnostic|healthcare|dental)\b/i,
  },
  {
    sector: "Education",
    pattern: /\b(education|school|university|college|academy|learning|training institute|higher education|e-learning|edtech)\b/i,
  },
  {
    sector: "Construction / Engineering",
    pattern: /\b(construction|contracting|engineering|epc|architecture|infrastructure|building material|civil engineering)\b/i,
  },
  {
    sector: "Real Estate / Facilities",
    pattern: /\b(real estate|property|properties|facilities|facility management|fm services|urban development|housing)\b/i,
  },
  {
    sector: "Energy / Oil & Gas",
    pattern: /\b(oil|gas|energy|petroleum|petrochemical|refining|renewable|solar|utilities|power generation|water utility)\b/i,
  },
  { sector: "Mining / Metals", pattern: /\b(mining|metals?|steel|aluminium|aluminum|mineral)\b/i },
  {
    sector: "Manufacturing / Industrial",
    pattern: /\b(manufactur|industrial|machinery|automation|electronics manufacturing|chemicals?|plastics?|packaging|textiles?)\b/i,
  },
  {
    sector: "Technology / IT",
    pattern: /\b(information technology|\bit\b|software|technology|cyber|cloud|data center|artificial intelligence|\bai\b|computer software|digital services|systems integrator)\b/i,
  },
  { sector: "Telecom", pattern: /\b(telecom|telecommunication|mobile operator|internet service provider|\bisp\b)\b/i },
  {
    sector: "Logistics / Transport / Aviation",
    pattern: /\b(logistics|supply chain|transport|trucking|rail|railway|aviation|airline|airport|maritime|shipping|freight|ports?|courier|delivery)\b/i,
  },
  {
    sector: "Retail / FMCG / Food",
    pattern: /\b(retail|fmcg|consumer goods|food|beverage|supermarket|restaurant|dairy|food production|food service|ecommerce|e-commerce)\b/i,
  },
  {
    sector: "Hospitality / Tourism / Entertainment",
    pattern: /\b(hospitality|hotel|tourism|travel|leisure|entertainment|theme park|events?|resort)\b/i,
  },
  {
    sector: "BPO / Outsourcing",
    pattern: /\b(bpo|outsourc|shared services|business process|contact center|call center)\b/i,
  },
  {
    sector: "Professional / Business Services",
    pattern: /\b(professional services|management consulting|consulting|business services|legal services|accounting|advisory|business supplies)\b/i,
  },
  { sector: "Media / Sports", pattern: /\b(media|broadcast|publishing|sports?|sporting|football|gaming)\b/i },
  {
    sector: "Agriculture / Fisheries / Food Security",
    pattern: /\b(agriculture|agri|fisheries|fishery|aquaculture|food security|farming|poultry)\b/i,
  },
];

export function normalizeCoverageCountry(rawCountry: string): AcquisitionCoverageCountry | null {
  const value = String(rawCountry || "").trim().toLowerCase();
  if (/saudi arabia|\bsaudi\b|\bksa\b|السعود/.test(value)) return "Saudi Arabia";
  if (/united arab emirates|\buae\b|\bemirates\b|الإمارات/.test(value)) return "United Arab Emirates";
  if (/\bqatar\b|قطر/.test(value)) return "Qatar";
  if (/\bkuwait\b|الكويت/.test(value)) return "Kuwait";
  if (/\bbahrain\b|البحرين/.test(value)) return "Bahrain";
  if (/\boman\b|سلطنة عمان|عمان/.test(value)) return "Oman";
  if (/\begypt\b|مصر/.test(value)) return "Egypt";
  return null;
}

export function classifyCoverageSector(rawCountry: string, sourceText: string) {
  const country = normalizeCoverageCountry(rawCountry);
  const text = String(sourceText || "");
  const matched = SECTOR_PATTERNS.find((item) => item.pattern.test(text));
  const sector = matched?.sector || "";
  const targeted = Boolean(country && sector && ACQUISITION_COUNTRY_SECTORS[country].includes(sector));
  return {
    country,
    sector,
    targeted,
    status: targeted ? ("eligible" as const) : ("review" as const),
    reason: targeted
      ? `Target sector for ${country}`
      : country
        ? "Industry did not map confidently to the target-sector matrix; keep for manual coverage review"
        : "Outside GCC + Egypt acquisition coverage",
  };
}

export function employeeCoverageTier(employeeCount: number) {
  if (employeeCount >= 251 && employeeCount <= 5_000) return "sweet_pool" as const;
  if (employeeCount > 5_000 && employeeCount <= 50_000) return "enterprise_extension" as const;
  return "outside_default_pool" as const;
}
