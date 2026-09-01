import assert from "node:assert/strict";
import test from "node:test";
import { parseSignalHireCsv } from "../src/lib/signalhire-csv.ts";

const HEADERS = [
  "Id", "Uploaded Link", "First Name", "Last Name", "Position", "Company", "Company Headquarter",
  "Company Size", "Location", "Spoken Language", "Recruitment Stage", "Recruitment Status", "Summary", "Headline",
  "Personal Email1", "Personal Email2", "Business Email1", "Business Email2", "Mobile Phone1", "Mobile Phone2",
  "Unknown Phone1", "Unknown Phone2", "Work Phone", "Work Phone1", "Work Phone2", "Home Phone", "LinkedIn Link",
  "LinkedIn Link1", "LinkedIn Link2", "LinkedIn Link3", "Twitter Link", "Facebook Link", "Skype",
  "Company Website1", "Company Website2", "Company Website3", "Years of Experience", "Skill",
  "Experience Title1", "Experience Company1", "Experience Summary1", "Experience Started1", "Experience Ended1",
  "Experience Title2", "Experience Company2", "Experience Summary2", "Experience Started2", "Experience Ended2",
  "Education Degree1", "Education Faculty1", "Education University1", "Education Started1", "Education Ended1",
];

function csvRow(values) {
  return HEADERS.map((header) => {
    const value = String(values[header] || "");
    return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(",");
}

test("parses multiline SignalHire fields and prefers business email", () => {
  const csv = [
    HEADERS.join(","),
    csvRow({
      Id: "lead-1",
      "First Name": "Tareq",
      "Last Name": "Mazid",
      Position: "Head of People and Culture",
      Company: "AlRajhi United",
      Location: "Riyadh, Saudi Arabia",
      Summary: "Line one\nLine two with \"quoted text\"",
      "Personal Email1": "tareq.mazid@gmail.com",
      "Business Email1": "tmazid@alrajhiunited.com",
      "Mobile Phone1": "+966 55 217 6661",
      "Work Phone": "+966 11 456 9801",
      "LinkedIn Link1": "https://www.linkedin.com/in/tma/",
      "Company Website1": "http://www.alrajhiunited.com/",
    }),
  ].join("\r\n");

  const result = parseSignalHireCsv(csv);
  assert.equal(result.leads.length, 1);
  const lead = result.leads[0];
  assert.equal(lead.name, "Tareq Mazid");
  assert.equal(lead.email, "tmazid@alrajhiunited.com");
  assert.deepEqual(lead.businessEmails, ["tmazid@alrajhiunited.com"]);
  assert.deepEqual(lead.personalEmails, ["tareq.mazid@gmail.com"]);
  assert.deepEqual(lead.mobilePhones, ["+966 55 217 6661"]);
  assert.deepEqual(lead.workPhones, ["+966 11 456 9801"]);
  assert.deepEqual(lead.phones, ["+966 55 217 6661", "+966 11 456 9801"]);
  assert.equal(lead.linkedinUrl, "https://www.linkedin.com/in/tma");
  assert.equal(lead.companyDomain, "alrajhiunited.com");
});

test("uses personal email when it is the only valid email so the contact is not treated as no-email", () => {
  const csv = [
    HEADERS.join(","),
    csvRow({
      Id: "lead-2",
      "First Name": "Khalid",
      "Last Name": "Alharbi",
      Position: "Human Capital Director",
      Company: "Sulaiman Al Rajhi University",
      "Personal Email1": "kalharbi1@gmail.com",
      "Mobile Phone1": "+966 59 244 0453",
      "LinkedIn Link": "https://www.linkedin.com/in/khalidalharbi59",
      "Company Website1": "http://www.sr.edu.sa",
    }),
  ].join("\n");

  const lead = parseSignalHireCsv(csv).leads[0];
  assert.equal(lead.email, "kalharbi1@gmail.com");
  assert.deepEqual(lead.emails, ["kalharbi1@gmail.com"]);
  assert.deepEqual(lead.personalEmails, ["kalharbi1@gmail.com"]);
  assert.equal(lead.linkedinUrl, "https://www.linkedin.com/in/khalidalharbi59");
});

test("supports the current SignalHire export columns and captures useful profile context", () => {
  const csv = [
    HEADERS.join(","),
    csvRow({
      Id: "lead-3",
      "Uploaded Link": "https://www.signalhire.com/profiles/example",
      "First Name": "Sara",
      "Last Name": "Saleh",
      Position: "Talent Acquisition Director",
      Company: "Example Group",
      "Company Headquarter": "Riyadh, Saudi Arabia",
      "Company Size": "500-1000",
      Location: "Riyadh, Saudi Arabia",
      Headline: "Talent leader focused on scaling recruitment",
      Summary: "Experienced HR leader with a strong recruiting background.",
      "Years of Experience": "14",
      Skill: "Talent Acquisition, Recruiting, Employer Branding, Workforce Planning",
      "Mobile Phone1": "+966500000001",
      "Work Phone1": "+966114000001",
      "Work Phone2": "+966114000002",
      "Business Email1": "sara@example.com",
      "LinkedIn Link": "https://www.linkedin.com/in/sara-saleh",
      "Experience Summary1": "Leads the group talent acquisition function across KSA.",
      "Experience Title2": "Head of Recruitment",
      "Experience Company2": "Previous Group",
      "Experience Started2": "2019",
      "Experience Ended2": "2024",
      "Education Degree1": "MBA",
      "Education University1": "King Saud University",
      "Education Ended1": "2018",
      "Company Website1": "https://example.com",
    }),
  ].join("\n");

  const lead = parseSignalHireCsv(csv).leads[0];
  assert.deepEqual(lead.workPhones, ["+966114000001", "+966114000002"]);
  assert.equal(lead.companySize, "500-1000");
  assert.equal(lead.companyHeadquarter, "Riyadh, Saudi Arabia");
  assert.equal(lead.yearsExperience, "14");
  assert.equal(lead.currentRoleSummary, "Leads the group talent acquisition function across KSA.");
  assert.equal(lead.previousTitle, "Head of Recruitment");
  assert.equal(lead.previousCompany, "Previous Group");
  assert.deepEqual(lead.skills.slice(0, 2), ["Talent Acquisition", "Recruiting"]);
  assert.match(lead.education[0], /MBA/);
  assert.match(lead.education[0], /King Saud University/);
});

test("rejects unrelated CSV files", () => {
  assert.throws(() => parseSignalHireCsv("name,email\nSomeone,a@example.com"), /does not look like a SignalHire export/i);
});
