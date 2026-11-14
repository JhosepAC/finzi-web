import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function signup(complete = true) {
  const c = client(), email = `accounts-${crypto.randomUUID()}@example.test`;
  expect((await c.auth.signUp({ email, password: "una frase de prueba para cuentas 64" })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
  expect(verified.error).toBeNull(); await c.schema("api").rpc("ensure_profile");
  if (complete) expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Prueba cuentas", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 })).error).toBeNull();
  return { c, uid: verified.data.user!.id };
}
function sql(uid: string, statement: string) {
  if (!/^[a-f0-9-]{36}$/i.test(uid)) throw new Error("UUID inválido.");
  return execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", `begin; set local role app_executor; select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true); ${statement}; commit;`], { encoding: "utf8", stdio: "pipe" });
}
function denied(uid: string, statement: string, code: string) {
  let message = ""; try { sql(uid, statement); } catch (error) { message = String((error as { stderr: string }).stderr); }
  expect(message).toContain(code);
}
const requestId = crypto.randomUUID();
const creation = { p_request_id: requestId, p_name: "Mi cuenta", p_type: "bank", p_currency: "PEN", p_opening: "1234.56" };
describe("cuentas: PostgreSQL, roles e idempotencia reales", () => {
  let a: SupabaseClient, b: SupabaseClient, uid: string, idA: string, idB: string, openingAt: string;
  beforeAll(async () => { const aa = await signup(), bb = await signup(); a = aa.c; uid = aa.uid; b = bb.c; });
  it("lectura vacía y alta exacta con fecha de servidor", async () => {
    expect((await a.schema("api").rpc("read_accounts")).data).toEqual([]);
    const result = await a.schema("api").rpc("create_account", creation);
    expect(result.error).toBeNull(); idA = result.data.id; openingAt = result.data.opening_at;
    expect(idA).not.toBe(requestId); expect(result.data.opening_minor).toBe("123456"); expect(result.data.version).toBe(1);
    expect(Date.parse(openingAt)).toBeLessThanOrEqual(Date.now() + 1000);
  });
  it("reintento conserva ID, versión y una sola fila de auditoría", async () => {
    const result = await a.schema("api").rpc("create_account", creation);
    expect(result.error).toBeNull(); expect(result.data.id).toBe(idA); expect(result.data.version).toBe(1);
    expect(sql(uid, "select count(*) from finance.account_events")).toContain("\n1\n");
    expect((await a.schema("api").rpc("create_account", { ...creation, p_name: "Distinto" })).error?.code).toBe("40001");
  });
  it("otra persona puede usar la misma clave sin colisionar ni acceder a A", async () => {
    const result = await b.schema("api").rpc("create_account", creation); expect(result.error).toBeNull(); idB = result.data.id;
    expect(idB).not.toBe(idA); expect((await b.schema("api").rpc("read_accounts")).data.map((row: { id: string }) => row.id)).toEqual([idB]);
    const foreign = { p_id: idA, p_name: "Intrusión", p_opening: "0", p_archived: false, p_expected_version: 1 };
    expect((await b.schema("api").rpc("update_account", foreign)).error?.code).toBe("P0002");
    expect((await b.schema("api").rpc("update_account", { ...foreign, p_id: crypto.randomUUID() })).error?.code).toBe("P0002");
    expect((await a.schema("api").rpc("create_account", { ...creation, user_id: "otro" })).error).not.toBeNull();
  });
  it.each([{ p_opening: "NaN" }, { p_opening: "Infinity" }, { p_opening: "1e3" }, { p_opening: "1.001" }, { p_opening: "10000000000000000" }, { p_currency: "EUR" }, { p_type: "credit" }, { p_name: " " }])("SQL rechaza datos inválidos %j antes de persistir", async (change) => {
    expect((await a.schema("api").rpc("create_account", { ...creation, p_request_id: crypto.randomUUID(), ...change })).error?.code).toBe("23514");
    expect((await a.schema("api").rpc("read_accounts")).data).toHaveLength(1);
  });
  it("edita apertura negativa, archiva y reintenta sin cambiar moneda/fecha", async () => {
    const update = { p_id: idA, p_name: "Mi cuenta corregida", p_opening: "-0.50", p_archived: true, p_expected_version: 1 };
    const result = await a.schema("api").rpc("update_account", update);
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({ opening_minor: "-50", status: "archived", currency_code: "PEN", opening_at: openingAt, version: 2 });
    expect((await a.schema("api").rpc("update_account", update)).data.version).toBe(2);
    expect((await a.schema("api").rpc("update_account", { ...update, p_name: "Edición obsoleta" })).error?.code).toBe("40001");
  });
  it("serializa ediciones concurrentes y permite restaurar", async () => {
    const results = await Promise.all(["Nombre A", "Nombre B"].map((p_name) => a.schema("api").rpc("update_account", { p_id: idA, p_name, p_opening: "0", p_archived: true, p_expected_version: 2 })));
    expect(results.filter((r) => !r.error)).toHaveLength(1); expect(results.filter((r) => r.error?.code === "40001")).toHaveLength(1);
    const name = results.find((r) => !r.error)!.data.name;
    const result = await a.schema("api").rpc("update_account", { p_id: idA, p_name: name, p_opening: "0", p_archived: false, p_expected_version: 3 });
    expect(result.data).toMatchObject({ status: "active", version: 4 });
  });
  it("RLS efectivo, FK de dueño, auditoría append-only e identidad inmutable", () => {
    expect(sql(uid, `select count(*) from finance.accounts where id='${idB}'; update finance.accounts set name='intrusion' where id='${idB}'`)).toContain("UPDATE 0");
    denied(uid, `insert into finance.account_events(user_id,account_id,action,version) values('${uid}','${idB}','created',1)`, "23503");
    denied(uid, "update finance.account_events set action='updated'", "42501");
    denied(uid, `update finance.accounts set currency_code='USD', version=version+1 where id='${idA}'`, "23514");
    denied(uid, `update finance.accounts set opening_at=now()+interval '1 day', version=version+1 where id='${idA}'`, "23514");
    denied(uid, `update finance.accounts set opening_balance='NaN', version=version+1 where id='${idA}'`, "23514");
  });
  it("anónimo no ejecuta RPC y un perfil sin completar no crea cuentas", async () => {
    expect((await client().schema("api").rpc("read_accounts")).error).not.toBeNull();
    expect((await client().schema("api").rpc("create_account", creation)).error).not.toBeNull();
    const incomplete = await signup(false); expect((await incomplete.c.schema("api").rpc("create_account", creation)).error?.code).toBe("42501");
  });
  it("limita a 100 incluso con dos altas simultáneas y permite reintentar al llegar al límite", async () => {
    const owner = await signup();
    sql(owner.uid, `insert into finance.accounts(user_id,create_request_id,name,type,currency_code,opening_balance) select '${owner.uid}',pg_catalog.gen_random_uuid(),'Fixture '||g,'cash','PEN',0 from generate_series(1,99) g`);
    const payloads = [crypto.randomUUID(), crypto.randomUUID()].map((p_request_id) => ({ ...creation, p_request_id }));
    const results = await Promise.all(payloads.map((p) => owner.c.schema("api").rpc("create_account", p)));
    expect(results.filter((r) => !r.error)).toHaveLength(1); expect(results.filter((r) => r.error?.code === "54000")).toHaveLength(1);
    const index = results.findIndex((r) => !r.error);
    expect((await owner.c.schema("api").rpc("create_account", payloads[index])).data.id).toBe(results[index].data.id);
    expect((await owner.c.schema("api").rpc("read_accounts")).data).toHaveLength(100);
  });
});
