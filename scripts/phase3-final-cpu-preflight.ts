import assert from "node:assert/strict";
import { spawnSync,execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { collectSample,createCheckpoint,type Observation } from "./telegram-cpu-checkpoint.ts";
import { providerOutput,diagnosticRows,safeFailure,writeEvidence } from "./telegram-control-observability.ts";
const ref="mkzclztzyqdmftesnwcw";
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json","utf8")).status,"paused");
process.loadEnvFile(".env.supabase-staging.local");assert.equal(process.env.SUPABASE_PROJECT_REF,ref);
const cli=createRequire(import.meta.url).resolve("supabase/dist/supabase.js"),observations:Observation[]=[];
const file=`docs/deployment/evidence/phase3-final-cpu-preflight-${Date.now()}.json`;
const save=()=>writeEvidence(file,{ref,scope:"read_only_cpu_no_financial_operations",observations});
const checkpoint=createCheckpoint({sample:()=>collectSample({fetchMetrics:()=>fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`,{headers:{Authorization:"Basic "+Buffer.from("service_role:"+process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64")},signal:AbortSignal.timeout(15000)}),diagnostics:()=>{
 const result=spawnSync(process.execPath,[cli,"db","query",`--remote=${ref}`,"--read-only","--output-format","json","select (select coalesce(sum(calls),0) from extensions.pg_stat_statements where queryid=5360251647081715348) as calls,(select stats_reset::text from extensions.pg_stat_statements_info) as reset,exists(select 1 from pg_stat_activity where usename='authenticator' and state not in ('idle','disabled')) as unsafe"],{encoding:"utf8",timeout:20000});
 return diagnosticRows(providerOutput({...result,error:result.error as {code?:unknown}|undefined}))[0];
 },now:Date.now,progress:(stage,metrics)=>{observations.push({stage,metrics,status:"progress",at:Date.now()});save();}}),rpc:()=>0,now:Date.now,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),budget:()=>{},emit:o=>{observations.push(o);save();if(o.status!=="progress")console.log(JSON.stringify(o));}});
try{await checkpoint();await checkpoint();console.log("Two read-only CPU windows passed; no financial operations.");}catch(error){console.log(JSON.stringify(safeFailure(error,"sample.validate")));process.exitCode=1;}
