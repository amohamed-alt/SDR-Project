import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOfficialCareerPages } from '../scripts/inventory-career-research.mjs';
test('scheduled research follows real official career links and rejects external redirects',async()=>{
 const calls=[];
 const mock=async(url)=>{calls.push(url); if(url==='https://company.example')return new Response('<a href="/careers">Careers</a><a href="https://outside.example/jobs">External</a>',{headers:{'content-type':'text/html'}});if(url==='https://company.example/careers')return new Response('<form><input type="file"></form>',{headers:{'content-type':'text/html'}});throw Error('unexpected URL');};
 const pages=await collectOfficialCareerPages({domain:'company.example'},mock);
 assert.deepEqual(pages.map(p=>p.url),['https://company.example','https://company.example/careers']);
 assert.deepEqual(calls,['https://company.example','https://company.example/careers']);
});
test('research errors never manufacture a no-ATS result',async()=>{
 assert.deepEqual(await collectOfficialCareerPages({domain:'company.example'},async()=>{throw Error('network unavailable');}),[]);
});
