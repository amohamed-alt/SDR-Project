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
