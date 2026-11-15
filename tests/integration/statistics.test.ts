import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `statistics-${crypto.randomUUID()}@example.test`;
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
  return execFileSync("docker", ["exec", process.env.FINZI_TEST_DB_CONTAINER ?? "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", `begin; ${prefix} set local role app_executor; select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true); ${statement}; commit;`], { encoding: "utf8", stdio: "pipe" });
}

async function historic(x: Context, name = "Histórica", currency = "PEN", opening = "100") {
 const id = crypto.randomUUID(); sql(x.uid,`insert into finance.accounts(id,user_id,create_request_id,name,type,currency_code,opening_balance,opening_at) values('${id}','${x.uid}',gen_random_uuid(),'${name}','cash','${currency}',${opening},'2026-01-01Z')`); return id;
}
const stats = (x: Context, args = {}) => x.c.schema("api").rpc("read_statistics", { p_currency: "PEN", p_period: "custom", p_from: "2026-05-01", p_to: "2026-05-31", ...args });
describe("A-12 estadísticas: PostgreSQL, RLS y precisión", () => {
  let x: Context, b: Context, source: string, second: string, child: string, other: string, correction: string;
  beforeAll(async () => {
    x = await setup(); b = await setup(); source = await historic(x); second = await historic(x, "Destino", "PEN", "1000");
    for (const [name, parent] of [["Subcategoría", x.expense.id], ["Otra categoría", null]]) {
      const c = await x.c.schema("api").rpc("create_category", { p_request_id: crypto.randomUUID(), p_parent_id: parent, p_kind: "expense", p_name: name, p_description: "", p_color: "blue", p_icon: "tag" }); expect(c.error).toBeNull(); const id = c.data.categories.find((c: { name: string }) => c.name === name).id; if (parent) child = id; else other = id;
    }
    for (const [date, kind, amount, category] of [["2026-04-05", "income", "100", x.income.id], ["2026-04-06", "expense", "40", x.expense.id], ["2026-04-08", "expense", "30", other], ["2026-05-05", "income", "200", x.income.id], ["2026-05-06", "expense", "50", child], ["2026-05-07", "expense", "10", other]]) {
      const r = await post(x, { p_account_id: source, p_kind: kind, p_category_id: category, p_amount: amount, p_occurred_at: `${date}T12:00:00Z` }); expect(r.error).toBeNull(); if (date === "2026-05-07") correction = r.data.id;
    }
  });
  it("conciliación con historial, comparación31d y suma de series exacta", async () => {
    const r = await stats(x); expect(r.error).toBeNull(); expect(r.data).toMatchObject({ income_minor: "20000", expense_minor: "6000", previous_income_minor: "10000", previous_expense_minor: "7000", previous_from: "2026-03-31", previous_to: "2026-04-30", movement_count: 3, previous_movement_count: 3 }); expect(r.data.series).toHaveLength(31);
    for (const k of ["income_minor", "expense_minor", "previous_income_minor", "previous_expense_minor"]) expect(r.data.series.reduce((n: bigint, p: Record<string, string>) => n + BigInt(p[k]), 0n).toString()).toBe(r.data[k]);
    const h = await read(x, { p_from: "2026-05-01", p_to: "2026-05-31" }); expect(h.data.expense_minor).toBe(r.data.expense_minor);
    expect(r.data.categories.find((c: { id: string }) => c.id === x.expense.id)).toMatchObject({ amount_minor: "5000", previous_amount_minor: "4000" });
    expect(r.data.categories.reduce((n: bigint, c: { amount_minor: string }) => n + BigInt(c.amount_minor), 0n)).toBe(6000n);
  });
  it("ignora aperturas/transferencias/USD y gastos anulados", async () => {
    expect((await x.c.schema("api").rpc("post_transfer", { p_request_id: crypto.randomUUID(), p_account_id: source, p_destination_id: second, p_amount: "20", p_description: "Transferencia", p_note: "", p_occurred_at: "2026-05-10T12:00:00Z" })).error).toBeNull();
    const usd = await historic(x, "USD", "USD", "1000"); expect((await post(x, { p_account_id: usd, p_amount: "500", p_occurred_at: "2026-05-15T12:00:00Z" })).error).toBeNull();
    const p = await post(x, { p_account_id: source, p_kind: "expense", p_category_id: other, p_amount: "5", p_occurred_at: "2026-05-15T12:00:00Z" }); expect(p.error).toBeNull(); expect((await x.c.schema("api").rpc("void_movement", { p_id: p.data.id, p_expected_version: 1, p_reason: "Anulado" })).error).toBeNull();
    expect((await stats(x)).data).toMatchObject({ income_minor: "20000", expense_minor: "6000", movement_count: 3 }); expect((await stats(x, { p_currency: "USD" })).data.income_minor).toBe("50000");
  });
  it("reemplazo cuenta solo sucesor; archivar no elimina historia", async () => {
    expect((await x.c.schema("api").rpc("replace_movement", { p_request_id: crypto.randomUUID(), p_id: correction, p_expected_version: 1, p_reason: "Corrección", p_kind: "expense", p_account_id: source, p_destination_id: null, p_category_id: other, p_amount: "15", p_description: "Corregido", p_note: "", p_occurred_at: "2026-05-07T12:00:00Z" })).error).toBeNull();
    expect((await x.c.schema("api").rpc("update_account", { p_id: source, p_name: "Archivada", p_opening: "100", p_archived: true, p_expected_version: 1 })).error).toBeNull(); expect((await stats(x)).data).toMatchObject({ income_minor: "20000", expense_minor: "6500", movement_count: 3 });
  });
  it.each(["week", "month", "three_months", "six_months", "year"])("preset %s usa reloj/zona servidor y comparación de igual duración", async (period) => {
    const r = await stats(x, { p_period: period, p_from: null, p_to: null }); expect(r.error).toBeNull(); expect(r.data.to).toBe(r.data.today); expect(new Date(r.data.to).getTime() - new Date(r.data.from).getTime()).toBe(new Date(r.data.previous_to).getTime() - new Date(r.data.previous_from).getTime()); expect(r.data.series.length).toBeLessThanOrEqual(122);
  });
  it("A/B, anónimo y rol efectivo; consulta no modifica saldos", async () => {
    expect((await stats(b)).data).toMatchObject({ income_minor: "0", expense_minor: "0", categories: [], movement_count: 0 }); expect((await client().schema("api").rpc("read_statistics")).error?.code).toBe("42501"); expect(sql(b.uid, "select api.read_statistics('PEN','custom','2026-05-01','2026-05-31')->>'income_minor'")).toContain("\n0\n"); const before = (await accounts(x)).data; await stats(x); expect((await accounts(x)).data).toEqual(before);
  });
  it.each([{ p_currency: "EUR" }, { p_period: "quarter" }, { p_from: "infinity" }, { p_to: "infinity" }, { p_to: "2099-01-01" }, { p_from: "2026-06-01" }, { p_from: "1800-01-01" }, { p_from: "1900-01-01" }, { p_period: "month" }])("rechaza %j", async (args) => expect((await stats(x, args)).error?.code).toBe("23514"));
  it("día DST de23h conserva límites locales inclusivos", async () => {
    const n = await setup("America/New_York"), id = await historic(n);
    for (const [at, amount] of [["2026-03-08T04:59:59Z", "4"], ["2026-03-08T05:00:00Z", "1"], ["2026-03-09T03:59:59Z", "2"], ["2026-03-09T04:00:00Z", "8"]]) expect((await post(n, { p_account_id: id, p_amount: amount, p_occurred_at: at })).error).toBeNull();
    expect((await stats(n, { p_from: "2026-03-08", p_to: "2026-03-08" })).data).toMatchObject({ income_minor: "300", previous_income_minor: "400", movement_count: 2 });
  });
  it("agregado de17 enteros exacto; diez años no generan series ilimitadas", async () => {
    const n = await setup(), large = await historic(n, "Grande", "PEN", "0"), small = await historic(n, "Pequeña", "PEN", "0");
    expect((await post(n, { p_account_id: large, p_amount: "9999999999999999.99", p_occurred_at: "2026-05-02T12:00:00Z" })).error).toBeNull(); expect((await post(n, { p_account_id: small, p_amount: "0.01", p_occurred_at: "2026-05-02T12:00:00Z" })).error).toBeNull();
    expect((await stats(n)).data.income_minor).toBe("1000000000000000000"); const long = await stats(n, { p_from: "2016-11-16", p_to: "2026-11-15" }); expect(long.error).toBeNull(); expect(long.data.series.length).toBeLessThanOrEqual(122);
  });
  it("pago de deuda cuenta una vez; desvincular conserva gasto y anular lo retira", async () => {
    const n = await setup(), id = await historic(n);
    const debt = await n.c.schema("api").rpc("debt_command", { p_command: { action: "create", requestId: crypto.randomUUID(), name: "Cuota", creditor: "Entidad sintética", detail: "", icon: "book", category: null, currency: "PEN", amount: "10.00", dueDate: null } }); expect(debt.error).toBeNull();
    expect((await n.c.schema("api").rpc("debt_command", { p_command: { action: "pay", id: debt.data.id, requestId: crypto.randomUUID(), mode: "new", accountId: id, categoryId: n.expense.id, amount: "10.00", occurredAt: "2026-05-10T12:00:00Z", note: "" } })).error).toBeNull();
    const details = await n.c.schema("api").rpc("read_debts"), payment = details.data.debts[0].payments[0]; expect((await stats(n)).data).toMatchObject({ expense_minor: "1000", movement_count: 1 });
    expect((await n.c.schema("api").rpc("debt_command", { p_command: { action: "unlink", id: debt.data.id, paymentId: payment.id } })).error).toBeNull(); expect((await stats(n)).data.expense_minor).toBe("1000");
    expect((await n.c.schema("api").rpc("void_movement", { p_id: payment.effective_id, p_expected_version: 1, p_reason: "Pago anulado" })).error).toBeNull(); expect((await stats(n)).data.expense_minor).toBe("0");
  });
  it("cuenta pendiente de eliminación no lee estadísticas con JWT aún vigente", async () => {
    const n = await setup(), user = await n.c.auth.getUser(); expect((await n.c.auth.signInWithPassword({ email: user.data.user!.email!, password: "una frase de prueba para movimientos 64" })).error).toBeNull();
    const proof = await n.c.schema("api").rpc("issue_reauth_proof", { p_purpose: "delete_account" }); expect(proof.error).toBeNull();
    expect((await n.c.schema("api").rpc("request_deletion", { p_request_id: crypto.randomUUID(), p_tracking_token: "a".repeat(64), p_proof: proof.data.token, p_confirmation: "ELIMINAR" })).error).toBeNull(); expect((await stats(n)).error?.code).toBe("42501");
  });
});
