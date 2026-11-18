import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { manifestStore, type ManifestDatabase } from "../../deletion-worker/manifests.ts";
import { runCheckpoint, type Action, type Database, type Failure, type Job, type Provider } from "../../deletion-worker/protocol.ts";

const url = process.env.SUPABASE_URL!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("local_only");
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
function query(statement: string, role = "supabase_admin") {
  if (!["supabase_admin", "finzi_deletion_gateway", "authenticated", "finzi_deletion_worker"].includes(role)) throw new Error("fixture_role_invalid");
  const result = execFileSync("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
    input: `begin;set local role ${role};${statement};commit;`, encoding: "utf8", stdio: "pipe",
  }).trim();
  return result ? JSON.parse(result.split("\n").at(-1)!) : null;
}
const rpc = (expr: string) => query(`select ${expr}`, "finzi_deletion_gateway");
const db: Database = {
  async claim(lease) { return rpc(`ops.cloud_deletion_claim(${quote(lease)})`); },
  async inspect(j) { return rpc(`ops.cloud_deletion_inspect(${quote(j.id)},${quote(j.lease)})`); },
  async step(j: Job, action: Action, digest?: string) { rpc(`to_jsonb(ops.cloud_deletion_step(${quote(j.id)},${quote(j.lease)},${quote(action)},${digest ? quote(digest) : "null"}))`); },
  async fail(j: Job, code: Failure) { rpc(`to_jsonb(ops.cloud_deletion_fail(${quote(j.id)},${quote(j.lease)},${quote(code)}))`); },
};
function sqliteStore() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(readFileSync("infrastructure/deletion/0001_manifests.sql", "utf8"));
  const d1: ManifestDatabase = { withSession() { return { prepare(statement) {
    let values: string[] = [];
    return { bind(...args) { values = args as string[]; return this; }, async run() { return sqlite.prepare(statement).run(...values); }, async first<T>() { return (sqlite.prepare(statement).get(...values) ?? null) as T | null; } };
  } }; } };
  return manifestStore(d1, "e".repeat(64));
}
const lease = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
describe("Phase 4 actual local PostgreSQL/Auth/Storage checkpoints", () => {
  let a: SupabaseClient, b: SupabaseClient, admin: SupabaseClient, uid: string, bid: string, receipt: string, token: string;
  const bot = String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, "0"), peer = "890000000001", otherPeer = "890000000002";
  let trackingHash: string;
  const flowA=crypto.randomUUID(),flowB=crypto.randomUUID();
  let custody: Awaited<ReturnType<typeof manifestStore>>, operations: Provider;
  const phase = () => query(`select to_jsonb(c) from ops.cloud_deletion_jobs c where receipt_id=${quote(receipt)}`);
  const remaining = () => query(`select ops.deletion_remaining(${quote(uid)},${quote(receipt)})`);
  const ready = () => query(`update ops.deletion_receipts set next_retry_at=null where id=${quote(receipt)}`);
  const run = () => runCheckpoint(db, custody, operations);
  beforeAll(async () => {
    if (query("select to_jsonb(count(*)) from ops.cloud_deletion_jobs where state<>'COMPLETED' and not halted") !== 0) throw new Error("review_existing_local_cloud_fixtures_first");
    const { runSupabase } = await import("../../scripts/supabase-cli.mjs");
    const local = JSON.parse(runSupabase(["status", "-o", "json"]));
    if (local.API_URL !== url) throw new Error("fixture_instance_mismatch");
    admin = createClient(url, local.SECRET_KEY ?? local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    async function setup() {
      const email = `cloud-deletion-${crypto.randomUUID()}@example.test`, password = "synthetic deletion worker passphrase 2026";
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
      const c = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      expect((await c.auth.signInWithPassword({ email, password })).error).toBeNull();
      expect((await c.schema("api").rpc("ensure_profile")).error).toBeNull();
      expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Synthetic deletion", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 })).error).toBeNull();
      expect((await c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Synthetic", p_type: "cash", p_currency: "PEN", p_opening: "100" })).error).toBeNull();
      return { c, id: created.data.user!.id };
    }
    const aa = await setup(), bb = await setup(); a = aa.c; uid = aa.id; b = bb.c; bid = bb.id;
    query(`insert into auth.flow_state(id,user_id,provider_type,authentication_method,code_challenge_method,code_challenge,created_at,updated_at)
      values('${flowA}','${uid}','email','email','s256','synthetic',now(),now()),('${flowB}','${bid}','email','email','s256','synthetic',now(),now())`);
    const categories = await a.schema("api").rpc("initialize_categories"); expect(categories.error).toBeNull();
    const account = (await a.schema("api").rpc("read_accounts")).data[0];
    expect((await a.schema("api").rpc("post_movement", { p_request_id: crypto.randomUUID(), p_kind: "expense", p_account_id: account.id, p_category_id: categories.data.categories.find((v: { kind: string }) => v.kind === "expense").id, p_amount: "25", p_description: "Synthetic deletion", p_note: "", p_occurred_at: null })).error).toBeNull();
    const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).webp().toBuffer();
    expect((await a.storage.from("category-images").upload(`${uid}/fixture.webp`, image, { contentType: "image/webp" })).error).toBeNull();
    // No Telegram request: local fixtures represent encrypted transport tied to A/B.
    query(`insert into telegram_private.transport_bots(bot_id,mode) values('${bot}','webhook');
      insert into telegram_private.links(user_id,bot_id,telegram_user_id,chat_id,capability_hash) values('${uid}','${bot}','${peer}','${peer}',sha256(convert_to('${uid}','UTF8'))),('${bid}','${bot}','${otherPeer}','${otherPeer}',sha256(convert_to('${bid}','UTF8')));
      insert into telegram_private.transport_events(bot_id,update_id,telegram_user_id,chat_id,event_type,payload_hash,payload_ciphertext) values('${bot}',1,'${peer}','${peer}','message','${"a".repeat(64)}','${"c".repeat(32)}'),('${bot}',2,'${otherPeer}','${otherPeer}','message','${"b".repeat(64)}','${"d".repeat(32)}');
      insert into telegram_private.transport_credentials(bot_id,telegram_user_id,challenge_hash,ciphertext) values('${bot}','${peer}','${"a".repeat(64)}','${"c".repeat(32)}')`);
    const proof = await a.schema("api").rpc("issue_reauth_proof", { p_purpose: "delete_account" }); expect(proof.error).toBeNull();
    receipt = crypto.randomUUID(); token = lease();
    expect((await a.schema("api").rpc("request_deletion", { p_request_id: receipt, p_tracking_token: token, p_proof: proof.data.token, p_confirmation: "ELIMINAR" })).error).toBeNull();
    // Opt in exactly this synthetic receipt; the global cloud switch stays false.
    query(`insert into ops.cloud_deletion_jobs(receipt_id) values(${quote(receipt)})`);
    trackingHash = query(`select to_jsonb(encode(tracking_hash,'hex')) from ops.deletion_receipts where id=${quote(receipt)}`);
    custody = await sqliteStore();
    operations = {
      async removeFiles(files) { const result = await admin.storage.from(files[0].bucket).remove(files.map(f => f.path)); if (result.error) throw new Error("storage_unavailable"); },
      async removeIdentity(id) { const r = await admin.auth.admin.deleteUser(id); if (r.error && r.error.code !== "user_not_found") throw new Error("auth_unavailable"); },
      async identityAbsent(id) { const r = await admin.auth.admin.getUserById(id); if (r.error && r.error.code !== "user_not_found") throw new Error("auth_unavailable"); return r.error?.code === "user_not_found"; },
    };
  });
  it("blocks residual JWT writes, keeps public receipt pending and isolates B", async () => {
    expect(phase().state).toBe("PENDING");
    expect((await a.storage.from("category-images").upload(`${uid}/late.png`, new Uint8Array([1]), { contentType: "image/png" })).error).not.toBeNull();
    expect((await a.schema("api").rpc("read_accounts")).error?.code).toBe("42501");
    expect((await b.schema("api").rpc("read_accounts")).data[0].balance_minor).toBe("10000");
    expect(query("select to_jsonb(cloud_enabled) from ops.deletion_runtime_settings")).toBe(false);
  });
  it("stores an independent manifest and advances only to PROCESSING", async () => {
    expect(await run()).toBe("advanced"); expect(phase().state).toBe("PROCESSING"); expect(remaining().storage).toBe(1); expect(remaining().database).toBeGreaterThan(0);
    expect(remaining().transport).toBe(2);
    expect(() => query(`insert into telegram_private.transport_events(bot_id,update_id,telegram_user_id,chat_id,event_type,payload_hash) values('${bot}',3,'${peer}','${peer}','message','${"e".repeat(64)}')`)).toThrow();
  });
  it("grants only one simultaneous lease; fences expiry, forged leases and phase skipping", async () => {
    const concurrentClaim = async () => {
      const { stdout } = await promisify(execFile)("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-c",
        `begin;set local role finzi_deletion_gateway;select ops.cloud_deletion_claim(${quote(lease())});select pg_sleep(0.2);commit;`]);
      return stdout.trim() ? JSON.parse(stdout.trim()) as Job : null;
    };
    const claimed = await Promise.all([concurrentClaim(), concurrentClaim()]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    const first = claimed.find(Boolean)!; expect(first.id).toBe(receipt);
    await expect(db.step(first!, "complete", first!.manifest_digest!)).rejects.toThrow();
    await expect(db.inspect({ ...first!, lease: "0".repeat(64) })).rejects.toThrow();
    query(`update ops.deletion_receipts set lease_until=clock_timestamp()+interval '20 seconds' where id=${quote(receipt)}`);
    await expect(db.inspect(first!)).rejects.toThrow();
    query(`update ops.deletion_receipts set lease_until=clock_timestamp()-interval '1 second' where id=${quote(receipt)}`);
    const replacement = await db.claim(lease()); expect(replacement?.id).toBe(receipt);
    await expect(db.step(first!, "storage")).rejects.toThrow();
    await db.fail(replacement!, "timeout"); ready();
  });
  it("bounds failures and crashed leases at eight attempts; operator review can resume the same checkpoint", async () => {
    // Earlier fencing assertions consumed two attempts, so set up this boundary explicitly.
    query(`update ops.cloud_deletion_jobs set attempts=7 where receipt_id=${quote(receipt)}`);
    const last = await db.claim(lease()); expect(last?.id).toBe(receipt);
    query(`update ops.deletion_receipts set lease_until=clock_timestamp()-interval '1 second' where id=${quote(receipt)}`);
    expect(await db.claim(lease())).toBeNull(); expect(phase()).toMatchObject({ attempts: 8, halted: true, error_code: "timeout", state: "PROCESSING" });
    await expect(db.inspect(last!)).rejects.toThrow();
    // A scoped local maintenance action models explicit operator approval, never automatic recovery.
    query(`update ops.cloud_deletion_jobs set attempts=0,halted=false,error_code=null where receipt_id=${quote(receipt)}`); ready();
    query(`update ops.cloud_deletion_jobs set attempts=7 where receipt_id=${quote(receipt)}`);
    const failure = await db.claim(lease()); await db.fail(failure!, "storage");
    expect(await db.claim(lease())).toBeNull(); expect(phase()).toMatchObject({ attempts: 8, halted: true, error_code: "storage" });
    query(`update ops.cloud_deletion_jobs set attempts=0,halted=false,error_code=null where receipt_id=${quote(receipt)}`); ready();
  });
  it("a Storage failure preserves SQL financial data and retries from the same checkpoint", async () => {
    const failing = { ...operations, async removeFiles() { throw new Error("injected_storage_failure"); } };
    expect(await runCheckpoint(db, custody, failing)).toBe("deferred"); expect(phase().state).toBe("PROCESSING"); expect(remaining().storage).toBe(1);
    expect(query(`select to_jsonb(count(*)) from finance.transactions where user_id=${quote(uid)}`)).toBe(1);
    expect(await db.claim(lease())).toBeNull(); ready();
    expect(await run()).toBe("advanced"); expect(phase().state).toBe("STORAGE_PURGED"); expect(remaining().storage).toBe(0);
  });
  it("a database failure rolls back the entire purge without falsely advancing", async () => {
    // A transient fixture table deliberately makes the completeness verifier reject the purge.
    query(`create table finance.deletion_test_residual(user_id uuid);insert into finance.deletion_test_residual values(${quote(uid)})`);
    try {
      expect(await run()).toBe("deferred"); expect(phase().state).toBe("STORAGE_PURGED");
      expect(query(`select to_jsonb(count(*)) from finance.transactions where user_id=${quote(uid)}`)).toBe(1);
    } finally { query("drop table finance.deletion_test_residual"); }
    ready();
    expect(await run()).toBe("advanced"); expect(phase().state).toBe("DATABASE_PURGED"); expect(remaining().database).toBe(0);
    expect(remaining().transport).toBe(0);
    expect(query(`select to_jsonb(count(*)) from telegram_private.transport_events where bot_id='${bot}' and telegram_user_id='${otherPeer}'`)).toBe(1);
  });
  it("Auth failure retains DATABASE_PURGED and does not delete B", async () => {
    expect(await runCheckpoint(db, custody, { ...operations, async removeIdentity() { throw new Error("injected_auth_failure"); } })).toBe("deferred");
    expect(phase().state).toBe("DATABASE_PURGED"); expect(remaining().auth).toBeGreaterThan(0); ready();
    expect((await admin.auth.admin.getUserById(bid)).error).toBeNull();
  });
  it("recovers a crash after Auth deletion, including idempotent 404 on replay", async () => {
    const claimed = await db.claim(lease()); expect(claimed?.state).toBe("DATABASE_PURGED");
    await expect(db.step({...claimed!,lease:lease()},"auth")).rejects.toThrow();
    await expect(db.step(claimed!,"auth")).rejects.toThrow();
    expect(query(`select to_jsonb(count(*)) from auth.flow_state where id='${flowA}'`)).toBe(1);
    await operations.removeIdentity(uid); // Crash before persisting the Auth checkpoint.
    await expect(db.step({...claimed!,lease:lease()},"auth")).rejects.toThrow();
    expect(query(`select to_jsonb(count(*)) from auth.flow_state where id='${flowA}'`)).toBe(1);
    expect(phase().state).toBe("DATABASE_PURGED");
    query(`update ops.deletion_receipts set lease_until=clock_timestamp()-interval '1 second' where id=${quote(receipt)}`);
    expect(await run()).toBe("advanced"); expect(phase().state).toBe("AUTH_PURGED"); expect(remaining().auth).toBe(0);
  });
  it("verifies all stores before completion, then retires subject/block and leases", async () => {
    expect(await run()).toBe("advanced"); expect(phase().state).toBe("VERIFIED");
    expect(query(`select to_jsonb(stage) from ops.deletion_receipts where id=${quote(receipt)}`)).toBe("identity_pending");
    expect(await run()).toBe("advanced"); expect(phase().state).toBe("COMPLETED");
    expect(remaining()).toEqual({ database: 0, auth: 0, storage: 0, transport: 0 });
    expect(query(`select to_jsonb(count(*)) from ops.deletion_subjects where receipt_id=${quote(receipt)}`)).toBe(0);
    const c = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    expect((await c.schema("api").rpc("deletion_status", { p_id: receipt, p_tracking_token: token })).data.status).toBe("completed");
    expect((await b.schema("api").rpc("read_accounts")).data[0].balance_minor).toBe("10000");
    expect((await a.storage.from("category-images").upload(`${uid}/resurrect.png`, new Uint8Array([1]), { contentType: "image/png" })).error).not.toBeNull();
    expect(await run()).toBe("idle");
  });
  it("never grants direct financial access, maintenance restore or RLS bypass", () => {
    expect(query(`select to_jsonb(count(*)) from auth.flow_state where id='${flowA}'`)).toBe(0);
    expect(query(`select to_jsonb(count(*)) from auth.flow_state where id='${flowB}'`)).toBe(1);
    expect(() => rpc("to_jsonb((select count(*) from finance.accounts))")).toThrow();
    expect(() => rpc("to_jsonb((select count(*) from ops.deletion_receipts))")).toThrow();
    expect(() => rpc(`to_jsonb(ops.restore_deletion(${quote(receipt)},${quote(bid)},${quote("a".repeat(64))}))`)).toThrow();
    expect(query("select jsonb_build_object('super',rolsuper,'bypass',rolbypassrls,'inherit',rolinherit) from pg_roles where rolname='finzi_deletion_gateway'")).toEqual({ super: false, bypass: false, inherit: false });
    expect(query("select to_jsonb(count(*)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('finance','ops','telegram_private') and c.relkind='r' and c.oid<>'finance.currencies'::regclass and (not c.relrowsecurity or not c.relforcerowsecurity)")).toBe(0);
  });
  it("reapplies independent custody after a restore, without resurrecting a completed receipt", async () => {
    const recreated = await admin.auth.admin.createUser({ id: uid, email: `restored-cloud-${uid}@example.test`, password: "synthetic restore phrase 2026", email_confirm: true }); expect(recreated.error).toBeNull();
    // Maintenance role is deliberately separate from the Worker gateway.
    expect(query(`select to_jsonb(ops.restore_deletion('${receipt}','${uid}','${trackingHash}'))`)).toBe(true);
    expect(phase().state).toBe("PENDING");
    // The surviving manifest digest is verified and reused: no new manifest write.
    for (let n = 0; n < 5; n++) expect(await run()).toBe("advanced");
    expect(phase().state).toBe("COMPLETED");
    expect(remaining()).toEqual({ database: 0, auth: 0, storage: 0, transport: 0 });
    expect((await b.schema("api").rpc("read_accounts")).data[0].balance_minor).toBe("10000");
    expect(await run()).toBe("idle");
  });
});
