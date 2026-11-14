import { describe, expect, it, vi } from "vitest";
import { authSchemas, hasRecentEmailProof, isAuthAction } from "../../src/modules/identity/domain/auth";
import { executeAuth, type AuthGateway } from "../../src/modules/identity/application/auth-service";

const password = "una frase larga para finzi";
const user = { id: "user-a", email: "persona@example.test", verified: true };
function gateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  const ok = async () => ({ error: null });
  return { register: vi.fn(ok), login: vi.fn(ok), recover: vi.fn(ok), resend: vi.fn(ok), verify: vi.fn(ok), identity: vi.fn(async () => user), recoverySession: vi.fn(async () => true), updatePassword: vi.fn(ok), logout: vi.fn(ok), ensureProfile: vi.fn(ok), ...overrides };
}
describe("contratos y seguridad de entrada", () => {
  it("normaliza correo, sin cambiar ni recortar contraseña", () => {
    const parsed = authSchemas.login.parse({ email: " PERSONA@EXAMPLE.TEST ", password: "  una frase larga  " });
    expect(parsed.email).toBe("persona@example.test"); expect(parsed.password).toBe("  una frase larga  ");
  });
  it.each(["sin-arroba", "a@", "", "x".repeat(255) + "@example.test"])("rechaza correo inválido %s", (email) => {
    expect(authSchemas.register.safeParse({ email, password, confirmPassword: password }).success).toBe(false);
  });
  it.each(["corta", "", "a".repeat(129)])("rechaza contraseña nueva inválida", (value) => {
    expect(authSchemas.register.safeParse({ email: user.email, password: value, confirmPassword: value }).success).toBe(false);
  });
  it("rechaza confirmación distinta y campos de identidad inyectados", () => {
    expect(authSchemas.register.safeParse({ email: user.email, password, confirmPassword: "otra" }).success).toBe(false);
    expect(authSchemas.login.safeParse({ email: user.email, password, user_id: "otro" }).success).toBe(false);
    expect(isAuthAction("__proto__")).toBe(false);
  });
  it("no acepta un enlace arbitrario ni un next de redirección externa", () => {
    expect(authSchemas.verify.safeParse({ type: "signup", tokenHash: "pkce_" + "a".repeat(56) }).success).toBe(true);
    expect(authSchemas.verify.safeParse({ type: "signup", tokenHash: "bad" }).success).toBe(false);
    expect(authSchemas.verify.safeParse({ type: "recovery", tokenHash: "a".repeat(64), next: "https://evil.test" }).success).toBe(false);
  });
});
describe("casos de uso AUTH", () => {
  it("registro válido solicita confirmación y no devuelve sesión", async () => {
    const g = gateway(); const result = await executeAuth("register", { email: user.email, password, confirmPassword: password }, g);
    expect(result.status).toBe(202); expect(result.body.redirectTo).toBe("/verify-email"); expect(g.register).toHaveBeenCalledWith(user.email, password); expect(g.login).not.toHaveBeenCalled();
  });
  it("no afirma haber enviado correo si el proyecto omite confirmación", async () => {
    const r = await executeAuth("register", { email: user.email, password, confirmPassword: password }, gateway({ register: async () => ({ error: "email_confirmation_disabled" }) }));
    expect(r.status).toBe(503); expect(r.body.ok).toBe(false);
  });
  it("mapea rechazo de contraseña del proveedor al campo", async () => {
    const r = await executeAuth("register", { email: user.email, password, confirmPassword: password }, gateway({ register: async () => ({ error: "weak_password" }) }));
    expect(r.status).toBe(422); expect(r.body.fieldErrors?.password).toBeDefined();
  });
  it("fallo del servicio al iniciar sesión no se disfraza como credenciales incorrectas", async () => {
    const r = await executeAuth("login", { email: user.email, password }, gateway({ login: async () => ({ error: "provider_error" }) }));
    expect(r.status).toBe(503);
  });
  it("duplicado y nuevo registro producen el mismo resultado público", async () => {
    const input = { email: user.email, password, confirmPassword: password };
    const fresh = await executeAuth("register", input, gateway());
    const duplicate = await executeAuth("register", input, gateway({ register: async () => ({ error: "user_already_exists" }) }));
    expect(duplicate).toEqual(fresh);
  });
  it("validación falla antes de contactar al proveedor", async () => {
    const g = gateway(); const result = await executeAuth("register", {}, g);
    expect(result.status).toBe(422); expect(result.body.fieldErrors?.email).toBeDefined(); expect(g.register).not.toHaveBeenCalled();
  });
  it("login exige sesión verificada y perfil propio", async () => {
    const g = gateway(); const r = await executeAuth("login", { email: user.email, password }, g);
    expect(r.status).toBe(200); expect(r.body.redirectTo).toBe("/session"); expect(g.identity).toHaveBeenCalledOnce(); expect(g.ensureProfile).toHaveBeenCalledOnce();
  });
  it.each(["invalid_credentials", "email_not_confirmed", "user_not_found"])("no enumera cuentas con %s", async (error) => {
    const r = await executeAuth("login", { email: user.email, password }, gateway({ login: async () => ({ error }) }));
    expect(r.status).toBe(401); expect(r.body.code).toBe("SIGN_IN_FAILED"); expect(r.body.message).not.toContain(error);
  });
  it.each([null, { ...user, verified: false }])("una sesión inexistente o sin confirmar no accede", async (identity) => {
    const g = gateway({ identity: async () => identity });
    expect((await executeAuth("login", { email: user.email, password }, g)).status).toBe(401);
    expect(g.ensureProfile).not.toHaveBeenCalled(); expect(g.logout).toHaveBeenCalledWith("local");
  });
  it("fallo de perfil no deja login parcialmente exitoso", async () => {
    const g = gateway({ ensureProfile: async () => ({ error: "database_error" }) });
    expect((await executeAuth("login", { email: user.email, password }, g)).status).toBe(503); expect(g.logout).toHaveBeenCalledWith("local");
  });
  it("recuperación de correo desconocido devuelve la misma respuesta", async () => {
    const known = await executeAuth("forgot-password", { email: user.email }, gateway());
    const unknown = await executeAuth("forgot-password", { email: user.email }, gateway({ recover: async () => ({ error: "user_not_found" }) }));
    expect(known).toEqual(unknown); expect(known.status).toBe(202);
  });
  it("enlace inválido no crea perfil ni declara éxito", async () => {
    const g = gateway({ verify: async () => ({ error: "otp_expired" }) });
    const r = await executeAuth("verify", { tokenHash: "a".repeat(64), type: "signup" }, g);
    expect(r.status).toBe(400); expect(g.ensureProfile).not.toHaveBeenCalled();
  });
  it("fallo temporal al verificar no se presenta como enlace inválido", async () => {
    const r = await executeAuth("verify", { tokenHash: "a".repeat(64), type: "recovery" }, gateway({ verify: async () => ({ error: "provider_error" }) }));
    expect(r.status).toBe(503); expect(r.body.code).toBe("AUTH_UNAVAILABLE");
  });
  it("confirmación válida da acceso a la identidad", async () => {
    const g = gateway(); const r = await executeAuth("verify", { tokenHash: "a".repeat(64), type: "signup" }, g);
    expect(r.body.redirectTo).toBe("/session?notice=email-verified"); expect(g.ensureProfile).toHaveBeenCalledOnce();
  });
  it("recuperación verificada abre exclusivamente el formulario de cambio", async () => {
    const g = gateway(); const r = await executeAuth("verify", { tokenHash: "a".repeat(64), type: "recovery" }, g);
    expect(r.body.redirectTo).toBe("/reset-password"); expect(g.ensureProfile).not.toHaveBeenCalled();
  });
  it("sesión ordinaria o expirada no cambia contraseña mediante recuperación", async () => {
    const g = gateway({ recoverySession: async () => false });
    expect((await executeAuth("reset-password", { password, confirmPassword: password }, g)).status).toBe(401);
    expect(g.updatePassword).not.toHaveBeenCalled();
  });
  it("cambiar contraseña invalida refresh tokens globalmente antes de éxito", async () => {
    const g = gateway(); const r = await executeAuth("reset-password", { password, confirmPassword: password }, g);
    expect(r.body.redirectTo).toBe("/login?notice=password-updated"); expect(g.updatePassword).toHaveBeenCalledWith(password); expect(g.logout).toHaveBeenCalledWith("global");
  });
  it("contraseña repetida tiene mensaje recuperable", async () => {
    const g = gateway({ updatePassword: async () => ({ error: "same_password" }) });
    expect((await executeAuth("reset-password", { password, confirmPassword: password }, g)).status).toBe(422); expect(g.logout).not.toHaveBeenCalled();
  });
  it("no afirma revocación global si el proveedor falla", async () => {
    const g = gateway({ logout: async () => ({ error: "network_error" }) });
    expect((await executeAuth("reset-password", { password, confirmPassword: password }, g)).body.code).toBe("SIGN_OUT_INCOMPLETE");
  });
  it.each(["local", "global"] as const)("cierra sesión con alcance %s", async (scope) => {
    const g = gateway(); const r = await executeAuth("logout", { scope }, g);
    expect(g.logout).toHaveBeenCalledWith(scope); expect(r.body.redirectTo).toBe("/login?notice=signed-out");
  });
  it("limita intentos y sanitiza fallos inesperados", async () => {
    const limited = await executeAuth("login", { email: user.email, password }, gateway({ login: async () => ({ error: "over_request_rate_limit" }) }));
    expect(limited.status).toBe(429);
    const broken = await executeAuth("login", { email: user.email, password }, gateway({ login: async () => { throw new Error("secret-payload"); } }));
    expect(broken.status).toBe(503); expect(JSON.stringify(broken)).not.toContain("secret-payload");
  });
});
describe("autorización de recuperación mediante claims verificados", () => {
  const now = 2_000_000_000_000;
  it.each(["otp", "recovery"])("acepta prueba de correo reciente %s", (method) => { expect(hasRecentEmailProof({ session_id: "id", amr: [{ method, timestamp: now / 1000 - 30 }] }, now)).toBe(true); });
  it.each([
    undefined, {}, { session_id: "id", amr: [{ method: "password", timestamp: now / 1000 }] },
    { session_id: "id", iat: now / 1000, amr: [{ method: "recovery", timestamp: now / 1000 - 3601 }] },
    { session_id: "id", amr: [{ method: "recovery", timestamp: now / 1000 + 5 }] },
    { session_id: "id", amr: [null, "recovery", { method: "recovery", timestamp: "now" }] }
  ])("rechaza claims inexistentes, ordinarios, vencidos o malformados", (claims) => { expect(hasRecentEmailProof(claims, now)).toBe(false); });
});
