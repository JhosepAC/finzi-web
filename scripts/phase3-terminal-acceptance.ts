import assert from "node:assert/strict";
import {readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {receiver} from "../telegram-webhook/worker.ts";
import {openDatabase} from "../telegram-webhook/database.ts";
import {runBatch,type Environment,type Sender} from "../telegram-webhook/processor.ts";
import {runSupabase} from "./supabase-cli.mjs";
import {writeEvidence} from "./telegram-control-observability.ts";
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json","utf8")).status,"paused");
const path=readFileSync(".staging-migrations/phase3-completion-cohort-path.txt","utf8"),prior=JSON.parse(readFileSync(path+".consumed","utf8"));
const old=JSON.parse(readFileSync(`docs/deployment/evidence/phase3-controlled-runtime-validation-${prior.run_id}.json`,"utf8"));
const permitPath=`.staging-migrations/terminal-completion-${old.run}.json`,permit=JSON.parse(readFileSync(permitPath,"utf8"));assert.equal(permit.status,"approved");assert.equal(permit.run,old.run);assert(!existsSync(permitPath+".consumed"));renameSync(permitPath,permitPath+".consumed");
process.loadEnvFile(".env.telegram-webhook-staging.local");assert.equal(process.env.TELEGRAM_WEBHOOK_BOT_ID,"970000003");
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("TELEGRAM_WEBHOOK_"))) as unknown as Environment;env.TELEGRAM_WEBHOOK_BOT_ID=old.bot;env.TELEGRAM_WEBHOOK_BOT_TOKEN=old.bot+":synthetic_test_only";
const uri=new URL(env.TELEGRAM_WEBHOOK_DATABASE_URL!);uri.port="6543";env.TELEGRAM_WEBHOOK_DATABASE_URL=uri.toString();
function query(sql:string){return JSON.parse(runSupabase(["db","query","--remote=mkzclztzyqdmftesnwcw","--read-only","--output-format","json",sql])).rows;}
const state=(id:string)=>{assert(/^[a-f0-9-]{36}$/.test(id));return query(`select state,attempts,delivery_attempts,payload_ciphertext is not null as input_present,result_ciphertext is not null as output_present from telegram_private.transport_events where bot_id='${old.bot}' and id='${id}'`)[0];};
const result:{run:string;checks:string[];status:string;financialOperations:number;newEvent?:string}={run:old.run,checks:[],status:"running",financialOperations:0};
const db=openDatabase(env.TELEGRAM_WEBHOOK_DATABASE_URL!);let id:string|undefined;
try{
 await db.check();const dead=state(old.ownedEvents.at(-1));assert.equal(dead.state,"dead");assert.equal(dead.attempts,5);assert(dead.input_present);
 assert.equal(await db.claim(old.bot,randomBytes(32).toString("hex"),"process"),null);result.checks.push("case16_five_attempts_dead_preserved_no_sixth_claim");
 const update=Date.now(),user=Number(String(update).slice(-10))*100+88;
 const event={update_id:update,message:{message_id:update,date:Math.floor(Date.now()/1000),from:{id:user,is_bot:false,first_name:"Synthetic"},chat:{id:user,type:"private"},text:"/start",entities:[{type:"bot_command",offset:0,length:6}]}};
 assert.equal((await receiver()(new Request("https://staging.invalid/telegram/webhook",{method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(event)}),env)).status,200);
 id=String(query(`select id from telegram_private.transport_events where bot_id='${old.bot}' and update_id=${update}`)[0].id);result.newEvent=id;
 const sender:Sender=async()=>{};assert.equal(await runBatch(db,env,"process",sender),true);assert.equal(state(id).state,"ready");
 for(let n=1;n<=5;n++){
  assert.equal(await runBatch(db,env,"deliver",async()=>{throw new Error("synthetic delivery failure");}),false);
  const s=state(id);assert.equal(s.delivery_attempts,n);assert.equal(s.state,n===5?"dead":"ready");assert(s.output_present);
  if(n<5){const file=".staging-migrations/terminal-fixture.sql";writeFileSync(file,`update telegram_private.transport_events set available_at=clock_timestamp()-interval '1 second' where bot_id='${old.bot}' and id='${id}';`);try{runSupabase(["db","query","--remote=mkzclztzyqdmftesnwcw","--file",file,"--yes","--output-format","json"]);}finally{unlinkSync(file);}}
 }
 assert.equal(await db.claim(old.bot,randomBytes(32).toString("hex"),"deliver"),null);result.checks.push("case17_five_delivery_failures_dead_preserved_no_sixth_claim");
 const audit=JSON.parse(runSupabase(["db","query","--remote=mkzclztzyqdmftesnwcw","--read-only","--file","infrastructure/supabase/phase3-completion-cohort-audit.sql","--output-format","json"])).rows[0].audit;
 const baseline=JSON.parse(readFileSync("docs/deployment/evidence/cpu-remediation-security-after.json","utf8"));assert.deepEqual(audit.functions,baseline.functions);assert.equal(audit.unsafe_tenant_tables,0);
 const a=audit.subjects.find((s:{user_id:string})=>s.user_id===old.subjects.find((s:{label:string})=>s.label==="a").uid),b=audit.subjects.find((s:{user_id:string})=>s.user_id===old.subjects.find((s:{label:string})=>s.label==="b").uid);
 assert.equal(a.accounts[0].balance_minor,"7500");assert.equal(a.transactions,1);assert.equal(a.entries,1);assert.equal(a.events,1);assert.equal(a.confirmations,1);assert.equal(a.financial_details[0].kind,"expense");assert.equal(a.financial_details[0].status,"posted");assert.equal(a.financial_details[0].amount_minor,"2500");assert.equal(a.financial_details[0].entry_sum_minor,"-2500");assert.equal(a.financial_details[0].confirmation_count,1);assert.equal(b.accounts[0].balance_minor,"10000");assert.equal(b.transactions,0);
 writeEvidence(`docs/deployment/evidence/phase3-terminal-final-audit-${old.run}.json`,audit);result.checks.push("case18_independent_accounts_ledger_audit_receipt_B_isolation_86_functions_RLS");result.status="passed";
}catch{result.status="failed";process.exitCode=1;}finally{await db.close();writeEvidence(`docs/deployment/evidence/phase3-terminal-acceptance-${old.run}.json`,result);console.log(JSON.stringify(result));}
