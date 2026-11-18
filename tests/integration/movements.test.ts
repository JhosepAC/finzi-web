import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `movements-${crypto.randomUUID()}@example.test`;
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
describe("ledger de ingresos/gastos: PostgreSQL, atomicidad y seguridad", () => {
  let a: Context, b: Context, incomeId: string, expenseId: string;
  beforeAll(async () => { a = await setup(); b = await setup(); });
  it("apertura 100 + ingreso 50 - gasto 20 = 130, flujo 30 sin apertura", async () => {
    const income = await post(a); expect(income.error).toBeNull(); incomeId = income.data.id;
    const expense = await post(a, { p_kind: "expense", p_category_id: a.expense.id, p_amount: "20", p_description: "Compra real" }); expect(expense.error).toBeNull(); expenseId = expense.data.id;
    expect((await accounts(a)).data[0]).toMatchObject({ opening_minor: "10000", balance_minor: "13000", can_edit_opening: false });
    expect((await read(a)).data).toMatchObject({ income_minor: "5000", expense_minor: "2000", total_count: 2 });
    expect(sql(a.uid, "select sum(signed_amount) from finance.transaction_entries")).toContain("30.0000");
  });
  it("reintentos concurrentes idénticos solo confirman una partida/evento", async () => {
    const request = crypto.randomUUID(); const results = await Promise.all([post(a, { p_request_id: request, p_amount: "0.10" }), post(a, { p_request_id: request, p_amount: "0.10" })]);
    expect(results.every((r) => !r.error)).toBe(true); expect(results[0].data.id).toBe(results[1].data.id);
    expect((await post(a, { p_request_id: request, p_amount: "0.20" })).error?.code).toBe("PT409");
    expect((await post(a, { p_amount: "0.20" })).error).toBeNull(); expect((await accounts(a)).data[0].balance_minor).toBe("13030");
    expect(sql(a.uid, `select count(*) from finance.transaction_events where transaction_id='${results[0].data.id}'`)).toContain("\n1\n");
  });
  it("A/B, anónimo, referencias y claves no revelan datos ajenos", async () => {
    expect((await read(b)).data.movements).toHaveLength(0);
    for (const values of [{ p_account_id: a.account.id }, { p_category_id: a.income.id }, { p_account_id: crypto.randomUUID() }]) expect((await post(b, values)).error?.code).toBe("P0002");
    const key = crypto.randomUUID(); const first = await post(a, { p_request_id: key }); const second = await post(b, { p_request_id: key }); expect(first.error).toBeNull(); expect(second.error).toBeNull(); expect(first.data.id).not.toBe(second.data.id);
    expect((await read(b, { p_account_id: a.account.id })).data.movements).toHaveLength(0);
    expect((await b.c.schema("api").rpc("void_movement", { p_id: incomeId, p_expected_version: 1, p_reason: "Intento" })).error?.code).toBe("P0002");
    expect((await client().schema("api").rpc("read_movements")).error?.code).toBe("42501");
    expect((await a.c.schema("finance").from("transactions").select()).error).not.toBeNull();
  });
  it.each(["0", "-1", "0.001", "1e2", "NaN", "Infinity", "10000000000000000", "1,25"])("RPC rechaza importe %s antes del cast", async (amount) => { expect((await post(a, { p_amount: amount })).error?.code).toBe("23514"); });
  it("categoría de otro tipo, cuenta/categoría/padre archivados no publican", async () => {
    expect((await post(a, { p_category_id: a.expense.id })).error?.code).toBe("23514");
    const x = await setup();
    const child = await x.c.schema("api").rpc("create_category", { p_request_id: crypto.randomUUID(), p_parent_id: x.income.id, p_kind: "income", p_name: "Hija", p_description: "", p_color: "blue", p_icon: "tag" }); expect(child.error).toBeNull();
    const childId = child.data.categories.find((c: { parent_id: string }) => c.parent_id === x.income.id).id;
    expect((await x.c.schema("api").rpc("update_category", { p_id: x.income.id, p_name: x.income.name, p_description: "", p_color: x.income.color, p_icon: x.income.icon, p_archived: true, p_expected_version: 1 })).error).toBeNull();
    expect((await post(x)).error?.code).toBe("23514"); expect((await post(x, { p_category_id: childId })).error?.code).toBe("23514");
    expect((await x.c.schema("api").rpc("update_account", { p_id: x.account.id, p_name: x.account.name, p_opening: "100", p_archived: true, p_expected_version: 1 })).error).toBeNull();
    expect((await post(x, { p_kind: "expense", p_category_id: x.expense.id })).error?.code).toBe("23514"); expect((await read(x)).data.total_count).toBe(0);
  });
  it("rechaza futuro, antes de apertura e infinitos sin guardar partes", async () => {
    for (const occurred of ["2000-01-01T00:00:00Z", "2099-01-01T00:00:00Z", "infinity"]) expect((await post(a, { p_occurred_at: occurred })).error?.code).toBe("22008");
  });
  it("anula con motivo y versión, conserva entrada/apertura bloqueada y es idempotente", async () => {
    expect((await a.c.schema("api").rpc("void_movement", { p_id: expenseId, p_expected_version: 9, p_reason: "Duplicado" })).error?.code).toBe("40001");
    const results = await Promise.all([a.c.schema("api").rpc("void_movement", { p_id: expenseId, p_expected_version: 1, p_reason: "Duplicado" }), a.c.schema("api").rpc("void_movement", { p_id: expenseId, p_expected_version: 1, p_reason: "Duplicado" })]);
    expect(results.every((r) => !r.error)).toBe(true); expect((await read(a, { p_status: "void" })).data.movements[0]).toMatchObject({ id: expenseId, version: 2, void_reason: "Duplicado" });
    expect(sql(a.uid, `select count(*) from finance.transaction_entries where transaction_id='${expenseId}'`)).toContain("\n1\n");
    expect((await accounts(a)).data[0]).toMatchObject({ can_edit_opening: false, balance_minor: "20030" });
    expect((await a.c.schema("api").rpc("update_account", { p_id: a.account.id, p_name: "Efectivo", p_opening: "101", p_archived: false, p_expected_version: 1 })).error?.code).toBe("55000");
    const only = await setup(); const movement = await post(only); await only.c.schema("api").rpc("void_movement", { p_id: movement.data.id, p_expected_version: 1, p_reason: "Error" });
    expect((await accounts(only)).data[0].can_edit_opening).toBe(false);
  });
  it("saldo negativo permitido, rango desbordado rechazado y monedas separadas", async () => {
    const x = await setup(); expect((await post(x, { p_kind: "expense", p_category_id: x.expense.id, p_amount: "150" })).error).toBeNull(); expect((await accounts(x)).data[0].balance_minor).toBe("-5000");
    expect((await post(x, { p_amount: "9999999999999999.99" })).error).toBeNull();
    expect((await post(x, { p_amount: "51" })).error?.code).toBe("22003");
    const usd = await x.c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "USD", p_type: "cash", p_currency: "USD", p_opening: "0" });
    expect((await post(x, { p_account_id: usd.data.id, p_amount: "0.30" })).error).toBeNull(); expect((await read(x, { p_currency: "USD" })).data.income_minor).toBe("30");
    expect((await read(x)).data.expense_minor).toBe("15000");
  });
  it("archivo contra publicación se serializa; apertura contra publicación también", async () => {
    const x = await setup(); const [archive, movement] = await Promise.all([x.c.schema("api").rpc("update_account", { p_id: x.account.id, p_name: "Efectivo", p_opening: "100", p_archived: true, p_expected_version: 1 }), post(x)]);
    expect(archive.error).toBeNull(); if (movement.error) expect(movement.error.code).toBe("23514");
    expect((await post(x)).error?.code).toBe("23514");
    const y = await setup(); const [opening, posted] = await Promise.all([y.c.schema("api").rpc("update_account", { p_id: y.account.id, p_name: "Efectivo", p_opening: "200", p_archived: false, p_expected_version: 1 }), post(y)]);
    expect(posted.error).toBeNull(); if (opening.error) expect(opening.error.code).toBe("55000");
    expect(["15000", "25000"]).toContain((await accounts(y)).data[0].balance_minor);
  });
  it("fallo inducido en auditoría revierte movimiento, partida y clave", async () => {
    const x = await setup(), request = crypto.randomUUID();
    const prefix = "create function pg_temp.reject_event() returns trigger language plpgsql as $$ begin raise exception 'test_rollback'; end $$; create trigger test_rollback before insert on finance.transaction_events for each row execute function pg_temp.reject_event();";
    denied(x.uid, `select api.post_movement('${request}','income','${x.account.id}','${x.income.id}','1','Rollback','',null)`, "test_rollback", prefix);
    expect((await read(x)).data.total_count).toBe(0); expect(sql(x.uid, "select count(*) from finance.transaction_entries")).toContain("\n0\n");
    expect((await post(x, { p_request_id: request, p_amount: "1", p_description: "Rollback" })).error).toBeNull();
  });
  it("roles efectivos impiden reescribir partidas, historia y auditoría", () => {
    expect(sql(b.uid, `select count(*) from finance.transactions where id='${incomeId}'`)).toContain("\n0\n");
    denied(a.uid, "update finance.transaction_entries set signed_amount=1", "42501"); denied(a.uid, "delete from finance.transactions", "42501");
    denied(a.uid, "update finance.transaction_events set action='voided'", "42501");
    denied(a.uid, `update finance.transactions set amount=1 where id='${incomeId}'`, "23514");
    const foreignLink = crypto.randomUUID();
    denied(a.uid, `insert into finance.transactions(id,user_id,create_request_id,kind,description,amount,currency_code,category_id,occurred_at) values('${foreignLink}','${a.uid}',gen_random_uuid(),'income','FK propia',1,'PEN','${a.income.id}',now()); insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) values('${a.uid}','${foreignLink}','${b.account.id}',1)`, "23503");
    expect(sql(a.uid, "select bool_and(r.rolname='app_executor') from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='api' and p.proname in ('post_movement','void_movement','read_movements','update_account','read_accounts')")).toContain("\nt\n");
  });
  it("constraint diferida exige exactamente una partida coherente al commit", () => {
    denied(a.uid, `insert into finance.transactions(user_id,create_request_id,kind,description,amount,currency_code,category_id,occurred_at) values('${a.uid}',gen_random_uuid(),'income','Sin partida',1,'PEN','${a.income.id}',now())`, "23514");
    const id = crypto.randomUUID();
    denied(a.uid, `insert into finance.transactions(id,user_id,create_request_id,kind,description,amount,currency_code,category_id,occurred_at) values('${id}','${a.uid}',gen_random_uuid(),'income','Signo',1,'PEN','${a.income.id}',now()); insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) values('${a.uid}','${id}','${a.account.id}',-1)`, "23514");
  });
  it("paginación estable con empate temporal y agregados sobre todo el filtro", async () => {
    const x = await setup(); const instant = new Date().toISOString();
    for (let i = 0; i < 5; i++) expect((await post(x, { p_description: `Página ${i}`, p_occurred_at: instant, p_amount: "1" })).error).toBeNull();
    const first = await read(x, { p_limit: 2 }); expect(first.data).toMatchObject({ total_count: 5, income_minor: "500", has_more: true });
    const second = await read(x, { p_limit: 2, p_cursor_at: first.data.next_cursor.at, p_cursor_id: first.data.next_cursor.id });
    const third = await read(x, { p_limit: 2, p_cursor_at: second.data.next_cursor.at, p_cursor_id: second.data.next_cursor.id });
    expect(third.data.has_more).toBe(false); expect(new Set([...first.data.movements, ...second.data.movements, ...third.data.movements].map((m) => m.id)).size).toBe(5);
    expect((await read(x, { p_query: "pÁGINA 3" })).data.total_count).toBe(1); expect((await read(x, { p_limit: 51 })).error?.code).toBe("23514");
  });
  it("cuota concurrente de 10000 no deja publicaciones parciales y admite reintentos", async () => {
    const x = await setup();
    sql(x.uid, `insert into finance.transactions(user_id,create_request_id,kind,description,amount,currency_code,category_id,occurred_at) select '${x.uid}',gen_random_uuid(),'income','Cuota',1,'PEN','${x.income.id}',now() from generate_series(1,9999); insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) select user_id,id,'${x.account.id}',1 from finance.transactions; insert into finance.transaction_events(user_id,transaction_id,action,version) select user_id,id,'posted',1 from finance.transactions`);
    const keys = [crypto.randomUUID(), crypto.randomUUID()]; const results = await Promise.all(keys.map((key) => post(x, { p_request_id: key, p_amount: "1" })));
    expect(results.filter((r) => !r.error)).toHaveLength(1); expect(results.find((r) => r.error)?.error?.code).toBe("54000");
    const winner = results.findIndex((r) => !r.error); expect((await post(x, { p_request_id: keys[winner], p_amount: "1" })).data.id).toBe(results[winner].data.id);
    expect((await read(x)).data).toMatchObject({ total_count: 10000, income_minor: "1000000" });
    expect(sql(x.uid, "select count(*) from finance.transaction_entries")).toContain("\n10000\n");
  });
  it("archivo de categoría contra publicación se serializa", async () => {
    const x = await setup(); const [archived, posted] = await Promise.all([x.c.schema("api").rpc("update_category", { p_id: x.income.id, p_name: x.income.name, p_description: "", p_color: x.income.color, p_icon: x.income.icon, p_archived: true, p_expected_version: 1 }), post(x)]);
    expect(archived.error).toBeNull(); if (posted.error) expect(posted.error.code).toBe("23514");
    expect((await post(x)).error?.code).toBe("23514");
  });
  it("períodos usan zona del perfil, límites locales y cambio DST", async () => {
    const x = await setup("America/New_York"), historic = crypto.randomUUID();
    sql(x.uid, `insert into finance.accounts(id,user_id,create_request_id,name,type,currency_code,opening_balance,opening_at) values('${historic}','${x.uid}',gen_random_uuid(),'Histórica','cash','PEN',0,'2020-01-01Z')`);
    for (const instant of ["2026-03-08T04:59:00Z", "2026-03-08T05:00:00Z", "2026-03-09T03:59:59Z", "2026-03-09T04:00:00Z"]) expect((await post(x, { p_account_id: historic, p_occurred_at: instant, p_amount: "1" })).error).toBeNull();
    const page = await read(x, { p_from: "2026-03-08", p_to: "2026-03-08" }); expect(page.error).toBeNull(); expect(page.data).toMatchObject({ total_count: 2, income_minor: "200" });
  });
});
