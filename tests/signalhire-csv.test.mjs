import assert from "node:assert/strict";
import test from "node:test";
import { parseSignalHireCsv } from "../src/lib/signalhire-csv.ts";

const HEADERS = [
  "Id", "Uploaded Link", "First Name", "Last Name", "Position", "Company", "Company Headquarter",
  "Company Size", "Location", "Spoken Language", "Recruitment Stage", "Recruitment Status", "Summary", "Headline",
  "Personal Email1", "Personal Email2", "Business Email1", "Business Email2", "Mobile Phone1", "Mobile Phone2",
  "Unknown Phone1", "Unknown Phone2", "Work Phone", "LinkedIn Link1", "LinkedIn Link2", "LinkedIn Link3",
  "Company Website1", "Company Website2", "Company Website3",
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
      PersonalEmail1: "ignored@example.com",
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
  assert.deepEqual(lead.phones, ["+966 55 217 6661", "+966 11 456 9801"]);
  assert.equal(lead.linkedinUrl, "https://www.linkedin.com/in/tma");
  assert.equal(lead.companyDomain, "alrajhiunited.com");
});

test("does not promote a personal email to the HubSpot primary email", () => {
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
      "LinkedIn Link1": "https://www.linkedin.com/in/khalidalharbi59",
      "Company Website1": "http://www.sr.edu.sa",
    }),
  ].join("\n");

  const result = parseSignalHireCsv(csv);
  const lead = result.leads[0];
  assert.equal(lead.email, "");
  assert.deepEqual(lead.emails, ["kalharbi1@gmail.com"]);
  assert.deepEqual(lead.personalEmails, ["kalharbi1@gmail.com"]);
});

test("rejects unrelated CSV files", () => {
  assert.throws(() => parseSignalHireCsv("name,email\nSomeone,a@example.com"), /does not look like a SignalHire export/i);
});
