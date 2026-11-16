import { expect, test } from "@playwright/test";
import { financialSession, localOrigin, navigate } from "../helpers/financial";

test("vistas de compromisos, calendario filtrado y modales adaptables", async ({ page, context }) => {
  const data = (await financialSession(page, context))!;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  for (const [name, amount, day] of [["Alquiler del departamento", "850", "01"], ["Internet del hogar", "89.90", "18"], ["Telefonía móvil", "39.90", "25"], ["Suscripción de música", "20.90", "28"]]) {
    const result = await context.request.post("/api/v1/fixed-expenses", { headers: { Origin: localOrigin }, data: { action: "create", requestId: crypto.randomUUID(), name, amount, dueDate: `${today.slice(0, 7)}-${day}`, frequency: "monthly", currency: "PEN", categoryId: data.expense.id, note: "" } });
    expect(result.ok()).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate(page, "Gastos Fijos");
  await expect(page.locator(".fixed-row")).toHaveCount(4);
  await page.screenshot({ path: ".impeccable/review/fixed-overview-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Vista de lista", exact: true }).click();
  await expect(page.locator(".fixed-list")).toHaveClass(/list/);
  await page.getByRole("button", { name: "Vista de calendario", exact: true }).click();
  const day = page.getByRole("button", { name: `${today.slice(0, 7)}-18: 1 vencimientos`, exact: true });
  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".fixed-row")).toHaveCount(1);
  await expect(page.locator(".fixed-row")).toContainText("Internet del hogar");
  await page.screenshot({ path: ".impeccable/review/fixed-calendar.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".impeccable/review/fixed-calendar-mobile.png", fullPage: true });
  await page.locator(".fixed-schedule-list li").filter({ hasText: "Alquiler del departamento" }).getByRole("button", { name: "Ver vencimiento", exact: true }).click();
  await expect(page.locator(".fixed-row")).toHaveCount(1);
  await expect(page.locator(".fixed-row")).toContainText("Alquiler del departamento");
  await page.getByLabel("Buscar gasto", { exact: true }).fill("inexistente");
  await expect(page.locator(".fixed-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await page.getByRole("button", { name: "Vista de tarjetas", exact: true }).click();
  for (const width of [360, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/fixed-overview-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Nuevo gasto fijo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo gasto fijo", exact: true });
  await expect(dialog).toHaveJSProperty("open", true);
  await expect(dialog.getByLabel("Nombre del gasto")).toBeFocused();
  await page.screenshot({ path: ".impeccable/review/fixed-editor-mobile.png" });
  await dialog.getByLabel("Nombre del gasto").fill("Borrador");
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("Nombre del gasto")).toHaveValue("Borrador");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Cerrar formulario" }).click();
  await expect(dialog).not.toBeVisible();
});

test("registra compromiso, paga en modal, consulta meses e historial y elimina conservando pago", async ({ page, context }) => {
  test.setTimeout(90000);
  const data = (await financialSession(page, context))!;
  await navigate(page, "Gastos Fijos");
  await page.getByRole("button", { name: "Nuevo gasto fijo", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Nuevo gasto fijo", exact: true });
  await form.getByLabel("Nombre del gasto").fill("Internet del hogar"); await form.getByLabel("Monto", { exact: true }).fill("20");
  await form.getByRole("combobox", { name: "Categoría", exact: true }).selectOption(data.expense.id);
  const today = await form.getByLabel("Primer vencimiento").inputValue();
  await form.getByLabel("Observaciones (opcional)").fill("Pago del servicio de casa");
  await form.getByRole("button", { name: "Crear gasto fijo", exact: true }).click(); await expect(form).not.toBeVisible();
  const row = page.locator(".fixed-row").filter({ hasText: "Internet del hogar" });
  await expect(row).toContainText("Vence hoy");
  await row.getByRole("button", { name: "Registrar pago", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Registrar pago", exact: true });
  await payment.getByRole("combobox", { name: "Cuenta de pago", exact: true }).selectOption(data.accounts[0].id);
  await expect(payment).toContainText("S/ 80.00");
  await payment.getByRole("button", { name: "Confirmar pago", exact: true }).click(); await expect(payment).not.toBeVisible();
  await expect(row).toContainText("Pagado");

  const catalog = await (await context.request.get(`/api/v1/fixed-expenses?month=${today.slice(0, 7)}-01`)).json();
  expect(catalog.expenses[0].next_due > today).toBe(true); expect(catalog.payments).toHaveLength(1);
  await page.getByRole("button", { name: "Ver vencimiento", exact: true }).click();
  await expect(page.getByLabel("Mes de vencimiento")).toHaveValue(catalog.expenses[0].next_due.slice(0, 7));
  await expect(row.getByRole("button", { name: "Registrar pago", exact: true })).toBeVisible();
  await page.getByLabel("Mes de vencimiento").fill(today.slice(0, 7));
  await expect(row).toContainText("Pagado");
  expect((await (await context.request.get("/api/v1/accounts")).json()).accounts[0].balance_minor).toBe("8000");
  await page.screenshot({ path: ".impeccable/review/fixed-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/fixed-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await row.getByText("Gestionar", { exact: true }).click(); await row.getByRole("button", { name: "Eliminar gasto", exact: true }).click();
  const removal = page.getByRole("dialog", { name: "Eliminar gasto fijo", exact: true }); await removal.getByRole("button", { name: "Eliminar gasto fijo", exact: true }).click();
  await expect(removal).not.toBeVisible(); await expect(row).toContainText("Compromiso eliminado");
  await expect(row.getByRole("button", { name: "Ver movimiento" })).toBeVisible();
  expect((await (await context.request.get("/api/v1/accounts")).json()).accounts[0].balance_minor).toBe("8000");
});

test("filtros automáticos, vencidos, vínculo existente y reintento incierto sin duplicar", async ({ page, context }) => {
  test.setTimeout(90000); const data = (await financialSession(page, context))!; const headers = { Origin: localOrigin };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const first = `${today.slice(0, 7)}-01`;
  const created = await context.request.post("/api/v1/fixed-expenses", { headers, data: { action: "create", requestId: crypto.randomUUID(), name: "Spotify", note: "", categoryId: data.expense.id, currency: "PEN", amount: "10.00", dueDate: first, frequency: "monthly" } }); expect(created.status()).toBe(200);
  const tx = await context.request.post("/api/v1/movements", { headers, data: { requestId: crypto.randomUUID(), kind: "expense", accountId: data.accounts[0].id, categoryId: data.expense.id, amount: "10", description: "Spotify pagado", note: "", occurredAt: null } }); expect(tx.status()).toBe(200);
  await navigate(page, "Gastos Fijos"); await expect(page.locator(".fixed-row")).toContainText("Spotify");
  await page.getByLabel("Buscar gasto", { exact: true }).fill("Otro"); await expect(page.locator(".fixed-row")).toHaveCount(0);
  await page.getByLabel("Buscar gasto", { exact: true }).fill("Spotify");
  await page.getByRole("combobox", { name: "Estado", exact: true }).selectOption("overdue"); if (today > first) await expect(page.locator(".fixed-row")).toContainText("Vencido hace");
  await page.getByRole("combobox", { name: "Estado", exact: true }).selectOption("");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click(); const payment = page.getByRole("dialog", { name: "Registrar pago", exact: true });
  await payment.getByRole("combobox", { name: "Cómo registrar el pago", exact: true }).selectOption("existing");
  await expect(payment.getByRole("combobox", { name: "Gasto registrado", exact: true }).locator("option")).toHaveCount(2); await payment.getByRole("combobox", { name: "Gasto registrado", exact: true }).selectOption((await tx.json()).id);
  let lose = true; await page.route("**/api/v1/fixed-expenses", async (route) => { if (route.request().method() === "POST" && lose) { lose = false; await route.fetch(); await route.abort(); } else await route.continue(); });
  await payment.getByRole("button", { name: "Confirmar pago", exact: true }).click(); await expect(payment.getByRole("button", { name: "Reintentar el mismo guardado" })).toBeVisible();
  await payment.getByRole("button", { name: "Reintentar el mismo guardado" }).click(); await expect(payment).not.toBeVisible();
  await page.getByRole("combobox", { name: "Estado", exact: true }).selectOption("paid"); await expect(page.locator(".fixed-row")).toContainText("Pagado");
  expect((await (await context.request.get("/api/v1/accounts")).json()).accounts[0].balance_minor).toBe("9000");
  expect((await (await context.request.get("/api/v1/fixed-expenses")).json()).payments).toHaveLength(1);
});
