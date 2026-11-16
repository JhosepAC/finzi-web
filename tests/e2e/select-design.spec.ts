import { expect, test } from "@playwright/test";
import { financialSession, navigate } from "../helpers/financial";

test("select global: opciones en modal, teclado, deshabilitados, filtros y móvil", async ({ page, context }) => {
  test.setTimeout(60000);
  await financialSession(page, context);
  expect(await page.evaluate(() => CSS.supports("appearance", "base-select"))).toBe(true);
  await navigate(page, "Cuentas");
  await page.getByRole("button", { name: "Añadir cuenta", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Crear cuenta financiera", exact: true });
  const type = dialog.getByLabel("Tipo de cuenta", { exact: true });
  await expect(type).toHaveCSS("appearance", "base-select");
  await type.click();
  await expect(type).toHaveJSProperty("disabled", false);
  await expect(dialog.getByRole("option", { name: "Cuenta bancaria", exact: true })).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/select-account-desktop.png" });
  await dialog.getByRole("option", { name: "Cuenta bancaria", exact: true }).click();
  await expect(type).toHaveValue("bank");
  await type.focus(); await page.keyboard.press("Space"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(type).toHaveValue("savings");
  await type.click(); await page.keyboard.press("Escape"); await expect(type).toBeFocused(); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Editar cuenta Efectivo", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Editar cuenta", exact: true });
  await expect(edit.getByLabel("Tipo de cuenta", { exact: true })).toBeDisabled();
  await edit.getByRole("button", { name: "Cancelar", exact: true }).click();
  for (const section of ["Movimientos", "Gastos Fijos", "Deudas"]) {
    await navigate(page, section);
    await expect(page.locator("select").first()).toHaveCSS("appearance", "base-select");
  }
  await navigate(page, "Movimientos");
  await page.setViewportSize({ width: 390, height: 844 });
  const period = page.getByLabel("Período", { exact: true });
  await period.click(); await expect(period.locator("option[value=custom]")).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/select-filter-mobile.png" });
  await period.locator("option[value=all]").click(); await expect(period).toHaveValue("all");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
