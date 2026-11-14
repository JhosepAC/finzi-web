import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasRecentEmailProof } from "../../src/modules/identity/domain/auth";
import { findMailLink } from "../helpers/mail";
import { execFileSync } from "node:child_process";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Estas pruebas requieren Supabase LOCAL y .env.local; nunca se ejecutan contra nube.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const password = "frase de prueba para finzi 42";
const emailA = `integration-a-${crypto.randomUUID()}@example.test`;
const emailB = `integration-b-${crypto.randomUUID()}@example.test`;
let a: SupabaseClient, b: SupabaseClient;
let idA: string, idB: string;

async function signUp(email: string) {
  const c = client(); const { data, error } = await c.auth.signUp({ email, password });
  expect(error).toBeNull(); expect(data.session).toBeNull(); expect(data.user?.email_confirmed_at).toBeFalsy();
  const link = new URL(await findMailLink(email, "signup"));
  const params = new URLSearchParams(link.hash.slice(1));
  const confirmed = await c.auth.verifyOtp({ token_hash: params.get("token_hash")!, type: "signup" });
  expect(confirmed.error).toBeNull(); expect(Boolean(confirmed.data.session)).toBe(true);
  expect((await c.schema("api").rpc("ensure_profile")).error).toBeNull();
  return { c, id: confirmed.data.user!.id };
}
describe("Supabase real: identidad, recuperación y RLS", () => {
  beforeAll(async () => { const aa = await signUp(emailA); const bb = await signUp(emailB); a = aa.c; idA = aa.id; b = bb.c; idB = bb.id; });
  it("login real y verificación de identidad", async () => {
    const c = client(); expect((await c.auth.signInWithPassword({ email: emailA, password })).error).toBeNull();
    expect((await c.auth.getUser()).data.user?.id).toBe(idA);
  });
  it("credenciales incorrectas no obtienen sesión", async () => {
    const { data, error } = await client().auth.signInWithPassword({ email: emailA, password: "wrong password" });
    expect(error?.code).toBe("invalid_credentials"); expect(data.session).toBeNull();
  });
  it("proveedor rechaza contraseña débil", async () => {
    const r = await client().auth.signUp({ email: `weak-${crypto.randomUUID()}@example.test`, password: "tiny" });
    expect(r.error).not.toBeNull(); expect(r.data.session).toBeNull();
  });
  it("RLS real: RPC solo devuelve o modifica perfil propio", async () => {
    const readA = await a.schema("api").rpc("read_profile"); const readB = await b.schema("api").rpc("read_profile");
    expect(readA.error).toBeNull(); expect(readB.error).toBeNull();
    expect(readA.data.user_id).toBe(idA); expect(readB.data.user_id).toBe(idB);
    expect((await a.schema("api").rpc("update_profile", { p_display_name: "Persona A" })).error).toBeNull();
    expect((await b.schema("api").rpc("read_profile")).data.display_name).toBeNull();
    expect((await a.schema("api").rpc("update_profile", { p_display_name: "intrusión", user_id: idB })).error).not.toBeNull();
  });
  it("RLS sigue aislando incluso con rol ejecutor y IDs manipulados en SQL", () => {
    const sql = `begin; set local role app_executor; select set_config('request.jwt.claims', '{"sub":"${idA}","role":"authenticated"}', true); select count(*) from finance.profiles where user_id = '${idB}'; update finance.profiles set display_name='intrusion' where user_id='${idB}'; rollback;`;
    const output = execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-c", sql], { encoding: "utf8" });
    expect(output).toContain("\n0\n"); expect(output).toContain("UPDATE 0");
  });
  it("anónimo no ejecuta funciones y las tablas privadas no son API pública", async () => {
    expect((await client().schema("api").rpc("read_profile")).error).not.toBeNull();
    const response = await fetch(`${url}/rest/v1/profiles?select=*`, { headers: { apikey: key, "Accept-Profile": "finance" } });
    expect(response.ok).toBe(false);
  });
  it("renovación usa refresh oficial y sesiones locales se invalidan", async () => {
    const c = client(); await c.auth.signInWithPassword({ email: emailB, password });
    const refreshed = await c.auth.refreshSession(); expect(refreshed.error).toBeNull();
    const token = refreshed.data.session!.refresh_token;
    expect((await c.auth.signOut({ scope: "local" })).error).toBeNull();
    expect((await client().auth.refreshSession({ refresh_token: token })).error).not.toBeNull();
  });
  it("recuperación real produce prueba de correo y permite contraseña nueva", async () => {
    const c = client(); expect((await c.auth.resetPasswordForEmail(emailA)).error).toBeNull();
    const link = new URL(await findMailLink(emailA, "recovery"));
    const token = new URLSearchParams(link.hash.slice(1)).get("token_hash")!;
    expect((await c.auth.verifyOtp({ token_hash: token, type: "recovery" })).error).toBeNull();
    const claims = await c.auth.getClaims(); expect(hasRecentEmailProof(claims.data?.claims as Record<string, unknown>)).toBe(true);
    const newer = "una nueva frase para finzi 51";
    expect((await c.auth.updateUser({ password: newer })).error).toBeNull();
    await c.auth.signOut({ scope: "global" });
    expect((await client().auth.signInWithPassword({ email: emailA, password: newer })).error).toBeNull();
    expect((await client().auth.signInWithPassword({ email: emailA, password })).error).not.toBeNull();
    expect((await client().auth.verifyOtp({ token_hash: token, type: "recovery" })).error).not.toBeNull();
  });
  it("cierre global impide renovar otra sesión", async () => {
    const first = client(), second = client();
    await first.auth.signInWithPassword({ email: emailB, password });
    const other = await second.auth.signInWithPassword({ email: emailB, password });
    const token = other.data.session!.refresh_token;
    expect((await first.auth.signOut({ scope: "global" })).error).toBeNull();
    expect((await client().auth.refreshSession({ refresh_token: token })).error).not.toBeNull();
  });
  it("sesión expirada no puede renovarse; el access JWT conserva su TTL residual", async () => {
    const { c } = await signUp(`expired-${crypto.randomUUID()}@example.test`);
    const claims = await c.auth.getClaims();
    const sessionId = claims.data?.claims.session_id;
    expect(typeof sessionId).toBe("string");
    if (typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error("Falta session_id verificado.");
    // Test-only local fixture: expire this synthetic session in Auth, without forged JWTs or changing the host clock.
    execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `update auth.sessions set not_after = now() - interval '1 second' where id = '${sessionId}';`], { stdio: "pipe" });
    const refreshed = await c.auth.refreshSession();
    expect(refreshed.error?.code).toBe("session_expired");
    expect(Boolean(refreshed.data.session)).toBe(false);
    const identity = await c.auth.getUser();
    // Supabase still accepts this previously issued access JWT until its own expiry.
    expect(Boolean(identity.data.user)).toBe(true);
  });
});
