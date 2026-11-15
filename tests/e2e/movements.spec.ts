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
test("ingreso/gasto en modal persisten y concilian saldo e Inicio; apertura queda bloqueada", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  let form = await entry(page, "income", data.income.id, "50", "Pago del trabajo");
  await expect(page.getByRole("dialog", { name: "Registrar ingreso", exact: true })).toBeVisible(); await expect(form.locator(".ledger-preview")).toContainText("S/ 150.00");
  await form.getByRole("button", { name: "Guardar ingreso", exact: true }).click(); await expect(form).toHaveCount(0); await expect(page.getByText("Ingreso guardado.", { exact: true })).toBeVisible();
  form = await entry(page, "expense", data.expense.id, "20", "Compra del día"); await expect(form.locator(".ledger-preview")).toContainText("S/ 130.00");
  await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form).toHaveCount(0);
  await expect(page.locator(".ledger-totals")).toContainText("S/ 50.00"); await expect(page.locator(".ledger-totals")).toContainText("S/ 20.00"); await expect(page.locator(".ledger-totals")).toContainText("S/ 30.00");
  await navigate(page, "Inicio"); await expect(page.locator(".overview-balance > strong")).toHaveText("S/ 130.00"); await expect(page.locator(".overview-recent")).toContainText("Compra del día");
  await page.reload(); await expect(page.locator(".overview-balance > strong")).toHaveText("S/ 130.00");
  await navigate(page, "Cuentas"); await page.getByRole("button", { name: "Editar cuenta Efectivo" }).click(); const dialog = page.getByRole("dialog", { name: "Editar cuenta", exact: true }); await expect(dialog.getByLabel("Saldo inicial en PEN")).toHaveAttribute("readonly", "");
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
test("validación, fecha futura, saldo negativo y archivado sin perder historial", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  const form = await entry(page, "expense", data.expense.id, "0", "Gasto mayor al saldo"); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form.getByLabel("Importe en PEN")).toBeFocused();
  await form.getByLabel("Importe en PEN").fill("150"); await expect(form.locator(".ledger-preview.warning")).toContainText("−S/ 50.00");
  await form.getByRole("checkbox", { name: "Ocurrió ahora" }).uncheck(); await form.getByLabel("Fecha y hora del movimiento").fill("2099-01-01T10:00"); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form.getByText(/La fecha debe haber ocurrido/)).toBeVisible(); await expect(form.getByLabel("Fecha y hora del movimiento")).toBeFocused(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: ".impeccable/review/ledger-date-error.png", fullPage: true }); await expect(form.getByLabel("Descripción", { exact: true })).toHaveValue("Gasto mayor al saldo");
  await form.getByRole("checkbox", { name: "Ocurrió ahora" }).check(); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form).toHaveCount(0);
  const record = page.locator(".ledger-record").filter({ hasText: "Gasto mayor al saldo" }); await record.locator("summary").click(); await record.getByRole("button", { name: "Archivar movimiento", exact: true }).click(); await page.locator(".ledger-remove-dialog").getByRole("button", { name: "Confirmar archivado" }).click(); await expect(page.locator(".ledger-remove-dialog").getByLabel("Motivo de archivado")).toBeFocused();
  await page.locator(".ledger-remove-dialog").getByLabel("Motivo de archivado").fill("Se registró por error"); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: ".impeccable/review/ledger-void-form.png", fullPage: true }); await page.locator(".ledger-remove-dialog").getByRole("button", { name: "Confirmar archivado" }).click(); await expect(record).toContainText("Archivado"); await expect(page.locator(".ledger-totals")).toContainText("S/ 0.00");
  const account = (await (await context.request.get("/api/v1/accounts")).json()).accounts.find((a: { id: string }) => a.id === data.accounts[0].id); expect(account).toMatchObject({ balance_minor: "10000", can_edit_opening: false });
  await page.reload(); await navigate(page, "Movimientos"); await expect(page.locator(".ledger-record")).toContainText("Archivado");
});
test("páginas y filtros mantienen agregados completos y no mezclan PEN/USD", async ({ page, context }) => {
  const data = (await financialSession(page, context))!;
  for (let i = 0; i < 27; i++) expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "income", accountId: data.accounts[0].id, categoryId: data.income.id, amount: "1", description: `Pago ${i}`, note: "", occurredAt: null } })).status()).toBe(200);
  expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "income", accountId: data.accounts[1].id, categoryId: data.income.id, amount: "2", description: "Ingreso USD", note: "", occurredAt: null } })).status()).toBe(200);
  await page.reload(); await navigate(page, "Movimientos"); await expect(page.locator(".ledger-record")).toHaveCount(25); await expect(page.locator(".ledger-totals")).toContainText("S/ 27.00"); await page.getByRole("button", { name: "Siguiente", exact: true }).click(); await expect(page.locator(".ledger-record")).toHaveCount(2); await expect(page.locator(".ledger-totals")).toContainText("S/ 27.00");
  await page.getByLabel("Buscar movimientos", { exact: true }).fill("Pago 26"); await expect(page.locator(".ledger-record")).toHaveCount(1);
  await page.getByLabel("Buscar movimientos", { exact: true }).fill(""); await page.getByLabel("Moneda", { exact: true }).selectOption("USD"); await expect(page.locator(".ledger-record")).toHaveCount(1); await expect(page.locator(".ledger-totals")).toContainText("US$ 2.00"); await expect(page.locator(".ledger-rows")).not.toContainText("Pago 26");
});
test("sesión expirada y lectura fallida conservan verdad y borrador", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  await page.route("**/api/v1/movements?**", (route) => route.fulfill({ status: 503, json: { ok: false } })); await page.getByLabel("Tipo", { exact: true }).selectOption("income"); await expect(page.getByText(/No pudimos cargar esta consulta/)).toBeVisible(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: ".impeccable/review/ledger-read-error.png", fullPage: true }); await expect(page.locator(".ledger-empty")).toHaveCount(0); await page.unroute("**/api/v1/movements?**");
  const form = await entry(page, "income", data.income.id, "10", "Borrador conservado"); await context.clearCookies(); await form.getByRole("button", { name: "Guardar ingreso" }).click(); await expect(form.getByText(/Tu sesión terminó/)).toBeVisible(); await expect(form.getByLabel("Descripción", { exact: true })).toHaveValue("Borrador conservado");
});
test("interfaz real a 320–1440: formulario en modal, teclado y capturas de todos los estados principales", async ({ page, context }) => {
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  let form = await entry(page, "income", data.income.id, "1250.10", "Pago del trabajo de noviembre"); await form.getByRole("button", { name: "Guardar ingreso", exact: true }).click(); await expect(form).toHaveCount(0);
  form = await entry(page, "expense", data.expense.id, "20.50", "Compras para la semana"); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form).toHaveCount(0);
  for (const width of [1440, 1024, 768, 390, 320]) { await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.evaluate(() => document.fonts.ready); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/ledger-${width}.png`, fullPage: true }); }
  await page.setViewportSize({ width: 1440, height: 1000 }); form = await entry(page, "expense", data.expense.id, "14.90", "Compra por registrar");
  for (const width of [1440, 1024, 768, 390, 320]) { await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); await page.evaluate(() => window.scrollTo(0, 0)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/ledger-form-${width}.png`, fullPage: true }); }
  await form.getByRole("button", { name: "Cancelar registro" }).click(); await page.locator(".ledger-record").first().locator("summary").focus(); await page.keyboard.press("Enter"); await expect(page.locator(".ledger-record").first()).toHaveAttribute("open", "");
});
test("eliminar exige confirmación, reintenta una respuesta perdida y conserva trazabilidad", async ({ page, context, request }) => {
  expect((await request.delete("/api/v1/movements", { headers: { Origin: "https://otro.example" }, data: {} })).status()).toBe(403);
  expect((await request.delete("/api/v1/movements", { headers: { Origin: localOrigin }, data: { id: crypto.randomUUID(), expectedVersion: 1, reason: "Intento" } })).status()).toBe(401);
  const data = (await financialSession(page, context))!; await navigate(page, "Movimientos");
  await expect(page.getByRole("button", { name: "Actualizar movimientos", exact: true })).toHaveCount(0); await expect(page.getByText("Ingresos, gastos y transferencias reales", { exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Aplicar filtros", exact: true })).toHaveCount(0);
  const form = await entry(page, "expense", data.expense.id, "20", "Compra para eliminar");
  await expect(form.locator("xpath=..")).toHaveJSProperty("open", true); await form.getByRole("button", { name: "Guardar gasto", exact: true }).click(); await expect(form).toHaveCount(0);
  const movement = (await (await context.request.get("/api/v1/movements")).json()).movements[0];
  expect((await context.request.delete("/api/v1/movements", { headers: { Origin: localOrigin }, data: { id: movement.id, expectedVersion: 1, reason: "Eliminar", user_id: crypto.randomUUID() } })).status()).toBe(422);
  const record = page.locator(".ledger-record"); await record.locator("summary").click(); await record.getByRole("button", { name: "Eliminar movimiento", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Eliminar movimiento", exact: true }); await expect(modal).toContainText("trazabilidad"); await modal.getByRole("button", { name: "Conservar movimiento" }).click(); await expect(modal).not.toBeVisible(); await expect(record).toHaveCount(1);
  await record.getByRole("button", { name: "Eliminar movimiento", exact: true }).click(); await modal.getByRole("button", { name: "Confirmar eliminación" }).click(); await expect(modal.getByLabel("Motivo de eliminación")).toBeFocused(); await modal.getByLabel("Motivo de eliminación").fill("Registro descartado");
  let first = true; const inputs: unknown[] = [];
  await page.route("**/api/v1/movements", async (route) => {
    if (route.request().method() === "DELETE") { inputs.push(route.request().postDataJSON()); if (first) { first = false; expect((await route.fetch()).status()).toBe(200); await route.fulfill({ status: 503, json: { ok: false, message: "Confirmación interrumpida" } }); return; } } await route.continue();
  });
  await modal.getByRole("button", { name: "Confirmar eliminación" }).click(); await expect(modal.getByText("Confirmación interrumpida")).toBeVisible(); await expect(modal.getByLabel("Motivo de eliminación")).toHaveValue("Registro descartado"); await expect(modal.getByLabel("Motivo de eliminación")).toBeDisabled();
  await modal.getByRole("button", { name: "Confirmar eliminación" }).click(); await expect(modal).not.toBeVisible(); await expect(record).toHaveCount(0); await expect(page.locator(".finzi-toast-message")).toHaveText("Movimiento eliminado."); expect(inputs).toHaveLength(2); expect(inputs[0]).toEqual(inputs[1]);
  const traced = await (await context.request.get(`/api/v1/movements?id=${movement.id}`)).json(); expect(traced.movement).toMatchObject({ status: "void", deleted_at: expect.any(String), deletion_reason: "Registro descartado" });
  expect((await (await context.request.get("/api/v1/accounts")).json()).accounts[0].balance_minor).toBe("10000");
  await page.reload(); await navigate(page, "Movimientos"); await expect(record).toHaveCount(0);
});
test("conflicto al eliminar conserva el motivo y ofrece consultar la versión actual", async ({ page, context }) => {
  const data = (await financialSession(page, context))!;
  const response = await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "income", accountId: data.accounts[0].id, categoryId: data.income.id, amount: "10", description: "Registro concurrente", note: "", occurredAt: null } }); expect(response.status()).toBe(200); const movement = await response.json();
  await navigate(page, "Movimientos"); const row = page.locator(".ledger-record"); await row.locator("summary").click(); await row.getByRole("button", { name: "Eliminar movimiento", exact: true }).click(); const modal = page.locator(".ledger-remove-dialog"); await modal.getByLabel("Motivo de eliminación").fill("Motivo conservado");
  expect((await context.request.patch("/api/v1/movements", { headers: { Origin: localOrigin }, data: { id: movement.id, expectedVersion: 1, reason: "Archivado desde otra sesión" } })).status()).toBe(200);
  await modal.getByRole("button", { name: "Confirmar eliminación" }).click(); await expect(modal.getByText(/movimiento cambió/)).toBeVisible(); await expect(modal.getByRole("button", { name: "Confirmar eliminación" })).toBeDisabled(); await expect(modal.getByLabel("Motivo de eliminación")).toHaveValue("Motivo conservado"); await modal.getByRole("button", { name: "Cerrar y consultar movimientos" }).click(); await expect(modal).not.toBeVisible(); await expect(row).toContainText("Archivado");
  await row.getByRole("button", { name: "Eliminar movimiento", exact: true }).click(); await modal.getByLabel("Motivo de eliminación").fill("Eliminar registro archivado"); await modal.getByRole("button", { name: "Confirmar eliminación" }).click(); await expect(modal).not.toBeVisible(); await expect(row).toHaveCount(0);
});
test("filtros automáticos invalidan respuestas anteriores, validan fechas y reinician la página", async ({ page, context }) => {
  const data = (await financialSession(page, context))!;
  for (const description of ["Café", "Mercado"]) expect((await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "expense", accountId: data.accounts[0].id, categoryId: data.expense.id, amount: "5", description, note: "", occurredAt: null } })).status()).toBe(200);
  await navigate(page, "Movimientos"); await expect(page.locator(".ledger-record")).toHaveCount(2);
  await page.route("**/api/v1/movements?**", async (route) => { if (new URL(route.request().url()).searchParams.get("query") === "Café") { const response = await route.fetch(); await new Promise((resolve) => setTimeout(resolve, 700)); await route.fulfill({ response }); } else await route.continue(); });
  await page.getByLabel("Buscar movimientos", { exact: true }).fill("Café"); await page.waitForRequest((request) => request.url().includes("query=Caf")); await page.getByLabel("Buscar movimientos", { exact: true }).fill("Mercado"); await expect(page.locator(".ledger-record-name > strong")).toHaveText(["Mercado"]); await page.waitForTimeout(800); await expect(page.locator(".ledger-record-name > strong")).toHaveText(["Mercado"]);
  await page.getByLabel("Período", { exact: true }).selectOption("custom"); await page.getByLabel("Desde", { exact: true }).fill("2099-01-01"); await expect(page.locator(".ledger-filter-error")).toBeVisible(); await expect(page.locator(".ledger-record-name > strong")).toHaveText(["Mercado"]);
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click(); await expect(page.locator(".ledger-record")).toHaveCount(2); await expect(page.locator(".ledger-filter-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Registrar movimiento", exact: true }).click(); const modal = page.locator(".ledger-dialog"); await expect(modal).toBeVisible(); await page.keyboard.press("Escape"); await expect(modal).not.toBeVisible(); await expect(page.getByRole("button", { name: "Registrar movimiento", exact: true })).toBeFocused();
});
