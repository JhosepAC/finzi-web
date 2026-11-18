import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { cpuCounters } from "./telegram-cpu-guard.ts";
import { advanceCpuGate, authorizeRecoveryOnly } from "./phase7-s1-backpressure.mjs";
import { authorizeRequest, upstream, origin } from "./phase7-s1-policy.mjs";
import { authOutcome, safeAuthHeaders } from "./phase7-auth-outcome.mjs";

const { run } = JSON.parse(readFileSync(".staging-migrations/phase7-s1/recovery-current.json", "utf8"));
assert(/^[a-f0-9-]{36}$/.test(run));
const privatePath = `.staging-migrations/phase7-s1/${run}`, publicPath = `docs/deployment/evidence/phase7/${run}`;
const permit = JSON.parse(readFileSync(`${privatePath}/private.json`, "utf8"));
const loginOnly = permit.scope === "explicit_S1_login_only_no_email";
const passwordOnly = permit.scope === "explicit_S1_password_only_no_email" || loginOnly;
const freshRecovery = permit.freshRecoveryApproved === true;
if (freshRecovery) { assert.equal(permit.emailLimit, 3); assert.equal(permit.authRequestLimit, 48); }
if (passwordOnly) {
  assert.equal(permit.passwordOnlyApproved, true);
  if (loginOnly) { assert.equal(permit.loginOnlyApproved, true); assert.equal(permit.authRequestLimit, 108); }
  else if (permit.completionApproved) {
    assert.equal(permit.additionalAuthRequests, 60);
    assert.equal(permit.authRequestLimit, permit.startingAuthRequests + 60);
  } else assert.equal(permit.authRequestLimit, 48);
} else {
  assert.equal(permit.scope, "explicit_S1_existing_identity_recovery_only");
  assert.equal(permit.configurationApproved, true);
  assert.equal(JSON.parse(readFileSync(`${publicPath}/restoration-readback-interpreted.json`, "utf8")).status, "original_three_values_verified_restored");
}
assert.equal(permit.confirmationUserApproved, true);
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
assert.equal(spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(), "deployment/staging");
writeFileSync(`${privatePath}/server.consumed`, "consumed", { flag: "wx" });
process.loadEnvFile(".env.supabase-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF, "mkzclztzyqdmftesnwcw");
const require = createRequire(import.meta.url), cli = require.resolve("supabase/dist/supabase.js");
const guard = randomBytes(32).toString("hex");
writeFileSync(`${privatePath}/control.private.json`, JSON.stringify({ guard }), { mode: 0o600 });
const prior = JSON.parse(readFileSync(`docs/deployment/evidence/phase7/${permit.priorRun}/runtime.json`, "utf8"));
if (passwordOnly) {
  assert.equal(prior.recoveryVerified, true); assert.equal(prior.passwordChanged, loginOnly);
  if (loginOnly) {
    assert.equal(prior.globalSignout, true); assert.equal(prior.configurationRestoration, "not_changed");
    assert.equal(prior.authRequests, permit.startingAuthRequests ?? 57);
    assert(prior.stopped || (permit.operatorStopped === true && JSON.parse(readFileSync(`docs/deployment/evidence/phase7/${permit.priorRun}/operator-stop.json`, "utf8")).status === "own_idle_processes_stopped"));
  } else if (permit.completionApproved) {
    assert.equal(prior.configurationRestoration, "three_original_fields_read_back_equal");
    assert.equal(prior.authRequests, permit.startingAuthRequests);
    assert.equal(prior.stopped, true);
  } else { assert.equal(prior.configurationRestoration, "three_original_fields_read_back_equal"); assert.equal(prior.authRequests, 36); assert.equal(prior.emailsReserved, 2); }
}
const state = { run, priorRun: permit.priorRun, status: "cpu_warming", phase: "pre_send", stopped: false, deadline: Date.now() + 35 * 60000,
  authRequests: prior.authRequests, emailsReserved: prior.emailsReserved, registrationReserved: true, metricSamples: 0, diagnosticQueries: 0,
  authRequestLimit: passwordOnly || freshRecovery ? permit.authRequestLimit : 40,
  emailLimit: passwordOnly ? prior.emailsReserved : freshRecovery ? 3 : 2,
  observations: [], requests: [], pages: [], identityVerified: true, recoveryVerified: passwordOnly, cookieVerified: false,
  cpuGate: { paused: true, consecutive: 0 }, configurationApplied: false, passwordChanged: loginOnly, globalSignout: loginOnly };
let next, inFlight = 0, baseline, sampling = false, timer, finishing = false;
function save() { writeFileSync(`${publicPath}/runtime.json`, JSON.stringify(state, null, 2), { mode: 0o600 }); }
function command(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("CONFIGURATION_CLI_FAILED");
  return JSON.parse(r.stdout);
}
function configDiff(name) {
  const diff = command(["config", "diff", "--remote=mkzclztzyqdmftesnwcw", "--workdir", `${privatePath}/${name}`, "--output-format", "json"]);
  return (diff.changes ?? []).filter(c => c.declared === true).map(c => ({ path: Array.isArray(c.path) ? c.path.join(".") : c.path, local: c.local, remote: c.remote }));
}
function applyConfiguration() {
  assert.equal(state.configurationApplied, false);
  const diff = configDiff("config-change");
  assert.equal(diff.length, 2, "EXACT_CALLBACK_DIFF_REQUIRED");
  assert.deepEqual(diff.map(c => c.path).sort(), ["auth.additional_redirect_urls", "auth.site_url"]);
  writeFileSync(`${publicPath}/temporary-configuration.json`, JSON.stringify({ at: new Date().toISOString(), diff, signupRemainsClosed: true }, null, 2));
  // Mark before the request: an ambiguous network failure still requires the authorized restoration.
  state.configurationApplied = true; save();
  command(["config", "push", "--remote=mkzclztzyqdmftesnwcw", "--workdir", `${privatePath}/config-change`, "--yes", "--output-format", "json"]);
  state.configurationApply = "cli_success"; save();
}
function finish() {
  if (finishing || inFlight > 0) return;
  finishing = true; clearInterval(timer);
  if (next?.pid) spawnSync("taskkill", ["/PID", String(next.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  if (state.configurationApplied) {
    try {
      command(["config", "push", "--remote=mkzclztzyqdmftesnwcw", "--workdir", `${privatePath}/config-rollback`, "--yes", "--output-format", "json"]);
      assert.equal(configDiff("config-rollback").length, 0);
      state.configurationRestoration = "three_original_fields_read_back_equal";
    } catch { state.configurationRestoration = "requires_review_no_retry"; }
  } else state.configurationRestoration = "not_changed";
  save(); server.close();
}
function stop(code) {
  if (state.stopped) return;
  state.stopped = true; state.status = "stopped"; state.reason = code; save();
  console.log(JSON.stringify({ status: state.status, code, emailsReserved: state.emailsReserved }));
  setTimeout(finish, 100);
}
function diagnostic() {
  if (state.diagnosticQueries >= 36) throw new Error("DIAGNOSTICS_BUDGET"); state.diagnosticQueries++; save();
  const sql = "select (select coalesce(sum(calls),0) from extensions.pg_stat_statements where queryid=5360251647081715348) as calls,(select stats_reset::text from extensions.pg_stat_statements_info) as reset,exists(select 1 from pg_stat_activity where usename='authenticator' and state not in ('idle','disabled') and clock_timestamp()-query_start>interval '15 seconds') as unsafe";
  const r = spawnSync(process.execPath, [cli, "db", "query", "--remote=mkzclztzyqdmftesnwcw", "--read-only", "--output-format", "json", sql], { encoding: "utf8", timeout: 15000, windowsHide: true });
  if (r.status !== 0) throw new Error("DIAGNOSTICS_UNAVAILABLE");
  const data = JSON.parse(r.stdout).rows[0];
  if (!data || !Number.isFinite(Number(data.calls)) || typeof data.reset !== "string" || typeof data.unsafe !== "boolean") throw new Error("DIAGNOSTICS_INVALID");
  return data;
}
async function sample() {
  if (state.metricSamples >= 36) throw new Error("METRICS_BUDGET"); state.metricSamples++; save();
  const r = await fetch(upstream + "/customer/v1/privileged/metrics", { headers: { Authorization: "Basic " + Buffer.from("service_role:" + process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY).toString("base64") }, signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!r.ok) throw new Error("METRICS_UNAVAILABLE");
  const counters = cpuCounters(await r.text()), row = diagnostic();
  return { ...counters, at: Date.now(), calls: Number(row.calls), reset: row.reset, unsafe: row.unsafe };
}
async function checkpoint() {
  if (sampling || state.stopped) return;
  sampling = true;
  try {
    const after = await sample();
    if (baseline) {
      const expected = state.requests.filter(r => r.path.startsWith("/rest/")).length - baseline.restCalls;
      const observation = { before: baseline, after, outcome: null }; state.observations.push(observation); save();
      observation.outcome = advanceCpuGate(state.cpuGate, baseline, after, Math.max(0, expected));
      state.status = state.cpuGate.paused ? "cpu_paused" : state.phase === "pre_send" ? "ready_recovery" : "waiting_user";
      console.log(JSON.stringify({ event: "cpu_window", ...observation.outcome, paused: state.cpuGate.paused, consecutive: state.cpuGate.consecutive }));
    }
    baseline = { ...after, restCalls: state.requests.filter(r => r.path.startsWith("/rest/")).length }; save();
  } catch (e) { stop(/^[A-Z_]+$/.test(e.code ?? "") ? e.code : /^[A-Z_]+$/.test(e.message ?? "") ? e.message : "CPU_CHECKPOINT_FAILED"); }
  finally { sampling = false; }
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 32768) throw new Error("BODY_LIMIT"); chunks.push(part); }
  return Buffer.concat(chunks);
}
function reply(res, status, data) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(data)); }
function launchNext() {
  assert.equal(next, undefined);
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3030"], {
    windowsHide: true, stdio: ["ignore", "ignore", "ignore"], env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/.test(k))),
      APP_URL: origin, SUPABASE_URL: upstream, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_STAGING_ANON_KEY,
      FINZI_S1_BRIDGE: "http://127.0.0.1:3031", FINZI_S1_GUARD: guard, NEXT_TELEMETRY_DISABLED: "1",
      FINZI_S1_STATE_FILE: resolve(`${publicPath}/runtime.json`),
      NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/phase7-s1-preload.mjs")).href}`,
    },
  });
  state.nextPid = next.pid; save(); next.once("exit", () => stop("NEXT_EXITED"));
}
const server = createServer(async (req, res) => {
  if (req.headers["x-finzi-s1-guard"] !== guard) return reply(res, 403, { code: "FORBIDDEN" });
  const url = new URL(req.url, "http://127.0.0.1:3031");
  try {
    if (url.pathname === "/status") return reply(res, 200, state);
    if (url.pathname === "/observe") {
      const p = JSON.parse((await body(req)).toString());
      state.pages.push({ path: p.path, status: p.status, method: p.method, sessionCookiePresent: p.sessionCookiePresent === true, sessionCookieSet: p.sessionCookieSet === true, httpOnly: p.httpOnly === true, sameSiteLax: p.sameSiteLax === true });
      if (p.sessionCookieSet && p.httpOnly && p.sameSiteLax) state.cookieVerified = true;
      if (p.path === "/api/v1/auth/reset-password" && p.status === 200 && state.passwordChanged && state.recoveryVerified && state.globalSignout) state.phase = "recovery_review";
      if (p.path === "/api/v1/auth/login" && p.status === 200 && state.passwordChanged && state.globalSignout) state.loginVerified = true;
      save(); return reply(res, 200, { ok: true });
    }
    if (url.pathname === "/start" && req.method === "POST") {
      if (state.cpuGate.paused || state.stopped || next) return reply(res, 409, { code: "NOT_READY" });
      if (!passwordOnly) applyConfiguration();
      else { state.phase = loginOnly ? "recovery_review" : "waiting_recovery"; state.recoveryReserved = true; save(); }
      launchNext(); return reply(res, 200, { status: "next_started", port: 3030 });
    }
    if (url.pathname === "/recover" && req.method === "POST") {
      if (passwordOnly) return reply(res, 403, { code: "NO_EMAIL_AUTHORIZED" });
      if (state.cpuGate.paused || state.phase !== "pre_send" || state.stopped || !next || state.recoveryReserved) return reply(res, 409, { code: "NOT_READY" });
      state.phase = "ready_recovery"; save();
      const r = await fetch(origin + "/api/v1/auth/forgot-password", { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ email: permit.recipient }), signal: AbortSignal.timeout(20000), redirect: "error" });
      const result = await r.json();
      if (r.status !== 202 || result.ok !== true || !state.recoveryReserved) throw new Error("RECOVERY_UNCONFIRMED");
      state.phase = "waiting_recovery"; state.status = "waiting_user"; save();
      return reply(res, 200, { phase: state.phase, emailsReserved: state.emailsReserved, run });
    }
    if (url.pathname === "/finish" && req.method === "POST") {
      if (!state.passwordChanged || !state.globalSignout || state.cpuGate.paused || state.phase !== "recovery_review") return reply(res, 409, { code: "CLOSURE_NOT_READY" });
      if (permit.completionApproved && !state.loginVerified) return reply(res, 409, { code: "LOGIN_REVIEW_REQUIRED" });
      stop("AUTHORIZED_CLOSE"); return reply(res, 200, { closing: true });
    }
    if (!url.pathname.startsWith("/upstream/")) return reply(res, 404, {});
    const path = url.pathname.slice("/upstream".length), raw = await body(req), parsed = raw.length ? JSON.parse(raw.toString()) : {};
    if (req.headers.apikey !== process.env.SUPABASE_STAGING_ANON_KEY) throw new Error("WRONG_CLIENT_KEY");
    if (passwordOnly && ["/auth/v1/recover", "/auth/v1/verify"].includes(path)) throw new Error("NO_EMAIL_OR_REPLAY_AUTHORIZED");
    if (loginOnly && req.method === "PUT") throw new Error("NO_PASSWORD_CHANGE_AUTHORIZED");
    try { authorizeRecoveryOnly(state, permit.recipient, req.method, path, url.search, parsed, authorizeRequest); }
    catch (error) {
      if (error.message !== "CPU_PAUSED") {
        state.deniedOperation = { stage: "request.authorize", code: /^[A-Z_]+$/.test(error.message ?? "") ? error.message : "OPERATION_DENIED",
          operation: req.method === "PUT" && path === "/auth/v1/user" ? "password_update" : "other",
          passwordPresent: typeof parsed.password === "string", pkceChallengeNull: parsed.code_challenge === null, pkceMethodNull: parsed.code_challenge_method === null };
        save();
      }
      throw error;
    }
    save();
    if (req.method === "PUT" && path === "/auth/v1/user") {
      if (state.passwordUpdateAttempted) throw new Error("PASSWORD_UPDATE_ALREADY_ATTEMPTED");
      state.passwordUpdateAttempted = true; save();
    }
    inFlight++;
    try {
      const headers = new Headers();
      for (const h of ["apikey", "authorization", "content-type", "x-client-info", "x-supabase-api-version", "accept-profile", "content-profile"]) if (req.headers[h]) headers.set(h, req.headers[h]);
      const upstreamResponse = await fetch(upstream + path + url.search, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : raw, signal: AbortSignal.timeout(10000), redirect: "error" });
      const bytes = await upstreamResponse.arrayBuffer(); let data;
      try { data = JSON.parse(Buffer.from(bytes).toString()); } catch { data = null; }
      const outcome = authOutcome(req.method, path, url.search, upstreamResponse.status, data);
      state.requests.push({ path, method: req.method, status: upstreamResponse.status, code: outcome.code });
      if ((path === "/auth/v1/user" || path === "/auth/v1/verify") && upstreamResponse.ok && data) {
        const user = data.user ?? data;
        if (user.id && (user.id !== permit.subject || user.email !== permit.recipient || !user.email_confirmed_at)) throw new Error("IDENTITY_MISMATCH");
        if (path === "/auth/v1/verify" && parsed.type === "recovery") {
          if (!user.id) throw new Error("RECOVERY_IDENTITY_MISSING");
          state.recoveryVerified = true;
        }
      }
      if (outcome.terminal) stop("UPSTREAM_HTTP_" + upstreamResponse.status);
      if (path === "/auth/v1/user" && req.method === "PUT" && parsed.password && upstreamResponse.ok) state.passwordChanged = true;
      if (path === "/auth/v1/logout" && new URLSearchParams(url.search).get("scope") === "global" && upstreamResponse.ok) state.globalSignout = true;
      save(); res.writeHead(upstreamResponse.status, safeAuthHeaders(upstreamResponse.headers)); res.end(Buffer.from(bytes));
    } finally { inFlight--; if (state.stopped) setTimeout(finish, 100); }
  } catch (e) {
    if (e.message === "CPU_PAUSED") return reply(res, 503, { code: "CPU_PAUSED" });
    stop(/^[A-Z_]+$/.test(e.message ?? "") ? e.message : "PILOT_REQUEST_FAILED"); reply(res, 503, { code: "PILOT_STOPPED" });
  }
});
await new Promise(resolve => server.listen(3031, "127.0.0.1", resolve));
await checkpoint();
timer = setInterval(async () => {
  if (Date.now() > state.deadline) stop("DURATION_BUDGET");
  if (!state.stopped) await checkpoint();
  if (state.stopped && inFlight === 0) finish();
}, 61000);
console.log(JSON.stringify({ status: state.status, run, recoveryOnly: true }));
