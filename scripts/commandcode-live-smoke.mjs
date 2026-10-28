// Runs only inside the existing deployment job with the server-side GitHub secret.
// Uses synthetic contacts and never creates CRM records or sends outreach.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Diagnostics are limited to synthetic provider requests, with the API key redacted.
const originalFetch=globalThis.fetch;
globalThis.fetch=async (...args)=>{
  const response=await originalFetch(...args);
  if(String(args[0]).startsWith('https://api.commandcode.ai/') && !response.ok){
    const body=await response.clone().json().catch(()=>({}));
    let detail=String(body?.error?.message || body?.message || body?.error || '').slice(0,400);
    const key=process.env.COMMANDCODE_API || process.env.COMMANDCODE_API_KEY;
    if(key)detail=detail.replaceAll(key,'[redacted]');
    console.error(JSON.stringify({test:'synthetic-provider-error',status:response.status,detail}));
  }
  return response;
};
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
  if(process.env.COMMANDCODE_PROVIDER_ONLY === 'true') {
    console.log('CommandCode provider contract passed: both brands and general gateway');
  } else {
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
  }
} catch(error) {
  // Application errors contain status codes only; never log credential values.
  console.error(error instanceof Error ? error.message : 'CommandCode live smoke failed');
  process.exitCode=1;
} finally { globalThis.fetch=originalFetch; await rm(directory,{recursive:true,force:true}); }
