// Deliberately limited enrollment diagnostic, never a financial or polling runner.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { receiver } from "../telegram-webhook/worker.ts";
import { openDatabase, type Database } from "../telegram-webhook/database.ts";
import { runBatch, checkEnvironment, type Environment, type Sender } from "../telegram-webhook/processor.ts";
import { hash } from "../telegram-bot/bot.ts";

const ref = "mkzclztzyqdmftesnwcw", botId = "970000003", scope = "single-telegram-enrollment-control";
const approvalPath = ".staging-migrations/telegram-enrollment-approval.json";
const reportPath = "docs/deployment/evidence/phase3-enrollment-control.json";
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "deployment/staging");
const gate = JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8"));
assert.equal(gate.project_ref, ref); assert.equal(gate.status, "paused");
assert(["plan", "run"].includes(process.argv[2]));
if (process.argv[2] === "plan") {
  console.log(JSON.stringify({ ref, scope, gate: "paused", requiresFreshExplicitApproval: true, approvalPresent: existsSync(approvalPath), maxSyntheticUsers: 2, maxUpdates: 2, maxProcessAndDeliveryCalls: 4, movements: 0, realTelegramRequests: 0 }));
  process.exit(0);
}
const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
assert.equal(approval.status, "approved"); assert.equal(approval.project_ref, ref); assert.equal(approval.scope, scope);
assert(/^[a-f0-9-]{36}$/.test(approval.run_id));
const age = Date.now() - Date.parse(approval.approved_at); assert(age >= 0 && age < 3600000);
assert(!existsSync(approvalPath + ".consumed")); renameSync(approvalPath, approvalPath + ".consumed");
const report: { project: string; run: string; at: string; gate: string; status: string; checks: string[]; operations: { operation: string; code: string }[]; replies: string[]; financialRequests: number; realTelegramRequests: number } = {
  project: ref, run: approval.run_id, at: new Date().toISOString(), gate: "paused", status: "running", checks: [], operations: [], replies: [], financialRequests: 0, realTelegramRequests: 0
};
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function query(statement: string): Record<string, unknown>[] {
  const result = spawnSync(process.execPath, [cli, "db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", statement], { encoding: "utf8", timeout: 20000 });
  if (result.status !== 0) throw new Error("read_only_diagnostic_failed");
  return JSON.parse(result.stdout).rows;
}
function ok<T extends { data: unknown; error: unknown }>(value: T): T["data"] { assert.equal(value.error, null); return value.data; }
const allowedRpc = new Set(["ensure_profile", "configure_profile", "telegram_issue_link", "telegram_activate_link", "telegram_link_status"]);
async function syntheticFetch(input: RequestInfo | URL, init?: RequestInit) {
  const target = new URL(String(input));
  if (target.hostname !== `${ref}.supabase.co`) throw new Error("external_network_blocked");
  if (target.pathname.includes("/rpc/") && !allowedRpc.has(target.pathname.split("/").at(-1)!)) throw new Error("financial_or_unapproved_rpc_blocked");
  return fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(12000), ...(init?.signal ? [init.signal] : [])]) });
}
let db: Database | undefined;
try {
  process.loadEnvFile(".env.supabase-staging.local"); process.loadEnvFile(".env.telegram-webhook-staging.local");
  assert.equal(process.env.SUPABASE_PROJECT_REF, ref); assert.equal(process.env.SUPABASE_URL, `https://${ref}.supabase.co`);
  assert.equal(process.env.TELEGRAM_WEBHOOK_BOT_ID, botId);
  // Make it impossible to send to a real bot even if a Sender regression occurs.
  assert(process.env.TELEGRAM_WEBHOOK_BOT_TOKEN?.endsWith(":synthetic_test_only"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("TELEGRAM_WEBHOOK_"))) as unknown as Environment;
  checkEnvironment(env);
  assert.equal(Number(query("select count(*) as n from supabase_migrations.schema_migrations")[0].n), 36);
  assert.equal(Number(query(`select count(*) as n from telegram_private.transport_events where bot_id='${botId}' and state in ('pending','processing','ready','delivering')`)[0].n), 0);
  db = openDatabase(env.TELEGRAM_WEBHOOK_DATABASE_URL!); await db.check();
  const audited: Database = { ...db, call: async (...args) => {
    assert(["claim", "context"].includes(args[3]), "No draft, query or financial operation allowed");
    try { const value = await db!.call(...args); report.operations.push({ operation: args[3], code: "ok" }); return value; }
    catch (error) { const code = (error as { code?: string }).code; report.operations.push({ operation: args[3], code: code && /^[A-Z0-9]{5}$/.test(code) ? code : "unclassified" }); throw error; }
  } };
  const sender: Sender = async calls => {
    assert.equal(calls.length, 1); assert.equal(calls[0].method, "sendMessage");
    const text = String(calls[0].payload.text);
    report.replies.push(text.includes("Solicitud recibida") ? "claim_received" : text.includes("El enlace venció") ? "claim_rejected" : "other_safe_reply");
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: syntheticFetch } };
  const operator = createClient(`https://${ref}.supabase.co`, process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY!, options).auth.admin;
  const uidList: string[] = []; let sequence = Date.now();
  for (const label of ["a", "b"]) {
    const email = `enrollment-${approval.run_id}-${label}@example.test`, password = randomBytes(24).toString("hex");
    ok(await operator.createUser({ email, password, email_confirm: true }));
    const client = createClient(`https://${ref}.supabase.co`, process.env.SUPABASE_STAGING_ANON_KEY!, { ...options, db: { retry: false } });
    const login = ok(await client.auth.signInWithPassword({ email, password })); assert(login.user); uidList.push(login.user.id);
    const rpc = (name: string, args = {}) => { assert(allowedRpc.has(name)); return client.schema("api").rpc(name, args).retry(false); };
    ok(await rpc("ensure_profile")); ok(await rpc("configure_profile", { p_display_name: "Synthetic enrollment", p_currency: "PEN", p_timezone: "America/Bogota", p_expected_version: 0 }));
    const challenge = randomBytes(32).toString("hex"), attempt = ok(await rpc("telegram_issue_link", { p_challenge_hash: hash(challenge) }));
    const telegramUser = Number(String(Date.now()).slice(-10)) * 10 + (label === "a" ? 1 : 2);
    const update = { update_id: ++sequence, message: { message_id: sequence, date: Math.floor(Date.now() / 1000), from: { id: telegramUser, is_bot: false, first_name: "Synthetic" }, chat: { id: telegramUser, type: "private" }, text: "/start " + challenge, entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
    const request = new Request("https://staging.invalid/telegram/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(update) });
    assert.equal((await receiver()(request, env)).status, 200);
    assert.equal(await runBatch(audited, env, "process", sender), true); assert.equal(await runBatch(audited, env, "deliver", sender), true);
    const facts = query(`select claimed_at is not null as claimed,consumed_at is not null as consumed,expires_at>clock_timestamp() as fresh from telegram_private.link_attempts where id='${attempt.id}' and user_id='${login.user.id}'`)[0];
    save(); assert.equal(report.replies.at(-1), "claim_received"); assert.equal(facts.claimed, true); assert.equal(facts.fresh, true);
    const activated = ok(await rpc("telegram_activate_link", { p_attempt: attempt.id }));
    const status = ok(await rpc("telegram_link_status")); assert(status.links.some((link: { id: string }) => link.id === activated.id));
    assert.equal(Number(query(`select count(*) as n from finance.transactions where user_id='${login.user.id}'`)[0].n), 0);
    report.checks.push(label + "_claim_activation_and_zero_movements"); save();
  }
  assert.equal(uidList.length, 2); report.status = "passed_awaiting_review";
} catch {
  report.status = "stopped_on_anomaly"; process.exitCode = 1;
} finally {
  await db?.close(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks, operationCodes: report.operations, replyClasses: report.replies, gate: "paused", financialRequests: 0, realTelegramRequests: 0 }));
}
