// Runs only inside the existing deployment job with the server-side GitHub secret.
// Uses synthetic contacts and never creates CRM records or sends outreach.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'commandcode-live-'));
process.env.COMMANDCODE_STATE_PATH = join(directory, 'outreach.json');
process.env.COMMANDCODE_GATEWAY_STATE_PATH = join(directory, 'gateway.json');
try {
  const { commandCodeOutreach } = await import('../src/lib/commandcode-outreach.ts');
  const { commandCodeCompletion } = await import('../src/lib/commandcode-gateway.ts');
  for (const brand of ['Talentera', 'Evalufy']) {
    const result = await commandCodeOutreach({contactId:`synthetic-${brand}`, firstName:'أحمد', company:'شركة الاختبار', title:'مدير استقطاب المواهب', brand});
    console.log(JSON.stringify({test:'synthetic-saudi-copy',brand,model:result.model,draft:result.draft}));
  }
  const result = await commandCodeCompletion({cacheKey:'deployment-gateway-smoke',system:'اكتب بالعربية السعودية المهنية جملة واحدة تسأل فيها عن متابعة المرشحين بدون افتراض وجود مشكلة',user:'اكتب السؤال فقط',maxOutputTokens:200});
  assert.match(result.content, /[ء-ي]/);
  console.log(JSON.stringify({test:'general-ai-gateway',model:result.model,content:result.content}));
  const token=process.env.ACQUISITION_OWNER_TOKEN || process.env.SDR_ADMIN_PASSWORD;
  assert.ok(token,'A tools credential is required to verify deployed routes');
  const origin='https://sdr.dashboardtalentera.tech';
  const headers={'Content-Type':'application/json','x-acquisition-owner-token':token,Origin:origin};
  const status=await fetch(`${origin}/api/ai/account-brief`,{headers,signal:AbortSignal.timeout(20_000)});
  assert.equal(status.status,200,'Deployed provider status must be accessible with tools authorization');
  const body=await status.json();
  assert.equal(body.provider,'commandcode');
  assert.equal(body.configured,true);
  const response=await fetch(`${origin}/api/ai/task-message`,{method:'POST',headers,body:JSON.stringify({contactId:'invalid-smoke-id'}),signal:AbortSignal.timeout(20_000)});
  assert.equal(response.status,400,'Deployed task handler must authenticate and reject invalid input before CRM/provider access');
  console.log('CommandCode live smoke passed: both brands, general gateway, deployed provider config and protected task handler');
} catch(error) {
  // Application errors contain status codes only; never log credential values.
  console.error(error instanceof Error ? error.message : 'CommandCode live smoke failed');
  process.exitCode=1;
} finally { await rm(directory,{recursive:true,force:true}); }
