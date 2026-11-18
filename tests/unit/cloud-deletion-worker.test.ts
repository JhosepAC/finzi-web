import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { runCheckpoint, type Database, type Job, type Provider, type Inspection, type State } from "../../deletion-worker/protocol.ts";
import { manifestStore, type ManifestDatabase } from "../../deletion-worker/manifests.ts";
import { provider } from "../../deletion-worker/provider.ts";
import { databaseOptions } from "../../deletion-worker/database.ts";
import worker, { scheduledCheckpoint, type Env } from "../../deletion-worker/worker.ts";

const job = (state: State = "PROCESSING"): Job => ({ id: crypto.randomUUID(), user_id: crypto.randomUUID(), tracking_hash: "b".repeat(64), lease: "c".repeat(64), state, manifest_digest: "a".repeat(64) });
const empty: Inspection = { database: 0, auth: 0, storage: 0, transport: 0, files: [] };
function fixture(state: State = "PROCESSING") {
  const j = job(state);
  const db: Database = { claim: vi.fn(async () => j), inspect: vi.fn(async () => empty), step: vi.fn(async () => {}), fail: vi.fn(async () => {}) };
  const manifests = { save: vi.fn(async () => "a".repeat(64)), verify: vi.fn(async () => "a".repeat(64)) };
  const api: Provider = { removeFiles: vi.fn(async () => {}), removeIdentity: vi.fn(async () => {}), identityAbsent: vi.fn(async () => true) };
  return { j, db, manifests, api, run: () => runCheckpoint(db, manifests, api) };
}
export function sqliteManifests() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync("infrastructure/deletion/0001_manifests.sql", "utf8"));
  const db: ManifestDatabase = {
    withSession(mode) {
      expect(mode).toBe("first-primary");
      return { prepare(query) {
        let values: (string | number | null)[] = [];
        return {
          bind(...args: unknown[]) { values = args as typeof values; return this; },
          async run() { return sql.prepare(query).run(...values); },
          async first<T>() { return (sql.prepare(query).get(...values) ?? null) as T | null; },
        };
      } };
    },
  };
  return { sql, db };
}
describe("cloud deletion fenced checkpoints", () => {
  it("does not work or connect when Cron is disabled; fetch has no deletion endpoint", async () => {
    await scheduledCheckpoint({ DELETION_ENABLED: "false" } as Env);
    expect(worker.fetch().status).toBe(404);
  });
  it("idle claims do not touch external services", async () => {
    const f = fixture(); vi.mocked(f.db.claim).mockResolvedValue(null);
    expect(await f.run()).toBe("idle"); expect(f.manifests.verify).not.toHaveBeenCalled();
  });
  it("rejects malformed subjects before privileged external calls", async () => {
    const f = fixture(); f.j.user_id = "arbitrary";
    await expect(f.run()).rejects.toThrow("invalid_job"); expect(f.api.removeIdentity).not.toHaveBeenCalled();
  });
  it("records durable independent manifest before the first destructive step", async () => {
    const f = fixture(); f.j.manifest_digest = null;
    expect(await f.run()).toBe("advanced"); expect(f.db.step).toHaveBeenCalledWith(f.j, "manifest", "a".repeat(64));
    expect(f.api.removeFiles).not.toHaveBeenCalled(); expect(f.api.removeIdentity).not.toHaveBeenCalled();
  });
  it.each([
    ["PROCESSING", "storage"], ["STORAGE_PURGED", "database"], ["DATABASE_PURGED", "auth"], ["AUTH_PURGED", "verify"], ["VERIFIED", "complete"],
  ] as const)("advances exactly one checkpoint from %s", async (state, action) => {
    const f = fixture(state); expect(await f.run()).toBe("advanced");
    expect(f.db.step).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.db.step).mock.calls[0].slice(0, 2)).toEqual([f.j, action]);
  });
  it.each(["missing", "mismatch"])("manifest %s stops all destructive operations", async reason => {
    const f = fixture("DATABASE_PURGED");
    if (reason === "missing") vi.mocked(f.manifests.verify).mockRejectedValue(new Error("SECRET"));
    else vi.mocked(f.manifests.verify).mockResolvedValue("d".repeat(64));
    expect(await f.run()).toBe("deferred"); expect(f.api.removeIdentity).not.toHaveBeenCalled();
    expect(f.db.fail).toHaveBeenCalledWith(f.j, "manifest");
  });
  it("deletes one bounded page then yields only on actual progress", async () => {
    const f = fixture(); vi.mocked(f.db.inspect).mockResolvedValueOnce({ ...empty, storage: 51, files: [{ bucket: "x", path: "y" }] }).mockResolvedValueOnce({ ...empty, storage: 1 });
    expect(await f.run()).toBe("advanced"); expect(f.db.step).toHaveBeenCalledWith(f.j, "yield"); expect(f.api.removeFiles).toHaveBeenCalledTimes(1);
  });
  it.each(["no_progress", "no_inventory", "excess_inventory", "mixed_buckets", "provider_failure"])("storage %s preserves the database", async reason => {
    const f = fixture();
    const files = reason === "no_inventory" ? [] : reason === "excess_inventory" ? Array.from({ length: 51 }, () => ({ bucket: "x", path: "y" })) : reason === "mixed_buckets" ? [{ bucket: "x", path: "y" }, { bucket: "z", path: "y" }] : [{ bucket: "x", path: "y" }];
    vi.mocked(f.db.inspect).mockResolvedValue({ ...empty, storage: 2, files });
    if (reason === "provider_failure") vi.mocked(f.api.removeFiles).mockRejectedValue(new Error("SECRET"));
    expect(await f.run()).toBe("deferred"); expect(f.db.step).not.toHaveBeenCalled(); expect(f.db.fail).toHaveBeenCalledWith(f.j, "storage");
  });
  it("Auth failure does not replay Storage or database purge", async () => {
    const f = fixture("DATABASE_PURGED"); vi.mocked(f.api.removeIdentity).mockRejectedValue(new Error("SECRET"));
    expect(await f.run()).toBe("deferred"); expect(f.db.fail).toHaveBeenCalledWith(f.j, "auth");
    expect(f.api.removeFiles).not.toHaveBeenCalled(); expect(f.db.step).not.toHaveBeenCalled();
  });
  it("revalidates the lease before destructive Auth access, even after slow custody verification", async () => {
    const f = fixture("DATABASE_PURGED"); vi.mocked(f.db.inspect).mockRejectedValue(new Error("lease_expired"));
    expect(await f.run()).toBe("deferred"); expect(f.api.removeIdentity).not.toHaveBeenCalled();
  });
  it("post-Auth crash/retry tolerates an already absent identity", async () => {
    const f = fixture("DATABASE_PURGED"); vi.mocked(f.db.step).mockRejectedValueOnce(new Error("connection_lost"));
    expect(await f.run()).toBe("deferred"); expect(await f.run()).toBe("advanced");
    expect(f.api.removeIdentity).toHaveBeenCalledTimes(2);
  });
  it.each(["database", "auth", "storage", "transport"] as const)("cannot complete when %s remains", async field => {
    const f = fixture("VERIFIED"); vi.mocked(f.db.inspect).mockResolvedValue({ ...empty, [field]: 1 });
    expect(await f.run()).toBe("deferred"); expect(f.db.step).not.toHaveBeenCalled(); expect(f.db.fail).toHaveBeenCalledWith(f.j, "verification");
  });
  it("cannot overwrite a lease after a failure", async () => {
    const f = fixture(); vi.mocked(f.db.step).mockRejectedValue(new Error("expired")); vi.mocked(f.db.fail).mockRejectedValue(new Error("expired"));
    expect(await f.run()).toBe("deferred"); expect(f.db.claim).toHaveBeenCalledTimes(1);
  });
});
describe("independent encrypted custody on SQLite/D1", () => {
  it("is immutable, encrypted, concurrent-idempotent and survives a new store instance", async () => {
    const { db, sql } = sqliteManifests(), store = await manifestStore(db, "f".repeat(64)), j = job();
    const [a, b] = await Promise.all([store.save(j), store.save(j)]);
    expect(a).toBe(b); expect(await (await manifestStore(db, "f".repeat(64))).verify(j)).toBe(a);
    const raw = JSON.stringify(sql.prepare("select * from deletion_manifests").get());
    expect(raw).not.toContain(j.user_id); expect(raw).not.toContain(j.tracking_hash);
    expect(() => sql.exec("update deletion_manifests set envelope='{}'")).toThrow("immutable_manifest");
    expect(() => sql.exec("delete from deletion_manifests")).toThrow("immutable_manifest"); sql.close();
  });
  it("fails closed for wrong key, absent custody or incompatible subject", async () => {
    const { db, sql } = sqliteManifests(), store = await manifestStore(db, "f".repeat(64)), j = job();
    await expect(store.verify(j)).rejects.toThrow("manifest_missing"); await store.save(j);
    await expect((await manifestStore(db, "e".repeat(64))).verify(j)).rejects.toThrow();
    await expect(store.save({ ...j, user_id: crypto.randomUUID() })).rejects.toThrow("manifest_incompatible");
    await expect(manifestStore(db, "bad")).rejects.toThrow("manifest_key_invalid"); sql.close();
    await expect(manifestStore(undefined as unknown as ManifestDatabase, "f".repeat(64))).rejects.toThrow("manifest_binding_invalid");
  });
});
describe("restricted production adapters", () => {
  const base = "https://mkzclztzyqdmftesnwcw.supabase.co";
  it.each(["http://mkzclztzyqdmftesnwcw.supabase.co", "https://other.supabase.co", "https://mkzclztzyqdmftesnwcw.supabase.co/path"])("rejects provider %s", value => expect(() => provider(value, "synthetic")).toThrow());
  it.each([401, 403, 429, 500, 404])("does not mistake HTTP %s for verified absence or retry", async status => {
    const request = vi.fn(async () => new Response("{}", { status }));
    await expect(provider(base, "synthetic", request).identityAbsent(crypto.randomUUID())).rejects.toThrow("auth_unavailable"); expect(request).toHaveBeenCalledTimes(1);
  });
  it("accepts only the provider's precise user_not_found and forbids redirects", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ code: "user_not_found" }, { status: 404 }));
    expect(await provider(base, "synthetic", request).identityAbsent(crypto.randomUUID())).toBe(true);
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "GET" });
  });
  it("pins TLS, database role, staging, port and bounded connection settings", () => {
    const good = "postgresql://finzi_deletion_gateway.mkzclztzyqdmftesnwcw:synthetic@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";
    expect(databaseOptions(good)).toMatchObject({ ssl: { rejectUnauthorized: true }, max: 1, prepare: false, connection: { statement_timeout: 10000 } });
    for (const bad of [good + "?sslmode=disable", good.replace("6543", "5432"), good.replace("finzi_deletion_gateway", "postgres"), good.replace("mkzclztzyqdmftesnwcw", "production"), good.replace("aws-0-sa-east-1.pooler.supabase.com", "localhost")]) expect(() => databaseOptions(bad)).toThrow("database_configuration_invalid");
  });
});
