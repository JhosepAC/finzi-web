import assert from "node:assert/strict";
import { readFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { unstable_dev } from "wrangler";
import { runSupabase } from "./supabase-cli.mjs";
import { writeEvidence } from "./telegram-control-observability.ts";
assert.equal(process.env.WRANGLER_WRITE_LOGS, "false"); assert.equal(process.env.WRANGLER_SEND_METRICS, "false");
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
const permitPath = process.argv[2]; assert(/^\.staging-migrations\/phase3-cron-[a-f0-9-]{36}\.json$/.test(permitPath));
const permit = JSON.parse(readFileSync(permitPath, "utf8"));
assert.equal(permit.status, "approved"); assert.equal(permit.scope, "synthetic_workerd_cron_no_financial_commands");
assert(Date.now() - Date.parse(permit.at) < 3600000); assert(!existsSync(permitPath + ".consumed")); renameSync(permitPath, permitPath + ".consumed");
const prior = JSON.parse(readFileSync("docs/deployment/evidence/phase3-controlled-runtime-validation-6c27a5f2-18a2-4cd2-9b7d-d0d6e126a455.json", "utf8"));
process.loadEnvFile(".env.telegram-webhook-staging.local"); assert.equal(process.env.TELEGRAM_WEBHOOK_BOT_ID, "970000003");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("TELEGRAM_WEBHOOK_") && k !== "TELEGRAM_WEBHOOK_DATABASE_URL"));
env.TELEGRAM_WEBHOOK_BOT_ID = prior.bot; env.TELEGRAM_WEBHOOK_BOT_TOKEN = prior.bot + ":synthetic_test_only";
env.TELEGRAM_WEBHOOK_URL = "https://synthetic.invalid/telegram/webhook";
const update = Date.now(), user = Number(String(update).slice(-10)) * 100 + 66; env.PHASE3_SYNTHETIC_CHAT = String(user);
const uri = new URL(process.env.TELEGRAM_WEBHOOK_DATABASE_URL); assert(uri.hostname.includes("sa-east-1.pooler.supabase.com")); assert(uri.username.includes("mkzclztzyqdmftesnwcw"));
uri.port = "6543"; uri.searchParams.set("sslmode", "verify-full"); uri.searchParams.set("sslrootcert", resolve("infrastructure/supabase/prod-ca-2021.crt"));
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TELEGRAM_DB = uri.toString();
const result = { run: prior.run, status: "running", checks: [], localWorkerd: true, productionScheduledHandler: true, financialOperations: 0, realTelegramRequests: 0, published: false };
let worker, stage = "preflight";
const query = sql => JSON.parse(runSupabase(["db", "query", "--remote=mkzclztzyqdmftesnwcw", "--read-only", "--output-format", "json", sql])).rows;
const row = () => query(`select id,state,payload_ciphertext is not null as input_present,result_ciphertext is not null as output_present from telegram_private.transport_events where bot_id='${prior.bot}' and update_id=${update}`)[0];
try {
  assert.equal(Number(query(`select count(*) as n from telegram_private.transport_events where bot_id='${prior.bot}' and state in ('pending','processing','ready','delivering')`)[0].n), 0);
  stage = "workerd.start";
  worker = await unstable_dev("tests/runtime/telegram-cron-entry.ts", { config: "wrangler.telegram.jsonc", vars: env, port: 0, local: true, persist: false, logLevel: "error", experimental: { disableExperimentalWarning: true, watch: false, disableDevRegistry: true } });
  stage = "webhook.persist";
  const event = { update_id: update, message: { message_id: update, date: Math.floor(Date.now() / 1000), from: { id: user, is_bot: false, first_name: "Synthetic" }, chat: { id: user, type: "private" }, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
  assert.equal((await worker.fetch("http://localhost/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(event) })).status, 200);
  assert.equal(row().state, "pending");
  stage = "scheduled.process";
  const first = await worker.fetch("http://localhost/__phase3_cron_test", { method: "POST" }); assert.equal(first.status, 200);
  assert.deepEqual((await first.json()).syntheticApiMethods, []); assert.equal(row().state, "ready"); result.checks.push("production_scheduled_process_in_workerd_ready_outbox");
  stage = "scheduled.deliver";
  const second = await worker.fetch("http://localhost/__phase3_cron_test", { method: "POST" }); assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).syntheticApiMethods, ["getMe", "getWebhookInfo", "sendMessage"]);
  const final = row(); assert.equal(final.state, "done"); assert(!final.input_present && !final.output_present);
  result.event = final.id; result.checks.push("production_scheduled_deliver_in_workerd_stub_api_identity_webhook_and_message"); result.status = "passed";
} catch {
  result.status = "failed"; result.stage = stage; process.exitCode = 1;
} finally {
  await worker?.stop(); writeEvidence("docs/deployment/evidence/phase3-workerd-cron-acceptance.json", result); console.log(JSON.stringify(result));
}
