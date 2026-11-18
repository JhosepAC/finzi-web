import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { cpuCounters } from "./telegram-cpu-guard.ts";
import { advanceCpuGate } from "./phase7-s1-backpressure.mjs";

const ref="mkzclztzyqdmftesnwcw",out="docs/deployment/evidence/phase8-stage1";
assert.equal(spawnSync("git",["branch","--show-current"],{encoding:"utf8"}).stdout.trim(),"deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json","utf8")).status,"paused");
process.loadEnvFile(".env.supabase-staging.local");assert.equal(process.env.SUPABASE_PROJECT_REF,ref);
mkdirSync(out,{recursive:true});
const state={status:"running",phase:"preflight",project:ref,mutations:0,metricSamples:0,observations:[],cpuGate:{paused:true,consecutive:0}};
const save=()=>writeFileSync(`${out}/preflight.json`,JSON.stringify(state,null,2));
const cli=createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function query(sql){const r=spawnSync(process.execPath,[cli,"db","query",`--remote=${ref}`,"--read-only","--output-format","json",sql],{encoding:"utf8",timeout:20000,windowsHide:true});if(r.status!==0)throw new Error("READONLY_PREFLIGHT_FAILED");return JSON.parse(r.stdout).rows;}
async function sample(){state.metricSamples++;save();const r=await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`,{headers:{Authorization:"Basic "+Buffer.from("service_role:"+process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64")},signal:AbortSignal.timeout(15000),redirect:"error"});if(!r.ok)throw new Error("METRICS_UNAVAILABLE");return {...cpuCounters(await r.text()),at:Date.now(),calls:0,reset:"phase8_metrics",unsafe:false};}
try{
 for(const manifest of ["deletion-worker-migration","deletion-auth-flow-migration"]){for(const item of JSON.parse(readFileSync(`infrastructure/supabase/${manifest}.manifest.json`,"utf8"))){const hash=createHash("sha256").update(readFileSync(item.file,"utf8").replaceAll("\r\n","\n")).digest("hex");assert.equal(hash,item.sha256_lf,"APPROVED_SOURCE_CHANGED");}}
 let before=await sample();
 const metadata=query("select (select json_agg(version order by version) from supabase_migrations.schema_migrations) as versions,(select json_agg(json_build_object('role',rolname,'super',rolsuper,'create_role',rolcreaterole,'bypass',rolbypassrls)) from pg_roles where rolname in('postgres','finzi_deletion_worker','finzi_deletion_gateway')) as roles,(select coalesce(json_agg(json_build_object('member',mbr.rolname,'role',r.rolname,'admin',m.admin_option)),'[]') from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles mbr on mbr.oid=m.member where mbr.rolname='postgres' and r.rolname in('finzi_deletion_worker','app_executor')) as ddl_memberships")[0];
 writeFileSync(`${out}/migration-operator.json`,JSON.stringify(metadata,null,2));console.log(JSON.stringify({event:"metadata",...metadata}));
 assert.equal(metadata.versions.length,36,"REMOTE_HISTORY_REVIEW_REQUIRED");
 for(let n=0;n<10&&state.cpuGate.paused;n++){
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,61000-(Date.now()-before.at))));
  const after=await sample(),observation={before,after,outcome:null};state.observations.push(observation);save();
  observation.outcome=advanceCpuGate(state.cpuGate,before,after,0);before=after;save();console.log(JSON.stringify({event:"cpu_window",...observation.outcome,gate:state.cpuGate}));
 }
 if(state.cpuGate.paused)throw new Error("CPU_NOT_READY_WITHIN_BUDGET");
 state.status="passed_readonly";save();console.log(JSON.stringify({status:state.status,mutations:0}));
}catch(e){state.status="stopped";state.code=/^[A-Z_]+$/.test(e.code??"")?e.code:/^[A-Z_]+$/.test(e.message??"")?e.message:"PREFLIGHT_FAILED";save();console.log(JSON.stringify({status:state.status,code:state.code,mutations:0}));process.exitCode=1;}
