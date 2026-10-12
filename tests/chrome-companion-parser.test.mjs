import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function node(value,attributes={}) { return { innerText:value,textContent:value,getAttribute:key=>attributes[key]||null }; }
function fixtureCards() {
 return Array.from({length:25},(_,i)=>{
  const fields={'person-name':node(`Person ${i}`),'title':node('Human Resources Director'),'job-title':node('3 months in role 3 months in company'),'company-name':node('Example Company'),'location':node('Amman, Jordan')};
  const anchor=node(`Person ${i}`,{href:`https://www.linkedin.com/sales/lead/person${i},NAME_SEARCH,123`});
  const company=node('Example Company',{href:'/sales/company/123'});
  const card={innerText:`Person ${i}\n· 3rd\nHuman Resources Director Example Company\nAmman, Jordan\n3 months in role 3 months in company\nSave`,querySelector:selector=>fields[selector.match(/data-anonymize="([^"]+)"/)?.[1]]||null,querySelectorAll:()=>[anchor,company]};
  anchor.closest=()=>card;return {anchor,card,fields};
 });
}
for(const [file,name,next] of [['background-v154.js','extractCurrentSalesNavPageV154','function clickNextSalesNavPageV154'],['popup.js','extractCurrentSalesNavPage','function clickSalesNavPager'],['background.js','extractCurrentSalesNavPageBackground','function clickNextSalesNavPageBackground']]) {
 test(`${file} extracts 25 actual job titles and does not invent public profile URLs`,async()=>{
  const text=fs.readFileSync(`chrome-companion/${file}`,'utf8');const fn=text.slice(text.indexOf(`async function ${name}()`),text.indexOf(next));
  const cards=fixtureCards(),scroll={scrollTop:0,scrollHeight:0,clientHeight:0,scrollTo:()=>{}};
  const document={querySelectorAll:s=>s.includes('data-anonymize="person-name"')?cards.map(x=>x.anchor):[],scrollingElement:scroll,documentElement:scroll};
  const context={document,location:new URL('https://www.linkedin.com/sales/search/people?query=test'),URL,Map,HTMLElement:function(){},window:{scrollY:0,scrollTo:()=>{}},setTimeout:f=>f(),Promise};
  vm.createContext(context);vm.runInContext(fn+`\nresult=${name}();`,context);const result=await context.result;
  assert.equal(result.leads.length,25);assert.ok(result.leads.every(x=>x.title==='Human Resources Director'));assert.ok(result.leads.every(x=>x.linkedinUrl===''));
  cards[0].fields.title=null;
  vm.runInContext(`result=${name}();`,context);const fallback=await context.result;
  assert.doesNotMatch(fallback.leads[0].title,/in role|in company|3rd/);
 });
}
test('profile reader uses the current role instead of a prior employer',async()=>{
 const company=node('The American University of Kurdistan'),title=node('Human Resources Director');
 const section={querySelector:s=>s.includes('job-title')?title:s.includes('company-name')?company:null};
 const root={querySelector:s=>s.includes('lead-current-role')?section:null,querySelectorAll:s=>s==='h1'?[node('Sales Navigator Lead Page'),node('Basic lead information for Beyan'),node('Beyan Yasin Berwarî')]:s==='h2'?[{...node('Current role'),parentElement:section}]:[]};
 const menu={getAttribute:()=> 'true',click:()=>{throw Error('Should not click an already open menu')}};
 const link=node('View LinkedIn profile',{href:'https://www.linkedin.com/in/beyan-berwari'});
 const doc={title:'Sales Navigator',querySelector:s=>s==='main'?root:menu,querySelectorAll:()=>[link]};
 const context={document:doc,location:new URL('https://www.linkedin.com/sales/lead/123'),URL,Promise,setTimeout:f=>f()};vm.createContext(context);
 vm.runInContext(fs.readFileSync('chrome-companion/profile-dom.js','utf8')+'\nresult=readVisibleLinkedInProfile();',context);const result=await context.result;
 assert.equal(result.lead.company,'The American University of Kurdistan');assert.equal(result.lead.title,'Human Resources Director');assert.equal(result.lead.linkedinUrl,'https://www.linkedin.com/in/beyan-berwari');
});
