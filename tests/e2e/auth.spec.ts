import { test, expect, type Page } from "@playwright/test";
import { findMailLink } from "../helpers/mail";
import { execFileSync } from "node:child_process";

process.loadEnvFile(".env.local");
const authUrl = process.env.SUPABASE_URL;
if (!authUrl || !["127.0.0.1", "localhost"].includes(new URL(authUrl).hostname)) throw new Error("E2E requiere Supabase LOCAL; nunca usar cuentas cloud o datos reales.");

const origin = "http://127.0.0.1:3000";
const password = "una frase de prueba para finzi 42";
function uniqueEmail() { return `e2e-${crypto.randomUUID()}@example.test`; }
async function fillCredentials(page: Page, email: string, value = password) {
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(value);
}
async function register(page: Page, email: string) {
  await page.goto("/register"); await fillCredentials(page, email);
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  return findMailLink(email, "signup");
}
async function confirm(page: Page, link: string) {
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Confirma tu correo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar correo", exact: true }).click();
  await expect(page).toHaveURL(/\/session/);
}

test.describe("AUTH real con Supabase local", () => {
  test("rutas públicas, redirección inicial y bloqueo privado sin sesión", async ({ page, request }) => {
    for (const [route, heading] of [["/login", "Iniciar sesión"], ["/register", "Crea tu cuenta"], ["/forgot-password", "Recupera tu acceso"], ["/verify-email", "Revisa tu correo"]]) {
      await page.goto(route); await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    await page.goto("/session"); await expect(page).toHaveURL(/\/login$/);
    await page.goto("/reset-password"); await expect(page).toHaveURL(/\/forgot-password$/);
    await page.goto("/"); await expect(page).toHaveURL(/\/login$/);
    expect((await request.get("/api/v1/auth/session")).status()).toBe(401);
  });
  test("validación visible, confirmación, foco y mostrar/ocultar contraseña", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(page.getByLabel("Correo electrónico", { exact: true })).toBeFocused();
    await expect(page.getByText("Escribe un correo electrónico válido.")).toBeVisible();
    await fillCredentials(page, "persona@example.test", "corta");
    await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).click();
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Ocultar contraseña", exact: true }).click();
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute("type", "password");
    await page.getByLabel("Confirmar contraseña").fill("diferente");
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(page.getByText("Usa al menos 12 caracteres.")).toBeVisible();
    await expect(page.getByText("Las contraseñas no coinciden.")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".impeccable/review/register-error-390.png", fullPage: true, animations: "disabled" });
  });
  test("registro, correo explícito, sesión verificada, cookies y logout local", async ({ page, context, browser }) => {
    const email = uniqueEmail(); const link = await register(page, email);
    expect((await context.cookies()).filter((c) => c.name.includes("auth-token") && !c.name.endsWith("-code-verifier"))).toHaveLength(0);
    expect((await context.request.get("/api/v1/auth/session")).status()).toBe(401);
    await confirm(page, link);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: ".impeccable/review/session-1440.png", fullPage: true, animations: "disabled" });
    expect(new URL(page.url()).hash).toBe("");
    const session = await context.request.get("/api/v1/auth/session"); expect(session.status()).toBe(200);
    expect((await session.json()).user.email).toBe(email);
    const cookies = (await context.cookies()).filter((c) => c.name.includes("auth-token"));
    expect(cookies.length).toBeGreaterThan(0); expect(cookies.every((c) => c.httpOnly && c.sameSite === "Lax")).toBe(true);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    for (const path of ["/login", "/register"]) { await page.goto(path); await expect(page).toHaveURL(/\/session/); }
    const sibling = await context.newPage(); await sibling.goto(`${origin}/session`);
    // A second independent browser session must survive a local-only sign-out.
    const other = await browser.newContext(); const otherPage = await other.newPage();
    await otherPage.goto(`${origin}/login`); await fillCredentials(otherPage, email);
    await otherPage.getByRole("button", { name: "Iniciar sesión", exact: true }).click(); await expect(otherPage).toHaveURL(/\/session/);
    await page.getByRole("button", { name: "Cerrar esta sesión", exact: true }).click(); await expect(page).toHaveURL(/\/login\?notice=signed-out/);
    await sibling.bringToFront(); await expect(sibling).toHaveURL(/\/login/); await sibling.close();
    expect((await context.request.get("/api/v1/auth/session")).status()).toBe(401);
    expect((await other.request.get(`${origin}/api/v1/auth/session`)).status()).toBe(200);
    await page.goto("/session"); await expect(page).toHaveURL(/\/login$/);
    await otherPage.getByRole("button", { name: "Cerrar en todos los dispositivos" }).click(); await expect(otherPage).toHaveURL(/\/login/); await other.close();
  });
  test("correo no confirmado y credenciales incorrectas tienen el mismo error", async ({ page }) => {
    const email = uniqueEmail(); await register(page, email);
    await page.goto("/login"); await fillCredentials(page, email);
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    const message = "No pudimos iniciar sesión. Revisa el correo, la contraseña y la confirmación de tu cuenta.";
    await expect(page.getByText(message)).toBeVisible();
    await page.getByLabel("Contraseña", { exact: true }).fill("contraseña incorrecta");
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await expect(page.getByText(message)).toBeVisible(); await expect(page).toHaveURL(/\/login$/);
  });
  test("duplicado usa confirmación genérica y no revela la cuenta existente", async ({ page, browser }) => {
    const email = uniqueEmail(); await confirm(page, await register(page, email));
    const another = await browser.newContext(); const fresh = await another.newPage();
    await fresh.goto(`${origin}/register`); await fillCredentials(fresh, email); await fresh.getByLabel("Confirmar contraseña").fill(password);
    await fresh.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(fresh).toHaveURL(/\/verify-email$/); expect((await another.request.get(`${origin}/api/v1/auth/session`)).status()).toBe(401); await another.close();
  });
  test("recuperación completa, cambio de contraseña y enlace consumido", async ({ page }) => {
    const email = uniqueEmail(); await confirm(page, await register(page, email));
    // A password-only login does not authorize the recovery endpoint.
    await page.getByRole("button", { name: "Cerrar esta sesión" }).click();
    await fillCredentials(page, email); await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click(); await expect(page).toHaveURL(/\/session/);
    const denied = await page.request.post("/api/v1/auth/reset-password", { headers: { Origin: origin }, data: { password: "nueva frase de prueba 91", confirmPassword: "nueva frase de prueba 91" } }); expect(denied.status()).toBe(401);
    await page.getByRole("button", { name: "Cerrar esta sesión" }).click();
    await page.goto("/forgot-password"); await page.getByLabel("Correo electrónico").fill(email);
    await page.getByRole("button", { name: "Enviar enlace", exact: true }).click();
    await expect(page.getByText("Si hay una cuenta asociada a este correo, recibirás un enlace para restablecer tu contraseña.")).toBeVisible();
    const link = await findMailLink(email, "recovery"); await page.goto(link);
    await page.getByRole("button", { name: "Continuar recuperación" }).click(); await expect(page).toHaveURL(/\/reset-password$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".impeccable/review/recovery-390.png", fullPage: true, animations: "disabled" });
    const newer = "una nueva frase de acceso finzi 82";
    await page.getByLabel("Nueva contraseña", { exact: true }).fill(newer); await page.getByLabel("Confirmar contraseña").fill(newer);
    await page.getByRole("button", { name: "Guardar contraseña" }).click(); await expect(page).toHaveURL(/\/login\?notice=password-updated/);
    await fillCredentials(page, email, newer); await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click(); await expect(page).toHaveURL(/\/session/);
    await page.getByRole("button", { name: "Cerrar esta sesión" }).click();
    await page.goto(link); await page.getByRole("button", { name: "Continuar recuperación" }).click();
    await expect(page.getByText("Este enlace no es válido o ya expiró. Solicita uno nuevo.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar recuperación" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Solicitar recuperación", exact: true })).toHaveClass(/button-primary/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".impeccable/review/invalid-link-390.png", fullPage: true, animations: "disabled" });
  });
  test("recuperación de correo inexistente conserva respuesta no enumeradora", async ({ page }) => {
    await page.goto("/forgot-password"); await page.getByLabel("Correo electrónico").fill(uniqueEmail());
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByText("Si hay una cuenta asociada a este correo, recibirás un enlace para restablecer tu contraseña.")).toBeVisible();
  });
  test("enlaces inválidos son recuperables y no abren ruta privada", async ({ page }) => {
    await page.goto("/auth/confirm"); await expect(page.getByRole("heading", { name: "El enlace no es válido" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Solicitar confirmación" })).toHaveAttribute("href", "/verify-email");
    await page.goto("/auth/confirm#token_hash=" + "a".repeat(64) + "&type=recovery");
    await page.getByRole("button", { name: "Continuar recuperación" }).click();
    await expect(page.getByText("Este enlace no es válido o ya expiró. Solicita uno nuevo.")).toBeVisible();
    expect((await page.request.get("/api/v1/auth/session")).status()).toBe(401);
  });
  test("un fallo temporal de verificación permite reintentar el mismo enlace", async ({ page }) => {
    await page.route("**/api/v1/auth/verify", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "AUTH_UNAVAILABLE", message: "El acceso no está disponible ahora. Inténtalo más tarde." }) }));
    await page.goto("/auth/confirm#token_hash=" + "a".repeat(64) + "&type=recovery");
    await page.getByRole("button", { name: "Continuar recuperación" }).click();
    await expect(page.getByText("El acceso no está disponible ahora. Inténtalo más tarde.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar recuperación" })).toBeEnabled();
  });
  test("cookie inválida no autoriza sesión", async ({ page, context }) => {
    await context.addCookies([{ name: "sb-127-auth-token", value: "base64-invalid-expired", domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/session"); await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/v1/auth/session")).status()).toBe(401);
  });
  test("renovación de sesión expirada descarta credenciales y bloquea rutas privadas", async ({ page, context }) => {
    const email = uniqueEmail(); await confirm(page, await register(page, email));
    const identity = (await (await context.request.get("/api/v1/auth/session")).json()).user;
    if (typeof identity.id !== "string" || !/^[a-f0-9-]{36}$/i.test(identity.id)) throw new Error("Falta UUID propio verificado.");
    // Expire only this synthetic user's Auth sessions in the local provider.
    execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `update auth.sessions set not_after = now() - interval '1 second' where user_id = '${identity.id}';`], { stdio: "pipe" });
    const all = await context.cookies();
    const auth = all.filter((cookie) => cookie.name.includes("auth-token") && !cookie.name.includes("code-verifier"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    expect(auth.length > 0).toBe(true);
    const encoded = auth.map((cookie) => cookie.value).join("");
    if (!encoded.startsWith("base64-")) throw new Error("Cookie SSR con codificación inesperada.");
    const stored = JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString("utf8"));
    // Advance only the fixture's SDK expiry metadata to exercise refresh without waiting one hour.
    // No JWT is forged; Supabase itself rejects refresh because not_after really elapsed.
    stored.expires_at = Math.floor(Date.now() / 1000) - 60;
    const value = "base64-" + Buffer.from(JSON.stringify(stored)).toString("base64url");
    const base = auth[0].name.replace(/\.\d+$/, "");
    const parts = value.match(/.{1,3000}/g)!;
    await context.clearCookies();
    await context.addCookies(parts.map((part, index) => ({ ...auth[0], name: parts.length === 1 ? base : `${base}.${index}`, value: part })));
    await page.goto("/session"); await expect(page).toHaveURL(/\/login$/);
    expect((await context.request.get("/api/v1/auth/session")).status()).toBe(401);
    // Empty deletion slots are not credentials; no session value may survive the failed refresh.
    expect((await context.cookies()).filter((cookie) => cookie.name.includes("auth-token") && !cookie.name.includes("code-verifier") && cookie.value).map((cookie) => cookie.name)).toEqual([]);
  });
  test("CSRF, parámetros ajenos y tamaño de entrada son rechazados", async ({ request }) => {
    const page = await request.get("/login");
    expect(page.headers()["content-security-policy"]).toContain("'nonce-");
    expect(page.headers()["cache-control"]).toContain("no-store");
    expect(page.headers()["referrer-policy"]).toBe("no-referrer");
    const payload = { email: "persona@example.test", password };
    expect((await request.post("/api/v1/auth/login", { headers: { Origin: "https://otro.example" }, data: payload })).status()).toBe(403);
    expect((await request.post("/api/v1/auth/login", { headers: { Origin: origin }, data: { ...payload, user_id: "otro" } })).status()).toBe(422);
    expect((await request.post("/api/v1/auth/login", { headers: { Origin: origin }, data: { email: "a".repeat(9000) } })).status()).toBe(413);
    expect((await request.post("/api/v1/auth/logout", { headers: { Origin: origin }, data: { scope: "global" } })).status()).toBe(401);
  });
  test("fallo del proveedor conserva campos y explica la recuperación", async ({ page }) => {
    await page.goto("/login"); await fillCredentials(page, "persona@example.test");
    await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "El acceso no está disponible ahora. Inténtalo más tarde." }) }));
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click(); await expect(page.getByText("El acceso no está disponible ahora. Inténtalo más tarde.")).toBeVisible();
    await expect(page.getByLabel("Correo electrónico", { exact: true })).toHaveValue("persona@example.test");
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue(password);
  });
  test("responsive y acceso por teclado a 320, 390, 768, 1024 y 1440", async ({ page }) => {
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto("/register");
      await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.goto("/login"); await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
  });
});
