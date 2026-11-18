import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runSupabase } from "./supabase-cli.mjs";
import { writeEvidence } from "./telegram-control-observability.ts";

// Read-only independent reconciliation; never sends a financial command.
const ref = "mkzclztzyqdmftesnwcw";
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "deployment/staging");
const gate = JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8"));
assert.equal(gate.status, "paused"); assert.equal(gate.project_ref, ref);
const runs = ["6c27a5f2-18a2-4cd2-9b7d-d0d6e126a455", "9325b2e5-a599-4744-8882-928a90f2fe40"];
const baseline = JSON.parse(readFileSync("docs/deployment/evidence/cpu-remediation-security-after.json", "utf8"));
const template = readFileSync("infrastructure/supabase/phase3-completion-cohort-audit.sql", "utf8");
const reports = [];
let stage = "cohort.reconciliation";
try {
  for (const run of runs) {
    const previous = JSON.parse(readFileSync(`docs/deployment/evidence/phase3-controlled-runtime-validation-${run}.json`, "utf8"));
    const a = previous.subjects.find(s => s.label === "a"), b = previous.subjects.find(s => s.label === "b");
    for (const subject of [a, b]) assert(/^[a-f0-9-]{36}$/.test(subject.uid));
    assert(/^\d{15}$/.test(previous.bot));
    const sql = template.replaceAll("100142513132091", previous.bot)
      .replaceAll("a1ae8770-cb52-4f66-bbef-c5783cb46b2c", a.uid)
      .replaceAll("d73e11ac-6d8a-4fb6-bbc5-dc83367dcf82", b.uid);
    const audit = JSON.parse(runSupabase(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", sql])).rows[0].audit;
    writeEvidence(`docs/deployment/evidence/phase3-final-independent-${run}.json`, audit);
    assert.equal(audit.migrations, 36); assert.equal(audit.functions.length, 86);
    assert.deepEqual(audit.functions, baseline.functions); assert.equal(audit.unsafe_tenant_tables, 0);
    const states = {};
    for (const event of audit.events) {
      states[event.state] = (states[event.state] ?? 0) + 1;
      assert(["done", "dead"].includes(event.state)); assert(!event.lease_live);
      if (event.state === "done") { assert(!event.has_input); assert(!event.has_output); }
      assert(event.attempts <= 5); assert(event.delivery_attempts <= 5);
    }
    for (const [subject, balance, count] of [[a, "7500", 1], [b, "10000", 0]]) {
      const s = audit.subjects.find(s => s.user_id === subject.uid);
      assert.equal(s.accounts.length, 1); assert.equal(s.accounts[0].balance_minor, balance);
      for (const key of ["transactions", "entries", "events", "confirmations"]) assert.equal(s[key], count);
      if (count) {
        const t = s.financial_details[0]; assert.equal(s.financial_details.length, 1);
        assert.equal(t.kind, "expense"); assert.equal(t.status, "posted"); assert.equal(t.amount_minor, "2500");
        assert.equal(t.entry_sum_minor, "-2500"); assert.equal(t.confirmation_count, 1);
      }
    }
    reports.push({ run, balancesMinor: { A: "7500", B: "10000" }, movements: { A: 1, B: 0 }, states, functionsUnchanged: 86 });
  }
  stage = "roles.read";
  const rolesSql = `select jsonb_build_object(
    'observed_at',clock_timestamp(),
    'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'bypass',rolbypassrls,'inherit',rolinherit,'create_role',rolcreaterole,'create_db',rolcreatedb,'login',rolcanlogin) order by rolname) from pg_roles where rolname in ('app_executor','finzi_deletion_worker','finzi_telegram_gateway','finzi_telegram_transport_executor')),
    'gateway_financial_table_privileges',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance' and c.relkind='r' and has_table_privilege('finzi_telegram_gateway',c.oid,'SELECT,INSERT,UPDATE,DELETE')),
    'transport_financial_table_privileges',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance' and c.relkind='r' and has_table_privilege('finzi_telegram_transport_executor',c.oid,'SELECT,INSERT,UPDATE,DELETE')),
    'active_authenticator',(select count(*) from pg_stat_activity where usename='authenticator' and state not in ('idle','disabled')),
    'open_test_transactions',(select count(*) from pg_stat_activity where usename in ('authenticator','finzi_telegram_gateway') and state like 'idle in transaction%'),
    'postgrest_calls',(select coalesce(sum(calls),0) from extensions.pg_stat_statements where queryid=5360251647081715348)
  ) as audit;`;
  const roles = JSON.parse(runSupabase(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", rolesSql])).rows[0].audit;
  writeEvidence("docs/deployment/evidence/phase3-final-roles-health.json", roles);
  assert.equal(roles.roles.length, 4);
  for (const role of roles.roles) {
    stage = `roles.${role.name}`;
    for (const key of ["super", "bypass", "inherit", "create_role", "create_db"]) assert.equal(role[key], false);
    assert.equal(role.login, role.name === "finzi_telegram_gateway");
  }
  assert.equal(roles.gateway_financial_table_privileges, 0); assert.equal(roles.transport_financial_table_privileges, 0);
  assert.equal(roles.active_authenticator, 0); assert.equal(roles.open_test_transactions, 0);
  stage = "migrations.hashes";
  const manifests = ["migrations.manifest.json", "telegram-webhook-migration.manifest.json", "cpu-remediation-migration.manifest.json"];
  let verifiedMigrations = 0;
  for (const manifest of manifests) for (const item of JSON.parse(readFileSync(`infrastructure/supabase/${manifest}`, "utf8"))) {
    const source = readFileSync(`supabase/migrations/${item.file}`, "utf8").replaceAll("\r\n", "\n");
    assert.equal(createHash("sha256").update(source).digest("hex"), item.sha256_lf); verifiedMigrations++;
  }
  assert.equal(verifiedMigrations, 36);
  writeEvidence("docs/deployment/evidence/phase3-final-acceptance-audit.json", { status: "passed", ref, gate: "paused", reports, verifiedMigrations, roles, financialCommands: 0, destructiveOperations: 0 });
  console.log("Independent final audit passed: both A=75/B=100, one expense per isolated cohort, 86 functions, 36 migrations, four roles and RLS intact; no pending operations.");
} catch (error) {
  const code = error?.code === "ERR_ASSERTION" ? "ASSERTION_FAILED" : "READ_OR_EVIDENCE_FAILED";
  writeEvidence("docs/deployment/evidence/phase3-final-audit-failure.json", { stage, code, financialCommands: 0 });
  console.error(JSON.stringify({ stage, code })); process.exitCode = 1;
}
