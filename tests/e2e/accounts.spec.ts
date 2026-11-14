import { test, expect, type Page } from "@playwright/test";
import { findMailLink } from "../helpers/mail";
process.loadEnvFile(".env.local");
if (!process.env.SUPABASE_URL || !["127.0.0.1", "localhost"].includes(new URL(process.env.SUPABASE_URL).hostname)) throw new Error("Solo Supabase local.");
const origin = "http://127.0.0.1:3000";
async function enter(page: Page) {
  const email = `accounts-ui-${crypto.randomUUID()}@example.test`, password = "una frase de prueba para cuentas 64";
  await page.goto("/register"); await page.getByLabel("Correo electrónico", { exact: true }).fill(email); await page.getByLabel("Contraseña", { exact: true }).fill(password); await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click(); await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto(await findMailLink(email, "signup")); await page.getByRole("button", { name: "Confirmar correo", exact: true }).click(); await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Tu nombre", { exact: true }).fill("Andrea"); await page.getByRole("button", { name: "Continuar", exact: true }).click(); await page.getByRole("button", { name: "Continuar", exact: true }).click(); await page.getByRole("button", { name: "Guardar y continuar" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
}
async function create(page: Page, name: string, amount: string, currency = "PEN") {
  await page.locator(".home-sidebar").getByRole("button", { name: "Cuentas", exact: true }).click();
  await page.getByRole("button", { name: "Añadir cuenta", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Crear cuenta financiera" });
  await dialog.getByLabel("Nombre de la cuenta").fill(name); await dialog.getByLabel("Moneda", { exact: true }).selectOption(currency); await dialog.getByLabel(`Saldo inicial en ${currency}`).fill(amount); await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click(); await expect(dialog).not.toBeVisible();
}
test("API de cuentas: sesión, origen, tamaño y campos inyectados", async ({ request }) => {
  const data = { requestId: crypto.randomUUID(), name: "Efectivo", type: "cash", currency: "PEN", openingBalance: "0" };
  const read = await request.get("/api/v1/accounts"); expect(read.status()).toBe(401); expect(read.headers()["cache-control"]).toContain("no-store"); expect(read.headers()["content-security-policy"]).toContain("nonce-");
  expect((await request.post("/api/v1/accounts", { headers: { Origin: origin }, data })).status()).toBe(401);
  expect((await request.post("/api/v1/accounts", { headers: { Origin: "https://otro.example" }, data })).status()).toBe(403);
  expect((await request.post("/api/v1/accounts", { headers: { Origin: origin }, data: { ...data, user_id: "otro" } })).status()).toBe(422);
  expect((await request.post("/api/v1/accounts", { headers: { Origin: origin }, data: { name: "x".repeat(5000) } })).status()).toBe(413);
  expect((await request.patch("/api/v1/accounts", { headers: { Origin: origin }, data: { id: crypto.randomUUID(), name: "Cuenta", openingBalance: "0", archived: false, expectedVersion: 1, currency: "USD" } })).status()).toBe(422);
});
test("cuentas reales: confirmación incierta, reintento, persistencia, PEN/USD y archivo/restauración", async ({ page, context }) => {
  await enter(page); await expect(page.getByRole("heading", { name: "Empieza por tu primera cuenta." })).toBeVisible();
  await page.getByRole("button", { name: "Crear mi primera cuenta" }).click();
  const dialog = page.getByRole("dialog", { name: "Crear cuenta financiera" });
  await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click(); await expect(dialog.getByLabel("Nombre de la cuenta")).toBeFocused();
  await dialog.getByLabel("Nombre de la cuenta").fill("Diario"); await dialog.getByLabel("Tipo de cuenta").selectOption("bank"); await dialog.getByLabel("Saldo inicial en PEN").fill("1250.001");
  await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click(); await expect(dialog.getByLabel("Saldo inicial en PEN")).toBeFocused();
  await dialog.getByLabel("Saldo inicial en PEN").fill("1250.10");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/real-account-form-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  let first = true; const keys: string[] = [];
  await page.route("**/api/v1/accounts", async (route) => {
    if (route.request().method() === "POST") {
      keys.push(route.request().postDataJSON().requestId);
      if (first) { first = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, json: { ok: false, message: "No pudimos confirmar el guardado. Reintenta esta operación." } }); return; }
    }
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click(); await expect(dialog.getByText("No pudimos confirmar el guardado. Reintenta esta operación.")).toBeVisible();
  await expect(dialog.getByLabel("Nombre de la cuenta")).toHaveValue("Diario"); await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Diario", exact: true })).toBeFocused();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); await page.unroute("**/api/v1/accounts");
  expect((await (await context.request.get("/api/v1/accounts")).json()).accounts).toHaveLength(1);
  await create(page, "Dólares", "200.25", "USD");
  await expect(page.locator(".real-balances")).toContainText("S/ 1,250.10"); await expect(page.locator(".real-balances")).toContainText("US$ 200.25");
  await page.reload(); await page.locator(".home-sidebar").getByRole("button", { name: "Cuentas", exact: true }).click(); await expect(page.getByRole("heading", { name: "Diario", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar cuenta Diario", exact: true }).click(); const edit = page.getByRole("dialog", { name: "Editar cuenta", exact: true });
  await expect(edit.getByLabel("Moneda", { exact: true })).toBeDisabled(); await expect(edit.getByLabel("Tipo de cuenta")).toBeDisabled();
  await edit.getByLabel("Nombre de la cuenta").fill("Diario corregido"); await edit.getByLabel("Saldo inicial en PEN").fill("-10.50"); await edit.getByRole("checkbox", { name: /Cuenta archivada/ }).check();
  await edit.getByRole("button", { name: "Guardar cambios" }).click(); await expect(edit).not.toBeVisible();
  await expect(page.locator(".real-balances")).toContainText("−S/ 10.50"); await page.getByRole("checkbox", { name: "Mostrar archivadas" }).uncheck();
  await expect(page.getByRole("heading", { name: "Diario corregido", exact: true })).toHaveCount(0); await expect(page.locator(".real-balances")).toContainText("−S/ 10.50");
  await page.getByRole("checkbox", { name: "Mostrar archivadas" }).check(); await page.getByRole("button", { name: "Editar cuenta Diario corregido", exact: true }).click();
  await edit.getByRole("checkbox", { name: /Cuenta archivada/ }).uncheck(); await edit.getByRole("button", { name: "Guardar cambios" }).click(); await expect(edit).not.toBeVisible();
  const accounts = (await (await context.request.get("/api/v1/accounts")).json()).accounts;
  expect(accounts).toHaveLength(2); expect(accounts.find((a: { name: string }) => a.name === "Diario corregido").status).toBe("active");
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); await page.evaluate(() => document.fonts.ready); await page.evaluate(() => window.scrollTo(0, 0)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/real-accounts-${width}.png`, fullPage: true }); }
});
test("conflicto entre pestañas conserva el borrador y actualiza saldos reales", async ({ page, context }) => {
  await enter(page); await create(page, "Ahorros", "100");
  await page.getByRole("button", { name: "Editar cuenta Ahorros", exact: true }).click(); const edit = page.getByRole("dialog", { name: "Editar cuenta", exact: true });
  await edit.getByLabel("Nombre de la cuenta").fill("Mi borrador");
  const original = (await (await context.request.get("/api/v1/accounts")).json()).accounts[0];
  const response = await context.request.patch("/api/v1/accounts", { headers: { Origin: origin }, data: { id: original.id, name: "Otra pestaña", openingBalance: "500", archived: false, expectedVersion: original.version } }); expect(response.status()).toBe(200);
  await edit.getByRole("button", { name: "Guardar cambios" }).click(); await expect(edit.getByText("La cuenta cambió o este intento ya se utilizó. Actualiza las cuentas antes de continuar.")).toBeVisible();
  await expect(edit.getByLabel("Nombre de la cuenta")).toHaveValue("Mi borrador"); await expect(edit.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await edit.getByRole("button", { name: "Descartar el borrador y actualizar cuentas" }).click(); await expect(edit).not.toBeVisible(); await expect(page.getByRole("heading", { name: "Otra pestaña", exact: true })).toBeVisible();
  await page.locator(".home-sidebar").getByRole("button", { name: "Inicio", exact: true }).click(); await expect(page.locator(".overview-balance")).toContainText("S/ 500.00");
});
test("sesión terminada no guarda apertura y conserva campos del formulario", async ({ page, context }) => {
  await enter(page); await page.getByRole("button", { name: "Crear mi primera cuenta", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Crear cuenta financiera" });
  await dialog.getByLabel("Nombre de la cuenta").fill("Pendiente"); await dialog.getByLabel("Saldo inicial en PEN").fill("25.00"); await context.clearCookies();
  await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click(); await expect(dialog.getByText("Tu sesión terminó. Inicia sesión de nuevo.")).toBeVisible();
  await expect(dialog.getByLabel("Nombre de la cuenta")).toHaveValue("Pendiente");
});
