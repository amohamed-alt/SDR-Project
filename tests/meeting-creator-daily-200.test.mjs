import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const daily=fs.readFileSync(".github/workflows/marita-phone-first-daily.yml","utf8");
const alternate=fs.readFileSync("src/app/api/meeting-creator/alternate/route.ts","utf8");
const queue=fs.readFileSync("src/app/api/meeting-creator/queue/route.ts","utf8");

test("one Sunday–Thursday Saudi morning cron replaces legacy Marita-only paid daily run",()=>{
  assert.match(daily,/name: Meeting Creator Saudi Daily 200/);
  assert.match(daily,/cron: '15 6 \* \* 0-4'/);
  assert.match(daily,/group: meeting-creator-saudi-daily/);
  assert.match(daily,/TARGET_PER_SDR/);
  assert.match(daily,/Math\.min\(100/);
  assert.match(daily,/scanSource\('inventory',maxInventoryPages\)/);
  assert.match(daily,/scanSource\('wrong_number',5\)/);
  assert.match(daily,/await write\('\/api\/meeting-creator\/push'/);
  assert.doesNotMatch(daily,/\/api\/acquisition['"]/);
  assert.doesNotMatch(daily,/enrich_person|signalHireEnrichments|confirmCredits:true/);
});

test("scheduled push protects explicit dry-run, capped 25 percent reactivations and uncertain POSTs",()=>{
  assert.match(daily,/github\.event_name == 'schedule'/);
  assert.match(daily,/dryRun/);
  assert.match(daily,/Math\.floor\(target\*\.25\)/);
  assert.match(daily,/choices:batch\.map/);
  assert.match(daily,/No retry after uncertain POST/);
  assert.match(daily,/paidContactReveals:0/);
  assert.match(daily,/shortfall/i);
});

test("alternate research is authorized, search-only and reject wrong-company matches",()=>{
  assert.match(alternate,/sdrAdminAuthorized\(request\)/);
  assert.match(alternate,/row\.status!=="needs_alternate"/);
  assert.match(alternate,/compatibleCompanyIdentity/);
  assert.match(alternate,/normalizedPerson\(candidate\.fullName\)!==normalizedPerson\(row\.contactName\)/);
  assert.match(alternate,/searchByQuery/);
  assert.match(alternate,/contactReveals:0/);
  assert.doesNotMatch(alternate,/candidate\/search["']|\/crm\/v3\/objects\/contacts/);
});

test("wrong number reads CRM calls even when the cached inventory excludes a company",()=>{
  assert.match(queue,/source: z\.enum\(\["inventory","wrong_number"\]\)/);
  assert.match(queue,/WRONG_NUMBER_DISPOSITION/);
  assert.match(queue,/readAssociations\("calls","contacts",pageIds\)/);
  assert.match(queue,/readAssociations\("calls","companies",pageIds\)/);
  assert.match(queue,/batchRead\("calls",allCallIds,\["hs_call_disposition","hs_call_status","hs_call_to_number","hs_call_title"\]\)/);
  assert.match(queue,/needsAlternate:alternate\.length/);
});
