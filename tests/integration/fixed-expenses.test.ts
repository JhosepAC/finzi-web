import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `fixed-${crypto.randomUUID()}@example.test`;
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
const command = (x: Context, c: object) => x.c.schema("api").rpc("fixed_expense_command", { p_command: c });
const draft = (x: Context, overrides = {}) => ({ action: "create", requestId: crypto.randomUUID(), name: "Internet", note: "Privado", categoryId: x.expense.id, currency: "PEN", amount: "20.00", dueDate: "2026-01-31", frequency: "monthly", ...overrides });
const read = (x: Context, month = "2026-02-01") => x.c.schema("api").rpc("read_fixed_expenses", { p_month: month });
async function create(x: Context, overrides = {}) { const r = await command(x, draft(x, overrides)); expect(r.error).toBeNull(); return r.data.id as string; }
const pay = (x: Context, id: string, overrides = {}) => command(x, { action: "pay", id, expectedVersion: 1, ordinal: 0, requestId: crypto.randomUUID(), mode: "new", accountId: x.account.id, occurredAt: null, ...overrides });
const balance = async (x: Context) => (await x.c.schema("api").rpc("read_accounts")).data[0].balance_minor;
function sql(uid: string, statement: string) {
  if (!/^[a-f0-9-]{36}$/i.test(uid)) throw new Error("UUID inválido");
  return execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", `begin;set local role app_executor;select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true);${statement};commit;`], { encoding: "utf8", stdio: "pipe" });
}
describe("gastos fijos reales", () => {
  let a: Context, b: Context;
  beforeAll(async () => { a = await setup(); b = await setup(); });
  it("proyecta meses cortos sin deriva y no modifica saldos al registrar", async () => {
    const before = await balance(a); const id = await create(a);
    expect((await read(a)).error).toBeNull();
    expect((await read(a)).data.occurrences).toContainEqual(expect.objectContaining({ expense_id: id, ordinal: 1, due_date: "2026-02-28", paid: false }));
    expect((await read(a, "2026-03-01")).data.occurrences).toContainEqual(expect.objectContaining({ expense_id: id, ordinal: 2, due_date: "2026-03-31" }));
    expect(await balance(a)).toBe(before);
    expect(sql(a.uid, "select finance.fixed_due('2024-02-29','yearly',1),finance.fixed_due('2024-02-29','yearly',4),finance.fixed_due('2026-01-31','quarterly',1),finance.fixed_due('2026-01-31','fortnightly',1),finance.fixed_due('2026-01-31','weekly',1)" )).toContain("2025-02-28|2028-02-29|2026-04-30|2026-02-15|2026-02-07");
  });
  it.each(["0", "-1", "0.001", "NaN", "1e2", "10000000000000000"])("rechaza importe %s en RPC", async (amount) => { expect((await command(a, draft(a, { amount }))).error?.code).toBe("23514"); });
  it("alta y pago son idempotentes; dos confirmaciones concurrentes no duplican", async () => {
    const input = draft(a); const created = await command(a, input); expect((await command(a, input)).data.id).toBe(created.data.id);
    expect((await command(a, { ...input, name: "Otro" })).error?.code).toBe("40001");
    const before = BigInt(await balance(a)); const requestId = crypto.randomUUID();
    const r = await Promise.all([pay(a, created.data.id, { requestId }), pay(a, created.data.id, { requestId })]);
    expect(r.map((r) => r.error)).toEqual([null, null]); expect(r[0].data.id).toBe(r[1].data.id);
    expect(await balance(a)).toBe((before - 2000n).toString());
    expect((await pay(a, created.data.id)).error?.code).toBe("40001");
    expect((await read(a)).data.expenses.find((e: { id: string }) => e.id === created.data.id).next_due).toBe("2026-02-28");
  });
  it("vincula un gasto existente sin descontar dos veces y bloquea reutilización", async () => {
    const id = await create(a), another = await create(a);
    const tx = await a.c.schema("api").rpc("post_movement", { p_request_id: crypto.randomUUID(), p_kind: "expense", p_account_id: a.account.id, p_category_id: a.expense.id, p_amount: "20", p_description: "Internet pagado", p_note: "", p_occurred_at: null }); expect(tx.error).toBeNull();
    const before = await balance(a);
    const c = { action: "pay", id, expectedVersion: 1, ordinal: 1, requestId: crypto.randomUUID(), mode: "existing", movementId: tx.data.id };
    expect((await command(a, c)).error).toBeNull(); expect(await balance(a)).toBe(before);
    expect((await command(a, { ...c, id: another, requestId: crypto.randomUUID() })).error?.code).toBe("23514");
  });
  it("dos pagos distintos concurrentes solo confirman uno; fallos no dejan gasto huérfano", async () => {
    const id = await create(a); const before = BigInt(await balance(a));
    const result = await Promise.all([pay(a, id), pay(a, id)]);
    expect(result.filter((r) => !r.error)).toHaveLength(1); expect(result.find((r) => r.error)?.error?.code).toBe("40001");
    expect(await balance(a)).toBe((before - 2000n).toString());
    const other = await create(a, { currency: "USD" }); const after = await balance(a);
    expect((await pay(a, other)).error?.code).toBe("23514"); expect(await balance(a)).toBe(after);
    expect((await pay(a, other, { accountId: b.account.id })).error).not.toBeNull();
    const future = await create(a); expect((await pay(a, future, { occurredAt: "2099-01-01T00:00:00Z" })).error?.code).toBe("22008");
    expect((await read(a)).data.payments.filter((p: { expense_id: string }) => p.expense_id === future || p.expense_id === other)).toHaveLength(0);
  });
  it("anulación reabre el vencimiento y reemplazo conserva vínculo; moneda e importe están protegidos", async () => {
    const id = await create(a); expect((await pay(a, id)).error).toBeNull();
    let p = (await read(a)).data.payments.find((p: { expense_id: string }) => p.expense_id === id);
    const replace = (amount: string) => a.c.schema("api").rpc("replace_movement", { p_request_id: crypto.randomUUID(), p_id: p.movement_id, p_expected_version: 1, p_reason: "Corrección", p_kind: "expense", p_account_id: a.account.id, p_destination_id: null, p_category_id: a.expense.id, p_amount: amount, p_description: "Pago corregido", p_note: "", p_occurred_at: null });
    expect((await replace("21")).error?.code).toBe("23514"); expect((await replace("20")).error).toBeNull();
    p = (await read(a)).data.payments.find((p: { expense_id: string }) => p.expense_id === id);
    expect((await a.c.schema("api").rpc("delete_movement", { p_id: p.movement_id, p_expected_version: 1, p_reason: "No pagado" })).error).toBeNull();
    expect((await read(a)).data.payments.find((p: { expense_id: string }) => p.expense_id === id).active).toBe(false);
    expect((await pay(a, id, { expectedVersion: 2 })).error).toBeNull();
  });
  it("historia pagada no cambia al editar monto; eliminar conserva ledger y pagos", async () => {
    const id = await create(a); await pay(a, id, { ordinal: 1 }); const before = await balance(a);
    const { requestId: _r, ...fields } = draft(a); void _r;
    expect((await command(a, { ...fields, action: "update", id, expectedVersion: 2, amount: "30" })).error).toBeNull();
    expect((await read(a)).data.occurrences.find((o: { expense_id: string }) => o.expense_id === id).amount_minor).toBe("2000");
    expect((await read(a, "2026-03-01")).data.occurrences.find((o: { expense_id: string }) => o.expense_id === id).amount_minor).toBe("3000");
    expect((await command(a, { action: "delete", id, expectedVersion: 3 })).error).toBeNull();
    expect((await read(a)).data.payments.some((p: { expense_id: string }) => p.expense_id === id)).toBe(true); expect(await balance(a)).toBe(before);
  });
  it("impide enlaces con Deudas desde ambos módulos", async () => {
    const id = await create(a); await pay(a, id); const p = (await read(a)).data.payments.find((p: { expense_id: string }) => p.expense_id === id);
    const debt = await a.c.schema("api").rpc("debt_command", { p_command: { action: "create", requestId: crypto.randomUUID(), name: "Servicio", creditor: "Proveedor", detail: "", icon: "wallet", category: null, currency: "PEN", amount: "100", dueDate: null } }); expect(debt.error).toBeNull();
    expect((await a.c.schema("api").rpc("debt_command", { p_command: { action: "pay", id: debt.data.id, requestId: crypto.randomUUID(), mode: "existing", movementId: p.movement_id, note: "" } })).error?.code).toBe("23514");
  });
  it("aislamiento real RLS, referencias ajenas, anónimo y categorías eliminadas", async () => {
    const id = await create(a);
    expect((await pay(b, id)).error?.code).toBe("P0002"); expect((await read(b)).data.expenses).toHaveLength(0);
    expect(sql(b.uid, `select count(*) from finance.fixed_expenses where id='${id}'`)).toContain("\n0\n");
    expect((await client().schema("api").rpc("read_fixed_expenses")).error?.code).toBe("42501");
    expect((await command(a, draft(a, { categoryId: b.expense.id }))).error?.code).toBe("23514");
    const x = await setup(); await create(x);
    expect((await x.c.schema("api").rpc("delete_category", { p_id: x.expense.id, p_expected_version: x.expense.version })).error).toBeNull();
    expect((await read(x)).data.expenses[0].category_name).toBe(x.expense.name);
    expect((await pay(x, (await read(x)).data.expenses[0].id)).error?.code).toBe("23514");
  });
  it("exporta compromisos y pagos con comprobante sin huellas operativas", async () => {
    const x = await setup(); const id = await create(x); await pay(x, id);
    const user = await x.c.auth.getUser(); await x.c.auth.signInWithPassword({ email: user.data.user!.email!, password: "una frase de prueba para movimientos 64" });
    const proof = await x.c.schema("api").rpc("issue_reauth_proof", { p_purpose: "export_data" });
    const result = await x.c.schema("api").rpc("export_personal_data", { p_proof: proof.data.token, p_format: "json" }); expect(result.error).toBeNull();
    expect(result.data.fixed_expenses).toHaveLength(1); expect(result.data.fixed_expense_payments).toHaveLength(1);
    expect(JSON.stringify(result.data.fixed_expenses)).not.toMatch(/request_hash|request_id/); expect(result.data.debts).toBeDefined(); expect(result.data.categories).toBeDefined();
  });
});

