import { expect, test } from "@playwright/test";
import { financialSession, localOrigin, navigate } from "../helpers/financial";

test("gasto usa icono de categoría y trazabilidad modal devuelve el foco al cerrar", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; const category = data.expense; const headers = { Origin: localOrigin };
  const updated = await context.request.patch("/api/v1/categories", { headers, data: { id: category.id, expectedVersion: category.version, name: category.name, description: category.description, color: "blue", icon: "wifi", imagePath: null, archived: false } });
  expect(updated.status()).toBe(200);
  expect((await context.request.post("/api/v1/movements", { headers, data: { requestId: crypto.randomUUID(), kind: "expense", accountId: data.accounts[0].id, categoryId: category.id, amount: "10", description: "Internet del hogar", note: "Pago con trazabilidad", occurredAt: null } })).status()).toBe(200);
  await navigate(page, "Movimientos");
  await expect(page.locator(".ledger-kind-icon.expense .lucide-wifi")).toBeVisible();
  await expect(page.locator(".ledger-kind-icon.expense .lucide-wifi")).toHaveCSS("color", "rgb(29, 78, 216)");
  await page.locator(".ledger-record summary").click();
  const trigger = page.getByRole("button", { name: "Ver trazabilidad", exact: true }); await trigger.click();
  const modal = page.getByRole("dialog", { name: "Trazabilidad del movimiento", exact: true });
  await expect(modal).toBeVisible(); await expect(modal).toHaveJSProperty("open", true);
  await expect(modal.getByRole("heading", { name: "Internet del hogar", exact: true })).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/trace-modal-desktop.png" });
  await page.keyboard.press("Escape"); await expect(modal).not.toBeVisible(); await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 320, height: 844 }); await trigger.click(); await expect(modal).toBeVisible();
  expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: ".impeccable/review/trace-modal-mobile.png" });
  await modal.getByRole("button", { name: "Cerrar detalle", exact: true }).click(); await expect(modal).not.toBeVisible();
});
