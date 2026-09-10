const COUNTRY_ALIASES: Record<string, string> = {
  ae: "United Arab Emirates",
  uae: "United Arab Emirates",
  "u a e": "United Arab Emirates",
  "united arab emirate": "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
  dubai: "United Arab Emirates",
  "abu dhabi": "United Arab Emirates",
  sa: "Saudi Arabia",
  ksa: "Saudi Arabia",
  "k s a": "Saudi Arabia",
  "kingdom of saudi arabia": "Saudi Arabia",
  "saudi arabia": "Saudi Arabia",
  "saudia arabia": "Saudi Arabia",
  riyadh: "Saudi Arabia",
  jeddah: "Saudi Arabia",
  khobar: "Saudi Arabia",
  makkah: "Saudi Arabia",
  mecca: "Saudi Arabia",
};

function aliasKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeCountry(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  return COUNTRY_ALIASES[aliasKey(normalized)] ?? normalized;
}
