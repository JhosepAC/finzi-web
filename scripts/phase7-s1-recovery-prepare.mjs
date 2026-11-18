import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

assert.equal(spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(), "deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
const priorRun = "554b3ddf-021d-4639-ba3b-ee59d8f07068";
const priorPrivate = `.staging-migrations/phase7-s1/${priorRun}`;
const prior = JSON.parse(readFileSync(`docs/deployment/evidence/phase7/${priorRun}/runtime.json`, "utf8"));
assert.equal(prior.identityVerified, true); assert.equal(prior.emailsReserved, 1);
const permit = JSON.parse(readFileSync(`${priorPrivate}/private.json`, "utf8"));
const subject = JSON.parse(readFileSync(`${priorPrivate}/subject.private.json`, "utf8"));
assert(/^[a-f0-9-]{36}$/.test(subject.id));
const run = randomUUID(), privatePath = `.staging-migrations/phase7-s1/${run}`, publicPath = `docs/deployment/evidence/phase7/${run}`;
mkdirSync(privatePath, { recursive: true }); mkdirSync(publicPath, { recursive: true });
writeFileSync(`${privatePath}/private.json`, JSON.stringify({ run, priorRun, scope: "explicit_S1_existing_identity_recovery_only", recipient: permit.recipient, subject: subject.id, configurationApproved: true, confirmationUserApproved: true }), { mode: 0o600 });
writeFileSync(`${privatePath}/prepare.consumed`, "consumed", { flag: "wx" });
for (const [name, site, redirects] of [["config-rollback", "http://localhost:3000", []], ["config-change", "http://127.0.0.1:3030", ["http://127.0.0.1:3030/auth/confirm"]]]) {
  mkdirSync(`${privatePath}/${name}/supabase`, { recursive: true });
  writeFileSync(`${privatePath}/${name}/supabase/config.toml`, `project_id = "finzi-staging"\n[auth]\nenable_signup = false\nsite_url = ${JSON.stringify(site)}\nadditional_redirect_urls = ${JSON.stringify(redirects)}\n`);
}
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function command(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, "CONFIGURATION_READ_FAILED");
  return JSON.parse(result.stdout);
}
const read = command(["config", "diff", "--remote=mkzclztzyqdmftesnwcw", "--workdir", `${privatePath}/config-rollback`, "--output-format", "json"]);
const changes = (read.changes ?? []).map(c => ({ path: Array.isArray(c.path) ? c.path.join(".") : c.path, declared: c.declared, class: c.class, remote: c.remote }));
// Only persist the three nonsecret fields. Missing differences mean equality to the explicit desired values.
const keys = ["auth.enable_signup", "auth.site_url", "auth.additional_redirect_urls"];
const targetChanges = changes.filter(c => keys.includes(c.path));
const unexpectedDeclared = changes.filter(c => c.declared === true && !keys.includes(c.path));
const evidence = { run, priorRun, at: new Date().toISOString(), status: targetChanges.length === 0 && unexpectedDeclared.length === 0 ? "original_three_values_verified_restored" : "configuration_mismatch_stop", expected: { enable_signup: false, site_url: "http://localhost:3000", additional_redirect_urls: [] }, changes: targetChanges, ignoredUndeclaredFields: changes.filter(c => !c.declared).length, unexpectedDeclaredFields: unexpectedDeclared.map(c => c.path), noUserCreated: true, emailsSent: 0 };
writeFileSync(`${publicPath}/restoration-readback.json`, JSON.stringify(evidence, null, 2));
assert.equal(targetChanges.length, 0, "CONFIGURATION_MISMATCH_STOP");
assert.equal(unexpectedDeclared.length, 0, "UNEXPECTED_DECLARED_FIELDS");
writeFileSync(".staging-migrations/phase7-s1/recovery-current.json", JSON.stringify({ run }));
console.log(JSON.stringify(evidence));
