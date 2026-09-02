import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = async (path) => access(new URL(`../${path}`, import.meta.url)).then(() => true).catch(() => false);

test("deployment build ref survives persistent runtime env loading", async () => {
  const entrypoint = await read("docker/sdr-entrypoint.sh");
  const snapshot = entrypoint.indexOf('DEPLOY_SDR_BUILD_REF="${SDR_BUILD_REF:-}"');
  const source = entrypoint.indexOf('. "$RUNTIME_ENV_FILE"');
  const restore = entrypoint.indexOf('restore_if_set SDR_BUILD_REF "$DEPLOY_SDR_BUILD_REF"');
  const exported = entrypoint.indexOf('export SDR_BUILD_REF="${SDR_BUILD_REF:-unknown}"');

  assert.ok(snapshot >= 0, "deployment build ref must be snapshotted");
  assert.ok(source > snapshot, "persistent env must load after deployment snapshot");
  assert.ok(restore > source, "deployment build ref must be restored after persistent env");
  assert.ok(exported > restore, "restored build ref must be exported to Next.js");
});

test("retired outreach vendor env cannot survive runtime migration", async () => {
  const compose = await read("docker-compose.yml");
  const deploy = await read(".github/workflows/deploy-hostinger.yml");
  const envExample = await read(".env.example");
  const entrypoint = await read("docker/sdr-entrypoint.sh");

  for (const productionSurface of [compose, deploy, envExample]) {
    assert.doesNotMatch(productionSurface, /SMARTLEAD_API_KEY|SMARTLEAD_AUTOPILOT_ENABLED|PRIMEFORGE_API_KEY|PRIME_FORGE_API_KEY/);
  }
  assert.match(entrypoint, /SMARTLEAD_/);
  assert.match(entrypoint, /PRIMEFORGE_/);
  assert.match(entrypoint, /unset "\$RETIRED_KEY"/);
  assert.match(compose, /sed -i -E/);
});

test("production compose is canonical, Traefik-only, and volume-safe", async () => {
  const compose = await read("docker-compose.yml");

  assert.equal(await exists("docker-compose.light.yml"), false);
  assert.doesNotMatch(compose, /127\.0\.0\.1:3010|3010:3000/);
  assert.match(compose, /expose:\s*\n\s*- "3000"/);
  assert.match(compose, /traefik_proxy:\s*\n\s*external: true\s*\n\s*name: n8n_default/);
  assert.match(compose, /traefik\.http\.routers\.sdr-dashboard\.service=sdr-dashboard/);
  assert.match(compose, /traefik\.http\.services\.sdr-dashboard\.loadbalancer\.healthcheck\.path=\/api\/health/);
  assert.match(compose, /socket\.create_connection\(\('127\.0\.0\.1',8000\),3\)/);
  assert.match(compose, /max-size: "10m"/);
  assert.match(compose, /max-file: "3"/);
  assert.match(compose, /sdr_postgres_data:/);
  assert.match(compose, /sdr_runtime_env:/);
  assert.doesNotMatch(compose, /volume prune|--volumes/);
});

test("Docker build persists npm and Next compilation caches", async () => {
  const dockerfile = await read("Dockerfile");
  assert.match(dockerfile, /# syntax=docker\/dockerfile:1\.7/);
  assert.match(dockerfile, /--mount=type=cache,id=sdr-npm-cache,target=\/root\/\.npm/);
  assert.match(dockerfile, /npm ci --prefer-offline --no-audit --no-fund/);
  assert.match(dockerfile, /--mount=type=cache,id=sdr-next-cache,target=\/app\/\.next\/cache/);
});

test("Maqsam worker reuses the application image instead of rebuilding it", async () => {
  const compose = await read("docker-compose.yml");
  const section = compose.slice(compose.indexOf("  maqsam-sync:"));
  assert.match(section, /image: sdr-dashboard:\$\{SDR_BUILD_REF:-unknown\}/);
  assert.match(section, /pull_policy: never/);
  assert.doesNotMatch(section, /\n\s+build:/);
});

test("Hostinger workflow rejects stale CI candidates, retries reads, and queues server-side Compose work", async () => {
  const workflow = await read(".github/workflows/deploy-hostinger.yml");

  assert.match(workflow, /preflight:/);
  assert.match(workflow, /github\.rest\.repos\.getBranch/);
  assert.match(workflow, /candidate !== branch\.commit\.sha/);
  assert.match(workflow, /needs: preflight/);
  assert.match(workflow, /needs\.preflight\.outputs\.should_deploy == 'true'/);
  assert.match(workflow, /api_get\(\)/);
  assert.match(workflow, /Hostinger GET retry/);
  assert.match(workflow, /for LOCK_ATTEMPT in \$\(seq 1 60\)/);
  assert.match(workflow, /Hostinger Compose action active:/);
  assert.match(workflow, /Hostinger Compose action remained active after 5 minutes/);
});

test("deployment exact-build gate self-heals a Created stack through Hostinger", async () => {
  const workflow = await read(".github/workflows/deploy-hostinger.yml");
  const health = await read("src/app/api/health/route.ts");

  assert.match(workflow, /Gate \$\{ATTEMPT\}\/120/);
  assert.match(workflow, /Cache-Control: no-cache/);
  assert.match(workflow, /deploy=\$\{DEPLOY_SHA\}/);
  assert.match(workflow, /\[ "\$BUILD_REF" = "\$DEPLOY_SHA" \]/);
  assert.match(workflow, /START_ATTEMPTED=false/);
  assert.match(workflow, /ATTEMPT" -ge 36/);
  assert.match(workflow, /docker\/\$PROJECT\/start/);
  assert.match(workflow, /Detected stalled Created\/stopped SDR stack/);
  assert.doesNotMatch(workflow, /docker-compose\.light\.yml/);
  assert.match(workflow, /docker-compose\.yml/);
  assert.match(health, /no-store, max-age=0/);
});

test("CI cancels stale branch work and keeps heavyweight integration checks on PRs", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /npm ci --prefer-offline --no-audit/);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/);
  assert.match(workflow, /Production build/);
  assert.match(workflow, /Validate production compose/);
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

test("public production keeps browser Basic Auth off and protects admin tools in-app", async () => {
  const proxy = await read("src/proxy.ts");
  const acquisition = await read("src/app/api/acquisition/route.ts");
  const workflow = await read(".github/workflows/deploy-hostinger.yml");
  const adminAuth = await read("src/lib/sdr-admin-auth.ts");
  const adminRoute = await read("src/app/api/sdr-admin/route.ts");

  assert.match(proxy, /dashboardAuthResponse/);
  assert.doesNotMatch(acquisition, /OWNER_PIN_SHA256|e0f05da9/);
  assert.match(workflow, /DISABLE_AUTH=true/);
  assert.doesNotMatch(workflow, /--user\s+"\$\{DASHBOARD_USERNAME\}:\$\{DASHBOARD_PASSWORD\}"/);
  assert.match(workflow, /WWW-Authenticate/);
  assert.match(adminAuth, /process\.env\.DASHBOARD_PASSWORD \|\| process\.env\.SDR_ADMIN_PASSWORD/);
  assert.match(adminRoute, /configured: sdrAdminConfigured\(\)/);
  assert.match(adminRoute, /validateSdrAdminPassword/);
});

test("HubSpot association reads prefer the stable v4 endpoint with a versioned fallback", async () => {
  const hubspot = await read("src/lib/hubspot.ts");
  const stable = hubspot.indexOf("/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read");
  const fallback = hubspot.indexOf("/crm/associations/2026-03/${fromObjectType}/${toObjectType}/batch/read");
  assert.ok(stable >= 0);
  assert.ok(fallback > stable);
});
