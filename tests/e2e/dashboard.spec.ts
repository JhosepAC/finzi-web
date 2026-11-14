import { test, expect, type Page } from "@playwright/test";
import { findMailLink } from "../helpers/mail";
import { readFile } from "node:fs/promises";

process.loadEnvFile(".env.local");
if (!process.env.SUPABASE_URL || !["127.0.0.1", "localhost"].includes(new URL(process.env.SUPABASE_URL).hostname)) throw new Error("Solo Supabase local.");
async function enter(page: Page, preview = true) {
  await page.goto("/register"); const email = `dashboard-${crypto.randomUUID()}@example.test`, password = "una frase de prueba de dashboard 64";
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email); await page.getByLabel("Contraseña", { exact: true }).fill(password); await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click(); await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto(await findMailLink(email, "signup")); await page.getByRole("button", { name: "Confirmar correo", exact: true }).click(); await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Tu nombre", { exact: true }).fill("Andrea"); await page.getByRole("button", { name: "Continuar", exact: true }).click(); await page.getByRole("button", { name: "Continuar", exact: true }).click();
  if (preview) await page.getByRole("checkbox", { name: /Explorar con datos de prueba/ }).check();
  await page.getByRole("button", { name: "Guardar y continuar" }).click(); await expect(page).toHaveURL(preview ? /\/dashboard\?demo=1$/ : /\/dashboard$/);
}
test("modo de prueba explícito, períodos y monedas sin mezclas, estado real sin muestra", async ({ page, context }) => {
  await page.goto("/dashboard?demo=1"); await expect(page).toHaveURL(/\/login$/);
  await enter(page, false);
  const before = (await (await context.request.get("/api/v1/profile")).json()).profile;
  await expect(page.getByText("S/ 20,220.00", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Explorar con datos de prueba" }).click();
  await expect(page.getByText("Datos de prueba", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".balance-figure")).toHaveText("S/ 20,220.00");
  await page.getByRole("combobox", { name: "Período" }).selectOption("2026-10");
  await expect(page.locator(".balance-figure")).toHaveText("S/ 20,220.00");
  await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Ingresos del mes" }) })).toContainText("S/ 4,750.00");
  await page.getByRole("button", { name: "US$ USD", exact: true }).click();
  await expect(page.locator(".balance-figure")).toHaveText("US$ 2,650.00");
  await page.getByRole("button", { name: "Ocultar importes" }).click(); await expect(page.locator(".balance-figure")).toHaveText("••••••");
  await expect(page.locator(".home-main")).not.toContainText("US$ 2,650.00");
  await page.getByRole("button", { name: "Mostrar importes" }).click();
  await page.getByRole("button", { name: "Salir de la muestra" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Empieza por tu primera cuenta." })).toBeVisible();
  const after = (await (await context.request.get("/api/v1/profile")).json()).profile;
  expect(after).toEqual(before);
});
test("aperturas y movimientos simulados actualizan importes; recargar los descarta", async ({ page }) => {
  await enter(page);
  const writes: string[] = []; page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/")) writes.push(request.url()); });
  await page.getByRole("button", { name: "Editar saldo inicial de prueba de Cuenta del día a día" }).click();
  const opening = page.getByRole("dialog", { name: "Saldo inicial", exact: true }); await expect(opening).toBeVisible();
  await opening.getByLabel("Saldo inicial en PEN").fill("5000.00"); await opening.getByRole("button", { name: "Guardar saldo de prueba" }).click();
  await expect(page.locator(".balance-figure")).toHaveText("S/ 20,420.00");
  await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Ingresos del mes" }) })).toContainText("S/ 4,800.00");
  await page.getByRole("button", { name: "Añadir movimiento de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Añadir movimiento", exact: true });
  await dialog.getByLabel("Descripción", { exact: true }).fill("Café de prueba"); await dialog.getByLabel("Importe en PEN").fill("15.90"); await dialog.getByLabel("Categoría", { exact: true }).selectOption("Ocio");
  await dialog.getByLabel("Importe en PEN").fill("15.999");
  await dialog.getByRole("button", { name: "Añadir a la muestra" }).click();
  await expect(dialog.getByLabel("Importe en PEN")).toBeFocused();
  await expect(dialog.getByText("Usa un importe de hasta 9 dígitos y 2 decimales.")).toBeVisible();
  await dialog.getByLabel("Importe en PEN").fill("15.90");
  await dialog.getByRole("button", { name: "Añadir a la muestra" }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.locator(".balance-figure")).toHaveText("S/ 20,404.10");
  await expect(page.getByText("Café de prueba", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Añadir movimiento de prueba" }).click(); await expect(dialog.getByLabel("Descripción", { exact: true })).toHaveValue(""); await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await page.reload(); await expect(page.locator(".balance-figure")).toHaveText("S/ 20,220.00"); await expect(page.getByText("Café de prueba", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});
test("búsqueda, tipo, navegación y exportación de muestra funcionan", async ({ page }) => {
  await enter(page);
  await page.getByRole("searchbox", { name: "Buscar movimientos" }).fill("supermercado");
  await expect(page.getByRole("heading", { name: "Tus movimientos." })).toBeVisible();
  await expect(page.getByText("Compras del supermercado", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Descargar muestra CSV" }).click();
  const file = await download; expect(file.suggestedFilename()).toContain("finzi-muestra-PEN-2026-11");
  const content = await readFile((await file.path())!, "utf8"); expect(content).toContain("Datos simulados Finzi"); expect(content).toContain("Compras del supermercado"); expect(content).not.toContain("Sueldo mensual");
  await page.getByRole("searchbox", { name: "Buscar movimientos" }).fill("no existe"); await expect(page.getByRole("heading", { name: "No hay movimientos con estos filtros." })).toBeVisible();
  await page.getByRole("button", { name: "Limpiar búsqueda y tipo" }).click(); await page.getByRole("combobox", { name: "Tipo" }).selectOption("income");
  await expect(page.getByText("Sueldo mensual", { exact: true })).toBeVisible(); await expect(page.getByText("Compras del supermercado", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cuentas", exact: true }).click(); await expect(page.getByRole("heading", { name: "Tus cuentas." })).toBeVisible();
});
test("responsive, gráficos por teclado y navegación móvil accesible", async ({ page }) => {
  let errors = 0; page.on("pageerror", () => errors++); page.on("console", (message) => { if (message.type() === "error") errors++; });
  await enter(page);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 }); await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => ({ width: innerWidth, total: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll(".home-app *")].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).map((node) => ({ tag: node.tagName, className: node.className.toString(), right: node.getBoundingClientRect().right })).slice(0, 12) }));
    expect(layout.total, JSON.stringify(layout)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.impeccable/review/home-final-${width}.png`, fullPage: true });
    if (width === 1440) await page.screenshot({ path: ".impeccable/review/home-preview.png" });
  }
  await page.getByRole("button", { name: "Abrir navegación" }).click(); const navigation = page.getByRole("dialog", { name: "Navegación principal" });
  await expect(navigation).toBeVisible(); await navigation.getByRole("button", { name: "Cuentas", exact: true }).click(); await expect(navigation).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Tus cuentas." })).toBeVisible();
  await page.getByRole("button", { name: "Abrir navegación" }).click(); await navigation.getByRole("button", { name: "Inicio", exact: true }).click();
  const june = page.getByRole("button", { name: /^junio:/i }); await june.focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("combobox", { name: "Período" })).toHaveValue("2026-06");
  await page.emulateMedia({ reducedMotion: "reduce" }); expect(errors).toBe(0);
});
