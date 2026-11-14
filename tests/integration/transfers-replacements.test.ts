import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `transfers-${crypto.randomUUID()}@example.test`;
  expect((await c.auth.signUp({ email, password: "una frase de prueba para movimientos 64" })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
  expect(verified.error).toBeNull(); await c.schema("api").rpc("ensure_profile");
  expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Prueba movimientos", p_currency: "PEN", p_timezone: zone, p_expected_version: 0 })).error).toBeNull();
  const account = await c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Efectivo", p_type: "cash", p_currency: "PEN", p_opening: "100" }); expect(account.error).toBeNull();
  const categories = await c.schema("api").rpc("initialize_categories"); expect(categories.error).toBeNull();
  return { c, uid: verified.data.user!.id, account: account.data, income: categories.data.categories.find((c: { kind: string }) => c.kind === "income"), expense: categories.data.categories.find((c: { kind: string }) => c.kind === "expense") };
}
type Context = Awaited<ReturnType<typeof setup>>;
const post = (x: Context, overrides = {}) => x.c.schema("api").rpc("post_movement", { p_request_id: crypto.randomUUID(), p_kind: "income", p_account_id: x.account.id, p_category_id: x.income.id, p_amount: "50", p_description: "Ingreso real", p_note: "", p_occurred_at: null, ...overrides });
const read = (x: Context, overrides = {}) => x.c.schema("api").rpc("read_movements", { p_currency: "PEN", ...overrides });
const accounts = (x: Context) => x.c.schema("api").rpc("read_accounts");
function sql(uid: string, statement: string, prefix = "") {
  if (!/^[a-f0-9-]{36}$/i.test(uid)) throw new Error("UUID inválido.");
  return execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", `begin; ${prefix} set local role app_executor; select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true); ${statement}; commit;`], { encoding: "utf8", stdio: "pipe" });
}
function denied(uid: string, statement: string, code: string, prefix = "") { let message = ""; try { sql(uid, statement, prefix); } catch (error) { message = String((error as { stderr: string }).stderr); } expect(message).toContain(code); }

async function account(x: Context, currency = "PEN", opening = "0", name = "Ahorros") {
  const result = await x.c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: name, p_type: "savings", p_currency: currency, p_opening: opening });
  expect(result.error).toBeNull(); return result.data;
}
async function transfer(x: Context, destination: string, overrides = {}) {
  return x.c.schema("api").rpc("post_transfer", { p_request_id: crypto.randomUUID(), p_account_id: x.account.id, p_destination_id: destination, p_amount: "25", p_description: "Para mis ahorros", p_note: "", p_occurred_at: null, ...overrides });
}
async function replace(x: Context, id: string, overrides = {}) {
  return x.c.schema("api").rpc("replace_movement", { p_request_id: crypto.randomUUID(), p_id: id, p_expected_version: 1, p_reason: "Importe equivocado", p_kind: "income", p_account_id: x.account.id, p_destination_id: null, p_category_id: x.income.id, p_amount: "30", p_description: "Ingreso corregido", p_note: "", p_occurred_at: null, ...overrides });
}
const detail = (x: Context, id: string) => x.c.schema("api").rpc("read_movement", { p_id: id });
const balances = async (x: Context) => Object.fromEntries((await accounts(x)).data.map((a: { id: string; balance_minor: string }) => [a.id, a.balance_minor]));
describe("A-07 transferencias y reemplazos reales", () => {
  let a: Context, b: Context, target: { id: string; opening_at: string };
  beforeAll(async () => { a = await setup(); b = await setup(); target = await account(a); });
  it("transferencia conserva saldo total, dos partidas, y queda fuera del flujo incluso por cuenta", async () => {
    const before = await balances(a), result = await transfer(a, target.id); expect(result.error).toBeNull();
    const after = await balances(a); expect(after[a.account.id]).toBe((BigInt(before[a.account.id]) - 2500n).toString()); expect(after[target.id]).toBe("2500");
    expect(sql(a.uid, `select count(*)||':'||sum(signed_amount) from finance.transaction_entries where transaction_id='${result.data.id}'`)).toContain("2:0.0000");
    for (const id of [null, a.account.id, target.id]) { const result = await read(a, { p_kind: "transfer", p_account_id: id }); expect(result.error).toBeNull(); expect(result.data).toMatchObject({ total_count: 1, income_minor: "0", expense_minor: "0" }); expect(result.data.movements[0]).toMatchObject({ account_id: a.account.id, destination_id: target.id, category_id: null }); }
  });
  it("reintentos concurrentes reutilizan dos partidas y rechazan cambio de dirección/importe", async () => {
    const request = crypto.randomUUID(); const results = await Promise.all([transfer(a, target.id, { p_request_id: request, p_amount: "0.10" }), transfer(a, target.id, { p_request_id: request, p_amount: "0.10" })]);
    expect(results.map((r) => r.error)).toEqual([null, null]); expect(results[0].data.id).toBe(results[1].data.id);
    expect((await transfer(a, target.id, { p_request_id: request, p_amount: "0.20" })).error?.code).toBe("40001");
    expect((await transfer(a, a.account.id, { p_request_id: request, p_account_id: target.id, p_amount: "0.10" })).error?.code).toBe("40001");
    expect(sql(a.uid, `select count(*) from finance.transaction_entries where transaction_id='${results[0].data.id}'`)).toContain("2");
  });
  it("rechaza cuenta igual, ajena, cruce PEN/USD, archivo y fechas previas a cualquiera de las aperturas", async () => {
    expect((await transfer(a, a.account.id)).error?.code).toBe("23514"); expect((await transfer(a, b.account.id)).error?.code).toBe("P0002");
    const usd = await account(a, "USD"); expect((await transfer(a, usd.id)).error?.code).toBe("23514");
    const archived = await account(a); expect((await a.c.schema("api").rpc("update_account", { p_id: archived.id, p_name: archived.name, p_opening: "0", p_archived: true, p_expected_version: 1 })).error).toBeNull();
    expect((await transfer(a, archived.id)).error?.code).toBe("23514");
    expect((await transfer(a, target.id, { p_occurred_at: a.account.opening_at })).error?.code).toBe("22008");
    expect((await transfer(a, target.id, { p_occurred_at: "2099-01-01T00:00:00Z" })).error?.code).toBe("22008");
  });
  it.each(["0", "-1", "0.001", "NaN", "Infinity", "1e2", "10000000000000000"])("transferencia rechaza importe %s sin partidas", async (amount) => { expect((await transfer(a, target.id, { p_amount: amount })).error?.code).toBe("23514"); });
  it("anulación retira ambos efectos, conserva partidas y permite reintento tras el archivo", async () => {
    const x = await setup(), destination = await account(x), before = await balances(x), request = crypto.randomUUID();
    const result = await transfer(x, destination.id, { p_request_id: request, p_amount: "150" }); expect(result.error).toBeNull(); expect((await balances(x))[x.account.id]).toBe("-5000");
    const command = { p_id: result.data.id, p_expected_version: 1, p_reason: "No ocurrió" };
    expect((await x.c.schema("api").rpc("void_movement", command)).error).toBeNull(); expect(await balances(x)).toEqual(before);
    expect((await x.c.schema("api").rpc("void_movement", command)).error).toBeNull(); expect((await transfer(x, destination.id, { p_request_id: request, p_amount: "150" })).data.status).toBe("void");
    expect((await accounts(x)).data.every((a: { can_edit_opening: boolean }) => !a.can_edit_opening)).toBe(true);
  });
  it("comprueba desborde en destino y también al anular/reemplazar, sin alterar el original", async () => {
    const x = await setup(), destination = await account(x, "PEN", "9999999999999999.99");
    expect((await transfer(x, destination.id, { p_amount: "0.01" })).error?.code).toBe("22003"); expect((await read(x)).data.total_count).toBe(0);
    const small = await account(x, "PEN", "0"); const t = await transfer(x, small.id, { p_account_id: destination.id, p_amount: "0.01" }); expect(t.error).toBeNull();
    expect((await post(x, { p_account_id: destination.id, p_amount: "0.01" })).error).toBeNull();
    expect((await x.c.schema("api").rpc("void_movement", { p_id: t.data.id, p_expected_version: 1, p_reason: "Corrección" })).error?.code).toBe("22003");
    expect((await replace(x, t.data.id)).error?.code).toBe("22003"); expect((await detail(x, t.data.id)).data.status).toBe("posted");
  });
  it("reemplazo es atómico, guarda motivo, conserva original y entradas y forma una cadena navegable", async () => {
    const x = await setup(), original = await post(x); expect(original.error).toBeNull();
    const originalRow = sql(x.uid, `select to_jsonb(t)-array['status','version','voided_at','void_reason'] from finance.transactions t where id='${original.data.id}'`);
    const originalEntries = sql(x.uid, `select jsonb_agg(to_jsonb(e)) from finance.transaction_entries e where transaction_id='${original.data.id}'`);
    const first = await replace(x, original.data.id); expect(first.error).toBeNull(); expect((await balances(x))[x.account.id]).toBe("13000");
    expect((await detail(x, original.data.id)).data).toMatchObject({ status: "void", replaced_by_id: first.data.id, void_reason: "Importe equivocado" });
    expect((await detail(x, first.data.id)).data).toMatchObject({ replaces_id: original.data.id, replacement_reason: "Importe equivocado", status: "posted" });
    expect(sql(x.uid, `select to_jsonb(t)-array['status','version','voided_at','void_reason'] from finance.transactions t where id='${original.data.id}'`)).toBe(originalRow);
    expect(sql(x.uid, `select jsonb_agg(to_jsonb(e)) from finance.transaction_entries e where transaction_id='${original.data.id}'`)).toBe(originalEntries);
    const second = await replace(x, first.data.id, { p_amount: "20", p_reason: "Segunda revisión" }); expect(second.error).toBeNull();
    expect((await detail(x, first.data.id)).data).toMatchObject({ replaces_id: original.data.id, replaced_by_id: second.data.id });
    expect((await read(x, { p_status: "replaced" })).data.total_count).toBe(2); expect((await read(x)).data.income_minor).toBe("2000");
    expect(sql(x.uid, "select count(*) from finance.transaction_events where action='replaced'")).toContain("2");
  });
  it("corrige cualquier campo financiero, ingreso a transferencia y transferencia a gasto; no hay conversiones implícitas", async () => {
    const x = await setup(), destination = await account(x), original = await post(x);
    const first = await replace(x, original.data.id, { p_kind: "transfer", p_destination_id: destination.id, p_category_id: null, p_amount: "40", p_description: "Era un traslado" }); expect(first.error).toBeNull(); expect(await balances(x)).toEqual({ [x.account.id]: "6000", [destination.id]: "4000" });
    const second = await replace(x, first.data.id, { p_kind: "expense", p_account_id: destination.id, p_category_id: x.expense.id, p_amount: "20", p_note: "Comprobante revisado", p_occurred_at: new Date().toISOString() }); expect(second.error).toBeNull(); expect(await balances(x)).toEqual({ [x.account.id]: "10000", [destination.id]: "-2000" });
    expect((await read(x)).data).toMatchObject({ income_minor: "0", expense_minor: "2000", total_count: 3 });
    const usd = await account(x, "USD"); const third = await replace(x, second.data.id, { p_account_id: usd.id, p_amount: "5" }); expect(third.error).toBeNull(); expect((await read(x, { p_currency: "USD" })).data.income_minor).toBe("500"); expect((await read(x)).data.expense_minor).toBe("0");
  });
  it("reintento de corrección es estable incluso después de otro reemplazo; claves no cambian de comando", async () => {
    const x = await setup(), original = await post(x), request = crypto.randomUUID();
    const first = await replace(x, original.data.id, { p_request_id: request }); expect(first.error).toBeNull();
    expect((await replace(x, first.data.id)).error).toBeNull(); const replay = await replace(x, original.data.id, { p_request_id: request }); expect(replay.error).toBeNull(); expect(replay.data).toEqual({ id: first.data.id, status: "void" });
    expect((await replace(x, original.data.id, { p_request_id: request, p_reason: "Otro motivo" })).error?.code).toBe("40001");
    expect((await post(x, { p_request_id: request, p_amount: "30", p_description: "Ingreso corregido" })).error?.code).toBe("40001");
  });
  it("dos correcciones concurrentes admiten un solo sucesor, mientras el reintento idéntico confirma el mismo", async () => {
    const x = await setup(), original = await post(x);
    const results = await Promise.all([replace(x, original.data.id), replace(x, original.data.id, { p_amount: "40" })]);
    expect(results.filter((r) => !r.error)).toHaveLength(1); expect(results.find((r) => r.error)?.error?.code).toBe("40001");
    expect((await read(x)).data.total_count).toBe(2);
    const next = results.find((r) => !r.error)!.data.id, request = crypto.randomUUID();
    const retry = await Promise.all([replace(x, next, { p_request_id: request }), replace(x, next, { p_request_id: request })]); expect(retry.map((r) => r.error)).toEqual([null, null]); expect(retry[0].data.id).toBe(retry[1].data.id);
  });
  it("carrera anular/corregir nunca deja dos registros vigentes ni revierte un sucesor", async () => {
    const x = await setup(), original = await post(x);
    const [correction, annul] = await Promise.all([replace(x, original.data.id), x.c.schema("api").rpc("void_movement", { p_id: original.data.id, p_expected_version: 1, p_reason: "No ocurrió" })]);
    expect(annul.error).toBeNull(); if (correction.error) { expect(correction.error.code).toBe("40001"); expect((await balances(x))[x.account.id]).toBe("10000"); } else { expect((await balances(x))[x.account.id]).toBe("13000"); }
    expect((await detail(x, original.data.id)).data.status).toBe("void");
  });
  it("aislamiento en detalle, corrección y destino: usuario ajeno y anónimo no leen ni escriben", async () => {
    const original = await post(a); expect(original.error).toBeNull();
    expect((await detail(b, original.data.id)).error?.code).toBe("P0002"); expect((await replace(b, original.data.id)).error?.code).toBe("P0002");
    expect((await replace(a, original.data.id, { p_account_id: b.account.id })).error?.code).toBe("P0002");
    expect((await client().schema("api").rpc("read_movement", { p_id: original.data.id })).error?.code).toBe("42501");
    denied(a.uid, "set local role authenticated; select * from finance.movement_details", "42501");
    denied(a.uid, `update finance.transactions set replaces_transaction_id='${original.data.id}'`, "23514");
  });
  it("fallo de segunda partida y de auditoría revierte también la anulación original y libera la clave", async () => {
    const x = await setup(), destination = await account(x), original = await post(x), before = await balances(x);
    const request = crypto.randomUUID();
    for (const table of ["transaction_entries", "transaction_events"]) {
      const condition = table === "transaction_entries" ? "new.signed_amount>0" : "new.action='posted'";
      const prefix = `create function pg_temp.fail_phase7() returns trigger language plpgsql as $body$ begin if ${condition} then raise exception 'induced'; end if; return new; end $body$; create trigger phase7_fault before insert on finance.${table} for each row execute function pg_temp.fail_phase7();`;
      denied(x.uid, `select api.replace_movement('${request}','${original.data.id}',1,'Revisión','transfer','${x.account.id}','${destination.id}',null,'25','Transferencia','',null)`, "P0001", prefix);
      expect(await balances(x)).toEqual(before); expect((await detail(x, original.data.id)).data.status).toBe("posted"); expect((await read(x)).data.total_count).toBe(1);
    }
    expect((await replace(x, original.data.id, { p_request_id: request, p_kind: "transfer", p_destination_id: destination.id, p_category_id: null, p_amount: "25", p_description: "Transferencia", p_reason: "Revisión" })).error).toBeNull();
  });
  it("restricción diferida rechaza transferencias incompletas, divisas distintas y origen/destino falsificados", async () => {
    const x = await setup(), destination = await account(x), usd = await account(x, "USD");
    const tx = crypto.randomUUID(); const insert = `insert into finance.transactions(id,user_id,create_request_id,kind,description,amount,currency_code,occurred_at) values('${tx}','${x.uid}',gen_random_uuid(),'transfer','Incompleta',1,'PEN',now());`;
    denied(x.uid, insert, "23514");
    denied(x.uid, insert+`insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) values('${x.uid}','${tx}','${x.account.id}',-1),('${x.uid}','${tx}','${destination.id}',2)`, "23514");
    denied(x.uid, insert+`insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) values('${x.uid}','${tx}','${x.account.id}',-1),('${x.uid}','${tx}','${usd.id}',1)`, "23514");
  });
  it("categoría archivada, motivo vacío y versión obsoleta no anulan el original", async () => {
    const x = await setup(), original = await post(x);
    expect((await replace(x, original.data.id, { p_reason: " " })).error?.code).toBe("23514"); expect((await replace(x, original.data.id, { p_expected_version: 2 })).error?.code).toBe("40001");
    expect((await replace(x, original.data.id, { p_category_id: x.expense.id })).error?.code).toBe("23514");
    expect((await detail(x, original.data.id)).data.status).toBe("posted");
  });
  it("archivo concurrente de destino y transferencias inversas conservan dinero", async () => {
    const x = await setup(), destination = await account(x);
    const [archived, moved] = await Promise.all([x.c.schema("api").rpc("update_account", { p_id: destination.id, p_name: destination.name, p_opening: "0", p_archived: true, p_expected_version: 1 }), transfer(x, destination.id)]);
    expect(archived.error).toBeNull(); if (moved.error) expect(moved.error.code).toBe("23514");
    const current = await balances(x); expect(BigInt(current[x.account.id])+BigInt(current[destination.id])).toBe(10000n);
    expect((await x.c.schema("api").rpc("update_account", { p_id: destination.id, p_name: destination.name, p_opening: "0", p_archived: false, p_expected_version: 2 })).error).toBeNull();
    const results = await Promise.all([transfer(x, destination.id, { p_amount: "0.10" }), transfer(x, x.account.id, { p_account_id: destination.id, p_amount: "0.10" })]); expect(results.map((r) => r.error)).toEqual([null, null]); expect(await balances(x)).toEqual(current);
  });
  it("corrige cuentas originales archivadas eligiendo cuentas activas; categoría archivada no se puede reutilizar", async () => {
    const x = await setup(), destination = await account(x), fresh = await account(x, "PEN", "0", "Cuenta actual");
    const original = await transfer(x, destination.id); expect(original.error).toBeNull();
    for (const a of [x.account, destination]) expect((await x.c.schema("api").rpc("update_account", { p_id: a.id, p_name: a.name, p_opening: a.opening_minor === "10000" ? "100" : "0", p_archived: true, p_expected_version: 1 })).error).toBeNull();
    const replacement = await replace(x, original.data.id, { p_kind: "expense", p_account_id: fresh.id, p_category_id: x.expense.id, p_amount: "10" }); expect(replacement.error).toBeNull(); expect(await balances(x)).toEqual({ [x.account.id]: "10000", [destination.id]: "0", [fresh.id]: "-1000" });
    expect((await x.c.schema("api").rpc("update_category", { p_id: x.expense.id, p_name: x.expense.name, p_description: x.expense.description, p_color: x.expense.color, p_icon: x.expense.icon, p_archived: true, p_expected_version: 1 })).error).toBeNull();
    expect((await replace(x, replacement.data.id, { p_kind: "expense", p_account_id: fresh.id, p_category_id: x.expense.id })).error?.code).toBe("23514"); expect((await detail(x, replacement.data.id)).data.status).toBe("posted");
  });
  it("reintentos de transferencia y corrección funcionan al alcanzar cuota; un nuevo reemplazo falla sin anular", async () => {
    const x = await setup(), destination = await account(x), original = await post(x), transferKey = crypto.randomUUID(), correctionKey = crypto.randomUUID();
    const moved = await transfer(x, destination.id, { p_request_id: transferKey }); expect(moved.error).toBeNull();
    const correction = await replace(x, original.data.id, { p_request_id: correctionKey }); expect(correction.error).toBeNull();
    sql(x.uid, `insert into finance.transactions(user_id,create_request_id,kind,description,amount,currency_code,category_id,occurred_at) select '${x.uid}',gen_random_uuid(),'income','Cuota A07',1,'PEN','${x.income.id}',now() from generate_series(1,9997); insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) select user_id,id,'${x.account.id}',1 from finance.transactions where description='Cuota A07'; insert into finance.transaction_events(user_id,transaction_id,action,version) select user_id,id,'posted',1 from finance.transactions where description='Cuota A07'`);
    expect((await transfer(x, destination.id, { p_request_id: transferKey })).data.id).toBe(moved.data.id); expect((await replace(x, original.data.id, { p_request_id: correctionKey })).data.id).toBe(correction.data.id);
    expect((await replace(x, correction.data.id)).error?.code).toBe("54000"); expect((await detail(x, correction.data.id)).data.status).toBe("posted");
  });
  it("roles efectivos mantienen RLS, propiedad restringida y no exponen el escritor interno", () => {
    expect(sql(a.uid, "select count(*) from finance.movement_details where user_id<>finance.request_user_id()")).toContain("\n0\n");
    expect(sql(a.uid, "select bool_and(r.rolname='app_executor' and not r.rolbypassrls) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='api' and p.proname in ('post_transfer','replace_movement','read_movement')")).toContain("\nt\n");
    denied(a.uid, "set local role authenticated; select finance.write_movement(null,null,null,null,null,null,null,null,null,null,null,null)", "42501");
  });

});
