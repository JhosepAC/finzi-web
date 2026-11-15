import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function signup(complete = true) {
  const c = client(), email = `categories-${crypto.randomUUID()}@example.test`;
  expect((await c.auth.signUp({ email, password: "una frase de prueba para categorías 64" })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
  expect(verified.error).toBeNull(); await c.schema("api").rpc("ensure_profile");
  if (complete) expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Prueba categorías", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 })).error).toBeNull();
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
const base = { p_request_id: crypto.randomUUID(), p_parent_id: null, p_kind: "expense", p_name: "Casa", p_description: "Personal", p_color: "blue", p_icon: "home", p_image_path: null };
const create = (c: SupabaseClient, overrides = {}) => c.schema("api").rpc("create_category", { ...base, ...overrides });
const read = (c: SupabaseClient) => c.schema("api").rpc("read_categories");
const update = (c: SupabaseClient, id: string, version: number, overrides = {}) => c.schema("api").rpc("update_category", { p_id: id, p_expected_version: version, p_name: "Casa", p_description: "Personal", p_color: "blue", p_icon: "home", p_image_path: null, p_archived: false, ...overrides });
describe("categorías: RPC, RLS, árbol y concurrencia reales", () => {
  let a: SupabaseClient, b: SupabaseClient, uid: string, uidB: string, root: string, child: string;
  beforeAll(async () => { const aa = await signup(), bb = await signup(); a = aa.c; uid = aa.uid; b = bb.c; uidB = bb.uid; });
  it("lee vacío, crea y reintenta sin duplicar ni duplicar auditoría", async () => {
    expect((await read(a)).data).toEqual({ categories: [], initialized: false });
    const first = await create(a); expect(first.error).toBeNull(); root = first.data.categories[0].id;
    const retry = await create(a); expect(retry.data.categories).toHaveLength(1); expect(retry.data.categories[0].id).toBe(root);
    expect(sql(uid, "select count(*) from finance.category_events")).toContain("\n1\n");
    expect((await create(a, { p_name: "Otro" })).error?.code).toBe("40001");
  });
  it("la misma clave de petición de B crea otra identidad aislada", async () => {
    const result = await create(b); expect(result.error).toBeNull(); expect(result.data.categories[0].id).not.toBe(root);
    expect((await update(b, root, 1)).error?.code).toBe("P0002");
    expect((await update(b, crypto.randomUUID(), 1)).error?.code).toBe("P0002");
    expect((await read(b)).data.categories).toHaveLength(1);
  });
  it("crea subcategoría del mismo dueño y tipo", async () => {
    const result = await create(a, { p_request_id: crypto.randomUUID(), p_parent_id: root, p_name: "Alquiler" });
    expect(result.error).toBeNull(); child = result.data.categories.find((c: { parent_id: string }) => c.parent_id === root).id;
  });
  it("rechaza padre ajeno, inexistente, tipo cruzado y tercer nivel", async () => {
    const foreign = (await read(b)).data.categories[0].id;
    for (const overrides of [{ p_parent_id: foreign }, { p_parent_id: crypto.randomUUID() }, { p_parent_id: root, p_kind: "income" }, { p_parent_id: child }]) expect((await create(a, { p_request_id: crypto.randomUUID(), ...overrides })).error?.code).toBe("23514");
    expect((await read(a)).data.categories).toHaveLength(2);
  });
  it("unicidad entre hermanas ignora mayúsculas; permite otro tipo y otro grupo", async () => {
    expect((await create(a, { p_request_id: crypto.randomUUID(), p_name: " casa " })).error?.code).toBe("23505");
    expect((await create(a, { p_request_id: crypto.randomUUID(), p_name: "Casa", p_kind: "income" })).error).toBeNull();
    expect((await create(a, { p_request_id: crypto.randomUUID(), p_name: "Alquiler" })).error).toBeNull();
  });
  it.each([{ p_name: " " }, { p_name: "x".repeat(81) }, { p_description: "x".repeat(301) }, { p_color: "url(evil)" }, { p_icon: "script" }, { p_kind: "transfer" }])("SQL valida sin pasar por Next: %j", async (values) => { expect((await create(a, { p_request_id: crypto.randomUUID(), ...values })).error?.code).toBe("23514"); });
  it("archivo del padre es efectivo en hijas; impide altas bajo padre archivado", async () => {
    const result = await update(a, root, 1, { p_archived: true }); expect(result.error).toBeNull();
    const c = result.data.categories.find((c: { id: string }) => c.id === child); expect(c).toMatchObject({ status: "active", effective_archived: true });
    expect((await create(a, { p_request_id: crypto.randomUUID(), p_parent_id: root, p_name: "Servicio" })).error?.code).toBe("23514");
    expect((await update(a, root, 1, { p_archived: true })).error).toBeNull();
    expect((await update(a, root, 1, { p_name: "Cambio viejo" })).error?.code).toBe("40001");
  });
  it("restaurar padre conserva archivo propio y exige restaurar padre antes de hija", async () => {
    expect((await update(a, child, 1, { p_name: "Alquiler", p_archived: true })).error).toBeNull();
    expect((await update(a, child, 2, { p_name: "Alquiler" })).error?.code).toBe("23514");
    const restored = await update(a, root, 2); expect(restored.error).toBeNull();
    expect(restored.data.categories.find((c: { id: string }) => c.id === child)).toMatchObject({ status: "archived", effective_archived: true });
    expect((await update(a, child, 2, { p_name: "Alquiler" })).error).toBeNull();
  });
  it("dos ediciones concurrentes confirman solo una versión", async () => {
    const results = await Promise.all([update(a, root, 3, { p_description: "A" }), update(a, root, 3, { p_description: "B" })]);
    expect(results.filter((r) => !r.error)).toHaveLength(1); expect(results.find((r) => r.error)?.error?.code).toBe("40001");
  });
  it("rol efectivo aplica RLS, FK propia, inmutabilidad y auditoría append-only", () => {
    expect(sql(uidB, `update finance.categories set name='Intruso',version=version+1 where id='${root}'`)).toContain("UPDATE 0");
    denied(uid, `update finance.categories set kind='income',version=version+1 where id='${root}'`, "23514");
    denied(uid, `update finance.categories set parent_id='${child}',version=version+1 where id='${root}'`, "23514");
    denied(uidB, `insert into finance.category_events(user_id,category_id,action,version) values('${uidB}','${root}','updated',99)`, "23503");
    denied(uid, "update finance.category_events set action='updated'", "42501");
    expect(sql(uidB, `delete from finance.categories where id='${root}'`)).toContain("DELETE 0");
    denied(uid, "delete from finance.category_events", "42501");
  });
  it("plantillas concurrentes son propias e idempotentes y no recrean una renombrada", async () => {
    const cc = await signup(); const results = await Promise.all([cc.c.schema("api").rpc("initialize_categories"), cc.c.schema("api").rpc("initialize_categories")]);
    for (const r of results) { expect(r.error).toBeNull(); expect(r.data).toMatchObject({ initialized: true }); expect(r.data.categories).toHaveLength(10); }
    const food = results[0].data.categories.find((c: { name: string }) => c.name === "Alimentación");
    expect((await update(cc.c, food.id, 1, { p_name: "Comidas", p_description: "", p_color: "amber", p_icon: "utensils" })).error).toBeNull();
    const retry = await cc.c.schema("api").rpc("initialize_categories"); expect(retry.data.categories).toHaveLength(10); expect(retry.data.categories.some((c: { name: string }) => c.name === "Alimentación")).toBe(false);
    expect((await read(a)).data.initialized).toBe(false);
  });
  it("cuota 200 serializada, incluso archivadas; el reintento funciona en el límite", async () => {
    const cc = await signup();
    sql(cc.uid, `insert into finance.categories(user_id,create_request_id,kind,name,color,icon,status) select '${cc.uid}',gen_random_uuid(),'expense','Prueba '||i,'blue','tag','archived' from generate_series(1,199) i`);
    const requests = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.all(requests.map((id, i) => create(cc.c, { p_request_id: id, p_name: `Límite ${i}` })));
    expect(results.filter((r) => !r.error)).toHaveLength(1); expect(results.find((r) => r.error)?.error?.code).toBe("54000");
    const winner = results.findIndex((r) => !r.error); expect((await create(cc.c, { p_request_id: requests[winner], p_name: `Límite ${winner}` })).error).toBeNull();
    expect((await read(cc.c)).data.categories).toHaveLength(200);
  });
  it("archivo concurrente del padre nunca deja una hija elegible", async () => {
    const cc = await signup(); const first = await create(cc.c); const parent = first.data.categories[0].id;
    const [archived, creation] = await Promise.all([update(cc.c, parent, 1, { p_archived: true }), create(cc.c, { p_request_id: crypto.randomUUID(), p_parent_id: parent, p_name: "Hija concurrente" })]);
    expect(archived.error).toBeNull();
    if (creation.error) expect(creation.error.code).toBe("23514");
    const rows = (await read(cc.c)).data.categories;
    expect(rows.every((c: { effective_archived: boolean }) => c.effective_archived)).toBe(true);
  });
  it("las plantillas respetan nombres existentes y hacen rollback si falta cuota", async () => {
    const cc = await signup(); expect((await create(cc.c, { p_name: "Vivienda" })).error).toBeNull();
    const seeded = await cc.c.schema("api").rpc("initialize_categories"); expect(seeded.error).toBeNull(); expect(seeded.data.categories).toHaveLength(10);
    expect(seeded.data.categories.find((c: { name: string }) => c.name === "Vivienda")).toMatchObject({ description: "Personal", color: "blue", icon: "home" });
    const limited = await signup();
    sql(limited.uid, `insert into finance.categories(user_id,create_request_id,kind,name,color,icon) select '${limited.uid}',gen_random_uuid(),'expense','Prueba '||i,'blue','tag' from generate_series(1,195) i`);
    expect((await limited.c.schema("api").rpc("initialize_categories")).error?.code).toBe("54000");
    const after = (await read(limited.c)).data; expect(after.categories).toHaveLength(195); expect(after.initialized).toBe(false);
    expect(sql(limited.uid, "select count(*) from finance.category_events")).toContain("\n0\n");
  });
  it("anon y perfil incompleto no pueden crear ni inicializar", async () => {
    expect((await create(client())).error?.code).toBe("42501");
    expect((await client().schema("api").rpc("read_categories")).error?.code).toBe("42501");
    const incomplete = await signup(false); expect((await create(incomplete.c)).error?.code).toBe("42501"); expect((await incomplete.c.schema("api").rpc("initialize_categories")).error?.code).toBe("42501");
    expect((await a.schema("finance").from("categories").select()).error).not.toBeNull();
  });
});
async function member() {
  const c = client(), email = `categories-${crypto.randomUUID()}@example.test`, password = "una frase de prueba para categorías 64";
  expect((await c.auth.signUp({ email, password })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
  expect(verified.error).toBeNull(); await c.schema("api").rpc("ensure_profile");
  expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Prueba gestión", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 })).error).toBeNull();
  return { c, uid: verified.data.user!.id, email, password };
}
async function cash(c: SupabaseClient) {
  const account = await c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Efectivo", p_type: "cash", p_currency: "PEN", p_opening: "100" });
  expect(account.error).toBeNull(); return account.data.id as string;
}
const remove = (c: SupabaseClient, id: string, version: number) => c.schema("api").rpc("delete_category", { p_id: id, p_expected_version: version });
const imageOf = (data: { categories: { id: string; image_path: string | null; movement_count: number; version: number }[] }, id: string) => data.categories.find((row) => row.id === id)!;
describe("gestión de categorías: borrado definitivo, imágenes y almacenamiento", () => {
  it("elimina solo categorías sin subcategorías ni movimientos, incluidos los anulados", async () => {
    const x = await member(), account = await cash(x.c);
    const used = await create(x.c, { p_name: "Ocio" }); expect(used.error).toBeNull();
    const usedId = used.data.categories[0].id;
    const posted = await x.c.schema("api").rpc("post_movement", { p_request_id: crypto.randomUUID(), p_kind: "expense", p_account_id: account, p_category_id: usedId, p_amount: "10", p_description: "Cine", p_note: "", p_occurred_at: null });
    expect(posted.error).toBeNull();
    expect(imageOf((await read(x.c)).data, usedId).movement_count).toBe(1);
    expect((await remove(x.c, usedId, 1)).error?.code).toBe("23503");
    expect((await x.c.schema("api").rpc("void_movement", { p_id: posted.data.id, p_expected_version: 1, p_reason: "Prueba" })).error).toBeNull();
    expect(imageOf((await read(x.c)).data, usedId).movement_count).toBe(1);
    expect((await remove(x.c, usedId, 1)).error?.code).toBe("23503");
    expect((await remove(x.c, crypto.randomUUID(), 1)).error?.code).toBe("P0002");
    expect((await remove(x.c, usedId, 9)).error?.code).toBe("40001");
    const parent = await create(x.c, { p_request_id: crypto.randomUUID(), p_name: "Hogar" }); expect(parent.error).toBeNull();
    const parentId = parent.data.categories.find((row: { name: string }) => row.name === "Hogar").id;
    const child = await create(x.c, { p_request_id: crypto.randomUUID(), p_parent_id: parentId, p_name: "Luz" }); expect(child.error).toBeNull();
    const childId = child.data.categories.find((row: { parent_id: string }) => row.parent_id === parentId).id;
    expect((await remove(x.c, parentId, 1)).error?.code).toBe("2BP01");
    expect((await remove(x.c, childId, 1)).error).toBeNull();
    expect((await read(x.c)).data.categories.some((row: { id: string }) => row.id === childId)).toBe(false);
    expect((await remove(x.c, parentId, 1)).error).toBeNull();
    expect((await read(x.c)).data.categories).toHaveLength(1);
    const other = await member();
    expect((await remove(other.c, usedId, 1)).error?.code).toBe("P0002");
  });
  it("acepta únicamente rutas de imagen emitidas para el propio dueño", async () => {
    const x = await member(), path = `${x.uid}/${crypto.randomUUID()}.webp`;
    const created = await create(x.c, { p_name: "Con imagen", p_image_path: path }); expect(created.error).toBeNull();
    const id = created.data.categories[0].id;
    expect(imageOf(created.data, id).image_path).toBe(path);
    expect((await create(x.c, { p_request_id: crypto.randomUUID(), p_name: "Ajena", p_image_path: `${crypto.randomUUID()}/${crypto.randomUUID()}.webp` })).error?.code).toBe("23514");
    expect((await create(x.c, { p_request_id: crypto.randomUUID(), p_name: "Png", p_image_path: `${x.uid}/${crypto.randomUUID()}.png` })).error?.code).toBe("23514");
    const cleared = await update(x.c, id, 1, { p_name: "Con imagen", p_image_path: null }); expect(cleared.error).toBeNull();
    expect(imageOf(cleared.data, id).image_path).toBeNull();
    denied(x.uid, `update finance.categories set image_path='${crypto.randomUUID()}/${crypto.randomUUID()}.webp',version=version+1 where id='${id}'`, "23514");
  });
  it("exporta la ruta de imagen sin exponer archivos ni credenciales", async () => {
    const x = await member(), path = `${x.uid}/${crypto.randomUUID()}.webp`;
    const created = await create(x.c, { p_name: "Exportable", p_image_path: path }); expect(created.error).toBeNull();
    const id = created.data.categories[0].id;
    expect((await x.c.auth.signInWithPassword({ email: x.email, password: x.password })).error).toBeNull();
    const proof = await x.c.schema("api").rpc("issue_reauth_proof", { p_purpose: "export_data" }); expect(proof.error).toBeNull();
    const exported = await x.c.schema("api").rpc("export_personal_data", { p_proof: proof.data.token, p_format: "json" });
    expect(exported.error).toBeNull(); expect(imageOf(exported.data, id).image_path).toBe(path);
    expect(JSON.stringify(exported.data)).not.toMatch(/token_hash|password|create_request_id|image_url|signed/i);
  });
  it("bucket privado, rutas por dueño y límites de tipo y tamaño", async () => {
    const a = await member(), b = await member(), bucket = () => a.c.storage.from("category-images");
    const webp = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
    const own = `${a.uid}/${crypto.randomUUID()}.webp`;
    expect((await bucket().upload(own, new Blob([webp], { type: "image/webp" }), { contentType: "image/webp" })).error).toBeNull();
    expect((await bucket().download(own)).error).toBeNull();
    expect((await b.c.storage.from("category-images").download(own)).error).not.toBeNull();
    expect((await client().storage.from("category-images").download(own)).error).not.toBeNull();
    const foreign = `${b.uid}/${crypto.randomUUID()}.webp`;
    expect((await bucket().upload(foreign, new Blob([webp], { type: "image/webp" }), { contentType: "image/webp" })).error).not.toBeNull();
    expect((await bucket().upload(`${a.uid}/${crypto.randomUUID()}.png`, new Blob([webp], { type: "image/png" }), { contentType: "image/png" })).error).not.toBeNull();
    expect((await bucket().upload(`${a.uid}/${crypto.randomUUID()}.webp`, new Blob([new Uint8Array(1048577)], { type: "image/webp" }), { contentType: "image/webp" })).error).not.toBeNull();
    expect((await bucket().remove([own])).error).toBeNull();
    expect((await bucket().download(own)).error).not.toBeNull();
  });
});
