import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `debts-${crypto.randomUUID()}@example.test`;
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
const command = (x: Context, input: object) => x.c.schema("api").rpc("debt_command", { p_command: input });
const draft = (overrides = {}) => ({ action: "create", requestId: crypto.randomUUID(), name: "Estudios", creditor: "Instituto", detail: "Detalle privado", icon: "book", category: "education", currency: "PEN", amount: "100.00", dueDate: null, ...overrides });
async function create(x: Context, overrides = {}) { const r = await command(x, draft(overrides)); expect(r.error).toBeNull(); return r.data.id as string; }
const pay = (x: Context, id: string, overrides = {}) => command(x, { action: "pay", id, requestId: crypto.randomUUID(), mode: "new", accountId: x.account.id, categoryId: x.expense.id, amount: "20.00", occurredAt: null, note: "Abono", ...overrides });
const catalog = (x: Context) => x.c.schema("api").rpc("read_debts");
const balance = async (x: Context) => (await x.c.schema("api").rpc("read_accounts")).data[0].balance_minor;
async function get(x: Context, id: string) { const r = await catalog(x); expect(r.error).toBeNull(); return r.data.debts.find((d: { id: string }) => d.id === id); }
const replace = (x: Context, id: string, overrides = {}) => x.c.schema("api").rpc("replace_movement", { p_request_id: crypto.randomUUID(), p_id: id, p_expected_version: 1, p_reason: "Corrección real", p_kind: "expense", p_account_id: x.account.id, p_destination_id: null, p_category_id: x.expense.id, p_amount: "30.00", p_description: "Pago corregido", p_note: "", p_occurred_at: null, ...overrides });
function sql(uid: string, statement: string) {
  if (!/^[a-f0-9-]{36}$/i.test(uid)) throw new Error("UUID inválido");
  const container = process.env.FINZI_TEST_DB_CONTAINER ?? "supabase_db_finzi-auth";
  if (!/^supabase_db_finzi-[a-z0-9-]+$/.test(container)) throw new Error("Contenedor de pruebas inválido");
  return execFileSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", `begin;set local role app_executor;select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true);${statement};commit;`], { encoding: "utf8", stdio: "pipe" });
}
describe("A-11 deudas y pagos con ledger real y RLS", () => {
  let a: Context, b: Context;
  beforeAll(async () => { a = await setup(); b = await setup(); });
  it("crear/editar no mueve dinero, reintento es idempotente y detecta cambios", async () => {
    const input = draft(), before = await balance(a); const [r, retry] = await Promise.all([command(a, input), command(a, input)]); expect(r.error).toBeNull(); expect(retry.data.id).toBe(r.data.id);
    expect((await command(a, { ...input, amount: "101.00" })).error?.code).toBe("40001");
    const { action: _action, requestId: _request, ...fields } = input; void _action; void _request;
    expect((await command(a, { ...fields, action: "update", id: r.data.id, expectedVersion: 1, name: "Nombre revisado" })).error).toBeNull();
    expect((await command(a, { ...fields, action: "update", id: r.data.id, expectedVersion: 1 })).error?.code).toBe("40001");
    expect(await balance(a)).toBe(before); expect(await get(a, r.data.id)).toMatchObject({ name: "Nombre revisado", paid_minor: "0", version: 2 });
  });
  it.each(["0", "-1", "0.001", "1e2", "NaN", "Infinity", "10000000000000000", "1,25"])("RPC rechaza importe %s", async (amount) => expect((await command(a, draft({ amount }))).error?.code).toBe("23514"));
  it("nuevo pago atómico, repetido no duplica gasto y un pago final liquida", async () => {
    const id = await create(a), before = BigInt(await balance(a)), requestId = crypto.randomUUID();
    const results = await Promise.all([pay(a, id, { requestId, amount: "0.10" }), pay(a, id, { requestId, amount: "0.10" })]); expect(results.every((r) => !r.error)).toBe(true); expect(results[0].data.id).toBe(results[1].data.id);
    expect(await balance(a)).toBe((before - 10n).toString()); expect(await get(a, id)).toMatchObject({ paid_minor: "10", payments: [expect.objectContaining({ active: true, created_expense: true })] });
    expect((await pay(a, id, { amount: "99.90" })).error).toBeNull(); expect((await get(a, id)).paid_minor).toBe("10000");
    expect((await pay(a, id, { amount: "0.01" })).error?.code).toBe("23514"); expect((await get(a, id)).payments).toHaveLength(2);
  });
  it("dos pagos concurrentes no pueden superar la deuda y el perdedor no deja gasto", async () => {
    const id = await create(a, { amount: "10.00" }), before = BigInt(await balance(a));
    const results = await Promise.all([pay(a, id, { amount: "6.00" }), pay(a, id, { amount: "6.00" })]);
    expect(results.filter((r) => !r.error)).toHaveLength(1); expect(results.find((r) => r.error)?.error?.code).toBe("23514"); expect(await balance(a)).toBe((before - 600n).toString()); expect((await get(a, id)).paid_minor).toBe("600");
  });
  it("vincula gasto existente sin descontarlo otra vez y evita doble asociación", async () => {
    const first = await create(a), second = await create(a); await pay(a, first); const p = (await get(a, first)).payments[0];
    expect((await command(a, { action: "unlink", id: first, paymentId: p.id })).error).toBeNull(); const before = await balance(a);
    const link = { action: "pay", id: second, requestId: crypto.randomUUID(), mode: "existing", movementId: p.effective_id, note: "Ya registrado" };
    expect((await command(a, link)).error).toBeNull(); expect(await balance(a)).toBe(before); expect((await get(a, second)).paid_minor).toBe("2000");
    expect((await command(a, { ...link, id: first, requestId: crypto.randomUUID() })).error?.code).toBe("23505");
    const linked = (await get(a, second)).payments[0]; expect((await command(a, { action: "voidpay", id: second, paymentId: linked.id })).error?.code).toBe("23514");
  });
  it("sigue reemplazos y anulaciones reales, bloquea sobrepago y cambio a ingreso", async () => {
    const id = await create(a, { amount: "40.00" }); expect((await pay(a, id)).error).toBeNull(); const p = (await get(a, id)).payments[0];
    const corrected = await replace(a, p.effective_id); expect(corrected.error).toBeNull(); expect(await get(a, id)).toMatchObject({ paid_minor: "3000", payments: [expect.objectContaining({ effective_id: corrected.data.id, amount_minor: "3000" })] });
    expect((await replace(a, corrected.data.id, { p_amount: "40.01" })).error?.code).toBe("23514");
    expect((await replace(a, corrected.data.id, { p_kind: "income", p_category_id: a.income.id })).error?.code).toBe("23514");
    const another = await create(a); expect((await command(a, { action: "pay", id: another, requestId: crypto.randomUUID(), mode: "existing", movementId: corrected.data.id, note: "" })).error?.code).toBe("23514");
    expect((await a.c.schema("api").rpc("void_movement", { p_id: corrected.data.id, p_expected_version: 1, p_reason: "Pago no realizado" })).error).toBeNull(); expect((await get(a, id)).paid_minor).toBe("0");
  });
  it("no permite reducir total debajo de pagos, anular revierte saldo y eliminar conserva gasto", async () => {
    const id = await create(a); await pay(a, id); const p = (await get(a, id)).payments[0]; const input = draft({ amount: "19.99" }); const { action: _action, requestId: _request, ...fields } = input; void _action; void _request;
    expect((await command(a, { action: "update", id, expectedVersion: 1, ...fields })).error?.code).toBe("23514");
    const before = BigInt(await balance(a)); expect((await command(a, { action: "voidpay", id, paymentId: p.id })).error).toBeNull(); expect(await balance(a)).toBe((before + 2000n).toString());
    await pay(a, id); const beforeDelete = await balance(a); expect((await command(a, { action: "delete", id, expectedVersion: 1 })).error).toBeNull(); expect(await balance(a)).toBe(beforeDelete); expect((await get(a, id)).deleted_at).not.toBeNull(); expect((await pay(a, id)).error?.code).toBe("23514");
  });
  it("aislamiento A/B en RPC y tablas con rol efectivo; anónimo y claves falsas", async () => {
    const id = await create(a);
    expect((await catalog(b)).data.debts).toHaveLength(0); expect((await pay(b, id)).error?.code).toBe("P0002");
    expect((await command(a, draft({ user_id: b.uid }))).error?.code).toBe("23514");
    expect((await client().schema("api").rpc("read_debts")).error?.code).toBe("42501");
    expect((await a.c.schema("finance").from("debts").select()).error).not.toBeNull();
    expect(sql(b.uid, `select count(*) from finance.debts where id='${id}'`)).toContain("\n0\n");
    expect(sql(b.uid, `select count(*) from finance.debt_payment_details`)).toContain("\n0\n");
  });
  it("no vincula moneda distinta, ingreso, gasto ajeno, categoría equivocada ni fechas futuras", async () => {
    const pen = await create(a), usd = await create(a, { currency: "USD" });
    expect((await pay(a, usd)).error?.code).toBe("23514"); expect((await pay(a, pen, { categoryId: a.income.id })).error?.code).toBe("23514"); expect((await pay(a, pen, { accountId: b.account.id })).error?.code).toBe("P0002"); expect((await pay(a, pen, { occurredAt: "2099-01-01T00:00:00Z" })).error?.code).toBe("22008");
    const income = await a.c.schema("api").rpc("post_movement", { p_request_id: crypto.randomUUID(), p_kind: "income", p_account_id: a.account.id, p_category_id: a.income.id, p_amount: "1", p_description: "Ingreso", p_note: "", p_occurred_at: null }); expect(income.error).toBeNull();
    expect((await command(a, { action: "pay", id: pen, requestId: crypto.randomUUID(), mode: "existing", movementId: income.data.id, note: "" })).error?.code).toBe("23514");
  });
  it("exporta deudas y pagos eliminados con trazabilidad, sin hashes operativos", async () => {
    const x = await setup(), id = await create(x); await pay(x, id); expect((await command(x, { action: "delete", id, expectedVersion: 1 })).error).toBeNull();
    const user = await x.c.auth.getUser(); await x.c.auth.signInWithPassword({ email: user.data.user!.email!, password: "una frase de prueba para movimientos 64" });
    const proof = await x.c.schema("api").rpc("issue_reauth_proof", { p_purpose: "export_data" }); expect(proof.error).toBeNull();
    const result = await x.c.schema("api").rpc("export_personal_data", { p_proof: proof.data.token, p_format: "json" }); expect(result.error).toBeNull();
    expect(result.data.debts).toHaveLength(1); expect(result.data.debts[0]).toMatchObject({ id, paid_minor: "2000", payments: [expect.objectContaining({ active: true })] }); expect(result.data.debts[0].deleted_at).not.toBeNull();
    expect(result.data.debt_events).toHaveLength(3); expect(JSON.stringify(result.data.debts)).not.toMatch(/request_hash|request_id|password|token/);
  });
});
