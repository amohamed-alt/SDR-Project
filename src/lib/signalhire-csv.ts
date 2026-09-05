export type SignalHireCsvLead = {
  id: string;
  name: string;
  title: string;
  company: string;
  companyWebsite: string;
  companyDomain: string;
  location: string;
  linkedinUrl: string;
  signalHireProfileUrl: string;
  email: string;
  emails: string[];
  businessEmails: string[];
  personalEmails: string[];
  phone: string;
  phones: string[];
  validationIssues: string[];
};

export type SignalHireCsvParseResult = {
  leads: SignalHireCsvLead[];
  skipped: number;
  headers: string[];
  totalRows: number;
};

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function isPlaceholder(value: string) {
  return /^(?:-|--|—|n\/?a|na|none|null|undefined|unknown|not available)$/i.test(value.trim());
}

function validPublicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host || isPlaceholder(host) || host.length > 253 || !host.includes(".")) return false;
  const labels = host.split(".");
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return false;
  const tld = labels.at(-1) || "";
  return /[a-z]/i.test(tld) && tld.length >= 2;
}

function normalizeWebsite(value: string) {
  const raw = value.trim();
  if (!raw || isPlaceholder(raw)) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol) || !validPublicHostname(url.hostname)) return "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function domainFromWebsite(value: string) {
  const website = normalizeWebsite(value);
  if (!website) return "";
  try {
    const hostname = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
    return validPublicHostname(hostname) ? hostname : "";
  } catch {
    return "";
  }
}

function cleanLinkedIn(value: string) {
  const raw = value.trim();
  if (!raw || isPlaceholder(raw)) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !/^\/in\//i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function emailValues(values: string[]) {
  return unique(values).filter((value) => !isPlaceholder(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function phoneValues(values: string[]) {
  return unique(values).filter((value) => !isPlaceholder(value) && /\d{6,}/.test(value.replace(/\D/g, "")));
}

function cell(record: Record<string, string>, name: string) {
  const value = String(record[name] || "").trim();
  return isPlaceholder(value) ? "" : value;
}

export function parseSignalHireCsv(text: string): SignalHireCsvParseResult {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The CSV does not contain any SignalHire rows.");

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  const required = ["First Name", "Last Name", "Company"];
  if (!required.every((name) => headers.includes(name))) {
    throw new Error("This does not look like a SignalHire export. Expected First Name, Last Name and Company columns.");
  }

  const leads: SignalHireCsvLead[] = [];
  const skipped = 0;
  const dataRows = rows.slice(1);

  for (const values of dataRows) {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = values[index] || ""; });

    const name = [cell(record, "First Name"), cell(record, "Last Name")].filter(Boolean).join(" ").trim();
    const company = cell(record, "Company");
    const businessEmails = emailValues([cell(record, "Business Email1"), cell(record, "Business Email2")]);
    const personalEmails = emailValues([cell(record, "Personal Email1"), cell(record, "Personal Email2")]);
    const emails = unique([...businessEmails, ...personalEmails]);
    const phones = phoneValues([
      cell(record, "Mobile Phone1"),
      cell(record, "Mobile Phone2"),
      cell(record, "Work Phone"),
      cell(record, "Unknown Phone1"),
      cell(record, "Unknown Phone2"),
    ]);
    const linkedinUrl = cleanLinkedIn(cell(record, "LinkedIn Link1"))
      || cleanLinkedIn(cell(record, "LinkedIn Link2"))
      || cleanLinkedIn(cell(record, "LinkedIn Link3"));
    const companyWebsite = normalizeWebsite(cell(record, "Company Website1"))
      || normalizeWebsite(cell(record, "Company Website2"))
      || normalizeWebsite(cell(record, "Company Website3"));

    const validationIssues: string[] = [];
    if (!name) validationIssues.push("Missing person name");
    if (!phones.length) validationIssues.push("No phone number");
    if (!company && !linkedinUrl && !emails.length && !phones.length) validationIssues.push("Missing person/company identifiers");

    // Keep every non-empty SignalHire data row visible in the import UI. Invalid or
    // incomplete records must be reviewed explicitly instead of disappearing from
    // the Uploaded count (for example, a 100-row file silently becoming 84 rows).
    leads.push({
      id: cell(record, "Id"),
      name,
      title: cell(record, "Position"),
      company,
      companyWebsite,
      companyDomain: domainFromWebsite(companyWebsite),
      location: cell(record, "Location") || cell(record, "Company Headquarter"),
      linkedinUrl,
      signalHireProfileUrl: cell(record, "Uploaded Link"),
      email: businessEmails[0] || "",
      emails,
      businessEmails,
      personalEmails,
      phone: phones[0] || "",
      phones,
      validationIssues,
    });
  }

  if (!leads.length) throw new Error("No SignalHire contacts were found in this export.");
  return { leads, skipped, headers, totalRows: dataRows.length };
}
