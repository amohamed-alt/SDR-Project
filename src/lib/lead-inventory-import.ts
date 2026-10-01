import { z } from "zod";

const webUrl = z.string().trim().max(2000).refine((value) => {
  if (!value) return true;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use an HTTP or HTTPS URL");

export const inventoryCompanySchema = z.object({
  name: z.string().trim().min(1).max(300),
  domain: z.string().trim().min(3).max(255),
  country: z.string().trim().max(160).default(""),
  industry: z.string().trim().max(300).default(""),
  employeeCount: z.coerce.number().int().min(0).max(10_000_000).default(0),
  sourceUrl: webUrl.default(""),
  linkedinUrl: webUrl.default(""),
  careerPageUrl: webUrl.default(""),
  detectedAts: z.string().trim().max(300).default(""),
  evidence: z.string().trim().max(1000).default(""),
  businessLine: z.enum(["Talentera", "Evalufy"]).default("Talentera"),
}).strict();

export const inventoryImportSchema = z.object({
  source: z.enum(["Clay", "SignalHire", "Sales Navigator", "LinkedIn", "Public research", "Manual"]),
  companies: z.array(inventoryCompanySchema).min(1).max(100),
  execute: z.boolean().default(false),
});

export type InventoryCompany = z.infer<typeof inventoryCompanySchema>;

export function inventoryDomain(value: string) {
  const raw = value.trim();
  if (/^[a-z]+:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) throw new Error("Use a company website domain");
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  const domain = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (url.username || url.password || url.port || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    || /(?:^|\.)(?:localhost|invalid|local|internal)$/.test(domain)) throw new Error(`Invalid company domain: ${value}`);
  return domain;
}

// RFC-style CSV: quoted commas, escaped quotes, CRLF and multiline fields.
export function parseInventoryFile(text: string): unknown[] {
  const input = text.replace(/^\uFEFF/, "").trim();
  if (input.startsWith("[")) {
    const result: unknown = JSON.parse(input);
    if (!Array.isArray(result)) throw new Error("JSON must contain an array of companies");
    return result;
  }
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  const headers = rows.shift()?.map((value) => value.trim()) || [];
  if (!headers.includes("name") || !headers.includes("domain")) throw new Error("CSV requires name and domain columns");
  if (new Set(headers).size !== headers.length) throw new Error("CSV has duplicate column names");
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has an incorrect column count`);
    return Object.fromEntries(headers.map((key, column) => [key, values[column].trim()]));
  });
}
