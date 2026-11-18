import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url), mode = process.argv[2], files = process.argv.slice(3);
assert(["integration", "e2e", "build"].includes(mode));
assert(files.every(f => /^tests\/(integration|e2e)\/[a-z0-9-]+\.(test|spec)\.ts$/.test(f)));
const local = parseEnv(readFileSync(".env.local", "utf8"));
for (const key of ["SUPABASE_URL", "APP_URL"]) assert(["127.0.0.1", "localhost"].includes(new URL(local[key]).hostname), "LOCAL_ENV_REQUIRED");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/SUPABASE|TELEGRAM|CLOUDFLARE|FINZI_S1|DATABASE_URL|NODE_OPTIONS|APP_URL/.test(k)));
Object.assign(env, Object.fromEntries(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_URL"].map(k => [k, local[k]])), { NEXT_TELEMETRY_DISABLED: "1", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", CI: "1" });
// Never pass other private files or bot tokens into the campaign.
delete env.TELEGRAM_BOT_TOKEN; delete env.SUPABASE_SERVICE_ROLE_KEY;
if (existsSync(".env.telegram.local")) {
  const telegram = parseEnv(readFileSync(".env.telegram.local", "utf8"));
  if (telegram.TELEGRAM_DATABASE_URL) {
    const db = new URL(telegram.TELEGRAM_DATABASE_URL);
    assert(["127.0.0.1", "localhost"].includes(db.hostname), "TELEGRAM_DB_MUST_BE_LOCAL");
    assert.equal(db.username, "finzi_telegram_gateway");
    env.TELEGRAM_DATABASE_URL = db.toString();
  }
}
env.NODE_OPTIONS = `--import=${pathToFileURL(resolve("scripts/phase7-local-network.mjs")).href}`;
const args = mode === "integration" ? [join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"), "run", "--config", "vitest.integration.config.ts", "--bail=1", "--no-file-parallelism", ...files]
  : mode === "e2e" ? [join(dirname(require.resolve("@playwright/test/package.json")), "cli.js"), "test", "--max-failures=1", ...files]
  : [require.resolve("next/dist/bin/next"), "build"];
const start = Date.now(), evidence = "docs/deployment/evidence/phase7-local";
mkdirSync(evidence, { recursive: true });
console.log(JSON.stringify({ mode, localOnly: true, telegramDriverEnabled: Boolean(env.TELEGRAM_DATABASE_URL), files }));
const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const output = [];
for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { output.push(b.toString()); process.stdout.write(b); });
child.on("error", () => { console.error("LOCAL_RUNNER_START_FAILED"); process.exitCode = 1; });
child.on("close", code => {
  const label = files.length ? files.map(f => f.split("/").at(-1).split(".")[0]).join("_") : "all";
  writeFileSync(`${evidence}/${mode}-${label}-${start}.log`, output.join(""));
  writeFileSync(`${evidence}/${mode}-${label}-${start}.json`, JSON.stringify({ mode, files, startedAt: new Date(start).toISOString(), elapsedMs: Date.now() - start, exitCode: code, localOnly: true }));
  process.exitCode = code ?? 1;
});
