import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { unstable_dev } from "wrangler";

// No credentials, Supabase, Telegram, cloud resources or financial operations.
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_WRITE_LOGS = "false";
const root = mkdtempSync(join(tmpdir(), "finzi-deletion-workerd-"));
let worker;
const options = { config: "wrangler.deletion.jsonc", vars: { DELETION_ENABLED: "false", DELETION_MANIFEST_KEY: "e".repeat(64) },
  port: 0, local: true, persist: true, persistTo: root, logLevel: "error",
  experimental: { disableExperimentalWarning: true, watch: false, disableDevRegistry: true } };
try {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(dirname(require.resolve("wrangler"))), "bin", "wrangler.js");
  execFileSync(process.execPath, [cli, "d1", "migrations", "apply", "DELETION_MANIFESTS", "--local", "--config", "wrangler.deletion.jsonc", "--persist-to", root], { stdio: "pipe" });
  worker = await unstable_dev("tests/runtime/deletion-entry.ts", options);
  const call = path => worker.fetch("http://localhost" + path, { method: "POST" });
  assert.equal((await worker.fetch("http://localhost/")).status, 404);
  assert.equal((await call("/__scheduled_disabled")).status, 204);
  const first = await (await call("/__save")).json(); assert.equal(first.plaintextPresent, false); assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(await (await call("/__save")).json(), first);
  assert.equal((await call("/__mutate")).status, 409);
  await worker.stop(); worker = undefined;
  worker = await unstable_dev("tests/runtime/deletion-entry.ts", options);
  assert.deepEqual(await (await call("/__verify")).json(), first);
  console.log("Deletion workerd: 6 checks passed (404, disabled scheduled, encrypted D1, immutable insert/replay, mutation rejection, restart). No external operations.");
} finally {
  await worker?.stop();
  // Only the exact temporary fixture created above can be removed.
  const target = resolve(root), insideTemp = relative(resolve(tmpdir()), target);
  assert(insideTemp.startsWith("finzi-deletion-workerd-") && !insideTemp.includes("..") && !isAbsolute(insideTemp));
  rmSync(target, { recursive: true, force: true });
}
