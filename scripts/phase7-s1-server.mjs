import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { cpuCounters, checkWindow } from "./telegram-cpu-guard.ts";
import { authorizeRequest, upstream, origin } from "./phase7-s1-policy.mjs";

const { run } = JSON.parse(readFileSync(".staging-migrations/phase7-s1/current.json", "utf8"));
assert(/^[a-f0-9-]{36}$/.test(run));
const privatePath = `.staging-migrations/phase7-s1/${run}`, publicPath = `docs/deployment/evidence/phase7/${run}`;
const permit = JSON.parse(readFileSync(`${privatePath}/private.json`, "utf8"));
const preflight = JSON.parse(readFileSync(`${publicPath}/preflight.json`, "utf8"));
assert.equal(permit.configurationApproved, true);
assert.equal(preflight.identityAbsent, true);
assert.equal(preflight.status, "readonly_preflight_complete_config_review_required");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
assert.equal(spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(), "deployment/staging");
assert.throws(() => readFileSync(`${privatePath}/server.consumed`));
writeFileSync(`${privatePath}/server.consumed`, "consumed", { flag: "wx" });
process.loadEnvFile(".env.supabase-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF, "mkzclztzyqdmftesnwcw");
const require = createRequire(import.meta.url), cli = require.resolve("supabase/dist/supabase.js");
const guard = randomBytes(32).toString("hex"), password = randomBytes(24).toString("base64url");
writeFileSync(`${privatePath}/control.private.json`, JSON.stringify({ guard, password }), { mode: 0o600 });
const state = { run, status: "starting", phase: "pre_send", stopped: false, deadline: preflight.observations[0].first.at + 35 * 60000,
  authRequests: 1, emailsReserved: 0, metricSamples: preflight.metricSamples, diagnosticQueries: preflight.diagnosticQueries,
  observations: [], requests: [], pages: [], identityVerified: false, recoveryVerified: false, cookieVerified: false };
let next, inFlight = 0, baseline, sampling = false, timer, finishing = false;
const memory = { subject: null };
function save() { writeFileSync(`${publicPath}/runtime.json`, JSON.stringify(state, null, 2), { mode: 0o600 }); }
function finish() {
  if (finishing || inFlight > 0) return;
  finishing = true; clearInterval(timer);
  if (next?.pid) spawnSync("taskkill", ["/PID", String(next.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  const rollback = spawnSync(process.execPath, [cli, "config", "push", "--remote=mkzclztzyqdmftesnwcw", "--workdir", `${privatePath}/config-rollback`, "--yes", "--output-format", "json"], { encoding: "utf8", timeout: 30000 });
  state.configurationRestoration = rollback.status === 0 ? "cli_success_not_read_back" : "requires_review_no_retry"; save();
  server.close();
}
function stop(code) { if (!state.stopped) { state.stopped = true; state.status = "stopped"; state.reason = code; save(); console.log(JSON.stringify({ status: "stopped", code, emailsReserved: state.emailsReserved })); setTimeout(finish, 100); } }
function diagnostic() {
  if (state.diagnosticQueries >= 12) throw new Error("DIAGNOSTICS_BUDGET"); state.diagnosticQueries++; save();
  const sql = "select (select coalesce(sum(calls),0) from extensions.pg_stat_statements where queryid=5360251647081715348) as calls,(select stats_reset::text from extensions.pg_stat_statements_info) as reset,exists(select 1 from pg_stat_activity where usename='authenticator' and state not in ('idle','disabled') and clock_timestamp()-query_start>interval '15 seconds') as unsafe";
  const r = spawnSync(process.execPath, [cli, "db", "query", "--remote=mkzclztzyqdmftesnwcw", "--read-only", "--output-format", "json", sql], { encoding: "utf8", timeout: 15000 });
  if (r.status !== 0) throw new Error("DIAGNOSTICS_UNAVAILABLE");
  const data = JSON.parse(r.stdout).rows[0];
  if (!data || !Number.isFinite(Number(data.calls)) || typeof data.reset !== "string" || typeof data.unsafe !== "boolean") throw new Error("DIAGNOSTICS_INVALID");
  return data;
}
async function sample() {
  if (state.metricSamples >= 8) throw new Error("METRICS_BUDGET"); state.metricSamples++; save();
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
    if (baseline && after.at - baseline.at >= 60000) {
      const expected = state.requests.filter(r => r.path.startsWith("/rest/")).length - (baseline.restCalls ?? 0);
      const item = { before: baseline, after, percent: null }; state.observations.push(item); save();
      item.percent = checkWindow(baseline, after, Math.max(0, expected));
      console.log(JSON.stringify({ event: "cpu_window", percent: item.percent }));
      if (state.phase === "pre_send") { state.status = "ready"; state.phase = "ready_registration"; }
    }
    baseline = { ...after, restCalls: state.requests.filter(r => r.path.startsWith("/rest/")).length };
    save();
  } catch (e) { stop(/^[A-Z_]+$/.test(e.code ?? "") ? e.code : /^[A-Z_]+$/.test(e.message ?? "") ? e.message : "CPU_CHECKPOINT_FAILED"); }
  finally { sampling = false; }
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 32768) throw new Error("BODY_LIMIT"); chunks.push(part); }
  return Buffer.concat(chunks);
}
function reply(res, status, data) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(data)); }
const server = createServer(async (req, res) => {
  if (req.headers["x-finzi-s1-guard"] !== guard) return reply(res, 403, { code: "FORBIDDEN" });
  const url = new URL(req.url, "http://127.0.0.1:3031");
  try {
    if (url.pathname === "/status") return reply(res, 200, state);
    if (url.pathname === "/observe") {
      const p = JSON.parse((await body(req)).toString());
      state.pages.push({ path: p.path, status: p.status, method: p.method, sessionCookiePresent: p.sessionCookiePresent === true, sessionCookieSet: p.sessionCookieSet === true, httpOnly: p.httpOnly === true, sameSiteLax: p.sameSiteLax === true });
      if (p.sessionCookieSet && p.httpOnly && p.sameSiteLax) state.cookieVerified = true;
      if (p.path === "/api/v1/auth/reset-password" && p.status === 200 && state.passwordChanged && state.recoveryVerified) state.phase = "recovery_review";
      save(); return reply(res, 200, { ok: true });
    }
    if (url.pathname === "/register" && req.method === "POST") {
      if (state.phase !== "ready_registration" || state.stopped) return reply(res, 409, { code: "NOT_READY" });
      const r = await fetch(origin + "/api/v1/auth/register", { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ email: permit.recipient, password, confirmPassword: password }), signal: AbortSignal.timeout(20000), redirect: "error" });
      const result = await r.json();
      if (r.status !== 202 || result.ok !== true || !memory.subject) throw new Error("REGISTRATION_UNCONFIRMED");
      state.phase = "waiting_confirmation"; state.status = "waiting_user"; save();
      return reply(res, 200, { status: state.status, phase: state.phase, emailsReserved: state.emailsReserved });
    }
    if (url.pathname === "/recover" && req.method === "POST") {
      const currentPermit = JSON.parse(readFileSync(`${privatePath}/private.json`, "utf8"));
      if (currentPermit.confirmationUserApproved !== true || !state.identityVerified || !state.cookieVerified || state.phase !== "waiting_confirmation" || state.stopped) return reply(res, 409, { code: "USER_CONFIRMATION_REQUIRED" });
      state.phase = "ready_recovery"; save();
      const r = await fetch(origin + "/api/v1/auth/forgot-password", { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ email: permit.recipient }), signal: AbortSignal.timeout(20000), redirect: "error" });
      const result = await r.json();
      if (r.status !== 202 || result.ok !== true) throw new Error("RECOVERY_UNCONFIRMED");
      state.phase = "waiting_recovery"; state.status = "waiting_user"; save();
      return reply(res, 200, { phase: state.phase, emailsReserved: state.emailsReserved });
    }
    if (url.pathname === "/finish" && req.method === "POST") { state.status = "completed_user_review_required"; save(); stop("AUTHORIZED_CLOSE"); return reply(res, 200, { closing: true }); }
    if (!url.pathname.startsWith("/upstream/")) return reply(res, 404, {});
    const path = url.pathname.slice("/upstream".length), raw = await body(req), parsed = raw.length ? JSON.parse(raw.toString()) : {};
    if (req.headers.apikey !== process.env.SUPABASE_STAGING_ANON_KEY) throw new Error("WRONG_CLIENT_KEY");
    authorizeRequest(state, permit.recipient, req.method, path, url.search, parsed); save();
    inFlight++;
    try {
      const headers = new Headers();
      for (const h of ["apikey", "authorization", "content-type", "x-client-info", "x-supabase-api-version", "accept-profile", "content-profile"]) if (req.headers[h]) headers.set(h, req.headers[h]);
      const upstreamResponse = await fetch(upstream + path + url.search, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : raw, signal: AbortSignal.timeout(10000), redirect: "error" });
      const bytes = await upstreamResponse.arrayBuffer(); let data;
      try { data = JSON.parse(Buffer.from(bytes).toString()); } catch { data = null; }
      state.requests.push({ path, method: req.method, status: upstreamResponse.status });
      if (path === "/auth/v1/signup" && upstreamResponse.ok) {
        const user = data?.user ?? data;
        if (!/^[a-f0-9-]{36}$/.test(user?.id ?? "") || user.email !== permit.recipient || user.email_confirmed_at || !user.identities?.length) throw new Error("SIGNUP_IDENTITY_INVALID");
        memory.subject = user.id; state.subjectCreated = true;
        writeFileSync(`${privatePath}/subject.private.json`, JSON.stringify({ id: user.id }), { mode: 0o600 });
      }
      if ((path === "/auth/v1/user" || path === "/auth/v1/verify") && upstreamResponse.ok && data) {
        const user = data.user ?? data;
        if (user.id && (user.id !== memory.subject || user.email !== permit.recipient)) throw new Error("IDENTITY_MISMATCH");
        if (user.id && user.email_confirmed_at) state.identityVerified = true;
        if (path === "/auth/v1/verify" && parsed.type === "recovery") state.recoveryVerified = true;
      }
      if (upstreamResponse.status >= 400) stop("UPSTREAM_HTTP_" + upstreamResponse.status);
      if (path === "/auth/v1/user" && req.method === "PUT" && parsed.password && upstreamResponse.ok) state.passwordChanged = true;
      save(); res.writeHead(upstreamResponse.status, { "content-type": upstreamResponse.headers.get("content-type") ?? "application/json", "cache-control": "no-store" }); res.end(Buffer.from(bytes));
    } finally { inFlight--; if (state.stopped) setTimeout(finish, 100); }
  } catch (e) { stop(/^[A-Z_]+$/.test(e.message ?? "") ? e.message : "PILOT_REQUEST_FAILED"); reply(res, 503, { code: "PILOT_STOPPED" }); }
});
await new Promise(resolve => server.listen(3031, "127.0.0.1", resolve));
next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3030"], {
  windowsHide: true, stdio: ["ignore", "ignore", "ignore"], env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/.test(k))),
    APP_URL: origin, SUPABASE_URL: upstream, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_STAGING_ANON_KEY,
    FINZI_S1_BRIDGE: "http://127.0.0.1:3031", FINZI_S1_GUARD: guard, NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/phase7-s1-preload.mjs")).href}`,
  },
});
state.nextPid = next.pid; save();
next.once("exit", () => stop("NEXT_EXITED"));
await checkpoint();
if (!state.stopped) { state.status = "cpu_warming"; save(); console.log(JSON.stringify({ status: "cpu_warming", run, port: 3030 })); }
timer = setInterval(async () => {
  if (Date.now() > state.deadline) stop("DURATION_BUDGET");
  if (!state.stopped) await checkpoint();
  if (state.stopped && inFlight === 0) finish();
}, 61000);
