import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

// Prepared locally only. Approval is created by the operator after an explicit user reply.
const approvalPath = ".staging-migrations/phase7-s1/password-only-approval.json";
const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
assert.equal(approval.scope, "explicit_S1_password_only_no_email");
assert.equal(approval.status, "approved"); assert.equal(approval.additionalAuthRequests, 12);
assert.equal(spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(), "deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
const priorRun = "5e18074d-570a-442e-93ac-3d17911a89c9";
const previous = JSON.parse(readFileSync(`.staging-migrations/phase7-s1/${priorRun}/private.json`, "utf8"));
const prior = JSON.parse(readFileSync(`docs/deployment/evidence/phase7/${priorRun}/runtime.json`, "utf8"));
assert.equal(prior.passwordChanged, false); assert.equal(prior.recoveryVerified, true);
assert.equal(prior.configurationRestoration, "three_original_fields_read_back_equal");
assert.equal(prior.authRequests, 36); assert.equal(prior.emailsReserved, 2);
writeFileSync(approvalPath + ".consumed", "consumed", { flag: "wx" });
const run = randomUUID(), privatePath = `.staging-migrations/phase7-s1/${run}`;
mkdirSync(privatePath, { recursive: true }); mkdirSync(`docs/deployment/evidence/phase7/${run}`, { recursive: true });
writeFileSync(`${privatePath}/private.json`, JSON.stringify({ run, priorRun, scope: approval.scope, recipient: previous.recipient, subject: previous.subject, passwordOnlyApproved: true, confirmationUserApproved: true, authRequestLimit: 48 }), { mode: 0o600 });
writeFileSync(".staging-migrations/phase7-s1/recovery-current.json", JSON.stringify({ run }));
console.log(JSON.stringify({ run, scope: approval.scope, additionalAuthRequests: 12, emails: 0, financialRequests: 0, configurationChanges: 0 }));
