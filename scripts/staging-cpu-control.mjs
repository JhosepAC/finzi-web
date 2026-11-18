// One finite remediation experiment. The global load gate stays paused.
// Create the one-use approval file ONLY after explicit user authorization.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { prepareStagingMigrations } from "./staging-migration-files.mjs";

const ref = "mkzclztzyqdmftesnwcw", url = `https://${ref}.supabase.co`;
const approvalFile = ".staging-migrations/cpu-control-approval.json";
const evidenceFile = "docs/deployment/evidence/cpu-remediation-remote-control.json";
const manifest = JSON.parse(readFileSync("infrastructure/supabase/cpu-remediation-migration.manifest.json", "utf8"));
const item = manifest[0], source = readFileSync(`supabase/migrations/${item.file}`, "utf8").replaceAll("\r\n", "\n");
const hash = text => createHash("sha256").update(text).digest("hex");
assert.equal(hash(source), item.sha256_lf);
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "deployment/staging");
const gate = JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8"));
assert.equal(gate.project_ref, ref); assert.equal(gate.status, "paused");
const mode = process.argv[2]; assert(["plan", "run"].includes(mode));
if (mode === "plan") {
  console.log(JSON.stringify({ ref, migration: item.file, sha256: item.sha256_lf, gate: gate.status, approvalFilePresent: existsSync(approvalFile), scope: "Apply one migration; provision two synthetic Auth users; one seed movement; two rejected conflicts; one exact replay; B ownership denial; financial fingerprints/ACL/RLS; metrics separately. No Telegram calls." }, null, 2));
  process.exit(0);
}
// No environment loading, credentials or network access before approval check.
const approval = JSON.parse(readFileSync(approvalFile, "utf8"));
assert.equal(approval.status, "approved"); assert.equal(approval.project_ref, ref);
assert.equal(approval.migration_sha256, item.sha256_lf);
assert.equal(approval.scope, "single-cpu-remediation-control");
assert(Number.isFinite(Date.parse(approval.approved_at)));
assert(Date.now() - Date.parse(approval.approved_at) >= 0 && Date.now() - Date.parse(approval.approved_at) < 3600000, "Approval must be fresh for this one experiment");
assert(/^[a-f0-9-]{36}$/.test(approval.run_id));
assert(!existsSync(`${approvalFile}.consumed`), "A previous control already consumed authorization");
renameSync(approvalFile, `${approvalFile}.consumed`); // No automatic second attempt after any failure.
const evidence = { project: ref, run: approval.run_id, started_at: new Date().toISOString(), gate: "paused", status: "running", checks: [] };
const record = name => { evidence.checks.push({ name, passed: true }); writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2)); };
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: process.env, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("provider_command_failed");
  return result.stdout;
}
function query(statement) {
  return JSON.parse(run(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", statement])).rows;
}
function ok(result) { assert.equal(result.error, null); return result.data; }
const writerSignature = "finance.write_movement(uuid,text,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer,text)";
const security = () => query(`select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'signature',p.oid::regprocedure::text,'source',md5(replace(p.prosrc,E'\\r\\n',E'\\n'))) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('api','finance','ops','telegram_private')),
 'unprotected',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('finance','ops','telegram_private') and c.relkind='r' and c.relname<>'currencies' and (not c.relrowsecurity or not c.relforcerowsecurity)),
 'excess_roles',(select count(*) from pg_roles where rolname in ('app_executor','finzi_deletion_worker','finzi_telegram_gateway','finzi_telegram_transport_executor') and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolinherit)),
 'writer',(select oid from pg_proc where oid='${writerSignature}'::regprocedure)
 ) as value;`)[0].value;
async function fixture(label) {
  // Admin key is confined to Auth provisioning; never returned as a DB client.
  const password = randomUUID() + "!Synthetic", email = `cpu-control-${approval.run_id}-${label}@example.test`;
  const operator = createClient(url, process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } });
  ok(await operator.auth.admin.createUser({ email, password, email_confirm: true }));
  const client = createClient(url, process.env.SUPABASE_STAGING_ANON_KEY, { db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } });
  const login = ok(await client.auth.signInWithPassword({ email, password }));
  assert.equal(JSON.parse(Buffer.from(login.session.access_token.split(".")[1], "base64url")).role, "authenticated");
  const rpc = (name, args = {}) => client.schema("api").rpc(name, args).retry(false);
  ok(await rpc("ensure_profile"));
  ok(await rpc("configure_profile", { p_display_name: "Synthetic CPU control", p_currency: "PEN", p_timezone: "America/Bogota", p_expected_version: 0 }));
  const account = ok(await rpc("create_account", { p_request_id: randomUUID(), p_name: "Synthetic CPU control", p_type: "cash", p_currency: "PEN", p_opening: "100" }));
  const catalog = ok(await rpc("initialize_categories"));
  return { uid: login.user.id, rpc, account: account.id, category: catalog.categories.find(c => c.kind === "income").id };
}
function boundedFetch(input, init) {
  return fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(12000), ...(init?.signal ? [init.signal] : [])]) });
}
async function financialSnapshot(x) {
  assert(/^[a-f0-9-]{36}$/.test(x.uid));
  const accounts = ok(await x.rpc("read_accounts"));
  const history = ok(await x.rpc("read_movements", { p_currency: "PEN", p_status: "all" }));
  const [{ fingerprint }] = query(`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(t) order by id) from finance.transactions t where user_id='${x.uid}'),
    (select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from finance.transaction_entries e where user_id='${x.uid}'),
    (select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from finance.transaction_events e where user_id='${x.uid}')
  )::text) as fingerprint;`);
  return { hash: hash(JSON.stringify({ accounts, history, fingerprint })), balance: accounts.find(a => a.id === x.account).balance_minor };
}
try {
  process.loadEnvFile(".env.supabase-staging.local");
  assert.equal(process.env.SUPABASE_PROJECT_REF, ref); assert.equal(process.env.SUPABASE_URL, url);
  assert.equal(JSON.parse(Buffer.from(process.env.SUPABASE_STAGING_ANON_KEY.split(".")[1], "base64url")).role, "anon");
  const projects = JSON.parse(run(["projects", "list", "--output", "json"]));
  const project = projects.find(p => p.id === ref); assert(project?.name === "finzi-staging" && project.status === "ACTIVE_HEALTHY");
  const base = JSON.parse(readFileSync("infrastructure/supabase/migrations.manifest.json", "utf8"));
  const webhook = JSON.parse(readFileSync("infrastructure/supabase/telegram-webhook-migration.manifest.json", "utf8"));
  const versions = query("select version from supabase_migrations.schema_migrations order by version").map(r => r.version);
  assert.deepEqual(versions, [...base, ...webhook].map(m => m.file.split("_")[0]));
  const before = security(); assert.equal(before.unprotected, 0); assert.equal(before.excess_roles, 0);
  const original = readFileSync("supabase/migrations/20261114000800_transfers_replacements.sql", "utf8").replaceAll("\r\n", "\n");
  const writer = original.slice(original.indexOf("create function finance.write_movement("));
  const oldBody = writer.match(/as \$\$([\s\S]*?)\$\$;/)[1];
  assert.equal(before.functions.find(f => f.oid === before.writer).source, createHash("md5").update(oldBody).digest("hex"));
  assert(!query("select pid from pg_stat_activity where usename='authenticator' and state like 'idle in transaction%'").length);
  record("exact_project_history_original_writer_and_security_preflight");
  writeFileSync("docs/deployment/evidence/cpu-remediation-security-before.json", JSON.stringify(before, null, 2));
  prepareStagingMigrations([...webhook, ...manifest]);
  assert.deepEqual(readdirSync(".staging-migrations/supabase/migrations").filter(f => f.endsWith(".sql")).sort(), [...base, ...webhook, ...manifest].map(m => m.file).sort());
  run(["db", "push", `--remote=${ref}`, "--workdir", ".staging-migrations", "--skip-vault", "--yes"]);
  assert.deepEqual(query("select version from supabase_migrations.schema_migrations order by version").map(r => r.version), [...versions, "20261116001000"]);
  const after = security(), changed = after.functions.find(f => f.oid === before.writer);
  const newBody = source.match(/as \$\$([\s\S]*?)\$\$;/)[1];
  assert.equal(changed.source, createHash("md5").update(newBody).digest("hex"));
  const restored = structuredClone(after); restored.functions.find(f => f.oid === before.writer).source = before.functions.find(f => f.oid === before.writer).source;
  assert.deepEqual(restored, before);
  writeFileSync("docs/deployment/evidence/cpu-remediation-security-after.json", JSON.stringify(after, null, 2));
  record("only_reviewed_writer_body_changed_acl_owner_rls_and_roles_unchanged");
  const a = await fixture("a"), b = await fixture("b");
  const command = { p_request_id: randomUUID(), p_kind: "income", p_account_id: a.account, p_category_id: a.category, p_amount: "1.00", p_description: "Synthetic CPU control", p_note: "", p_occurred_at: null };
  const posted = ok(await a.rpc("post_movement", command));
  const initial = await financialSnapshot(a), other = await financialSnapshot(b);
  assert.equal(initial.balance, "10100"); assert.equal(other.balance, "10000");
  record("one_synthetic_seed_movement_and_expected_exact_balance");
  for (const [name, rpcName, payload, message] of [
    ["permanent_idempotency_conflict", "post_movement", { ...command, p_amount: "2.00" }, "idempotency_conflict"],
    ["permanent_version_conflict", "replace_movement", { ...command, p_request_id: randomUUID(), p_id: posted.id, p_expected_version: 9, p_reason: "Synthetic stale version", p_destination_id: null }, "movement_version_conflict"],
  ]) {
    const result = await a.rpc(rpcName, payload);
    assert.equal(result.status, 409); assert.equal(result.error?.code, "PT409"); assert.equal(result.error.message, message);
    assert.deepEqual(await financialSnapshot(a), initial); record(name + "_http409_unchanged_balance_ledger_and_history");
  }
  assert.equal(ok(await a.rpc("post_movement", command)).id, posted.id);
  assert.deepEqual(await financialSnapshot(a), initial); record("exact_replay_same_id_no_duplicate_effect");
  const denied = await b.rpc("read_movement", { p_id: posted.id }); assert.equal(denied.error?.code, "P0002");
  assert.deepEqual(await financialSnapshot(b), other); record("verified_B_cannot_read_A_financial_state_unchanged");
  assert(!query("select pid from pg_stat_activity where usename='authenticator' and state like 'idle in transaction%'").length);
  record("no_idle_in_transaction_backend_after_finite_control");
  evidence.status = "awaiting_cpu_observation_and_user_review";
} catch {
  evidence.status = "stopped_on_anomaly";
  process.exitCode = 1;
} finally {
  evidence.finished_at = new Date().toISOString();
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, checksPassed: evidence.checks.length, gate: "paused", evidence: evidenceFile }));
}
