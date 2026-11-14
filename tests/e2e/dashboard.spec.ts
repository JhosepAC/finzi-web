import { expect, test } from "@playwright/test";
import { financialSession, localOrigin, navigate } from "../helpers/financial";

test("Inicio usa saldos reales, separa monedas y el enlace antiguo no activa simulación", async ({ page, context }) => {
  const data = (await financialSession(page, context))!;
  expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "income", accountId: data.accounts[0].id, categoryId: data.income.id, amount: "50", description: "Ingreso mensual", note: "", occurredAt: null } })).status()).toBe(200);
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("button", { name: /simulación|prueba/ })).toHaveCount(0); await expect(page.locator(".demo-banner, .home-footer, .real-sample-link")).toHaveCount(0);
  await expect(page.locator(".overview-balance > strong")).toHaveText("S/ 150.00"); await expect(page.locator(".overview-month")).toContainText("S/ 50.00"); await expect(page.locator(".overview-recent")).toContainText("Ingreso mensual");
  await page.getByLabel("Moneda del resumen").selectOption("USD"); await expect(page.locator(".overview-balance > strong")).toHaveText("US$ 0.00"); await expect(page.locator(".overview-month")).toContainText("US$ 0.00"); await expect(page.locator(".overview-recent")).not.toContainText("Ingreso mensual");
  await page.getByLabel("Moneda del resumen").selectOption("PEN"); await expect(page.locator(".overview-recent")).toContainText("Ingreso mensual");
  for (const width of [1440, 1024, 768, 390, 320]) { await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); await page.evaluate(() => window.scrollTo(0, 0)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/real-home-${width}.png`, fullPage: true }); }
});
test("Inicio vacío, fallo de resumen y navegación móvil accesible", async ({ page, context }) => {
  await financialSession(page, context, false); await expect(page.getByRole("heading", { name: "Empieza por tu primera cuenta." })).toBeVisible(); await expect(page.locator(".overview-summary")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); const trigger = page.getByRole("button", { name: "Abrir navegación", exact: true }); await expect(trigger).toHaveAttribute("aria-expanded", "false"); await trigger.click(); await expect(trigger).toHaveAttribute("aria-expanded", "true"); await page.keyboard.press("Escape"); await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await navigate(page, "Movimientos"); await expect(page.getByRole("heading", { name: "Necesitas una cuenta activa." })).toBeVisible();
});
