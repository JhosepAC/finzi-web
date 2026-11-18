import { prepareStagingMigrations } from "./staging-migration-files.mjs";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const ref = "mkzclztzyqdmftesnwcw";
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
assert.equal(branch, "deployment/staging", "Staging operations require deployment/staging");
const mode = process.argv[2];
assert(["preflight", "plan", "apply", "resume-plan", "resume-apply"].includes(mode), "Use preflight, plan, apply, resume-plan or resume-apply");
const manifest = JSON.parse(readFileSync("infrastructure/supabase/migrations.manifest.json", "utf8"));
assert.equal(manifest.length, 34);
for (const item of manifest) {
  const text = readFileSync(`supabase/migrations/${item.file}`, "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(text).digest("hex"), item.sha256_lf, "Historical migration changed");
}
process.loadEnvFile(".env.supabase-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF, ref, "Wrong staging credentials file");
assert(process.env.SUPABASE_DB_PASSWORD, "Staging database password required");
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function command(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8", timeout: 180_000,
    env: process.env, maxBuffer: 8 * 1024 * 1024
  });
  // Never forward raw CLI failures: connection errors can contain credentials.
  if (result.status !== 0) {
    console.error("Staging CLI failed; sequence stopped. No raw connection output was printed.");
    let safe = result.stdout + result.stderr;
    for (const [name, value] of Object.entries(process.env)) {
      if (/PASSWORD|TOKEN|KEY|DATABASE_URL/.test(name) && value?.length > 8) safe = safe.replaceAll(value, "[REDACTED]");
    }
    safe = safe.replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED CONNECTION]");
    mkdirSync("docs/deployment/evidence", { recursive: true });
    writeFileSync("docs/deployment/evidence/phase2-latest-failure.txt", safe);
    if (/must be owner of function/.test(safe)) console.error("Migration operator lacks function ownership at replacement.");
    const sqlState = safe.match(/SQLSTATE\s+([A-Z0-9]{5})/);
    if (sqlState) console.error(`SQLSTATE ${sqlState[1]}`);
    process.exit(1);
  }
  return result.stdout;
}
function json(text) {
  const start = text.indexOf("{");
  try { return JSON.parse(text.slice(start)); } catch {
    try { return JSON.parse(text); } catch { throw new Error("Unexpected CLI response; not printed"); }
  }
}
const projects = JSON.parse(command(["projects", "list", "--output", "json"]));
const project = projects.find(p => p.id === ref);
assert(project && project.name === "finzi-staging" && project.status === "ACTIVE_HEALTHY", "Unexpected project identity/status");
assert.equal(project.database.postgres_engine, "17");
const config = json(command(["config", "diff", `--remote=${ref}`, "--workdir", "infrastructure/supabase", "--output-format", "json"]));
assert.equal(config.changes.filter(c => c.declared).length, 0, "Restrictive staging config drift");
const initial = json(command(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json",
  "select current_setting('server_version_num') as version, (select count(*) from auth.users) as auth_users, (select count(*) from storage.objects) as objects, (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('finance','api','ops','telegram_private','public') and c.relkind in ('r','p')) as app_tables"])).rows[0];
assert(Number(initial.version) >= 170000 && Number(initial.version) < 180000);
mkdirSync("docs/deployment/evidence", { recursive: true });
if (mode === "preflight") {
  assert.equal(Number(initial.auth_users), 0, "Unexpected Auth users: stop for review");
  assert.equal(Number(initial.objects), 0, "Unexpected Storage objects: stop for review");
  assert.equal(Number(initial.app_tables), 0, "Unexpected application tables: stop for review");
  writeFileSync("docs/deployment/evidence/phase2-initial.json", JSON.stringify({ ref, at: new Date().toISOString(), project: { name: project.name, region: project.region, status: project.status }, ...initial }, null, 2));
  console.log("Staging preflight passed: exact project, PostgreSQL 17, restrictive configuration and empty application/Auth/Storage.");
} else {
  const evidence = JSON.parse(readFileSync("docs/deployment/evidence/phase2-initial.json", "utf8"));
  assert.equal(evidence.ref, ref);
  // Fresh deployment only. A partial or populated state requires investigation, not blind retries.
  assert.equal(Number(initial.auth_users), 0, "Unexpected users before migrations");
  assert.equal(Number(initial.objects), 0, "Unexpected objects before migrations");
  if (!mode.startsWith("resume-")) assert.equal(Number(initial.app_tables), 0, "Non-empty schema: stop and inspect partial state");
  else {
    const history = json(command(["db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", "select version from supabase_migrations.schema_migrations order by version"])).rows;
    assert([23, 26, 27].includes(history.length), "Unreviewed partial migration count");
    assert.deepEqual(history.map(x => x.version), manifest.slice(0, history.length).map(x => x.file.split("_")[0]), "Partial migration history changed; stop for review");
  }
  const args = ["db", "push", `--remote=${ref}`, "--skip-vault", "--yes"];
  {
    prepareStagingMigrations();
    args.push("--workdir", ".staging-migrations");
  }
  if (mode.endsWith("plan")) args.push("--dry-run");
  const output = command(args);
  // Record only migration names and success, never raw connection output.
  const migrations = [...new Set(output.match(/20\d{12}_[a-z_]+\.sql/g) ?? [])];
  writeFileSync(`docs/deployment/evidence/phase2-${mode}.json`, JSON.stringify({ ref, at: new Date().toISOString(), success: true, migrations }, null, 2));
  console.log(`Staging migration ${mode} succeeded; ${migrations.length} migration filenames reported.`);
}
