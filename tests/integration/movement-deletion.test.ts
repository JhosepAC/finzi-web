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
const remove = (x: Context, id: string, version = 1) => x.c.schema("api").rpc("delete_movement", { p_id: id, p_expected_version: version, p_reason: "Registro eliminado por su dueño" });
const detail = (x: Context, id: string) => x.c.schema("api").rpc("read_movement", { p_id: id });
describe("eliminación de movimientos con PostgreSQL y roles reales", () => {
  let a: Context, b: Context;
  beforeAll(async () => { a = await setup(); b = await setup(); });
  it("retira un ingreso de saldos, páginas y totales, conserva partidas y bloquea apertura", async () => {
    const movement = (await post(a)).data;
    expect((await remove(a, movement.id)).error).toBeNull();
    expect((await accounts(a)).data[0]).toMatchObject({ balance_minor: "10000", can_edit_opening: false });
    expect((await read(a)).data).toMatchObject({ total_count: 0, income_minor: "0", movements: [] });
    expect((await detail(a, movement.id)).data).toMatchObject({ status: "void", version: 2, deleted_at: expect.any(String), deletion_reason: "Registro eliminado por su dueño" });
    expect(sql(a.uid, `select count(*) from finance.transaction_entries where transaction_id='${movement.id}'`)).toContain("\n1\n");
    expect((await a.c.schema("api").rpc("update_account", { p_id: a.account.id, p_name: "Efectivo", p_opening: "101", p_archived: false, p_expected_version: 1 })).error?.code).toBe("55000");
  });
  it("eliminar un gasto ya archivado conserva su motivo y versión financieros", async () => {
    const movement = (await post(a, { p_kind: "expense", p_category_id: a.expense.id, p_amount: "20" })).data;
    expect((await a.c.schema("api").rpc("void_movement", { p_id: movement.id, p_expected_version: 1, p_reason: "Motivo original" })).error).toBeNull();
    expect((await remove(a, movement.id, 2)).error).toBeNull();
    expect((await detail(a, movement.id)).data).toMatchObject({ version: 2, void_reason: "Motivo original", deletion_reason: "Registro eliminado por su dueño" });
    expect((await accounts(a)).data[0].balance_minor).toBe("10000");
  });
  it("transferencia: elimina las dos partes atómicamente y reintentos concurrentes son inocuos", async () => {
    const destination = (await a.c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Ahorros", p_type: "savings", p_currency: "PEN", p_opening: "0" })).data;
    const movement = await a.c.schema("api").rpc("post_transfer", { p_request_id: crypto.randomUUID(), p_account_id: a.account.id, p_destination_id: destination.id, p_amount: "30", p_description: "Traslado", p_note: "", p_occurred_at: null });
    expect(movement.error).toBeNull();
    const results = await Promise.all([remove(a, movement.data.id), remove(a, movement.data.id)]);
    expect(results.every((result) => !result.error)).toBe(true); expect(results[0].data).toEqual(results[1].data);
    const balances = (await accounts(a)).data; expect(balances.find((account: { id: string }) => account.id === a.account.id).balance_minor).toBe("10000"); expect(balances.find((account: { id: string }) => account.id === destination.id).balance_minor).toBe("0");
    expect(sql(a.uid, `select count(*) from finance.transaction_entries where transaction_id='${movement.data.id}'`)).toContain("\n2\n");
    expect((await read(a)).data).toMatchObject({ total_count: 0, income_minor: "0", expense_minor: "0" });
  });
  it("eliminar un antecesor no rompe la cadena ni afecta su reemplazo", async () => {
    const original = (await post(a, { p_amount: "10" })).data;
    const replacement = await a.c.schema("api").rpc("replace_movement", { p_request_id: crypto.randomUUID(), p_id: original.id, p_expected_version: 1, p_reason: "Importe corregido", p_kind: "income", p_account_id: a.account.id, p_destination_id: null, p_category_id: a.income.id, p_amount: "15", p_description: "Reemplazo", p_note: "", p_occurred_at: null });
    expect(replacement.error).toBeNull(); expect((await remove(a, original.id, 2)).error).toBeNull();
    expect((await detail(a, replacement.data.id)).data.replaces_id).toBe(original.id); expect((await detail(a, original.id)).data.replaced_by_id).toBe(replacement.data.id);
    expect((await accounts(a)).data[0].balance_minor).toBe("11500");
    expect((await remove(a, replacement.data.id)).error).toBeNull(); expect((await accounts(a)).data[0].balance_minor).toBe("10000");
  });
  it("RLS A/B, anónimo, esquema privado y metadatos inmutables", async () => {
    const movement = (await post(a)).data;
    expect((await remove(b, movement.id)).error?.code).toBe("P0002");
    expect((await remove(b, crypto.randomUUID())).error?.code).toBe("P0002");
    expect((await client().schema("api").rpc("delete_movement", { p_id: movement.id, p_expected_version: 1, p_reason: "Intento" })).error?.code).toBe("42501");
    expect((await a.c.schema("finance").from("movement_deletions").select()).error).not.toBeNull();
    denied(b.uid, `insert into finance.movement_deletions(user_id,transaction_id,transaction_version,reason) values('${a.uid}','${movement.id}',1,'Ajeno')`, "42501");
    denied(a.uid, `insert into finance.movement_deletions(user_id,transaction_id,transaction_version,reason) values('${a.uid}','${movement.id}',1,'Sin anular')`, "42501");
    expect((await remove(a, movement.id)).error).toBeNull();
    denied(a.uid, "update finance.movement_deletions set reason='Sobrescribir'", "42501");
    denied(a.uid, "delete from finance.movement_deletions", "42501");
    expect(sql(b.uid, "select count(*) from finance.movement_deletions")).toContain("\n0\n");
  });
  it("rechaza versión obsoleta y serializa eliminación contra reemplazo", async () => {
    const movement = (await post(a)).data;
    expect((await remove(a, movement.id, 2)).error?.code).toBe("40001");
    const results = await Promise.all([remove(a, movement.id), a.c.schema("api").rpc("replace_movement", { p_request_id: crypto.randomUUID(), p_id: movement.id, p_expected_version: 1, p_reason: "Carrera", p_kind: "income", p_account_id: a.account.id, p_destination_id: null, p_category_id: a.income.id, p_amount: "25", p_description: "Sucesor concurrente", p_note: "", p_occurred_at: null })]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    // Migration 36 changed replace_movement's permanent version conflict only.
    if (results[0].error) expect(results[0].error.code).toBe("40001");
    if (results[1].error) expect(results[1].error.code).toBe("PT409");
  });
  it("fallo inducido en la marca revierte anulación, partidas y saldos juntos", async () => {
    const movement = (await post(b)).data;
    denied(b.uid, `select api.delete_movement('${movement.id}',1,'Fallo inducido')`, "P0001", "create function pg_temp.reject_removal() returns trigger language plpgsql as $$begin raise exception 'fallo inducido';end$$; create trigger reject_removal before insert on finance.movement_deletions for each row execute function pg_temp.reject_removal();");
    expect((await detail(b, movement.id)).data).toMatchObject({ status: "posted", version: 1, deleted_at: null });
    expect((await accounts(b)).data[0].balance_minor).toBe("15000");
    expect((await read(b)).data.total_count).toBe(1);
  });
  it("un pago vinculado eliminado actualiza la deuda sin borrar su vínculo histórico", async () => {
    const x = await setup();
    const debt = await x.c.schema("api").rpc("debt_command", { p_command: { action: "create", requestId: crypto.randomUUID(), name: "Estudios", creditor: "Instituto", detail: "", icon: "book", category: "education", currency: "PEN", amount: "100.00", dueDate: null } }); expect(debt.error).toBeNull();
    const payment = await x.c.schema("api").rpc("debt_command", { p_command: { action: "pay", id: debt.data.id, requestId: crypto.randomUUID(), mode: "new", accountId: x.account.id, categoryId: x.expense.id, amount: "20.00", occurredAt: null, note: "Abono" } }); expect(payment.error).toBeNull();
    let catalog = await x.c.schema("api").rpc("read_debts"); const paid = catalog.data.debts[0]; expect(paid.paid_minor).toBe("2000");
    expect((await remove(x, paid.payments[0].effective_id)).error).toBeNull(); catalog = await x.c.schema("api").rpc("read_debts");
    expect(catalog.data.debts[0]).toMatchObject({ paid_minor: "0", payments: [expect.objectContaining({ active: false })] });
    expect((await accounts(x)).data[0].balance_minor).toBe("10000");
  });
});
