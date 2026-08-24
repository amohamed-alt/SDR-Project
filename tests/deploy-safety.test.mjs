import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("deployment build ref survives persistent runtime env loading", async () => {
  const entrypoint = await read("docker/sdr-entrypoint.sh");
  const snapshot = entrypoint.indexOf('DEPLOY_SDR_BUILD_REF="${SDR_BUILD_REF:-}"');
  const source = entrypoint.indexOf('. "$RUNTIME_ENV_FILE"');
  const restore = entrypoint.indexOf('SDR_BUILD_REF="$DEPLOY_SDR_BUILD_REF"');
  const exported = entrypoint.indexOf('export SDR_BUILD_REF="${SDR_BUILD_REF:-unknown}"');

  assert.ok(snapshot >= 0, "deployment build ref must be snapshotted");
  assert.ok(source > snapshot, "persistent env must load after deployment snapshot");
  assert.ok(restore > source, "deployment build ref must be restored after persistent env");
  assert.ok(exported > restore, "restored build ref must be exported to Next.js");
});

test("Hostinger workflow rejects stale CI candidates before production concurrency", async () => {
  const workflow = await read(".github/workflows/deploy-hostinger.yml");

  assert.match(workflow, /preflight:/);
  assert.match(workflow, /github\.rest\.repos\.getBranch/);
  assert.match(workflow, /candidate !== currentMain/);
  assert.match(workflow, /needs: preflight/);
  assert.match(workflow, /needs\.preflight\.outputs\.should_deploy == 'true'/);
  assert.match(workflow, /Superseded by a newer main commit; production untouched/);
  assert.match(workflow, /if: cancelled\(\)/);
});

test("deployment health verification is cache-busted and exact-build gated", async () => {
  const workflow = await read(".github/workflows/deploy-hostinger.yml");
  const health = await read("src/app/api/health/route.ts");

  assert.match(workflow, /Cache-Control: no-cache/);
  assert.match(workflow, /deploy=\$\{DEPLOY_SHA\}/);
  assert.match(workflow, /\[ "\$BUILD_REF" = "\$DEPLOY_SHA" \]/);
  assert.match(health, /no-store, max-age=0/);
});

test("acquisition queue status ignores skipped bootstrap and retries transient production reads", async () => {
  const workflow = await read(".github/workflows/acquisition-queue-status.yml");

  assert.match(workflow, /if: github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /for ATTEMPT in 1 2 3 4 5/);
  assert.match(workflow, /Cache-Control: no-cache/);
  assert.match(workflow, /unavailable after retries/);
});

test("acquisition bootstrap retries transient people-scan gateway failures", async () => {
  const workflow = await read(".github/workflows/acquisition-bootstrap.yml");

  assert.match(workflow, /for ATTEMPT in 1 2 3 4 5/);
  assert.match(workflow, /\^\(408\|429\|5\[0-9\]\[0-9\]\)\$/);
  assert.match(workflow, /retrying/);
  assert.match(workflow, /ATTEMPT \* 5/);
});

test("today task queue and full task drawer expose WhatsApp for associated contacts", async () => {
  const workspace = await read("src/components/MaritaWorkspace.tsx");
  const drawer = await read("src/components/DrilldownDrawer.tsx");

  assert.match(workspace, /function TaskQueueItem/);
  assert.match(workspace, /row\.relatedContactId && row\.relatedContactHasPhone && <WhatsAppQuickAction contactId=\{row\.relatedContactId\}/);
  assert.match(drawer, /row\.type === "Task" && row\.relatedContactId && row\.relatedContactHasPhone && <WhatsAppQuickAction contactId=\{row\.relatedContactId\}/);
});

test("production access is protected and no hardcoded owner PIN remains", async () => {
  const proxy = await read("src/proxy.ts");
  const acquisition = await read("src/app/api/acquisition/route.ts");
  const smartleadAuth = await read("src/lib/smartlead-action-auth.ts");
  const workflow = await read(".github/workflows/deploy-hostinger.yml");

  assert.match(proxy, /dashboardAuthResponse/);
  assert.doesNotMatch(acquisition, /OWNER_PIN_SHA256|e0f05da9/);
  assert.doesNotMatch(smartleadAuth, /OWNER_PIN_SHA256|e0f05da9/);
  assert.match(workflow, /DASHBOARD_PASSWORD:.*ACQUISITION_OWNER_TOKEN/);
  assert.match(workflow, /--user "\$\{DASHBOARD_USERNAME\}:\$\{DASHBOARD_PASSWORD\}"/);
});

test("Primeforge remains read-only and advisory while Smartlead safety stays enforced", async () => {
  const deploy = await read(".github/workflows/deploy-hostinger.yml");
  const autopilot = await read(".github/workflows/smartlead-autopilot.yml");
  const orchestrator = await read("src/app/api/smartlead/orchestrator-v3/route.ts");
  const primeforge = await read("src/lib/primeforge-health.ts");

  assert.match(deploy, /PRIMEFORGE_API_KEY/);
  assert.match(autopilot, /Primeforge infrastructure advisory/);
  assert.match(orchestrator, /checkPrimeforgeInfrastructure/);
  assert.match(orchestrator, /pauseManagedCampaigns\(\)\.catch/);
  assert.match(orchestrator, /validateApprovedSenderInventory/);
  assert.match(orchestrator, /primeforgeGateEnforced: false/);
  assert.doesNotMatch(autopilot, /primeforge-fail-closed/);
  assert.doesNotMatch(deploy, /primeforge-deploy-fail-closed/);
  assert.match(primeforge, /method: "GET"/);
  assert.doesNotMatch(primeforge, /method: "(?:POST|PUT|PATCH|DELETE)"/);
});

test("Smartlead campaign parity audits the detailed campaign response", async () => {
  const parity = await read("src/app/api/smartlead/campaign-parity/route.ts");
  assert.match(parity, /smartleadRequest<unknown>\(`\/campaigns\/\$\{id\}`\)/);
  assert.match(parity, /object\(detailRoot\.data\)/);
  assert.match(parity, /DONT_EMAIL_OPEN/);
  assert.match(parity, /DONT_LINK_CLICK/);
});

test("Smartlead topology detects every non-visible Marita campaign and reports it", async () => {
  const orchestrator = await read("src/app/api/smartlead/orchestrator-v3/route.ts");
  const workflow = await read(".github/workflows/smartlead-autopilot.yml");

  assert.match(orchestrator, /isMaritaOutreachCampaignName/);
  assert.match(orchestrator, /!MANAGED_CAMPAIGN_NAMES\.has\(item\.name\)/);
  assert.match(orchestrator, /legacyCampaigns: legacy\.campaigns/);
  assert.doesNotMatch(orchestrator, /const LEGACY_CAMPAIGNS/);
  assert.match(workflow, /campaignTopology, legacyCampaigns/);
});

test("Golden Hours runs three idempotent attempts before the Riyadh send window", async () => {
  const workflow = await read(".github/workflows/smartlead-autopilot.yml");
  const orchestrator = await read("src/app/api/smartlead/orchestrator-v3/route.ts");

  assert.match(workflow, /cron: "45 5 \* \* 0-4"/);
  assert.match(workflow, /cron: "5 6 \* \* 0-4"/);
  assert.match(workflow, /cron: "25 6 \* \* 0-4"/);
  assert.match(orchestrator, /start_hour: "09:30"/);
  assert.match(orchestrator, /end_hour: "16:30"/);
  assert.match(orchestrator, /lastSuccessfulDate === clock\.date/);
});

test("manual Smartlead dry-run reports masked routing without campaign writes", async () => {
  const workflow = await read(".github/workflows/smartlead-autopilot.yml");
  const dryRun = await read("src/app/api/smartlead/language-test/route.ts");

  assert.match(workflow, /- dry-run/);
  assert.match(workflow, /api\/smartlead\/language-test\?limit=50&refresh=1/);
  assert.match(workflow, /if: steps\.mode\.outputs\.mode != 'dry-run'/);
  assert.match(workflow, /Audit first 50 recipient routes without sending/);
  assert.match(workflow, /jq '\{mode, productionSendingChanged, sampled, localeCounts, laneCounts, translatedCount, lowConfidence, senderPools\}'/);
  assert.doesNotMatch(workflow, /senderPools, samples/);
  assert.match(dryRun, /READ_ONLY_ROUTING_DRY_RUN/);
  assert.match(dryRun, /productionSendingChanged: false/);
  assert.match(dryRun, /maskedEmail\(lead\.email\)/);
  assert.match(dryRun, /VISIBLE_SEQUENCE_LANES\[lane\]\.campaignName/);
});

test("Smartlead active-campaign warmup is reconciled only for the exact approved 15 inboxes", async () => {
  const workflow = await read(".github/workflows/smartlead-autopilot.yml");

  assert.match(workflow, /Reconcile active-campaign warmup for approved inboxes/);
  assert.match(workflow, /if: steps\.mode\.outputs\.mode != 'dry-run'/);
  assert.match(workflow, /EXPECTED_DOMAIN_COUNTS='\{"jointalentera\.com":3,"usetalentera\.com":3,"talenteramena\.com":3,"evalufyhq\.com":3,"getevalufy\.com":3\}'/);
  assert.match(workflow, /"total_warmup_per_day":10/);
  assert.match(workflow, /"reply_rate_percentage":30/);
  assert.match(workflow, /"auto_adjust_warmup":true/);
  assert.match(workflow, /"is_rampup_enabled":false/);
  assert.match(workflow, /test "\$UPDATED" = "15"/);
});

test("Smartlead pauses on the first recorded spam complaint", async () => {
  const orchestrator = await read("src/app/api/smartlead/orchestrator-v3/route.ts");
  assert.match(orchestrator, /analytics\[lane\]\.spamComplaints > 0/);
  assert.match(orchestrator, /zero-complaint guardrail engaged/);
  assert.doesNotMatch(orchestrator, /SPAM_GUARD_RATE/);
});

test("Smartlead page exposes one verified send path and individual verification visibility", async () => {
  const page = await read("src/components/SmartleadCommandCenter.tsx");
  const route = await read("src/app/api/smartlead/route.ts");
  const waterfall = await read("src/lib/outreach-email-waterfall.ts");

  assert.match(page, /\/api\/smartlead\/send-today/);
  assert.match(page, /lead\.verification\.status/);
  assert.match(page, /lead\.campaignName/);
  assert.doesNotMatch(page, /Bootstrap V2 campaigns|Queue prepared only|Start both|Sync sender pools/);
  assert.match(route, /Legacy Smartlead write actions are retired/);
  assert.match(waterfall, /linkedinMatches\(person, identifier\)/);
  assert.match(waterfall, /companyMatches\(person, candidate\.companyName, candidate\.domain\)/);
  assert.match(waterfall, /verified\.entry\.status === "valid"/);
  assert.match(waterfall, /workEmailMatchesCurrentCompany/);
  assert.match(waterfall, /item\.subType === "work"/);
  assert.doesNotMatch(waterfall, /replacement personal email/);
});

test("verified Smartlead autopilot is launched while every legacy send path stays disabled", async () => {
  const deploy = await read(".github/workflows/deploy-hostinger.yml");
  assert.match(deploy, /SMARTLEAD_AUTOPILOT_ENABLED=true/);
  assert.match(deploy, /SMARTLEAD_LEGACY_SEND_ENABLED=false/);
});

test("Smartlead spam guard does not use the provider's broken is_spam query filter", async () => {
  const orchestrator = await read("src/app/api/smartlead/orchestrator-v3/route.ts");
  assert.doesNotMatch(orchestrator, /emailStatus:\s*"is_spam"/);
  assert.match(orchestrator, /leadRows\.filter/);
  assert.match(orchestrator, /row\.is_spam/);
});

test("Smartlead retries transient fresh safety reads without weakening fail-closed sending", async () => {
  const orchestrator = await read("src/app/api/smartlead/orchestrator-v3/route.ts");
  assert.match(orchestrator, /async function freshHealthySnapshot/);
  assert.match(orchestrator, /attempt <= 3/);
  assert.match(orchestrator, /catch \(error\)/);
  assert.match(orchestrator, /queue aborted after safety retries/);
  assert.match(orchestrator, /await freshHealthySnapshot\("Fresh Sales safety was temporarily unavailable after email verification"\)/);
});

test("HubSpot association reads prefer the stable v4 endpoint with a versioned fallback", async () => {
  const hubspot = await read("src/lib/hubspot.ts");
  const stable = hubspot.indexOf("/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read");
  const fallback = hubspot.indexOf("/crm/associations/2026-03/${fromObjectType}/${toObjectType}/batch/read");
  assert.ok(stable >= 0);
  assert.ok(fallback > stable);
});
