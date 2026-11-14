import { test, expect, type Page } from "@playwright/test";
import { findMailLink } from "../helpers/mail";

process.loadEnvFile(".env.local");
if (!process.env.SUPABASE_URL || !["127.0.0.1", "localhost"].includes(new URL(process.env.SUPABASE_URL).hostname)) throw new Error("Solo Supabase local.");
const origin = "http://127.0.0.1:3000", password = "una frase de prueba para perfil 64";
async function enter(page: Page) {
  const email = `onboarding-${crypto.randomUUID()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto(await findMailLink(email, "signup"));
  await page.getByRole("button", { name: "Confirmar correo", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  return email;
}
async function review(page: Page, name = "Sol") {
  await page.getByLabel("Tu nombre", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Todo listo para empezar." })).toBeVisible();
}
async function capture(page: Page, name: string) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/${name}-${width}.png`, fullPage: true });
  }
}
test("onboarding y dashboard exigen identidad; API controla origen y payload", async ({ page, request }) => {
  for (const path of ["/onboarding", "/dashboard"]) { await page.goto(path); await expect(page).toHaveURL(/\/login$/); }
  expect((await request.get("/api/v1/profile")).status()).toBe(401);
  const data = { displayName: "Sol", preferredCurrency: "PEN", timezone: "America/Lima", expectedVersion: 0 };
  expect((await request.post("/api/v1/profile", { headers: { Origin: origin }, data })).status()).toBe(401);
  expect((await request.post("/api/v1/profile", { headers: { Origin: "https://otro.example" }, data })).status()).toBe(403);
  expect((await request.post("/api/v1/profile", { headers: { Origin: origin }, data: { ...data, user_id: "otro" } })).status()).toBe(422);
  expect((await request.post("/api/v1/profile", { headers: { Origin: origin }, data: { ...data, preferredCurrency: "EUR" } })).status()).toBe(422);
  expect((await request.post("/api/v1/profile", { headers: { Origin: origin }, data: { displayName: "x".repeat(5000) } })).status()).toBe(413);
  expect((await request.post("/api/v1/profile", { headers: { Origin: origin, "Content-Type": "text/plain" }, data: "invalid" })).status()).toBe(415);
});
test("alta completa, revisión, fallo recuperable, persistencia, dashboard y login posterior", async ({ page, context }) => {
  const email = await enter(page);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Tu nombre", { exact: true })).toBeFocused();
  await expect(page.getByText("Escribe cómo quieres que te llamemos.")).toBeVisible();
  await page.getByLabel("Tu nombre", { exact: true }).fill("Sol");
  await expect(page.getByText("Escribe cómo quieres que te llamemos.")).toHaveCount(0);
  await capture(page, "onboarding-name");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("radio", { name: /Dólares estadounidenses/ }).check();
  await page.getByLabel("Zona horaria", { exact: true }).selectOption("Asia/Tokyo");
  await capture(page, "onboarding-preferences");
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await expect(page.getByLabel("Tu nombre", { exact: true })).toHaveValue("Sol");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("radio", { name: /Dólares estadounidenses/ })).toBeChecked();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await capture(page, "onboarding-review");
  await page.route("**/api/v1/profile", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "No pudimos guardar tu perfil. Puedes reintentar." }) }));
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByText("No pudimos guardar tu perfil. Puedes reintentar.")).toBeVisible();
  await expect(page.getByText("Asia/Tokyo", { exact: true })).toBeVisible();
  await page.unroute("**/api/v1/profile");
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Hola, Sol." })).toBeVisible();
  await capture(page, "dashboard-empty");
  const profile = (await (await context.request.get("/api/v1/profile")).json()).profile;
  expect(profile.preferred_currency).toBe("USD"); expect(profile.timezone).toBe("Asia/Tokyo"); expect(profile.version).toBe(1);
  await page.reload(); await expect(page.getByRole("heading", { name: "Hola, Sol." })).toBeVisible();
  await page.goto("/onboarding"); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/session"); await page.getByRole("button", { name: "Cerrar esta sesión", exact: true }).click();
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email); await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
});
test("edición y conflicto preservan el borrador y no sobrescriben otra pestaña", async ({ page, context }) => {
  await enter(page); await review(page); await page.getByRole("button", { name: "Guardar y continuar" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Mi perfil", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);await page.getByLabel("Tu nombre",{exact:true}).fill("Mi borrador");
  const current=(await(await context.request.get("/api/v1/profile")).json()).profile;
  expect((await context.request.post("/api/v1/profile",{headers:{Origin:origin},data:{displayName:"Otra pestaña",preferredCurrency:"USD",timezone:"UTC",expectedVersion:current.version}})).status()).toBe(200);
  const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==="/profile"&&r.request().headers()["rsc"]==="1");await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await refreshed;
  const save=page.waitForRequest(r=>r.url().endsWith("/api/v1/profile")&&r.method()==="PATCH");await page.getByRole("button",{name:"Guardar cambios",exact:true}).click();expect((await save).postDataJSON().expectedVersion).toBe(current.version);
  await expect(page.getByText("Tu perfil cambió en otra pestaña. Revisa la versión guardada antes de continuar.")).toBeVisible();await expect(page.getByLabel("Tu nombre",{exact:true})).toHaveValue("Mi borrador");await expect(page.locator(".settings-conflict")).toContainText("Otra pestaña");await expect(page.getByRole("button",{name:"Guardar cambios",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Descartar este borrador y cargar la versión guardada",exact:true}).click();await expect(page.getByLabel("Tu nombre",{exact:true})).toHaveValue("Otra pestaña");await page.getByLabel("Tu nombre",{exact:true}).fill("Nombre definitivo");await page.getByRole("button",{name:"Guardar cambios",exact:true}).click();await expect(page.getByText("Perfil actualizado.",{exact:true})).toBeVisible();await page.getByRole("link",{name:"Volver a Inicio",exact:true}).click();await expect(page.getByRole("heading",{name:"Hola, Nombre definitivo."})).toBeVisible();
});
test("sesión terminada no guarda el perfil y conserva la revisión", async ({ page, context }) => {
  await enter(page); await review(page, "Mi perfil pendiente");
  await context.clearCookies();
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByText("Tu sesión terminó. Inicia sesión de nuevo.")).toBeVisible();
  await expect(page.getByText("Mi perfil pendiente", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Iniciar sesión en otra pestaña" })).toBeVisible();
});
