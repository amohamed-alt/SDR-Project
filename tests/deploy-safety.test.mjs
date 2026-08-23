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

test("today task queue and full task drawer expose WhatsApp for associated contacts", async () => {
  const workspace = await read("src/components/MaritaWorkspace.tsx");
  const drawer = await read("src/components/DrilldownDrawer.tsx");

  assert.match(workspace, /function TaskQueueItem/);
  assert.match(workspace, /row\.relatedContactId && <WhatsAppQuickAction contactId=\{row\.relatedContactId\}/);
  assert.match(drawer, /row\.type === "Task" && row\.relatedContactId && <WhatsAppQuickAction contactId=\{row\.relatedContactId\}/);
});
