import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { runSupabase } from "./supabase-cli.mjs";
const ref="mkzclztzyqdmftesnwcw",mode=process.argv[2];
assert(["contain","restore"].includes(mode),"Choose contain or restore");
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
process.loadEnvFile(".env.supabase-staging.local");assert.equal(process.env.SUPABASE_PROJECT_REF,ref);
try {
 const project=JSON.parse(runSupabase(["projects","list","--output","json"])).find(p=>p.id===ref);
 assert(project?.name==="finzi-staging"&&project.status==="ACTIVE_HEALTHY");
 runSupabase(["db","query",`--remote=${ref}`,"--file",`infrastructure/supabase/cpu-${mode==="contain"?"containment":"restore"}.sql`,"--yes","--output-format","json"]);
 console.log(`Staging-only temporary RPC ACL ${mode} completed. No financial body, row or RLS change.`);
} catch { throw new Error("Containment command stopped; raw provider output suppressed"); }
