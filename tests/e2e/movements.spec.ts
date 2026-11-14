import { expect, test, type Page } from "@playwright/test";
import { financialSession, localOrigin, navigate } from "../helpers/financial";
async function entry(page: Page, kind: "income" | "expense", category: string, amount: string, description: string) {
  await page.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  const form = page.locator(".ledger-entry");
  await form.getByLabel("Tipo de movimiento", { exact: true }).selectOption(kind); await form.getByLabel("Categoría", { exact: true }).selectOption(category); await form.getByLabel(/Importe en/).fill(amount); await form.getByLabel("Descripción", { exact: true }).fill(description);
  return form;
}
test("movimientos API: sesión, CSRF, tamaño, filtros y campos manipulados", async ({ page, context, request }) => {
  expect((await request.get("/api/v1/movements")).status()).toBe(401);
  expect((await request.post("/api/v1/movements", { headers: { Origin: "https://otro.example" }, data: {} })).status()).toBe(403);
  expect((await request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { note: "x".repeat(9000) } })).status()).toBe(413);
  expect((await request.get("/api/v1/movements?currency=USD&currency=PEN")).status()).toBe(422);
  const data = (await financialSession(page, context))!;
  const command = { requestId: crypto.randomUUID(), kind: "income", accountId: data.accounts[0].id, categoryId: data.income.id, amount: "1", description: "Prueba", note: "", occurredAt: null };
  expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { ...command, user_id: crypto.randomUUID() } })).status()).toBe(422);
  expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { ...command, currency: "USD" } })).status()).toBe(422);
  expect((await context.request.get("/api/v1/movements?limit=51")).status()).toBe(422);
  const response = await context.request.get("/api/v1/movements"); expect(response.headers()["cache-control"]).toContain("no-store"); expect(response.headers()["content-security-policy"]).toContain("nonce-");
});
test("ingreso/gasto inline persisten y concilian saldo e Inicio; apertura queda bloqueada", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  let form = await entry(page, "income", data.income.id, "50", "Pago del trabajo");
  await expect(page.getByRole("dialog", { name: /movimiento/i })).toHaveCount(0); await expect(form.locator(".ledger-preview")).toContainText("S/ 150.00");
  await form.getByRole("button", { name: "Guardar ingreso", exact: true }).click(); await expect(form).toHaveCount(0); await expect(page.getByText("Ingreso guardado.", { exact: true })).toBeVisible();
  form = await entry(page, "expense", data.expense.id, "20", "Compra del día"); await expect(form.locator(".ledger-preview")).toContainText("S/ 130.00");
  await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form).toHaveCount(0);
  await expect(page.locator(".ledger-totals")).toContainText("S/ 50.00"); await expect(page.locator(".ledger-totals")).toContainText("S/ 20.00"); await expect(page.locator(".ledger-totals")).toContainText("S/ 30.00");
  await navigate(page, "Inicio"); await expect(page.locator(".overview-balance > strong")).toHaveText("S/ 130.00"); await expect(page.locator(".overview-recent")).toContainText("Compra del día");
  await page.reload(); await expect(page.locator(".overview-balance > strong")).toHaveText("S/ 130.00");
  await navigate(page, "Cuentas"); await page.getByRole("button", { name: "Editar cuenta Efectivo" }).click(); const dialog = page.getByRole("dialog", { name: "Editar cuenta", exact: true }); await expect(dialog.getByLabel("Saldo inicial en PEN")).toHaveAttribute("readonly", ""); await expect(dialog.getByText("Esta cuenta tiene historial. El saldo inicial se conserva.")).toBeVisible();
  expect((await context.request.patch("/api/v1/accounts", { headers: { Origin: localOrigin }, data: { id: data.accounts[0].id, name: "Efectivo", openingBalance: "101", archived: false, expectedVersion: 1 } })).status()).toBe(409);
  expect(errors).toEqual([]);
});
test("confirmación perdida permite reintentar exactamente el mismo registro", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  const form = await entry(page, "expense", data.expense.id, "0,10", "Café registrado");
  let first = true; const keys: string[] = [];
  await page.route("**/api/v1/movements", async (route) => {
    if (route.request().method() === "POST") { keys.push(route.request().postDataJSON().requestId); if (first) { first = false; expect((await route.fetch()).status()).toBe(200); await route.fulfill({ status: 503, json: { ok: false, message: "Confirmación interrumpida. Reintenta." } }); return; } } await route.continue();
  });
  await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form.getByText("Confirmación interrumpida. Reintenta.")).toBeVisible(); await expect(form.getByLabel("Descripción", { exact: true })).toBeDisabled(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: ".impeccable/review/ledger-uncertain.png", fullPage: true }); await expect(form.getByLabel("Descripción", { exact: true })).toHaveValue("Café registrado");
  await form.getByRole("button", { name: "Reintentar registro", exact: true }).click(); await expect(form).toHaveCount(0); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  const pageData = await (await context.request.get("/api/v1/movements")).json(); expect(pageData.total_count).toBe(1); expect(pageData.expense_minor).toBe("10");
  expect((await (await context.request.get("/api/v1/accounts")).json()).accounts.find((a: { id: string }) => a.id === data.accounts[0].id).balance_minor).toBe("9990");
});
test("validación, fecha futura, saldo negativo y anulación sin perder historial", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  const form = await entry(page, "expense", data.expense.id, "0", "Gasto mayor al saldo"); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form.getByLabel("Importe en PEN")).toBeFocused();
  await form.getByLabel("Importe en PEN").fill("150"); await expect(form.locator(".ledger-preview.warning")).toContainText("−S/ 50.00");
  await form.getByRole("checkbox", { name: "Ocurrió ahora" }).uncheck(); await form.getByLabel("Fecha y hora del movimiento").fill("2099-01-01T10:00"); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form.getByText(/La fecha debe haber ocurrido/)).toBeVisible(); await expect(form.getByLabel("Fecha y hora del movimiento")).toBeFocused(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: ".impeccable/review/ledger-date-error.png", fullPage: true }); await expect(form.getByLabel("Descripción", { exact: true })).toHaveValue("Gasto mayor al saldo");
  await form.getByRole("checkbox", { name: "Ocurrió ahora" }).check(); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form).toHaveCount(0);
  const record = page.locator(".ledger-record").filter({ hasText: "Gasto mayor al saldo" }); await record.locator("summary").click(); await record.getByRole("button", { name: "Anular movimiento", exact: true }).click(); await record.getByRole("button", { name: "Confirmar anulación" }).click(); await expect(record.getByLabel("Motivo de anulación")).toBeFocused();
  await record.getByLabel("Motivo de anulación").fill("Se registró por error"); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: ".impeccable/review/ledger-void-form.png", fullPage: true }); await record.getByRole("button", { name: "Confirmar anulación" }).click(); await expect(record).toContainText("Anulado"); await expect(page.locator(".ledger-totals")).toContainText("S/ 0.00");
  const account = (await (await context.request.get("/api/v1/accounts")).json()).accounts.find((a: { id: string }) => a.id === data.accounts[0].id); expect(account).toMatchObject({ balance_minor: "10000", can_edit_opening: false });
  await page.reload(); await navigate(page, "Movimientos"); await expect(page.locator(".ledger-record")).toContainText("Anulado");
});
test("páginas y filtros mantienen agregados completos y no mezclan PEN/USD", async ({ page, context }) => {
  const data = (await financialSession(page, context))!;
  for (let i = 0; i < 27; i++) expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "income", accountId: data.accounts[0].id, categoryId: data.income.id, amount: "1", description: `Pago ${i}`, note: "", occurredAt: null } })).status()).toBe(200);
  expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "income", accountId: data.accounts[1].id, categoryId: data.income.id, amount: "2", description: "Ingreso USD", note: "", occurredAt: null } })).status()).toBe(200);
  await page.reload(); await navigate(page, "Movimientos"); await expect(page.locator(".ledger-record")).toHaveCount(25); await expect(page.locator(".ledger-totals")).toContainText("S/ 27.00"); await page.getByRole("button", { name: "Siguiente", exact: true }).click(); await expect(page.locator(".ledger-record")).toHaveCount(2); await expect(page.locator(".ledger-totals")).toContainText("S/ 27.00");
  await page.getByLabel("Buscar movimientos", { exact: true }).fill("Pago 26"); await page.getByRole("button", { name: "Aplicar filtros" }).click(); await expect(page.locator(".ledger-record")).toHaveCount(1);
  await page.getByLabel("Buscar movimientos", { exact: true }).fill(""); await page.getByLabel("Moneda", { exact: true }).selectOption("USD"); await page.getByRole("button", { name: "Aplicar filtros" }).click(); await expect(page.locator(".ledger-record")).toHaveCount(1); await expect(page.locator(".ledger-totals")).toContainText("US$ 2.00"); await expect(page.locator(".ledger-rows")).not.toContainText("Pago 26");
});
test("sesión expirada y lectura fallida conservan verdad y borrador", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  await page.route("**/api/v1/movements?**", (route) => route.fulfill({ status: 503, json: { ok: false } })); await page.getByRole("button", { name: "Actualizar movimientos" }).click(); await expect(page.getByText(/No pudimos cargar esta consulta/)).toBeVisible(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: ".impeccable/review/ledger-read-error.png", fullPage: true }); await expect(page.locator(".ledger-empty")).toHaveCount(0); await page.unroute("**/api/v1/movements?**");
  const form = await entry(page, "income", data.income.id, "10", "Borrador conservado"); await context.clearCookies(); await form.getByRole("button", { name: "Guardar ingreso" }).click(); await expect(form.getByText(/Tu sesión terminó/)).toBeVisible(); await expect(form.getByLabel("Descripción", { exact: true })).toHaveValue("Borrador conservado");
});
test("interfaz real a 320–1440: formulario inline, teclado y capturas de todos los estados principales", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  let form = await entry(page, "income", data.income.id, "1250.10", "Pago del trabajo de noviembre"); await form.getByRole("button", { name: "Guardar ingreso", exact: true }).click(); await expect(form).toHaveCount(0);
  form = await entry(page, "expense", data.expense.id, "20.50", "Compras para la semana"); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form).toHaveCount(0);
  for (const width of [1440, 1024, 768, 390, 320]) { await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.evaluate(() => document.fonts.ready); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/ledger-${width}.png`, fullPage: true }); }
  await page.setViewportSize({ width: 1440, height: 1000 }); form = await entry(page, "expense", data.expense.id, "14.90", "Compra por registrar");
  for (const width of [1440, 1024, 768, 390, 320]) { await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); await page.evaluate(() => window.scrollTo(0, 0)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/ledger-form-${width}.png`, fullPage: true }); }
  await form.getByRole("button", { name: "Cancelar registro" }).click(); await page.locator(".ledger-record").first().locator("summary").focus(); await page.keyboard.press("Enter"); await expect(page.locator(".ledger-record").first()).toHaveAttribute("open", "");
});
