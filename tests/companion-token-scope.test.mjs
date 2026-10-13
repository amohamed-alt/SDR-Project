import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
test('previous pairing tokens retain capture access without gaining CRM write actions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'companion-scope-'));
 const original=process.env.SALESNAV_COMPANION_STORE_PATH;
 try {
  process.env.SALESNAV_COMPANION_STORE_PATH=join(dir,'pairing.json');
  const oldToken='test-only-capture-token';
  await writeFile(process.env.SALESNAV_COMPANION_STORE_PATH,JSON.stringify({tokenHash:createHash('sha256').update(oldToken).digest('hex'),createdAt:'2026-10-13'}));
  const companionModule=await import('../src/lib/salesnav-companion.ts?scope-test-160');
  assert.equal(await companionModule.verifyCompanionToken(oldToken),true);
  assert.equal((await companionModule.companionStatus()).profileActionsEnabled,false);
  const fresh=await companionModule.generateCompanionToken();
  assert.equal(await companionModule.verifyCompanionToken(fresh),true);
  assert.equal(await companionModule.verifyCompanionToken(oldToken),false);
  assert.equal((await companionModule.companionStatus()).profileActionsEnabled,true);
 } finally { original===undefined?delete process.env.SALESNAV_COMPANION_STORE_PATH:process.env.SALESNAV_COMPANION_STORE_PATH=original;await rm(dir,{recursive:true,force:true}); }
});
