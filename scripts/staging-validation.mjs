import { assertStagingLoadAllowed } from "./staging-load-gate.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const ref="mkzclztzyqdmftesnwcw";
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
assertStagingLoadAllowed();
process.loadEnvFile(".env.supabase-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF,ref);
const url=`https://${ref}.supabase.co`;
assert.equal(process.env.SUPABASE_URL,url);
const key=process.env.SUPABASE_STAGING_ANON_KEY;
assert.equal(JSON.parse(Buffer.from(key.split(".")[1],"base64url")).role,"anon");
const client=()=>createClient(url,key,{db:{retry:false,timeout:20000},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(30000),...(init?.signal?[init.signal]:[])])})},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const results=[];const run=crypto.randomUUID();let a,b;
function ok(r){assert.equal(r.error,null,`Unexpected RPC/Auth error: ${r.error?.code??r.error?.status??"unknown"}`);return r.data;}
function denied(r){assert(r.error,"Expected denial");}
const rpc=(x,name,args={})=>x.c.schema("api").rpc(name,args);
const balance=async x=>ok(await rpc(x,"read_accounts")).find(y=>y.id===x.account.id).balance_minor;
const post=(x,overrides={})=>rpc(x,"post_movement",{p_request_id:crypto.randomUUID(),p_kind:"income",p_account_id:x.account.id,p_category_id:x.income.id,p_amount:"50",p_description:"Synthetic staging validation",p_note:"",p_occurred_at:null,...overrides});
const debtDraft=()=>({action:"create",requestId:crypto.randomUUID(),name:"Synthetic debt",creditor:"Synthetic",detail:"",icon:"wallet",category:null,currency:"PEN",amount:"100",dueDate:null});
const fixedDraft=x=>({action:"create",requestId:crypto.randomUUID(),name:"Synthetic recurring",note:"",categoryId:x.expense.id,currency:"PEN",amount:"20",dueDate:"2026-01-31",frequency:"monthly"});
const debt=(x,p)=>rpc(x,"debt_command",{p_command:p});
const fixed=(x,p)=>rpc(x,"fixed_expense_command",{p_command:p});
async function withAuthOperator(callback) {
 // Administrative key is isolated to provisioning ordinary synthetic identities/links.
 // It is never returned to a test or used for database, Storage or financial requests.
 const admin=createClient(url,process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 return callback(admin.auth.admin);
}
async function provision(label) {
 const email=`finzi-staging-${run}-${label}@example.test`,password=crypto.randomUUID()+"!Synthetic64";
 const link=await withAuthOperator(auth=>auth.generateLink({type:"signup",email,password}));
 const data=ok(link);const c=client();
 const premature=await c.auth.signInWithPassword({email,password});denied(premature);
 const confirmed=ok(await c.auth.verifyOtp({token_hash:data.properties.hashed_token,type:"signup"}));
 assert(confirmed.user.email_confirmed_at);assert.equal(ok(await c.auth.getUser()).user.id,confirmed.user.id);
 return {c,uid:confirmed.user.id,email,password};
}
const cases=[
 ["Registration remains disabled",async()=>{denied(await client().auth.signUp({email:`finzi-disabled-${run}@example.test`,password:crypto.randomUUID()+"Synthetic64"}));}],
 ["Provision A/B; unconfirmed login denied; confirmation and real user sessions",async()=>{a=await provision("a");b=await provision("b");assert.notEqual(a.uid,b.uid);}],
 ["Onboarding and own profile identity",async()=>{for(const x of [a,b]){ok(await rpc(x,"ensure_profile"));ok(await rpc(x,"configure_profile",{p_display_name:"Synthetic staging",p_currency:"PEN",p_timezone:"America/Lima",p_expected_version:0}));assert.equal(ok(await rpc(x,"read_profile")).user_id,x.uid);x.account=ok(await rpc(x,"create_account",{p_request_id:crypto.randomUUID(),p_name:"Synthetic cash",p_type:"cash",p_currency:"PEN",p_opening:"100"}));const cats=ok(await rpc(x,"initialize_categories")).categories;x.income=cats.find(c=>c.kind==="income");x.expense=cats.find(c=>c.kind==="expense");}}],
 ["A/B own accounts; cross-user IDs rejected in both directions",async()=>{for(const [x,y] of [[a,b],[b,a]]){const own=ok(await rpc(x,"read_accounts"));assert(own.some(v=>v.id===x.account.id));assert(!own.some(v=>v.id===y.account.id));denied(await rpc(x,"update_account",{p_id:y.account.id,p_name:"Forbidden",p_opening:null,p_archived:false,p_expected_version:1}));denied(await post(x,{p_account_id:y.account.id}));denied(await post(x,{p_category_id:y.income.id}));assert.equal(await balance(x),"10000");}}],
 ["Private schemas/tables and anonymous RPC are inaccessible",async()=>{const anon=client();for(const name of ["read_accounts","read_profile","read_categories","read_movements","read_debts","read_fixed_expenses"]){denied(await anon.schema("api").rpc(name));}for(const x of [a,b,{c:anon}])for(const schema of ["finance","ops","telegram_private"]){denied(await x.c.schema(schema).from(schema==="finance"?"profiles":schema==="ops"?"deletion_subjects":"links").select("*"));}}],
 ["Owner and role parameters cannot escalate identity",async()=>{for(const x of [a,b]){const other=x===a?b:a;denied(await rpc(x,"create_account",{p_request_id:crypto.randomUUID(),p_name:"Forged",p_type:"cash",p_currency:"PEN",p_opening:"0",p_user_id:other.uid}));denied(await rpc(x,"post_movement",{p_user_id:other.uid}));}denied(await client().schema("api").rpc("claim_deletion"));}],
 ["Income 50 and expense 20 reconcile to 130 from opening 100",async()=>{a.incomeMove=ok(await post(a));a.expenseMove=ok(await post(a,{p_kind:"expense",p_category_id:a.expense.id,p_amount:"20"}));assert.equal(await balance(a),"13000");assert.equal(await balance(b),"10000");}],
 ["Idempotent concurrent income 0.10 has one effect; conflicting payload rejected",async()=>{const input={p_request_id:crypto.randomUUID(),p_amount:"0.10"};const result=await Promise.all([post(a,input),post(a,input)]);assert.equal(ok(result[0]).id,ok(result[1]).id);assert.equal(await balance(a),"13010");denied(await post(a,{...input,p_amount:"0.20"}));assert.equal(await balance(a),"13010");}],
 ["Decimal validation and rollback preserve balance and transaction count",async()=>{const before=await balance(a),count=ok(await rpc(a,"read_movements")).total_count;for(const amount of ["0","-1","0.001","NaN","1e2","10000000000000000"]){denied(await post(a,{p_amount:amount}));}assert.equal(await balance(a),before);assert.equal(ok(await rpc(a,"read_movements")).total_count,count);}],
 ["Concurrent replacement creates one successor; expense correction 20 to 25",async()=>{const input={p_request_id:crypto.randomUUID(),p_id:a.expenseMove.id,p_expected_version:1,p_reason:"Synthetic correction",p_kind:"expense",p_account_id:a.account.id,p_destination_id:null,p_category_id:a.expense.id,p_amount:"25",p_description:"Synthetic corrected expense",p_note:"",p_occurred_at:null};const r=await Promise.all([rpc(a,"replace_movement",input),rpc(a,"replace_movement",{...input,p_request_id:crypto.randomUUID()})]);assert.equal(r.filter(v=>!v.error).length,1);a.corrected=ok(r.find(v=>!v.error));assert.equal(await balance(a),"12510");const trace=ok(await rpc(a,"read_movement",{p_id:a.expenseMove.id}));assert.equal(trace.status,"void");}],
 ["Cross-user detail/delete denied; delete is traceable and idempotent",async()=>{for(const x of [b]){const hidden=await rpc(x,"read_movement",{p_id:a.incomeMove.id});assert(hidden.error||!hidden.data);denied(await rpc(x,"delete_movement",{p_id:a.incomeMove.id,p_expected_version:1,p_reason:"Forbidden"}));}const cmd={p_id:a.incomeMove.id,p_expected_version:1,p_reason:"Synthetic removal"};ok(await rpc(a,"delete_movement",cmd));ok(await rpc(a,"delete_movement",cmd));assert.equal(await balance(a),"7510");assert(!ok(await rpc(a,"read_movements")).movements.some(m=>m.id===a.incomeMove.id));const trace=ok(await rpc(a,"read_movement",{p_id:a.incomeMove.id}));assert(trace.deleted_at);}],
 ["Transfer preserves total; foreign account and different currency rejected",async()=>{const dest=ok(await rpc(a,"create_account",{p_request_id:crypto.randomUUID(),p_name:"Synthetic savings",p_type:"savings",p_currency:"PEN",p_opening:"0"}));const cmd={p_request_id:crypto.randomUUID(),p_account_id:a.account.id,p_destination_id:dest.id,p_amount:"10",p_description:"Synthetic transfer",p_note:"",p_occurred_at:null};ok(await rpc(a,"post_transfer",cmd));assert.equal(await balance(a),"6510");const accounts=ok(await rpc(a,"read_accounts"));assert.equal(accounts.find(v=>v.id===dest.id).balance_minor,"1000");denied(await rpc(a,"post_transfer",{...cmd,p_request_id:crypto.randomUUID(),p_destination_id:b.account.id}));const usd=ok(await rpc(a,"create_account",{p_request_id:crypto.randomUUID(),p_name:"Synthetic USD",p_type:"cash",p_currency:"USD",p_opening:"0"}));denied(await rpc(a,"post_transfer",{...cmd,p_request_id:crypto.randomUUID(),p_destination_id:usd.id}));assert.equal(await balance(a),"6510");}],
 ["Debt creation/update and payment link to ledger without duplication",async()=>{const id=ok(await debt(a,debtDraft())).id;const list=ok(await rpc(a,"read_debts"));const item=list.debts.find(v=>v.id===id);assert(item);ok(await debt(a,{...debtDraft(),action:"update",id,expectedVersion:item.version,name:"Synthetic updated debt"}));const payment={action:"pay",id,requestId:crypto.randomUUID(),mode:"new",accountId:a.account.id,categoryId:a.expense.id,amount:"10",occurredAt:null,note:"Synthetic"};const before=BigInt(await balance(a));ok(await debt(a,payment));ok(await debt(a,payment));assert.equal(await balance(a),(before-1000n).toString());denied(await debt(b,{action:"delete",id,expectedVersion:1}));assert.equal(ok(await rpc(b,"read_debts")).debts.length,0);}],
 ["Recurring expense/month-end history and concurrent idempotent payment",async()=>{const id=ok(await fixed(a,fixedDraft(a))).id;const before=BigInt(await balance(a));const pay={action:"pay",id,expectedVersion:1,ordinal:0,requestId:crypto.randomUUID(),mode:"new",accountId:a.account.id,occurredAt:null};const r=await Promise.all([fixed(a,pay),fixed(a,pay)]);assert.equal(ok(r[0]).id,ok(r[1]).id);assert.equal(await balance(a),(before-2000n).toString());const feb=ok(await rpc(a,"read_fixed_expenses",{p_month:"2026-02-01"}));assert(feb.payments.some(p=>p.expense_id===id));assert(feb.occurrences.some(o=>o.expense_id===id&&o.due_date==="2026-02-28"));const march=ok(await rpc(a,"read_fixed_expenses",{p_month:"2026-03-01"}));assert(march.occurrences.some(o=>o.expense_id===id&&o.due_date==="2026-03-31"));denied(await fixed(b,{...pay,requestId:crypto.randomUUID()}));assert.equal(ok(await rpc(b,"read_fixed_expenses")).expenses.length,0);}],
 ["Recurring invalid payment rolls back without orphan movement",async()=>{const id=ok(await fixed(a,{...fixedDraft(a),currency:"USD"})).id;const before=await balance(a),count=ok(await rpc(a,"read_movements")).total_count;denied(await fixed(a,{action:"pay",id,expectedVersion:1,ordinal:0,requestId:crypto.randomUUID(),mode:"new",accountId:a.account.id,occurredAt:null}));assert.equal(await balance(a),before);assert.equal(ok(await rpc(a,"read_movements")).total_count,count);}],
 ["Reports and B isolation reconcile currencies and own ledger",async()=>{const overview=ok(await rpc(a,"read_overview",{p_currency:"PEN",p_period:"month"}));assert.equal(overview.balance_minor,"4510");assert.equal(overview.income_minor,"10");assert.equal(overview.expense_minor,"5500");const ledger=ok(await rpc(a,"read_movements",{p_currency:"PEN",p_from:overview.from,p_to:overview.to,p_status:"posted"}));assert.equal(ledger.income_minor,overview.income_minor);assert.equal(ledger.expense_minor,overview.expense_minor);const accounts=ok(await rpc(a,"read_accounts"));assert.equal(accounts.filter(v=>v.currency_code==="PEN").reduce((sum,v)=>sum+BigInt(v.balance_minor),0n).toString(),overview.balance_minor);assert.equal(ok(await rpc(a,"read_overview",{p_currency:"USD",p_period:"month"})).balance_minor,"0");denied(await rpc(b,"read_overview",{p_currency:"PEN",p_period:"month",p_account_id:a.account.id}));ok(await rpc(a,"read_statistics",{p_currency:"PEN",p_period:"month"}));assert.equal(ok(await rpc(b,"read_movements")).total_count,0);assert.equal(await balance(b),"10000");}],
 ["Storage private upload/download; B and anonymous denied; signed URL permissions",async()=>{const bytes=await sharp({create:{width:4,height:4,channels:3,background:"#2288ff"}}).webp().toBuffer();const path=`${a.uid}/${crypto.randomUUID()}.webp`;ok(await a.c.storage.from("category-images").upload(path,bytes,{contentType:"image/webp"}));assert(ok(await a.c.storage.from("category-images").download(path)).size>0);denied(await b.c.storage.from("category-images").download(path));denied(await client().storage.from("category-images").download(path));denied(await b.c.storage.from("category-images").upload(`${a.uid}/${crypto.randomUUID()}.webp`,bytes,{contentType:"image/webp"}));denied(await a.c.storage.from("category-images").upload(`${a.uid}/${crypto.randomUUID()}.webp`,Buffer.alloc(1024*1024+1),{contentType:"image/webp"}));denied(await a.c.storage.from("category-images").upload(`${a.uid}/${crypto.randomUUID()}.txt`,Buffer.from("synthetic"),{contentType:"text/plain"}));const signed=ok(await a.c.storage.from("category-images").createSignedUrl(path,60));assert((await fetch(signed.signedUrl)).ok);denied(await b.c.storage.from("category-images").createSignedUrl(path,60));const publicUrl=a.c.storage.from("category-images").getPublicUrl(path).data.publicUrl;assert(!(await fetch(publicUrl)).ok);}],
 ["Password recovery token, single use, new password and session identity",async()=>{const generated=ok(await withAuthOperator(auth=>auth.generateLink({type:"recovery",email:b.email})));const c=client();ok(await c.auth.verifyOtp({token_hash:generated.properties.hashed_token,type:"recovery"}));const password=crypto.randomUUID()+"!Changed64";ok(await c.auth.updateUser({password}));denied(await client().auth.verifyOtp({token_hash:generated.properties.hashed_token,type:"recovery"}));denied(await client().auth.signInWithPassword({email:b.email,password:b.password}));assert.equal(ok(await client().auth.signInWithPassword({email:b.email,password})).user.id,b.uid);b.password=password;}]
];
let selected=cases;
if(process.argv.includes("--reports-only")) {
 const prior=JSON.parse(readFileSync("docs/deployment/evidence/phase2-runtime-validation.json","utf8"));
 assert.equal(prior.ref,ref);assert.equal(prior.results.length,18);assert(prior.results.every(r=>r.status==="passed"));
 const subjects=[];
 for(const label of ["a","b"]) {
  const email=`finzi-staging-${prior.run}-${label}@example.test`;
  const generated=ok(await withAuthOperator(auth=>auth.generateLink({type:"magiclink",email})));
  const c=client();const identity=ok(await c.auth.verifyOtp({token_hash:generated.properties.hashed_token,type:"magiclink"}));
  assert.equal(identity.user.email,email);
  const x={c,uid:identity.user.id};x.account=ok(await rpc(x,"read_accounts")).find(v=>v.type==="cash"&&v.currency_code==="PEN");subjects.push(x);
 }
 [a,b]=subjects;
 selected=cases.filter(([name])=>name.startsWith("Reports and B isolation"));
}
const evidenceFile=process.argv.includes("--reports-only")?"docs/deployment/evidence/phase2-report-reconciliation.json":"docs/deployment/evidence/phase2-runtime-validation.json";
for(const [name,action] of selected){try{await action();results.push({name,status:"passed"});console.log(`PASS ${name}`);}catch(error){results.push({name,status:"failed",reason:error instanceof assert.AssertionError?error.message.split("\n")[0]:`Unexpected ${error?.name??"Error"}; details suppressed to protect credentials`});writeFileSync(evidenceFile,JSON.stringify({ref,run,at:new Date().toISOString(),results},null,2));console.error(`STOP ${name}: ${results.at(-1).reason}`);process.exit(1);}}
writeFileSync(evidenceFile,JSON.stringify({ref,run,at:new Date().toISOString(),results},null,2));
console.log(`${results.length} staging validations passed. No financial requests used an administrative client.`);
