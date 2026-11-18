import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
export function prepareStagingMigrations(additions = []) {
 const manifest = JSON.parse(readFileSync("infrastructure/supabase/migrations.manifest.json", "utf8"));
 for (const item of manifest) {
  const text = readFileSync(`supabase/migrations/${item.file}`, "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(text).digest("hex"), item.sha256_lf, "Historical migration changed");
 }
    // Derived deployment copies change only DDL membership timing, never financial bodies.
    const directory = ".staging-migrations/supabase/migrations";
    mkdirSync(directory, { recursive: true });
    writeFileSync(".staging-migrations/supabase/config.toml", 'project_id = "finzi-staging"\n[db.seed]\nenabled = false\n');
    const adaptations = JSON.parse(readFileSync("infrastructure/supabase/migration-adaptations.json", "utf8"));
    for (const item of manifest) {
      let text = readFileSync(`supabase/migrations/${item.file}`, "utf8").replaceAll("\r\n", "\n");
      const adaptation = adaptations.find(a => a.file === item.file);
      if (adaptation?.action === "defer-revoke") {
        const revoke = "revoke app_executor from postgres;";
        assert.equal(text.split(revoke).length, 2);
        text = text.replace(revoke, "-- Revocation deferred until all owned functions are replaced.") + `\n${revoke}\n`;
      } else if (adaptation?.action === "bounded-membership") {
        text = `grant app_executor to postgres;\n${text}\nrevoke app_executor from postgres;\n`;
      } else if (adaptation?.action === "advance-grant") {
        const grant = "grant app_executor to postgres;";
        assert.equal(text.split(grant).length, 2);
        text = text.replace(grant, "-- Membership established before altering the existing function.").replace("begin;", `begin;\n${grant}`);
      } else if (adaptation?.action === "fixed-expenses-ddl") {
        const revoke = "revoke app_executor,finzi_deletion_worker from postgres;";
        const owner = "alter function ops.purge_profile(uuid,text) owner to finzi_deletion_worker;";
        assert.equal(text.split(revoke).length, 2);
        assert.equal(text.split(owner).length, 2);
        text = text.replace(revoke, "-- Defer membership revocation until the dynamic function replacement completes.")
          .replace(owner, `grant create on schema ops to finzi_deletion_worker;\n${owner}\nrevoke create on schema ops from finzi_deletion_worker;`) + `\n${revoke}\n`;
      }
      if (adaptation?.deferAppRevoke) {
        assert(text.includes("revoke app_executor from postgres;"));
        text = text.replaceAll("revoke app_executor from postgres;", "-- Defer revocation until final function ACL statements complete.");
        assert(/commit;\s*$/i.test(text));
        text = text.replace(/commit;\s*$/i, "revoke app_executor from postgres;\ncommit;\n");
      }
      writeFileSync(`${directory}/${item.file}`, text);
    }

 for(const item of additions) {
  assert(/^20[0-9]{12}_[a-z_]+\.sql$/.test(item.file));
  const text=readFileSync(`supabase/migrations/${item.file}`,"utf8").replaceAll("\r\n","\n");
  assert.equal(createHash("sha256").update(text).digest("hex"),item.sha256_lf,"Additive migration changed");
  writeFileSync(`${directory}/${item.file}`,text);
 }
}
