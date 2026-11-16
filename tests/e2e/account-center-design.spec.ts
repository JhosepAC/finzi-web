import { expect, test } from "@playwright/test";
import { financialSession } from "../helpers/financial";

test("centro de cuenta: vistas adaptables, formatos y protección del borrador", async ({ page, context }) => {
  test.setTimeout(60000);
  await financialSession(page, context);
  for (const route of ["profile", "security", "data"]) {
    await page.goto(`/${route}`);
    if (route === "security") await expect(page.locator(".settings-access-meta")).toBeVisible();
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} at ${width}`).toBe(true);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.impeccable/review/account-${route}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `.impeccable/review/account-${route}-mobile.png`, fullPage: true });
  }
  await page.getByRole("radio", { name: /CSV/ }).check();
  await expect(page.getByLabel("Moneda del CSV")).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar CSV filtrado" })).toBeDisabled();
  await page.getByRole("radio", { name: /JSON/ }).check();
  await expect(page.getByLabel("Moneda del CSV")).toHaveCount(0);
  await page.getByText("Qué incluye tu copia", { exact: true }).click();
  await expect(page.locator(".data-export details")).toContainText("trazabilidad");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Mi perfil", exact: true }).click();
  await page.getByLabel("Tu nombre", { exact: true }).fill("Borrador de perfil");
  await expect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Sesión y seguridad", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByLabel("Tu nombre", { exact: true })).toHaveValue("Borrador de perfil");
});
