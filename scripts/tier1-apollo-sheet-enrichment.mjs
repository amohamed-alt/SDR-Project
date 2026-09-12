import crypto from "node:crypto";

const sheetId = process.env.TIER1_SPREADSHEET_ID;
const apolloKey = process.env.APOLLO_API_KEY;
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const maxCompanies = Number(process.env.MAX_COMPANIES || 200);
const sheetName = "Tier 1 Contacts";
const hrTitles = ["Chief Human Resources Officer","CHRO","Chief People Officer","Head of Human Resources","Head of HR","Head of People","Human Resources Director","HR Director","Human Resources Manager","HR Manager","Human Capital Director","Human Capital Manager","People Director","People Operations","HR Operations","Payroll Manager","Payroll Director","Compensation and Benefits","Compensation & Benefits","Personnel Manager","Employee Services","HR Shared Services","Human Resources Specialist"];
const execTitles = ["Chief Executive Officer","CEO","General Manager","GM","Founder","Co-Founder","Owner"];

function b64(v){return Buffer.from(v).toString("base64url")}
function token(){const h=b64(JSON.stringify({alg:"RS256",typ:"JWT"}));const now=Math.floor(Date.now()/1000);const p=b64(JSON.stringify({iss:serviceAccount.client_email,scope:"https://www.googleapis.com/auth/spreadsheets",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));const s=crypto.createSign("RSA-SHA256");s.update(h+"."+p);s.end();return h+"."+p+"."+s.sign(serviceAccount.private_key,"base64url")}
async function googleToken(){const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:token()})});if(!r.ok)throw new Error("Google auth failed");return (await r.json()).access_token}
async function sheets(path,opts={},gt){const r=await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+path,{...opts,headers:{"authorization":"Bearer "+gt,"content-type":"application/json",...(opts.headers||{})}});if(!r.ok)throw new Error("Sheets "+r.status+" "+await r.text());return r.json()}
async function apollo(path,body){const r=await fetch("https://api.apollo.io/api/v1/"+path,{method:"POST",headers:{"content-type":"application/json","x-api-key":apolloKey},body:JSON.stringify(body)});if(!r.ok)throw new Error("Apollo "+r.status);return r.json()}
function parseRows(v){return v.values||[]}
async function main(){if(!sheetId||!apolloKey||!serviceAccount)throw new Error("Missing required secrets");const gt=await googleToken();const data=await sheets("/values/"+encodeURIComponent(sheetName)+"!A1:T2165",{},gt);const rows=parseRows(data).slice(1);const targets=[];for(let i=0;i<rows.length;i++){const r=rows[i]||[];if(!String(r[8]||"").trim()&&!String(r[16]||"").trim()&&String(r[7]||"").trim())targets.push({row:i+2,org:String(r[7]).trim()})}const batch=targets.slice(0,maxCompanies);const found=[];let done=0;async function one(c){
  try {
    let d=await apollo("mixed_people/api_search",{organization_ids:[c.org],person_titles:hrTitles,per_page:25,page:1,include_similar_titles:true});
    let people=(d.people||[]).filter(p=>p.has_email===true);
    let fallback=false;
    if(!people.length){
      d=await apollo("mixed_people/api_search",{organization_ids:[c.org],person_titles:execTitles,organization_num_employees_ranges:["1,10","11,20","21,50","51,100","101,200"],per_page:25,page:1,include_similar_titles:true});
      people=(d.people||[]).filter(p=>p.has_email===true);
      fallback=true;
    }
    if(people[0]){
      const matched=await apollo("people/bulk_match",{details:[{id:people[0].id}],reveal_personal_emails:true});
      const p=(matched.matches||[])[0];
      if(p&&p.email){
        found.push({row:c.row,values:[
          p.name||[p.first_name||people[0].first_name||"",p.last_name||""].filter(Boolean).join(" "),
          p.first_name||people[0].first_name||"",
          p.last_name||"",
          p.title||people[0].title||"",
          fallback?"CEO / founder decision maker":"HR/payroll decision maker",
          p.email,
          p.email_status||"email_available",
          p.linkedin_url||people[0].linkedin_url||"",
          p.id||people[0].id,
          fallback?"Apollo current-role match; small-company executive fallback; enriched email":"Apollo current-role match; HR/payroll match; enriched email",
          "Apollo GitHub workflow",
          "apollo_github_enriched"
        ]});
      }
    }
  }catch(error){
    console.error(JSON.stringify({stage:"company",row:c.row,error:String(error)}));
  }finally{
    done++;
  }
}
for(let i=0;i<batch.length;i+=10){await Promise.all(batch.slice(i,i+10).map(one));console.log(JSON.stringify({done:Math.min(i+10,batch.length),total:batch.length,found:found.length}))}
const requests=found.map(x=>({updateCells:{range:{sheetId:625047448,startRowIndex:x.row-1,endRowIndex:x.row,startColumnIndex:8,endColumnIndex:20},rows:[{values:x.values.map(v=>({userEnteredValue:{stringValue:String(v??"")}}))}],fields:"userEnteredValue"}}));if(requests.length)await sheets(":batchUpdate",{method:"POST",body:JSON.stringify({requests})},gt);console.log(JSON.stringify({considered:batch.length,found:found.length,remaining:targets.length-batch.length,written:requests.length}))}
main().catch(e=>{console.error(e);process.exit(1)});
