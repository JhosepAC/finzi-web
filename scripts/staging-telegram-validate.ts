import { verifyConfirmationRace } from "./telegram-concurrency-evidence.ts";
import { createCheckpoint, collectSample, type Observation } from "./telegram-cpu-checkpoint.ts";
import { ControlFault, safeFailure, writeEvidence, providerOutput, diagnosticRows, type Stage } from "./telegram-control-observability.ts";
import { assertStagingLoadAllowed } from "./staging-load-gate.mjs";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, unlinkSync, existsSync, renameSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { receiver } from "../telegram-webhook/worker.ts";
import { openDatabase, type Database } from "../telegram-webhook/database.ts";
import { runBatch as workerBatch, checkEnvironment, type Environment, type Sender } from "../telegram-webhook/processor.ts";
import { hash } from "../telegram-bot/bot.ts";
import { supabaseCa } from "../telegram-webhook/supabase-ca.ts";

const ref="mkzclztzyqdmftesnwcw",bot=String(100000000000000+Number.parseInt(randomBytes(5).toString("hex"),16));
let run=crypto.randomUUID();
let financialScopes:string[]=[];const financialConsumptions:{scope:string;at:string}[]=[];
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
const limits={users:2,uniqueUpdates:24,receiverCalls:40,batchCalls:96,metadataQueries:200,minutes:35,financialMovements:1};
const mode=process.argv[2];assert([undefined,"--plan","--approved-control"].includes(mode));
const gate=JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json","utf8"));assert.equal(gate.project_ref,ref);
if(mode==="--plan"){
 console.log(JSON.stringify({ref,scope:"bounded-telegram-phase3-integration",cases:18,limits,gate:gate.status,requiresFreshExplicitApproval:true,realTelegramRequests:0}));process.exit(0);
}
if(mode==="--approved-control"){
 assert.equal(gate.status,"paused");
 const path=process.argv[3]??".staging-migrations/telegram-phase3-approval.json";assert(path===".staging-migrations/telegram-phase3-approval.json"||/^\.staging-migrations\/phase3-final-approval-[a-f0-9-]{36}\.json$/.test(path));const approval=JSON.parse(readFileSync(path,"utf8"));
 const enrollment=JSON.parse(readFileSync("docs/deployment/evidence/phase3-enrollment-control.json","utf8"));
 assert.equal(enrollment.status,"passed_awaiting_review");assert.equal(approval.reviewed_enrollment_run,enrollment.run);
 assert.equal(approval.status,"approved");assert.equal(approval.project_ref,ref);assert.equal(approval.scope,"bounded-telegram-phase3-integration");
 assert.equal(approval.runner_sha256,createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"));
 const age=Date.now()-Date.parse(approval.approved_at);assert(age>=0&&age<3600000);
 assert(/^[a-f0-9-]{36}$/.test(approval.run_id));assert(!existsSync(path+".consumed"));
 assert(Array.isArray(approval.financial_scopes));assert.deepEqual([...approval.financial_scopes].sort(),["OPEN_A_100_PEN","OPEN_B_100_PEN","EXPENSE_A_25_PEN_IDEMPOTENT_CONFIRMATIONS"].sort());financialScopes=approval.financial_scopes;run=approval.run_id;renameSync(path,path+".consumed");
}else assertStagingLoadAllowed();
const started=Date.now(),usage={receiverCalls:0,batchCalls:0,metadataQueries:0,users:0,httpRpcCalls:0};
const subjects:{uid:string;label:string;account?:string}[]=[];
const ownedEvents=new Set<string>();
const uniqueUpdates=new Set<number>();let setupBaseline=0;
function budget(){assert(Date.now()-started<limits.minutes*60000,"Controlled run deadline reached");}
const cli=createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function runSupabase(args:string[]){budget();const r=spawnSync(process.execPath,[cli,...args],{encoding:"utf8",timeout:20000,maxBuffer:8*1024*1024});return providerOutput({...r,error:r.error as {code?:unknown}|undefined});}
async function runBatch(...args:Parameters<typeof workerBatch>){budget();assert(++usage.batchCalls<=limits.batchCalls,"Batch budget reached");assert.equal(args.length,4,"Synthetic sender is mandatory");return workerBatch(...args);}
process.loadEnvFile(".env.supabase-staging.local");process.loadEnvFile(".env.telegram-webhook-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF,ref);assert.equal(process.env.TELEGRAM_WEBHOOK_BOT_ID,"970000003");
assert.equal(process.env.SUPABASE_URL,`https://${ref}.supabase.co`);assert(process.env.TELEGRAM_WEBHOOK_BOT_TOKEN?.endsWith(":synthetic_test_only"));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("TELEGRAM_WEBHOOK_"))) as unknown as Environment;
env.TELEGRAM_WEBHOOK_BOT_ID=bot;env.TELEGRAM_WEBHOOK_BOT_TOKEN=bot+":synthetic_test_only";const transportUri=new URL(env.TELEGRAM_WEBHOOK_DATABASE_URL!);transportUri.port="6543";env.TELEGRAM_WEBHOOK_DATABASE_URL=transportUri.toString();checkEnvironment(env);
const url=`https://${ref}.supabase.co`,key=process.env.SUPABASE_STAGING_ANON_KEY!;
async function boundedFetch(input:RequestInfo|URL,init?:RequestInit){budget();const target=new URL(String(input));assert.equal(target.origin,url);if(target.pathname.includes("/rpc/")){assert(["ensure_profile","configure_profile","create_account","initialize_categories","telegram_issue_link","telegram_activate_link","telegram_link_status","telegram_set_movement_permission","telegram_set_query_permission","telegram_revoke_link_versioned","read_movements","read_accounts"].includes(target.pathname.split("/").at(-1)!));usage.httpRpcCalls++;}return fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(20000),...(init?.signal?[init.signal]:[])])});}
const create=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},db:{retry:false,timeout:20000},global:{fetch:boundedFetch}});
const clientOperator=createClient(url,process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}}).auth.admin;
let currentStage:Stage="scenario.work";
const results:({name:string;status:string}&Partial<ReturnType<typeof safeFailure>>)[]=[];
const evidence=`docs/deployment/evidence/phase3-${mode==="--approved-control"?"controlled-":""}runtime-validation-${run}.json`;
let raceEvidence:unknown;
const cpuObservations:Observation[]=[];
const cpuWindows:{percent:number;at:number}[]=[];
const record=()=>writeEvidence(evidence,{raceEvidence,ref,run,bot,subjects,financialConsumptions,ownedEvents:[...ownedEvents],cpuWindows,cpuObservations,at:new Date().toISOString(),results,limits,usage,uniqueUpdates:uniqueUpdates.size,gate:gate.status,realTelegramRequests:0});
function consumeFinancialScope(scope:string){
 assert(financialScopes.includes(scope),"Specific financial operation not authorized");
 assert(!financialConsumptions.some(x=>x.scope===scope),"Financial scope already consumed");
 financialConsumptions.push({scope,at:new Date().toISOString()});record();
}
const ok=<T>(r:{data:T;error:unknown}):T=>{if(r.error){const code=(r.error as {code?:string}).code;throw Object.assign(new Error("Auth/RPC rejected; raw details suppressed"),{code:code&&/^[A-Za-z0-9_]{1,40}$/.test(code)?code:"RPC_REJECTED"});}return r.data;};
const cpuCheckpoint=createCheckpoint({maxCpuPauses:3,
 sample:()=>collectSample({fetchMetrics:()=>fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`,{headers:{Authorization:"Basic "+Buffer.from("service_role:"+process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64")},signal:AbortSignal.timeout(15000)}),
 diagnostics:()=>query("select (select coalesce(sum(calls),0) from extensions.pg_stat_statements where queryid=5360251647081715348) as calls,(select stats_reset::text from extensions.pg_stat_statements_info) as reset,exists(select 1 from pg_stat_activity where usename='authenticator' and state not in ('idle','disabled')) as unsafe")[0],
 now:Date.now,progress:(stage,metrics)=>{currentStage=stage;cpuObservations.push({status:"progress",stage,metrics,at:Date.now()});record();}}),
 rpc:()=>usage.httpRpcCalls,now:Date.now,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),budget,
 emit:observation=>{currentStage=observation.stage;cpuObservations.push(observation);if(observation.status==="accepted")cpuWindows.push({percent:observation.percent!,at:observation.at});record();}
});
function stop(name:string,error:unknown):never{
 const failure=safeFailure(error,currentStage);results.push({name,status:"failed",...failure});
 try{record();console.error(JSON.stringify({name,...failure}));}
 catch{console.error(JSON.stringify(safeFailure(new ControlFault("evidence.write","EVIDENCE_WRITE_FAILED"),"evidence.write")));}
 process.exit(1);
}
async function test(name:string,work:()=>Promise<void>){try{budget();if(!results.length){await cpuCheckpoint();await cpuCheckpoint();}currentStage="scenario.work";await work();await cpuCheckpoint();currentStage="scenario.validate";const observed=Number(query("select coalesce(sum(calls),0) as n from extensions.pg_stat_statements where queryid=5360251647081715348")[0].n);assert(observed>=setupBaseline,"Unexpected statistics reset");assert(observed-setupBaseline<=usage.httpRpcCalls+2,"Unexpected PostgREST retries or unrelated traffic");assert.equal(Number(query("select count(*) as n from pg_stat_activity where usename='authenticator' and state like 'idle in transaction%'")[0].n),0,"Unexpected PostgREST transaction persists");results.push({name,status:"passed"});record();console.log("PASS "+name);}catch(error){stop(name,error);}}
function query(sql:string):Record<string,unknown>[] {budget();assert(++usage.metadataQueries<=limits.metadataQueries,"Metadata budget reached");try{const raw=runSupabase(["db","query",`--remote=${ref}`,"--read-only","--output-format","json",sql]);return diagnosticRows(raw);}catch(error){if(error instanceof ControlFault)throw error;throw new ControlFault("diagnostics.spawn","DIAGNOSTIC_EXIT");}}
function fixture(id:string,changes:string){assert(ownedEvents.has(id),"Foreign fixture refused");assert(/^[a-f0-9-]{36}$/.test(id));const file=".staging-migrations/telegram-test-fixture.sql";
 writeFileSync(file,`update telegram_private.transport_events set ${changes} where bot_id='${bot}' and id='${id}';`);
 try{runSupabase(["db","query",`--remote=${ref}`,"--file",file,"--yes","--output-format","json"]);}catch{throw new Error("Synthetic fixture update failed");}finally{unlinkSync(file);}}
const row=(id:string)=>{assert(/^[a-f0-9-]{36}$/.test(id));return query(`select id,state,attempts,delivery_attempts,error_code,payload_ciphertext,result_ciphertext from telegram_private.transport_events where bot_id='${bot}' and id='${id}'`)[0];};
let sequence=Date.now();const identity=Number(String(Date.now()).slice(-10))*100;
const message=(user:number,text:string)=>({update_id:++sequence,message:{message_id:sequence,date:Math.floor(Date.now()/1000),from:{id:user,is_bot:false,first_name:"Synthetic"},chat:{id:user,type:"private"},text,...(text.startsWith("/")?{entities:[{type:"bot_command",offset:0,length:text.split(" ")[0].length}]}:{})}});
const callback=(user:number,data:string)=>({update_id:++sequence,callback_query:{id:"synthetic-"+sequence,chat_instance:"synthetic",from:{id:user,is_bot:false,first_name:"Synthetic"},message:{message_id:sequence,date:Math.floor(Date.now()/1000),chat:{id:user,type:"private"}},data}});
const incoming=(update:unknown,secret=env.TELEGRAM_WEBHOOK_SECRET)=>new Request("https://staging.invalid/telegram/webhook",{method:"POST",headers:{"content-type":"application/json","X-Telegram-Bot-Api-Secret-Token":secret},body:JSON.stringify(update)});
const rawReceive=receiver();
const receive:ReturnType<typeof receiver>=async(request,environment)=>{budget();assert(++usage.receiverCalls<=limits.receiverCalls,"Receiver budget reached");return rawReceive(request,environment);};
const captured:{method:string;payload:Record<string,unknown>}[]=[];
const sender:Sender=async calls=>{captured.push(...calls);};
const connect=()=>openDatabase(env.TELEGRAM_WEBHOOK_DATABASE_URL!);
async function step(stage:"process"|"deliver",db?:Database){const own=!db;db??=connect();try{await db.check();return await runBatch(db,env,stage,sender);}finally{if(own)await db.close();}}
async function drain(){for(let i=0;i<25;i++){const a=await step("process"),b=await step("deliver");if(!a&&!b)return;}throw new Error("Unexpected queue depth");}
async function enqueue(update:{update_id:number}){
 uniqueUpdates.add(update.update_id);assert(uniqueUpdates.size<=limits.uniqueUpdates,"Update budget reached");
 for(let i=0;i<4;i++){const r=await receive(incoming(update),env);if(r.status===200){const rows=query(`select id from telegram_private.transport_events where bot_id='${bot}' and update_id=${update.update_id}`);assert.equal(rows.length,1);ownedEvents.add(String(rows[0].id));return String(rows[0].id);}assert.equal(r.status,503);}
 throw new Error("Receiver did not persist after bounded contention retries");
}
async function send(user:number,text:string){const id=await enqueue(message(user,text));await drain();assert.equal(row(id).state,"done");return id;}
const last=(user:number)=>captured.filter(x=>x.method==="sendMessage"&&String(x.payload.chat_id)===String(user)).at(-1)!.payload;
type Person=Awaited<ReturnType<typeof person>>;
let a:Person,b:Person,token:string,confirmationId:string;
async function person(label:string,user:number){
 assert(++usage.users<=limits.users,"Synthetic identity budget reached");
 const email=`finzi-staging-${run}-${label}@example.test`,password=randomBytes(24).toString("hex");
 const generated=await clientOperator.generateLink({type:"signup",email,password});assert(!generated.error);const subject={uid:generated.data.user.id,label,account:undefined as string|undefined};subjects.push(subject);record();const c=create();
 const verified=ok(await c.auth.verifyOtp({token_hash:generated.data.properties.hashed_token,type:"signup"}));assert(verified.user!.email_confirmed_at);
 assert.equal(JSON.parse(Buffer.from(verified.session!.access_token.split(".")[1],"base64url").toString()).role,"authenticated");
 ok(await c.schema("api").rpc("ensure_profile"));ok(await c.schema("api").rpc("configure_profile",{p_display_name:"Synthetic Telegram",p_currency:"PEN",p_timezone:"America/Lima",p_expected_version:0}));
 consumeFinancialScope(label==="a"?"OPEN_A_100_PEN":"OPEN_B_100_PEN");
 const account=ok(await c.schema("api").rpc("create_account",{p_request_id:crypto.randomUUID(),p_name:"Efectivo",p_type:"cash",p_currency:"PEN",p_opening:"100"}));
 subject.account=account.id;record();
 const categories=ok(await c.schema("api").rpc("initialize_categories")).categories;
 return {c,uid:verified.user!.id,user,account:account.id,category:categories.find((x:{kind:string})=>x.kind==="expense"),link:""};
}
const count=async(p:Person)=>ok(await p.c.schema("api").rpc("read_movements")).total_count;
const balance=async(p:Person)=>ok(await p.c.schema("api").rpc("read_accounts")).find((x:{id:string})=>x.id===p.account).balance_minor;
async function permission(p:Person,kind:"movement"|"query",allow:boolean){const status=ok(await p.c.schema("api").rpc("telegram_link_status"));const link=status.links.find((x:{id:string})=>x.id===p.link);ok(await p.c.schema("api").rpc(kind==="movement"?"telegram_set_movement_permission":"telegram_set_query_permission",{p_id:p.link,p_version:link.version,p_allow:allow}));}

await test("Staging identity, 36 migrations and real restricted TLS gateway",async()=>{
 const p=JSON.parse(runSupabase(["projects","list","--output","json"])).find((p:{id:string})=>p.id===ref);assert.equal(p.status,"ACTIVE_HEALTHY");
 assert.equal(Number(query("select count(*) as count from supabase_migrations.schema_migrations")[0].count),36);
 setupBaseline=Number(query("select coalesce(sum(calls),0) as n from extensions.pg_stat_statements where queryid=5360251647081715348")[0].n);
 assert.equal(Number(query(`select count(*) as n from telegram_private.transport_events where bot_id='${bot}' and state in ('pending','processing','ready','delivering')`)[0].n),0);
 const registration=".staging-migrations/telegram-register.sql";
 writeFileSync(registration,`insert into telegram_private.transport_bots(bot_id,mode,enabled) values('${bot}','webhook',true);`);
 try{runSupabase(["db","query",`--remote=${ref}`,"--file",registration,"--yes","--output-format","json"]);}finally{unlinkSync(registration);}
 const db=connect();try{await db.check();}finally{await db.close();}
});
await test("Invalid secret/event/method rejected without durable rows",async()=>{
 const before=query(`select count(*) as count from telegram_private.transport_events where bot_id='${bot}'`)[0].count;
 assert.equal((await receive(incoming(message(identity+1,"/start"),"wrong"),env)).status,403);
 assert.equal((await receive(incoming({update_id:++sequence}),env)).status,400);
 assert.equal((await receive(new Request("https://staging.invalid/telegram/webhook"),env)).status,405);
 assert.equal(query(`select count(*) as count from telegram_private.transport_events where bot_id='${bot}'`)[0].count,before);
});
await test("Concurrent duplicates persist once; conflicting payload cannot overwrite",async()=>{
 const update=message(identity+1,"/start");const responses=await Promise.all([receive(incoming(update),env),receive(incoming(update),env)]);assert(responses.every(r=>[200,503].includes(r.status)));assert(responses.some(r=>r.status===200));
 const id=await enqueue(update);assert.equal(row(id).state,"pending");assert(String(row(id).payload_ciphertext).startsWith("v1."));
 assert.equal((await receive(incoming({...update,message:{...update.message,text:"changed"}}),env)).status,503);
 const first=connect(),second=connect();try{await Promise.all([first.check(),second.check()]);const r=await Promise.all([runBatch(first,env,"process",sender),runBatch(second,env,"process",sender)]);assert.equal(r.filter(Boolean).length,1);}finally{await first.close();await second.close();}
 await drain();assert.equal(row(id).state,"done");
});
await test("Normal synthetic A/B Auth sessions and private web activation",async()=>{
 a=await person("a",identity+2);b=await person("b",identity+3);
 for(const p of [a,b]){
  const challenge=randomBytes(32).toString("hex");const attempt=ok(await p.c.schema("api").rpc("telegram_issue_link",{p_challenge_hash:hash(challenge)}));
  await send(p.user,"/start "+challenge);
  assert(String(last(p.user).text).includes("Solicitud recibida"));
  const linked=ok(await p.c.schema("api").rpc("telegram_activate_link",{p_attempt:attempt.id}));p.link=linked.id;
  await permission(p,"movement",true);await permission(p,"query",true);
 }
});
await test("Persisted but unprocessed event survives client restart",async()=>{
 const id=await enqueue(message(a.user,"/saldo"));assert.equal(row(id).state,"pending");assert.equal(await count(a),0);
 const next=connect();try{await next.check();assert.equal(await runBatch(next,env,"process",sender),true);}finally{await next.close();}
 assert.equal(row(id).state,"ready");assert(row(id).result_ciphertext);assert.equal(row(id).payload_ciphertext,null);await drain();assert.equal(row(id).result_ciphertext,null);
});
await test("Timeout and interruption preserve lease-fenced input for retry",async()=>{
 const id=await enqueue(message(a.user,"/saldo"));const base=connect();await base.check();let failed=false;
 const broken:Database={...base,call:async(...args:Parameters<Database["call"]>)=>{if(!failed){failed=true;throw Object.assign(new Error("synthetic timeout"),{code:"57014"});}return base.call(...args);}};
 try{assert.equal(await runBatch(broken,env,"process",sender),false);}finally{await base.close();}
 assert.equal(row(id).state,"pending");assert.equal(row(id).error_code,"timeout");fixture(id,"available_at=clock_timestamp()-interval '1 second'");
 await drain();assert.equal(row(id).state,"done");assert.equal(await count(a),0);
});
await test("Expired lease cannot mutate or finish; new owner reclaims",async()=>{
 const id=await enqueue(message(a.user,"/saldo")),lease=randomBytes(32).toString("hex");const db=connect();try{await db.check();const claimed=await db.claim(bot,lease,"process");assert.equal(claimed!.id,id);
 fixture(id,"lease_until=clock_timestamp()-interval '1 second'");
 await assert.rejects(db.finish(bot,id,lease,"invalid"),(e:unknown)=>(e as {code:string}).code==="42501");
 }finally{await db.close();}
 await drain();assert.equal(row(id).state,"done");assert.equal(row(id).attempts,2);
});
await test("Direct legacy financial entrypoints denied; polling lock blocks webhook",async()=>{
 const sql=postgres(env.TELEGRAM_WEBHOOK_DATABASE_URL!,{max:1,prepare:false,ssl:{ca:supabaseCa,rejectUnauthorized:true},onnotice:()=>{}});
 try{
  await assert.rejects(sql`select telegram_private.confirm_draft('{}'::jsonb,${"a".repeat(64)},'1')`,(e:unknown)=>(e as {code:string}).code==="42501");
  await sql.begin(async tx=>{
   await tx`select pg_advisory_xact_lock(hashtextextended(${'finzi-telegram:'+bot},0))`;
   assert.equal((await receive(incoming(message(a.user,"/saldo")),env)).status,503);
  });
 }finally{await sql.end({timeout:2});}
});
await test("Draft preview keeps money unchanged and registers signed confirm callback",async()=>{
 await send(a.user,`Gast\u00e9 25 soles en ${a.category.name}`);assert.equal(await count(a),0);
 const markup=last(a.user).reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]};
 const button=markup.inline_keyboard.flat().find(x=>x.text==="Confirmar movimiento");assert(button,"Expected complete preview with confirm button");token=button.callback_data;assert(/^f5:[a-f0-9]{48}$/.test(token));
});
await test("A callback used by B cannot publish A or B movements",async()=>{
 await enqueue(callback(b.user,token));await drain();assert.equal(await count(a),0);assert.equal(await count(b),0);
});
await test("Crash after financial commit recovers canonical result without duplication",async()=>{
 consumeFinancialScope("EXPENSE_A_25_PEN_IDEMPOTENT_CONFIRMATIONS");
 confirmationId=await enqueue(callback(a.user,token));const base=connect();await base.check();
 const peer=connect();await peer.check();
 let race:PromiseSettledResult<unknown>[]=[];let confirmArgs:Parameters<Database["call"]>|undefined;
 const interrupted:Database={...base,call:async(...args:Parameters<Database["call"]>)=>{
  if(args[3]!=="confirm")return base.call(...args);
  confirmArgs=args;race=await Promise.allSettled([base.call(...args),peer.call(...args)]);
  const winner=race.find((x):x is PromiseFulfilledResult<unknown>=>x.status==="fulfilled");
  if(!winner)throw new Error("No confirmation succeeded");return winner.value;
 },finish:async()=>{throw new Error("synthetic death before acknowledgement");},retry:async()=>{throw new Error("synthetic terminated worker");}};
 try{
  assert.equal(await runBatch(interrupted,env,"process",sender),false);
  assert(confirmArgs);
  const args=confirmArgs;raceEvidence=await verifyConfirmationRace(race,()=>base.call(...args));record();
 }finally{await base.close();await peer.close();}
 assert.equal(await count(a),1);assert.equal(await balance(a),"7500");assert.equal(row(confirmationId).state,"processing");
 fixture(confirmationId,"lease_until=clock_timestamp()-interval '1 second'");await drain();
 assert.equal(row(confirmationId).state,"done");assert.equal(await count(a),1);assert.equal(await balance(a),"7500");assert(String(last(a.user).text).includes("Movimiento registrado"));
});
await test("Duplicate update and a second confirmation preserve exactly one movement",async()=>{
 const again=callback(a.user,token);await enqueue(again);await drain();await enqueue(again);await drain();assert.equal(await count(a),1);assert.equal(await balance(a),"7500");assert.equal(await count(b),0);
});
await test("Delivery failure retries the outbox without running financial logic again",async()=>{
 const id=await enqueue(message(a.user,"/saldo"));await step("process");const db=connect();try{await db.check();assert.equal(await runBatch(db,env,"deliver",async()=>{throw new Error("synthetic delivery timeout");}),false);}finally{await db.close();}
 assert.equal(row(id).state,"ready");assert.equal(row(id).error_code,"delivery");fixture(id,"available_at=clock_timestamp()-interval '1 second'");await drain();assert.equal(row(id).state,"done");assert.equal(await count(a),1);
});
await test("Revocation suppresses queued private response and blocks new confirmation",async()=>{
 const id=await enqueue(message(a.user,"/saldo"));await step("process");assert.equal(row(id).state,"ready");
 const status=ok(await a.c.schema("api").rpc("telegram_link_status"));const link=status.links.find((x:{id:string})=>x.id===a.link);
 ok(await a.c.schema("api").rpc("telegram_revoke_link_versioned",{p_id:a.link,p_version:link.version}));
 const before=captured.length;await step("deliver");assert.equal(row(id).state,"done");assert.equal(captured.length,before);
 await enqueue(callback(a.user,token));await drain();assert.equal(await count(a),1);assert.equal(await count(b),0);
});
await test("Gateway cannot forge another event identity or read another subject custody",async()=>{
 const id=await enqueue(message(b.user,"/saldo")),lease=randomBytes(32).toString("hex");const db=connect();try{await db.check();assert.equal((await db.claim(bot,lease,"process"))!.id,id);
 await assert.rejects(db.call(bot,id,lease,"catalog",{context:{botId:bot,telegramUserId:String(a.user),chatId:String(a.user),capability:"a".repeat(64),scope:"catalog:read"}}),(e:unknown)=>(e as {code:string}).code==="42501");
 await assert.rejects(db.credentials(bot,id,"0".repeat(64)),(e:unknown)=>(e as {code:string}).code==="42501");
 }finally{await db.close();}
 fixture(id,"lease_until=clock_timestamp()-interval '1 second'");await drain();assert.equal(row(id).state,"done");
});
await test("Processing retries stop at five without dropping encrypted input",async()=>{
 const id=await enqueue(message(identity+4,"/start")),base=connect();await base.check();
 const failing:Database={...base,credentials:async()=>{throw Object.assign(new Error("synthetic timeout"),{code:"57014"});}};
 try{
  for(let attempt=1;attempt<=5;attempt++){
   assert.equal(await runBatch(failing,env,"process",sender),false);const state=row(id);assert.equal(state.attempts,attempt);
   assert.equal(state.state,attempt===5?"dead":"pending");assert(state.payload_ciphertext);
   if(attempt<5)fixture(id,"available_at=clock_timestamp()-interval '1 second'");
  }
  assert.equal(await runBatch(base,env,"process",sender),false);assert.equal(row(id).attempts,5);
 }finally{await base.close();}
 assert.equal(await count(a),1);assert.equal(await count(b),0);
});
await test("Delivery retries stop at five without repeating financial work",async()=>{
 const id=await enqueue(message(identity+5,"/start"));await step("process");const db=connect();await db.check();
 try{
  for(let attempt=1;attempt<=5;attempt++){
   assert.equal(await runBatch(db,env,"deliver",async()=>{throw new Error("synthetic delivery failure");}),false);
   const state=row(id);assert.equal(state.delivery_attempts,attempt);assert.equal(state.state,attempt===5?"dead":"ready");assert(state.result_ciphertext);
   if(attempt<5)fixture(id,"available_at=clock_timestamp()-interval '1 second'");
  }
  assert.equal(await runBatch(db,env,"deliver",sender),false);assert.equal(row(id).delivery_attempts,5);
 }finally{await db.close();}
 assert.equal(await count(a),1);assert.equal(await count(b),0);
});
await test("No raw payloads in completed queue; original money and A/B isolation reconcile",async()=>{
 const rows=query(`select count(*) filter(where state='done' and (payload_ciphertext is not null or result_ciphertext is not null)) as retained from telegram_private.transport_events where bot_id='${bot}'`);assert.equal(Number(rows[0].retained),0);
 assert.equal(await balance(a),"7500");assert.equal(await balance(b),"10000");assert.equal(await count(a),1);assert.equal(await count(b),0);
 const original=JSON.parse(readFileSync("docs/deployment/evidence/cpu-remediation-security-after.json","utf8"));
 const current=query("select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'signature',p.oid::regprocedure::text,'source',md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))) order by p.oid) as functions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('api','finance','ops','telegram_private')")[0].functions;
 assert.deepEqual(current,original.functions);
 assert.equal(Number(query("select count(*) as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('finance','ops','telegram_private') and c.relkind='r' and c.relname<>'currencies' and (not c.relrowsecurity or not c.relforcerowsecurity)")[0].n),0);
 assert.equal(Number(query("select count(*) as n from pg_roles where rolname in ('app_executor','finzi_deletion_worker','finzi_telegram_gateway','finzi_telegram_transport_executor') and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolinherit)")[0].n),0);
});
try{await cpuCheckpoint();}catch(error){stop("Final CPU window",error);}
console.log(`${results.length} real staging Telegram integration cases passed; no real Telegram API calls or financial admin client.`);
