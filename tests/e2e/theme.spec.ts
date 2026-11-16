import { expect, test } from "@playwright/test";
import { financialSession, localOrigin, navigate } from "../helpers/financial";

test("tema global persistente, sistema, módulos y modales", async ({ page, context }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if(message.type() === "error" && /hydrat|content security|nonce/i.test(message.text())) errors.push(message.text()); });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Tema de la interfaz").selectOption("light");
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Tema de la interfaz").selectOption("dark");
  await expect(page.getByLabel("Correo electrónico", { exact: true })).toHaveCSS("background-color", "rgb(18, 18, 18)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(9, 9, 9)");
  await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toHaveCSS("background-color", "rgb(40, 85, 255)");
  await page.screenshot({ path: ".impeccable/review/theme-login.png", fullPage: true });
  const data = (await financialSession(page, context))!;
  const headers = { Origin: localOrigin };
  const posted = await context.request.post("/api/v1/movements", { headers, data: { requestId: crypto.randomUUID(), kind: "expense", accountId: data.accounts[0].id, categoryId: data.expense.id, amount: "20", description: "Servicio de prueba", note: "", occurredAt: null } });
  expect(posted.ok()).toBe(true);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  for (const [url, payload] of [["fixed-expenses", { action: "create", requestId: crypto.randomUUID(), name: "Internet", amount: "30", currency: "PEN", categoryId: data.expense.id, dueDate: today, frequency: "monthly", note: "" }], ["debts", { action: "create", requestId: crypto.randomUUID(), name: "Pago pendiente", creditor: "Prueba", amount: "100", currency: "PEN", dueDate: today, icon: "home", category: "personal", detail: "" }]] as const) { const result = await context.request.post(`/api/v1/${url}`, { headers, data: payload }); expect(result.ok()).toBe(true); }
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const view of ["Inicio", "Movimientos", "Estadísticas", "Cuentas", "Categorías", "Deudas", "Gastos Fijos"]) {
    await navigate(page, view); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".home-main")).toBeVisible();
    if (view === "Inicio") await expect(page.locator(".overview-balance > strong")).toHaveText("S/ 80.00");
    if (view === "Movimientos") await expect(page.locator(".ledger-record")).toHaveCount(1);
    if (view === "Estadísticas") await expect(page.locator(".statistics-metric.expense > strong")).toHaveText("S/ 20.00");
    if (view === "Inicio") await expect(page.locator(".overview-radar")).toContainText("Internet");
    if (view === "Categorías") await expect(page.getByRole("button", { name: "Nueva categoría", exact: true })).toBeEnabled();
    if (view === "Deudas") await expect(page.getByRole("button", { name: "Registrar deuda", exact: true })).toBeEnabled();
    if (view === "Gastos Fijos") await expect(page.locator(".fixed-row")).toHaveCount(1);
    await page.mouse.move(1000, 0);
    await page.screenshot({ path: `.impeccable/review/theme-${view.replace(/[^a-z]/gi, "")}.png`, fullPage: true });
  }
  await navigate(page, "Movimientos");
  await page.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/theme-movement-dialog.png" });
  await page.keyboard.press("Escape");
  for (const route of ["profile", "security", "data", "deletion"]) {
    await page.goto(`/${route}`); await expect(page.getByLabel("Tema de la interfaz")).toHaveValue("dark"); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (route === "security") await expect(page.locator(".settings-access-meta")).toBeVisible();
    await page.screenshot({ path: `.impeccable/review/theme-${route}.png`, fullPage: true });
  }
  await page.goto("/dashboard"); await expect(page.locator(".overview-balance > strong")).toHaveText("S/ 80.00"); await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".impeccable/review/theme-mobile.png", fullPage: true });
  await page.getByLabel("Tema de la interfaz").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" }); await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" }); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
  expect((await context.cookies()).some((c) => c.name === "finzi-theme" && c.value === "system")).toBe(true);
});
