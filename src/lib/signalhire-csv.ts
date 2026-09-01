export type SignalHireCsvLead = {
  id: string;
  name: string;
  title: string;
  company: string;
  companyWebsite: string;
  companyDomain: string;
  companyHeadquarter: string;
  companySize: string;
  location: string;
  headline: string;
  summary: string;
  yearsExperience: string;
  spokenLanguage: string;
  recruitmentStage: string;
  recruitmentStatus: string;
  linkedinUrl: string;
  twitterUrl: string;
  facebookUrl: string;
  skype: string;
  signalHireProfileUrl: string;
  email: string;
  emails: string[];
  businessEmails: string[];
  personalEmails: string[];
  phone: string;
  phones: string[];
  mobilePhones: string[];
  workPhones: string[];
  otherPhones: string[];
  skills: string[];
  currentRoleSummary: string;
  previousTitle: string;
  previousCompany: string;
  previousStarted: string;
  previousEnded: string;
  education: string[];
};

export type SignalHireCsvParseResult = {
  leads: SignalHireCsvLead[];
  skipped: number;
  headers: string[];
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

function compact(value: string, max = 4_000) {
  return value.replace(/\u200b/g, "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function normalizeWebsite(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function domainFromWebsite(value: string) {
  const website = normalizeWebsite(value);
  if (!website) return "";
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanLinkedIn(value: string) {
  const raw = value.trim();
  if (!raw) return "";
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

function cleanSocial(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return /^https?:$/.test(url.protocol) ? url.toString().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

function emailValues(values: string[]) {
  return unique(values).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function phoneValues(values: string[]) {
  return unique(values).filter((value) => /\d{6,}/.test(value.replace(/\D/g, "")));
}

function cell(record: Record<string, string>, name: string) {
  return String(record[name] || "").trim();
}

function firstCell(record: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = cell(record, name);
    if (value) return value;
  }
  return "";
}

function educationValues(record: Record<string, string>) {
  const rows: string[] = [];
  for (let index = 1; index <= 8; index += 1) {
    const degree = cell(record, `Education Degree${index}`);
    const faculty = cell(record, `Education Faculty${index}`);
    const university = cell(record, `Education University${index}`);
    const started = cell(record, `Education Started${index}`);
    const ended = cell(record, `Education Ended${index}`);
    if (!degree && !faculty && !university) continue;
    const program = [degree, faculty].filter(Boolean).join(" — ");
    const place = university;
    const dates = [started, ended].filter(Boolean).join(" → ");
    rows.push([program, place, dates].filter(Boolean).join(" · "));
    if (rows.length >= 3) break;
  }
  return unique(rows);
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
  let skipped = 0;

  for (const values of rows.slice(1)) {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = values[index] || ""; });

    const name = [cell(record, "First Name"), cell(record, "Last Name")].filter(Boolean).join(" ").trim();
    const company = cell(record, "Company");
    const businessEmails = emailValues([cell(record, "Business Email1"), cell(record, "Business Email2")]);
    const personalEmails = emailValues([cell(record, "Personal Email1"), cell(record, "Personal Email2")]);
    const emails = unique([...businessEmails, ...personalEmails]);

    const mobilePhones = phoneValues([cell(record, "Mobile Phone1"), cell(record, "Mobile Phone2")]);
    const workPhones = phoneValues([cell(record, "Work Phone1"), cell(record, "Work Phone2"), cell(record, "Work Phone")]);
    const otherPhones = phoneValues([cell(record, "Unknown Phone1"), cell(record, "Unknown Phone2"), cell(record, "Home Phone")]);
    const phones = unique([...mobilePhones, ...workPhones, ...otherPhones]);

    const linkedinUrl = cleanLinkedIn(firstCell(record, ["LinkedIn Link", "LinkedIn Link1", "LinkedIn Link2", "LinkedIn Link3"]));
    const companyWebsite = Array.from({ length: 15 }, (_, index) => normalizeWebsite(cell(record, `Company Website${index + 1}`))).find(Boolean) || "";
    const skills = unique(cell(record, "Skill").split(/[,;|]/).map((value) => value.trim())).slice(0, 25);

    if (!name || (!company && !linkedinUrl && !emails.length && !phones.length)) {
      skipped += 1;
      continue;
    }

    leads.push({
      id: cell(record, "Id"),
      name,
      title: cell(record, "Position"),
      company,
      companyWebsite,
      companyDomain: domainFromWebsite(companyWebsite),
      companyHeadquarter: cell(record, "Company Headquarter"),
      companySize: cell(record, "Company Size"),
      location: cell(record, "Location") || cell(record, "Company Headquarter"),
      headline: compact(cell(record, "Headline"), 700),
      summary: compact(cell(record, "Summary")),
      yearsExperience: cell(record, "Years of Experience"),
      spokenLanguage: cell(record, "Spoken Language"),
      recruitmentStage: cell(record, "Recruitment Stage"),
      recruitmentStatus: cell(record, "Recruitment Status"),
      linkedinUrl,
      twitterUrl: cleanSocial(firstCell(record, ["Twitter Link", "Twitter Link1"])),
      facebookUrl: cleanSocial(firstCell(record, ["Facebook Link", "Facebook Link1"])),
      skype: cell(record, "Skype"),
      signalHireProfileUrl: cell(record, "Uploaded Link"),
      email: businessEmails[0] || personalEmails[0] || "",
      emails,
      businessEmails,
      personalEmails,
      phone: mobilePhones[0] || workPhones[0] || otherPhones[0] || "",
      phones,
      mobilePhones,
      workPhones,
      otherPhones,
      skills,
      currentRoleSummary: compact(cell(record, "Experience Summary1"), 2_000),
      previousTitle: cell(record, "Experience Title2"),
      previousCompany: cell(record, "Experience Company2"),
      previousStarted: cell(record, "Experience Started2"),
      previousEnded: cell(record, "Experience Ended2"),
      education: educationValues(record),
    });
  }

  if (!leads.length) throw new Error("No usable contacts were found in this SignalHire export.");
  return { leads, skipped, headers };
}
