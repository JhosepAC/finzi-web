import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { connectDatabase } from "../deletion-worker/database.ts";

const ref = "mkzclztzyqdmftesnwcw", out = "docs/deployment/evidence/phase8-stage1";
const envFile = ".env.deletion-worker-staging.local", sqlFile = ".staging-migrations/phase8-stage1/role-password.sql";
assert.equal(spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(), "deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
const comparison = JSON.parse(readFileSync(`${out}/schema-comparison.json`, "utf8"));
assert.equal(comparison.unexpectedDifferences.length, 0);
assert(comparison.financialUnchanged);
assert(!existsSync(envFile), "EXISTING_SECRET_REVIEW_REQUIRED");
process.loadEnvFile(".env.supabase-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF, ref);
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
const state = { project: ref, phase: "security_audit", status: "running", credentialsPrepared: false, passwordApplied: false, tlsVerified: false, claims: 0, financialOperations: 0 };
const save = () => writeFileSync(`${out}/custody.json`, JSON.stringify(state, null, 2));
function command(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 25000, windowsHide: true });
  if (r.status !== 0) throw new Error("CUSTODY_DATABASE_COMMAND_FAILED");
  return JSON.parse(r.stdout);
}
try {
  const audit = command(["db", "query", `--remote=${ref}`, "--read-only", "--file", "infrastructure/supabase/phase8-stage1-security.sql", "--output-format", "json"]).rows[0].audit;
  writeFileSync(`${out}/security-audit.json`, JSON.stringify(audit, null, 2));
  assert.equal(audit.migrations, 38);
  assert.equal(audit.cloud_enabled, false);
  for (const field of ["cloud_jobs", "cloud_peers", "active_deletion_leases", "processable_telegram_events", "active_telegram_leases", "unsafe_rls", "gateway_memberships", "gateway_tables", "gateway_api", "unsafe_definers"]) assert.equal(audit[field], 0, field);
  assert.equal(audit.gateway_unsafe, false);
  const operator = JSON.parse(readFileSync(`${out}/migration-operator.json`, "utf8"));
  assert.equal(audit.migration_operator_worker_membership, operator.ddl_memberships.some(m => m.role === "finzi_deletion_worker"));
  assert.deepEqual(audit.gateway_functions, ["ops.cloud_deletion_claim", "ops.cloud_deletion_fail", "ops.cloud_deletion_inspect", "ops.cloud_deletion_step"]);
  state.phase = "prepare_custody"; save();
  const transport = parseEnv(readFileSync(".env.telegram-webhook-staging.local", "utf8"));
  const uri = new URL(transport.TELEGRAM_WEBHOOK_DATABASE_URL);
  assert(/^aws-[0-9]+-sa-east-1\.pooler\.supabase\.com$/.test(uri.hostname));
  assert(decodeURIComponent(uri.username).endsWith(`.${ref}`));
  const password = randomBytes(48).toString("hex");
  uri.username = `finzi_deletion_gateway.${ref}`; uri.password = password; uri.port = "6543"; uri.search = ""; uri.hash = "";
  assert(process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY);
  const settings = { DELETION_ENABLED: "false", SUPABASE_URL: `https://${ref}.supabase.co`, DELETION_DATABASE_URL: uri.href, DELETION_OPERATIONS_KEY: process.env.SUPABASE_STAGING_AUTH_ADMIN_KEY };
  writeFileSync(envFile, "# Private staging custody. Manifest key and Cloudflare binding remain pending.\n" + Object.entries(settings).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  state.credentialsPrepared = true; state.phase = "set_gateway_password"; save();
  // Hex-only generated value, no interpolation of user SQL, no secrets in argv/logs.
  writeFileSync(sqlFile, `alter role finzi_deletion_gateway password '${password}';\n`, { flag: "wx", mode: 0o600 });
  command(["db", "query", `--remote=${ref}`, "--file", sqlFile, "--output-format", "json", "--yes"]);
  state.passwordApplied = true; state.phase = "verify_tls_identity"; save();
  unlinkSync(sqlFile); // Dispose only the temporary plaintext credential statement.
  const database = await connectDatabase(uri.href);
  await database.close();
  state.tlsVerified = true; state.status = "ready_disabled"; save();
  console.log(JSON.stringify(state));
} catch (error) {
  state.status = "stopped"; state.code = error instanceof assert.AssertionError ? "SECURITY_ASSERTION_FAILED" : /^[A-Z_]+$/.test(error.message ?? "") ? error.message : "CUSTODY_VERIFICATION_FAILED";
  save(); console.log(JSON.stringify(state)); process.exitCode = 1;
}
