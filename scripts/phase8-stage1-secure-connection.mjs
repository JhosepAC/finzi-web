import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { cpuCounters } from "./telegram-cpu-guard.ts";
import { advanceCpuGate } from "./phase7-s1-backpressure.mjs";
import { connectDatabase } from "../deletion-worker/database.ts";

const ref = "mkzclztzyqdmftesnwcw", out = "docs/deployment/evidence/phase8-stage1";
assert.equal(spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(), "deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
assert.equal(JSON.parse(readFileSync(`${out}/custody.json`, "utf8")).passwordApplied, true);
process.loadEnvFile(".env.supabase-staging.local"); assert.equal(process.env.SUPABASE_PROJECT_REF, ref);
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
const state = { project: ref, status: "running", phase: "before_ssl", updateIssued: false, observations: [], metricSamples: 0, tlsVerified: false };
const save = () => writeFileSync(`${out}/ssl-hardening.json`, JSON.stringify(state, null, 2));
function command(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 65000, windowsHide: true });
  if (r.status !== 0) throw new Error("SSL_COMMAND_FAILED");
  return JSON.parse(r.stdout);
}
async function sample() {
  if (++state.metricSamples > 24) throw new Error("CPU_OBSERVATION_BUDGET");
  save();
  const response = await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`, { headers: { Authorization: "Basic " + Buffer.from("service_role:" + process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64") }, signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw new Error("CPU_METRICS_UNAVAILABLE");
  return { ...cpuCounters(await response.text()), at: Date.now(), calls: 0, reset: state.phase, unsafe: false };
}
async function healthyWindows() {
  let before = await sample(); const gate = { paused: true, consecutive: 0 };
  for (let n = 0; n < 10 && gate.paused; n++) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 61000 - (Date.now() - before.at))));
    const after = await sample(), item = { phase: state.phase, before, after, outcome: null };
    state.observations.push(item); save(); item.outcome = advanceCpuGate(gate, before, after, 0); before = after; save();
    console.log(JSON.stringify({ phase: state.phase, ...item.outcome, paused: gate.paused }));
  }
  if (gate.paused) throw new Error("CPU_NOT_HEALTHY");
}
try {
  state.before = command(["ssl-enforcement", "get", `--remote=${ref}`, "--experimental", "--output-format", "json"]); save();
  assert.equal(state.before.target.project_ref, ref); assert.equal(state.before.currentConfig.database, false);
  await healthyWindows();
  state.phase = "ensure_quiescent"; save();
  const [activity] = command(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", "select count(*)::integer as active_transactions from pg_stat_activity where pid<>pg_backend_pid() and backend_type='client backend' and xact_start is not null"]).rows;
  state.activeTransactions = activity.active_transactions; save(); assert.equal(activity.active_transactions, 0);
  state.phase = "enable_ssl"; state.updateIssued = true; save();
  state.update = command(["ssl-enforcement", "update", `--remote=${ref}`, "--enable-db-ssl-enforcement", "--experimental", "--yes", "--output-format", "json"]); save();
  state.phase = "restart_settle"; save(); await new Promise(resolve => setTimeout(resolve, 45000));
  state.after = command(["ssl-enforcement", "get", `--remote=${ref}`, "--experimental", "--output-format", "json"]); save();
  assert.equal(state.after.currentConfig.database, true); assert.equal(state.after.appliedSuccessfully, true);
  state.phase = "after_ssl"; save(); await healthyWindows();
  state.phase = "verify_tls_identity"; save();
  const settings = parseEnv(readFileSync(".env.deletion-worker-staging.local", "utf8"));
  const database = await connectDatabase(settings.DELETION_DATABASE_URL); await database.close();
  state.tlsVerified = true; state.status = "ready_disabled"; save(); console.log(JSON.stringify({ status: state.status, tlsVerified: true }));
} catch (error) {
  state.status = "stopped"; state.code = error instanceof assert.AssertionError ? "SSL_ASSERTION_FAILED" : /^[A-Z_]+$/.test(error.message ?? "") ? error.message : "SSL_VERIFICATION_FAILED";
  save(); console.log(JSON.stringify({ status: state.status, phase: state.phase, code: state.code, updateIssued: state.updateIssued })); process.exitCode = 1;
}
