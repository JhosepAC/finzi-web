import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const ref = "mkzclztzyqdmftesnwcw", out = "docs/deployment/evidence/phase8-stage1";
assert.equal(spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(), "deployment/staging");
assert.equal(JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8")).status, "paused");
assert.equal(JSON.parse(readFileSync(`${out}/application.json`, "utf8")).status, "migrations_applied_verification_pending");
const cli = createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function queryFile(file) {
  const r = spawnSync(process.execPath, [cli, "db", "query", `--remote=${ref}`, "--read-only", "--output-format", "json", "--file", file], { encoding: "utf8", timeout: 25000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error("READONLY_VERIFICATION_FAILED");
  return JSON.parse(r.stdout).rows;
}
const saved = process.argv.includes("--saved");
const after = saved ? JSON.parse(readFileSync(`${out}/catalog-after.json`, "utf8")) : queryFile("infrastructure/supabase/phase8-schema-catalog.sql")[0].catalog;
if (!saved) writeFileSync(`${out}/catalog-after.json`, JSON.stringify(after, null, 2));
const before = JSON.parse(readFileSync(`${out}/catalog-before.json`, "utf8"));
const local = JSON.parse(readFileSync(`${out}/catalog-local.json`, "utf8"));
// Physical attnum is not part of this named-column protocol. Retain raw snapshots.
// pg_get_expr qualifies auth.uid() according to the querying session's search_path.
for (const catalog of [before, local, after]) {
  for (const table of catalog.tables) table.columns.sort((a, b) => a.name.localeCompare(b.name));
  for (const policy of catalog.policies.filter(p => p.schema === "storage" && p.name.startsWith("category_images_"))) {
    for (const field of ["using", "check"]) if (policy[field]) policy[field] = policy[field].replace(/(?<![\w.])uid\(\)/g, "auth.uid()");
  }
}
const key = (x) => [x.schema, x.table, x.name, x.args].filter(v => v !== undefined).join("/");
function differences(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return [{ path, remote: a, local: b }];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => differences(a[k], b[k], `${path}/${k}`));
}
const drift = [], baseline = [];
for (const group of Object.keys(after)) {
  if (["memberships"].includes(group)) { drift.push(...differences(after[group], local[group], group)); continue; }
  for (const expected of local[group]) {
    const actual = after[group].find(x => key(x) === key(expected));
    const previous = before[group].find(x => key(x) === key(expected));
    const delta = differences(actual, expected, `${group}/${key(expected)}`);
    for (const item of delta) {
      const known = differences(previous, expected, `${group}/${key(expected)}`).some(x => JSON.stringify(x) === JSON.stringify(item));
      (known ? baseline : drift).push(item);
    }
  }
  for (const actual of after[group]) if (!local[group].some(x => key(x) === key(actual))) drift.push({ path: `${group}/${key(actual)}`, extra: true });
}
const stable = ["api", "finance", "telegram_private"];
const changedStable = before.functions.filter(x => stable.includes(x.schema)).filter(x => JSON.stringify(x) !== JSON.stringify(after.functions.find(y => key(x) === key(y)))).map(key);
const financial = saved ? JSON.parse(readFileSync(`${out}/financial-after.json`, "utf8")) : queryFile(".staging-migrations/phase8-stage1/financial-audit.sql")[0].fingerprint;
if (!saved) writeFileSync(`${out}/financial-after.json`, JSON.stringify(financial, null, 2));
const result = { project: ref, migrations: 38, tables: after.tables.length, functions: after.functions.length, apiFunctions: after.functions.filter(x => x.schema === "api").length, inheritedDifferences: baseline, unexpectedDifferences: drift, changedFinancialOrTelegramFunctions: changedStable, financialUnchanged: JSON.stringify(financial) === JSON.stringify(JSON.parse(readFileSync(`${out}/financial-before.json`, "utf8"))) };
writeFileSync(`${out}/schema-comparison.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, inheritedDifferences: baseline.length }, null, 2));
assert.equal(drift.length, 0, "UNEXPECTED_SCHEMA_DRIFT");
assert.equal(changedStable.length, 0, "FINANCIAL_OR_TELEGRAM_FUNCTION_CHANGED");
assert(result.financialUnchanged, "FINANCIAL_STATE_CHANGED");
