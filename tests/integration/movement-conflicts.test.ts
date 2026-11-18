import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { findMailLink } from "../helpers/mail";

const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Local synthetic tests only");
function sql(statement: string) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: statement, encoding: "utf8", stdio: "pipe" }).trim();
}
async function setup() {
  let financialCalls = 0;
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
    if (String(input).includes("/rpc/post_movement") || String(input).includes("/rpc/replace_movement")) financialCalls++;
    return fetch(input, { ...init, signal: AbortSignal.timeout(8000) });
  } } });
  const email = `cpu-local-${crypto.randomUUID()}@example.test`;
  expect((await c.auth.signUp({ email, password: "synthetic cpu remediation password 6482" })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
  expect(verified.error).toBeNull();
  expect((await c.schema("api").rpc("ensure_profile")).error).toBeNull();
  expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Synthetic CPU", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 })).error).toBeNull();
  const account = await c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Synthetic CPU", p_type: "cash", p_currency: "PEN", p_opening: "100" });
  expect(account.error).toBeNull();
  const categories = await c.schema("api").rpc("initialize_categories"); expect(categories.error).toBeNull();
  const category = categories.data.categories.find((v: { kind: string }) => v.kind === "income").id;
  return { c, uid: verified.data.user!.id, account: account.data.id as string, category, calls: () => financialCalls };
}
type Context = Awaited<ReturnType<typeof setup>>;
const payload = (x: Context) => ({ p_request_id: crypto.randomUUID(), p_kind: "income", p_account_id: x.account, p_category_id: x.category, p_amount: "1.00", p_description: "Synthetic CPU", p_note: "", p_occurred_at: null });
async function snapshot(x: Context) {
  const accounts = await x.c.schema("api").rpc("read_accounts"), movements = await x.c.schema("api").rpc("read_movements", { p_currency: "PEN", p_status: "all" });
  expect(accounts.error).toBeNull(); expect(movements.error).toBeNull();
  const ledger = sql(`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(t) order by t.id) from finance.transactions t where user_id='${x.uid}'),
    (select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from finance.transaction_entries e where user_id='${x.uid}'),
    (select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from finance.transaction_events e where user_id='${x.uid}')
  )::text);`);
  return { accounts: accounts.data, movements: movements.data, ledger };
}

describe("CPU business conflicts on local real PostgreSQL/Auth/PostgREST", () => {
  let a: Context, b: Context;
  beforeAll(async () => {
    // No reset or historical migration edits; apply the additive SQL to local only.
    const metadata = sql("select jsonb_build_array(proowner,proacl,prosecdef,proconfig) from pg_proc where oid='finance.write_movement(uuid,text,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer,text)'::regprocedure;");
    sql(readFileSync("supabase/migrations/20261116001000_movement_business_conflicts.sql", "utf8"));
    expect(sql("select jsonb_build_array(proowner,proacl,prosecdef,proconfig) from pg_proc where oid='finance.write_movement(uuid,text,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer,text)'::regprocedure;")).toBe(metadata);
    a = await setup(); b = await setup();
  });
  it("changed payload returns HTTP 409/PT409 once, with no financial effect or persistent backend", async () => {
    const p = payload(a), posted = await a.c.schema("api").rpc("post_movement", p); expect(posted.error).toBeNull();
    const before = await snapshot(a), calls = a.calls();
    const conflict = await a.c.schema("api").rpc("post_movement", { ...p, p_amount: "2.00" });
    expect(conflict.status).toBe(409); expect(conflict.error?.code).toBe("PT409"); expect(conflict.error?.message).toBe("idempotency_conflict");
    expect(a.calls() - calls).toBe(1); expect(await snapshot(a)).toEqual(before);
    const retry = await a.c.schema("api").rpc("post_movement", p); expect(retry.error).toBeNull(); expect(retry.data.id).toBe(posted.data.id);
    expect(sql("select count(*) from pg_stat_activity where usename='authenticator' and state like 'idle in transaction%';")).toBe("0");
  });
  it("obsolete version rolls back and preserves exact ledger, balances and history", async () => {
    const p = payload(a), posted = await a.c.schema("api").rpc("post_movement", p); expect(posted.error).toBeNull();
    const before = await snapshot(a), calls = a.calls();
    const conflict = await a.c.schema("api").rpc("replace_movement", { ...p, p_request_id: crypto.randomUUID(), p_id: posted.data.id, p_expected_version: 9, p_reason: "Synthetic correction", p_destination_id: null });
    expect(conflict.status).toBe(409); expect(conflict.error?.code).toBe("PT409"); expect(conflict.error?.message).toBe("movement_version_conflict");
    expect(a.calls() - calls).toBe(1); expect(await snapshot(a)).toEqual(before);
  });
  it("concurrent replacements have one successor and idempotent replay", async () => {
    const p = payload(a), original = await a.c.schema("api").rpc("post_movement", p); expect(original.error).toBeNull();
    const command = { ...p, p_id: original.data.id, p_expected_version: 1, p_reason: "Synthetic race", p_destination_id: null, p_amount: "2.00" };
    const commands = [0, 1].map(() => ({ ...command, p_request_id: crypto.randomUUID() }));
    const results = await Promise.all(commands.map(c => a.c.schema("api").rpc("replace_movement", c)));
    expect(results.filter(r => !r.error)).toHaveLength(1); expect(results.find(r => r.error)?.error?.code).toBe("PT409");
    const winner = results.findIndex(r => !r.error), before = await snapshot(a);
    const retry = await a.c.schema("api").rpc("replace_movement", commands[winner]); expect(retry.error).toBeNull(); expect(retry.data.id).toBe(results[winner].data.id);
    expect(await snapshot(a)).toEqual(before);
  });
  it("A/B ownership, private writer ACL and FORCE RLS remain enforced", async () => {
    const before = await snapshot(a), other = await snapshot(b);
    expect((await b.c.schema("api").rpc("post_movement", { ...payload(b), p_account_id: a.account })).error?.code).toBe("P0002");
    expect(await snapshot(a)).toEqual(before); expect(await snapshot(b)).toEqual(other);
    expect(sql("select has_function_privilege('authenticated','finance.write_movement(uuid,text,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer,text)','EXECUTE');")).toBe("f");
    expect(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance' and c.relkind='r' and c.relname<>'currencies' and (not c.relrowsecurity or not c.relforcerowsecurity);")).toBe("0");
  });
  it("a genuine engine serialization error remains 40001, distinct from PT409", async () => {
    // Local-only PostgreSQL race on a synthetic profile, never PostgREST.
    // Both writes keep the display name unchanged; no ledger rows are touched.
    const context = `set local role app_executor; select set_config('request.jwt.claims','{"sub":"${a.uid}","role":"authenticated"}',true);`;
    const child = spawn("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { stdio: "pipe" });
    let stdout = "", stderr = "";
    const finished = new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", chunk => { stdout += String(chunk); if (stdout.includes("cpu_snapshot_ready")) resolve(); });
      child.on("error", reject); child.on("close", () => reject(new Error("Local transaction ended before snapshot")));
    });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdin.end(`begin isolation level repeatable read; set local statement_timeout='3s'; ${context} select version from finance.profiles where user_id='${a.uid}'; select 'cpu_snapshot_ready'; select pg_sleep(1); update finance.profiles set display_name=display_name where user_id='${a.uid}'; commit;`);
    await ready;
    sql(`begin; ${context} update finance.profiles set display_name=display_name where user_id='${a.uid}'; commit;`);
    expect(await finished).not.toBe(0); expect(stderr).toContain("40001"); expect(stderr).not.toContain("PT409");
    expect(sql("select position('exception when' in lower(prosrc))=0 from pg_proc where oid='finance.write_movement(uuid,text,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer,text)'::regprocedure;")).toBe("t");
  });
});
