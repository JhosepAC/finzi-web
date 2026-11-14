import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findMailLink } from "../helpers/mail";

const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function signup() {
  const c = client(); const email = `profile-${crypto.randomUUID()}@example.test`;
  expect((await c.auth.signUp({ email, password: "una frase de prueba para perfil 64" })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
  expect(verified.error).toBeNull(); expect((await c.schema("api").rpc("ensure_profile")).error).toBeNull();
  return c;
}
const input = { p_display_name: "Sol", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 };
describe("perfil: persistencia, versión e aislamiento reales", () => {
  let a: SupabaseClient, b: SupabaseClient;
  beforeAll(async () => { a = await signup(); b = await signup(); });
  it("empieza sin preferencias inventadas ni onboarding completado", async () => {
    const read = await a.schema("api").rpc("read_profile");
    expect(read.error).toBeNull(); expect(read.data.version).toBe(0);
    expect(read.data.preferred_currency).toBeNull(); expect(read.data.onboarding_completed_at).toBeNull();
  });
  it("guarda preferencias propias sin modificar otro perfil", async () => {
    const result = await a.schema("api").rpc("configure_profile", input);
    expect(result.error).toBeNull(); expect(result.data.display_name).toBe("Sol"); expect(result.data.version).toBe(1);
    expect(result.data.timezone).toBe("America/Lima"); expect(Boolean(result.data.onboarding_completed_at)).toBe(true);
    expect((await b.schema("api").rpc("read_profile")).data.onboarding_completed_at).toBeNull();
  });
  it("reintenta un commit confirmado sin duplicar versión", async () => {
    const result = await a.schema("api").rpc("configure_profile", input);
    expect(result.error).toBeNull(); expect(result.data.version).toBe(1);
  });
  it.each([{ p_currency: "EUR" }, { p_timezone: "Mars/Olympus" }, { p_timezone: "PST" }, { p_display_name: " " }])("Postgres rechaza preferencias inválidas %j", async (change) => {
    const result = await a.schema("api").rpc("configure_profile", { ...input, ...change, p_expected_version: 1 });
    expect(result.error?.code).toBe("23514");
    expect((await a.schema("api").rpc("read_profile")).data.version).toBe(1);
  });
  it("rechaza una edición obsoleta sin perder lo guardado", async () => {
    const result = await a.schema("api").rpc("configure_profile", { ...input, p_display_name: "Otro nombre" });
    expect(result.error?.code).toBe("40001"); expect((await a.schema("api").rpc("read_profile")).data.display_name).toBe("Sol");
  });
  it("no permite elegir dueño por parámetro ni ejecutar como anónimo", async () => {
    const other = (await b.schema("api").rpc("read_profile")).data.user_id;
    expect((await a.schema("api").rpc("configure_profile", { ...input, user_id: other })).error).not.toBeNull();
    expect((await client().schema("api").rpc("configure_profile", input)).error).not.toBeNull();
    expect((await b.schema("api").rpc("read_profile")).data.onboarding_completed_at).toBeNull();
  });
  it("serializa dos ediciones concurrentes: una confirma y la otra entra en conflicto", async () => {
    const results = await Promise.all(["Luna", "Mar"].map((p_display_name) => a.schema("api").rpc("configure_profile", { ...input, p_display_name, p_currency: "USD", p_timezone: "UTC", p_expected_version: 1 })));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error?.code === "40001")).toHaveLength(1);
    const read = (await a.schema("api").rpc("read_profile")).data;
    expect(read.version).toBe(2); expect(read.preferred_currency).toBe("USD"); expect(read.display_name).toBe(results.find((r) => !r.error)?.data.display_name);
  });
  it("la RPC de nombre anterior también invalida borradores obsoletos", async () => {
    expect((await a.schema("api").rpc("update_profile", { p_display_name: "Nuevo nombre" })).error).toBeNull();
    expect((await a.schema("api").rpc("configure_profile", { ...input, p_expected_version: 2 })).error?.code).toBe("40001");
  });
});
