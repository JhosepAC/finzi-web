import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { unstable_dev } from "wrangler";

process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_WRITE_LOGS = "false";
const local = parseEnv(readFileSync(".env.telegram.local", "utf8"));
const uri = new URL(local.TELEGRAM_DATABASE_URL);
assert(["127.0.0.1", "localhost"].includes(uri.hostname)); assert.equal(uri.username, "finzi_telegram_gateway");
// Only the local Hyperdrive connector; no cloud binding or TLS configuration is modified.
uri.search = "";
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TELEGRAM_DB = uri.toString();
const bot = String(Date.now()) + "42", user = String(Date.now()) + "7", update = Date.now();
const vars = { TELEGRAM_WEBHOOK_BOT_ID: bot, TELEGRAM_WEBHOOK_BOT_USERNAME: "FinziSyntheticBot", TELEGRAM_WEBHOOK_BOT_TOKEN: bot + ":synthetic_test_only",
  TELEGRAM_WEBHOOK_URL: "https://synthetic.invalid/telegram/webhook", TELEGRAM_WEBHOOK_SECRET: "a".repeat(40), TELEGRAM_WEBHOOK_CUSTODY_KEY: "b".repeat(64), TELEGRAM_WEBHOOK_CALLBACK_KEY: "c".repeat(64), PHASE3_SYNTHETIC_CHAT: user };
const options = { config: "wrangler.telegram.jsonc", vars, port: 0, local: true, persist: false, logLevel: "error", experimental: { disableExperimentalWarning: true, watch: false, disableDevRegistry: true } };
function rows() {
  const text = execFileSync("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { input: `select coalesce(json_agg(json_build_object('state',state,'input',payload_ciphertext is not null,'output',result_ciphertext is not null)),'[]') from telegram_private.transport_events where bot_id='${bot}' and update_id=${update};`, encoding: "utf8", stdio: "pipe" });
  return JSON.parse(text);
}
let worker;
const result = { status: "running", bot, localOnly: true, realTelegramRequests: 0, financialCommands: 0, checks: [] };
try {
  assert.equal(rows().length, 0);
  execFileSync("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { input: `insert into telegram_private.transport_bots(bot_id,mode,enabled) values('${bot}','webhook',true);`, stdio: "pipe" });
  worker = await unstable_dev("tests/runtime/telegram-cron-entry.ts", options);
  const target = "http://localhost/telegram/webhook";
  assert.equal((await worker.fetch(target)).status, 405); result.checks.push("method_rejected");
  assert.equal((await worker.fetch(target, { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "incorrect" }, body: "{}" })).status, 403); result.checks.push("secret_rejected");
  assert.equal((await worker.fetch(target, { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": vars.TELEGRAM_WEBHOOK_SECRET }, body: "{}" })).status, 400); result.checks.push("invalid_event_rejected");
  const event = { update_id: update, message: { message_id: update, date: Math.floor(Date.now() / 1000), from: { id: Number(user), is_bot: false, first_name: "Synthetic" }, chat: { id: Number(user), type: "private" }, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
  const request = () => worker.fetch(target, { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": vars.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(event) });
  const received = await Promise.all([request(), request()]);
  assert(received.some(r => r.status === 200)); assert(received.every(r => [200, 503].includes(r.status)));
  // The advisory try-lock can reject an overlapping receive without acknowledging it.
  assert.equal((await request()).status, 200);
  assert.deepEqual(rows(), [{ state: "pending", input: true, output: false }]); result.checks.push("concurrent_duplicate_durable_before_200");
  await worker.stop(); worker = undefined;
  worker = await unstable_dev("tests/runtime/telegram-cron-entry.ts", options);
  assert.equal(rows()[0].state, "pending"); result.checks.push("restart_recovers_pending_postgres");
  const first = await worker.fetch("http://localhost/__phase3_cron_test", { method: "POST" }); assert.equal(first.status, 200); assert.deepEqual((await first.json()).syntheticApiMethods, []); assert.equal(rows()[0].state, "ready"); result.checks.push("production_scheduled_process");
  const second = await worker.fetch("http://localhost/__phase3_cron_test", { method: "POST" }); assert.equal(second.status, 200); assert.deepEqual((await second.json()).syntheticApiMethods, ["getMe", "getWebhookInfo", "sendMessage"]);
  assert.deepEqual(rows(), [{ state: "done", input: false, output: false }]); result.checks.push("production_scheduled_stub_delivery");
  result.status = "passed";
} catch { result.status = "failed"; process.exitCode = 1; }
finally {
  await worker?.stop();
  execFileSync("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { input: `update telegram_private.transport_bots set enabled=false where bot_id='${bot}';`, stdio: "pipe" });
  mkdirSync("docs/deployment/evidence/phase7-local", { recursive: true });
  writeFileSync(`docs/deployment/evidence/phase7-local/telegram-workerd-${update}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
