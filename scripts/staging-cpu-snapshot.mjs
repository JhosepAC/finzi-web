import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { runSupabase } from "./supabase-cli.mjs";
const ref="mkzclztzyqdmftesnwcw",label=process.argv[2];
assert(/^[a-z0-9-]{1,32}$/.test(label??""));
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
process.loadEnvFile(".env.supabase-staging.local");assert.equal(process.env.SUPABASE_PROJECT_REF,ref);
const out={project:ref,at:new Date().toISOString(),label};
for(const [key,file] of [["activity","infrastructure/supabase/cpu-activity.sql"],["statements","infrastructure/supabase/cpu-statements.sql"]]) {
 try { out[key]=JSON.parse(runSupabase(["db","query",`--remote=${ref}`,"--read-only","--file",file,"--output-format","json"])).rows; }
 catch { throw new Error("Read-only diagnostic failed; raw output suppressed"); }
}
try {
 // This key is used ONLY for the read-only operational Metrics API, never financial requests.
 const response=await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`,{headers:{Authorization:"Basic "+Buffer.from("service_role:"+process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64")},signal:AbortSignal.timeout(20000)});
 if(!response.ok)out.metricsStatus=response.status;
 else {
  const text=await response.text();const allowed=["node_cpu_seconds_total","process_cpu_seconds_total","node_load1","node_load5","node_load15"];
  out.metrics=text.split("\n").filter(line=>allowed.some(name=>line.startsWith(name+"{")||line.startsWith(name+" ")));
  out.metricsAt=new Date().toISOString();
 }
} catch {out.metricsStatus="timeout_or_unavailable";}
writeFileSync(`docs/deployment/evidence/cpu-${label}.json`,JSON.stringify(out,null,2));
const setup=out.statements[0].highest_total_time.find(q=>q.queryid==="5360251647081715348");
console.log(JSON.stringify({at:out.at,metricsAt:out.metricsAt,activity:out.activity.map(a=>({pid:a.pid,state:a.state,operation:a.operation})),setupCalls:setup?.calls,setupTotalMs:setup?.total_exec_time,metricsStatus:out.metrics?"captured":out.metricsStatus}));
