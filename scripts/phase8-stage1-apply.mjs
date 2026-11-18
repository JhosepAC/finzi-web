import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { cpuCounters } from "./telegram-cpu-guard.ts";
import { advanceCpuGate } from "./phase7-s1-backpressure.mjs";
import assert from "node:assert/strict";

const ref="mkzclztzyqdmftesnwcw",out="docs/deployment/evidence/phase8-stage1";
assert.equal(spawnSync("git",["branch","--show-current"],{encoding:"utf8"}).stdout.trim(),"deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json","utf8")).status,"paused");
assert.equal(JSON.parse(readFileSync(`${out}/preflight.json`,"utf8")).status,"passed_readonly");
assert(!existsSync(".staging-migrations/phase8-stage1/apply.consumed"),"APPROVAL_ALREADY_CONSUMED");
writeFileSync(".staging-migrations/phase8-stage1/apply.consumed","explicit_stage1_only_37_38",{flag:"wx"});
process.loadEnvFile(".env.supabase-staging.local");assert.equal(process.env.SUPABASE_PROJECT_REF,ref);
const cli=createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
const state={project:ref,phase:"cpu_before_37",status:"running",applied:[],metricSamples:0,observations:[],gate:{paused:false,consecutive:2}};
const save=()=>writeFileSync(`${out}/application.json`,JSON.stringify(state,null,2));
function command(args){
 const r=spawnSync(process.execPath,[cli,...args],{encoding:"utf8",timeout:65000,maxBuffer:4*1024*1024,windowsHide:true});
 if(r.status!==0){const text=r.stdout+"\n"+r.stderr;const code=text.match(/(?:SQLSTATE\s*[:=]?\s*|"code"\s*:\s*")([A-Z0-9]{5})/)?.[1];throw Object.assign(new Error("MIGRATION_COMMAND_FAILED"),{code:code??"CLI_FAILED"});}
 return r.stdout;
}
function history(){return JSON.parse(command(["db","query",`--remote=${ref}`,"--read-only","--output-format","json","select version from supabase_migrations.schema_migrations order by version"])).rows.map(r=>r.version);}
async function sample(){if(state.metricSamples>=14)throw new Error("CPU_BUDGET");state.metricSamples++;save();const r=await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`,{headers:{Authorization:"Basic "+Buffer.from("service_role:"+process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64")},signal:AbortSignal.timeout(15000),redirect:"error"});if(!r.ok)throw new Error("METRICS_UNAVAILABLE");return {...cpuCounters(await r.text()),at:Date.now(),calls:0,reset:"phase8_apply",unsafe:false};}
let before;
async function checkpoint(){
 do{await new Promise(resolve=>setTimeout(resolve,Math.max(0,61000-(Date.now()-before.at))));const after=await sample(),item={before,after,outcome:null};state.observations.push(item);save();item.outcome=advanceCpuGate(state.gate,before,after,0);before=after;save();console.log(JSON.stringify({phase:state.phase,...item.outcome,paused:state.gate.paused}));}while(state.gate.paused);
}
try{
 before=await sample();await checkpoint();
 for(const [n,version]of [[37,"20261117000100"],[38,"20261117000200"]]){
  state.phase=`apply_${n}`;save();assert.equal(history().length,n-1);
  command(["db","push",`--remote=${ref}`,"--skip-vault","--yes","--workdir",`.staging-migrations/phase8-stage1/migrate${n}`]);
  const versions=history();assert.equal(versions.length,n);assert.equal(versions.at(-1),version);state.applied.push({version,verified:true});save();console.log(JSON.stringify({phase:state.phase,applied:version,verified:true}));
  state.phase=`cpu_after_${n}`;save();await checkpoint();
 }
 state.status="migrations_applied_verification_pending";save();console.log(JSON.stringify({status:state.status,applied:state.applied}));
}catch(e){state.status="stopped";state.code=/^[A-Z0-9_]+$/.test(e.code??"")?e.code:/^[A-Z0-9_]+$/.test(e.message??"")?e.message:"APPLICATION_FAILED";save();console.log(JSON.stringify({status:state.status,phase:state.phase,code:state.code,applied:state.applied}));process.exitCode=1;}
