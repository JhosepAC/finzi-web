import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { cpuCounters, checkWindow } from "./telegram-cpu-guard.ts";

const ref = "mkzclztzyqdmftesnwcw";
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
const { run } = JSON.parse(readFileSync(".staging-migrations/phase7-s1/current.json", "utf8"));
assert(/^[a-f0-9-]{36}$/.test(run));
const privatePath = `.staging-migrations/phase7-s1/${run}`;
const permit = JSON.parse(readFileSync(`${privatePath}/private.json`, "utf8"));
assert.equal(permit.run, run);
assert.equal(permit.scope, "one_explicit_S1_two_emails_zero_finance");
assert(/^[a-z0-9.]+@gmail\.com$/.test(permit.recipient));
const evidencePath = `docs/deployment/evidence/phase7/${run}`;
mkdirSync(evidencePath, { recursive: true });
assert.throws(() => readFileSync(`${privatePath}/preflight.consumed`));
writeFileSync(`${privatePath}/preflight.consumed`, "consumed", { flag: "wx" });
process.loadEnvFile(".env.supabase-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF, ref);
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
const evidence = { run, ref, scope: "S1_readonly_preflight", status: "running", stage: "initial", authEmails: 0, authRequests: 0, configReads: 0, diagnosticQueries: 0, metricSamples: 0, observations: [] };
const save = () => writeFileSync(`${evidencePath}/preflight.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 });
function command(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("CLI_READ_FAILED");
  try { return JSON.parse(result.stdout); } catch { throw new Error("CLI_READ_INVALID"); }
}
async function metrics() {
  if (++evidence.metricSamples > 8) throw new Error("METRICS_BUDGET"); save();
  const r = await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`, { headers: { Authorization: "Basic " + Buffer.from("service_role:" + process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64") }, signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!r.ok) throw new Error("METRICS_UNAVAILABLE");
  return { ...cpuCounters(await r.text()), at: Date.now() };
}
try {
  evidence.stage = "metrics.before"; save(); const first = await metrics();
  evidence.stage = "config.read"; evidence.configReads++; save();
  const config = command(["config", "diff", `--remote=${ref}`, "--workdir", "infrastructure/supabase", "--output-format", "json"]);
  const allowed = new Set(["auth.site_url", "auth.additional_redirect_urls", "auth.email.smtp.enabled", "auth.email.smtp.host", "auth.email.smtp.port", "auth.email.smtp.sender_name", "auth.rate_limit.email_sent"]);
  const safeConfig = { changes: (config.changes ?? []).filter(c => allowed.has(Array.isArray(c.path) ? c.path.join(".") : c.path)) };
  writeFileSync(`${privatePath}/config.private.json`, JSON.stringify(safeConfig), { mode: 0o600 });
  evidence.configShape = { keys: Object.keys(config), changes: (config.changes ?? []).map(c => ({ fields: Object.keys(c), key: c.key ?? c.path ?? c.name, declared: c.declared })) };
  evidence.stage = "identity.read"; evidence.diagnosticQueries++; save();
  const literal = permit.recipient.replaceAll("'", "''");
  const sql = `select (select count(*) from auth.users where lower(email)=lower('${literal}')) as recipient_users,(select coalesce(sum(calls),0) from extensions.pg_stat_statements where queryid=5360251647081715348) as calls,(select stats_reset::text from extensions.pg_stat_statements_info) as reset,exists(select 1 from pg_stat_activity where usename='authenticator' and state not in ('idle','disabled')) as unsafe`;
  const row = command(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", sql]).rows[0];
  evidence.identityAbsent = Number(row.recipient_users) === 0;
  if (!evidence.identityAbsent) throw new Error("RECIPIENT_ALREADY_REGISTERED");
  evidence.stage = "cpu.window"; save();
  // Yielded shell session permits progress updates; never an unlimited retry.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 61000 - (Date.now() - first.at))));
  const second = await metrics();
  evidence.diagnosticQueries++; save();
  const end = command(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", "select (select coalesce(sum(calls),0) from extensions.pg_stat_statements where queryid=5360251647081715348) as calls,(select stats_reset::text from extensions.pg_stat_statements_info) as reset,exists(select 1 from pg_stat_activity where usename='authenticator' and state not in ('idle','disabled')) as unsafe"]).rows[0];
  const sample = (m, d) => ({ ...m, calls: Number(d.calls), reset: d.reset, unsafe: d.unsafe });
  const observation = { first, second, percent: null }; evidence.observations.push(observation); save();
  const percent = checkWindow(sample(first, row), sample(second, end), 0); observation.percent = percent;
  evidence.status = "readonly_preflight_complete_config_review_required"; evidence.stage = "review"; save();
  console.log(JSON.stringify({ run, status: evidence.status, identityAbsent: true, cpuPercent: percent, configShape: evidence.configShape, emailsSent: 0 }));
} catch (error) {
  const known = ["CLI_READ_FAILED", "CLI_READ_INVALID", "METRICS_BUDGET", "METRICS_UNAVAILABLE", "RECIPIENT_ALREADY_REGISTERED"];
  const code = known.includes(error?.message) ? error.message : /^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "PREFLIGHT_FAILED";
  evidence.status = "stopped"; evidence.code = code; save();
  console.log(JSON.stringify({ run, status: "stopped", stage: evidence.stage, code, emailsSent: 0 })); process.exitCode = 1;
}
