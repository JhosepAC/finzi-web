import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { financialSession, localOrigin, navigate } from "../helpers/financial";

const input = (overrides = {}) => ({ action: "create", requestId: crypto.randomUUID(), name: "Estudios", creditor: "Instituto", detail: "Cuotas acordadas", icon: "book", category: "education", currency: "PEN", amount: "200.00", dueDate: null, ...overrides });
async function command(context: BrowserContext, data: object) { const response = await context.request.post("/api/v1/debts", { headers: { Origin: localOrigin }, data }); expect(response.status()).toBe(200); return response.json(); }
const card = (page: Page, name: string) => page.locator(".debt-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

test("deudas API protege sesión, origen, tamaño y campos de identidad", async ({ page, context, request }) => {
  expect((await request.get("/api/v1/debts")).status()).toBe(401);
  expect((await request.post("/api/v1/debts", { headers: { Origin: "https://otro.example" }, data: input() })).status()).toBe(403);
  expect((await request.post("/api/v1/debts", { headers: { Origin: localOrigin }, data: { detail: "x".repeat(17000) } })).status()).toBe(413);
  await financialSession(page, context);
  expect((await context.request.post("/api/v1/debts", { headers: { Origin: localOrigin }, data: input({ user_id: crypto.randomUUID() }) })).status()).toBe(422);
  const result = await context.request.get("/api/v1/debts"); expect(result.status()).toBe(200); expect(result.headers()["cache-control"]).toContain("no-store"); expect((await result.json()).debts).toHaveLength(0);
});

test("crea deuda y paga inline con gasto nuevo o existente, sin duplicar saldo", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message)); const session = (await financialSession(page, context))!;
  await navigate(page, "Deudas"); await expect(page.getByText("Tus deudas, con un plan claro.")).toBeVisible();
  await page.getByRole("button", { name: "Registrar deuda", exact: true }).click();
  const form = page.locator(".debt-editor"); await form.getByLabel("Nombre", { exact: true }).fill("Estudios"); await form.getByLabel("A quién le debes").fill("Instituto"); await form.getByLabel("Importe total").fill("200.00"); await form.getByLabel("Categoría de deuda (opcional)").selectOption("education"); await form.getByRole("button", { name: "Guardar deuda", exact: true }).click();
  await expect(form).toHaveCount(0); await expect(card(page, "Estudios")).toContainText("S/ 200.00"); await expect(page.locator(".debt-availability")).toContainText("Faltan S/ 100.00");
  await card(page, "Estudios").getByRole("button", { name: "Registrar pago", exact: true }).click(); await form.getByLabel("Importe del pago").fill("60.00"); await form.getByLabel("Cuenta del pago").selectOption(session.accounts[0].id); await form.getByLabel("Categoría del gasto").selectOption(session.expense.id);
  await expect(form.locator(".debt-payment-preview")).toContainText("S/ 40.00"); await form.getByRole("button", { name: "Registrar pago", exact: true }).click(); await expect(form).toHaveCount(0); await expect(card(page, "Estudios").locator(".debt-badge")).toHaveText("Pago parcial"); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 40.00");
  const expense = await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind: "expense", accountId: session.accounts[0].id, categoryId: session.expense.id, amount: "20.00", description: "Cuota ya registrada", note: "", occurredAt: null } }); expect(expense.status()).toBe(200); const movement = await expense.json();
  await page.getByRole("button", { name: "Actualizar", exact: true }).click(); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 20.00");
  await card(page, "Estudios").getByRole("button", { name: "Registrar pago", exact: true }).click(); await form.getByRole("button", { name: "Vincular un gasto existente", exact: true }).click(); await form.getByLabel("Gasto registrado").selectOption(movement.id); await form.getByRole("button", { name: "Registrar pago", exact: true }).click(); await expect(form).toHaveCount(0);
  await expect(card(page, "Estudios").locator(".debt-amount > strong")).toHaveText("S/ 120.00"); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 20.00");
  await card(page, "Estudios").getByRole("button", { name: "Ver detalle", exact: true }).click(); await expect(card(page, "Estudios").locator(".debt-payments li")).toHaveCount(2);
  await card(page, "Estudios").getByRole("button", { name: "Ver movimiento", exact: true }).first().click(); await expect(page.getByRole("heading", { name: "Tus movimientos.", exact: true })).toBeVisible(); expect(errors).toEqual([]);
});

test("filtra, edita, liquida y elimina con confirmación conservando los gastos", async ({ page, context }) => {
  const session = (await financialSession(page, context))!; const debt = await command(context, input({ amount: "10.00", dueDate: "2020-01-01" }));
  await command(context, input({ name: "Dólares", currency: "USD", amount: "30.00" })); await navigate(page, "Deudas");
  await expect(card(page, "Estudios")).toContainText("Vencida desde"); await page.getByRole("combobox", { name: "Estado", exact: true }).selectOption("paid"); await expect(page.getByText("No hay deudas con estos filtros.")).toBeVisible(); await page.getByRole("button", { name: "Limpiar filtros", exact: true }).first().click();
  await card(page, "Estudios").getByRole("button", { name: "Ver detalle", exact: true }).click(); await card(page, "Estudios").getByRole("button", { name: "Editar deuda", exact: true }).click(); await page.locator(".debt-editor").getByLabel("Nombre", { exact: true }).fill("Estudios terminados"); await page.getByRole("button", { name: "Guardar cambios", exact: true }).click(); await expect(page.locator(".debt-editor")).toHaveCount(0);
  await command(context, { action: "pay", id: debt.id, requestId: crypto.randomUUID(), mode: "new", accountId: session.accounts[0].id, categoryId: session.expense.id, amount: "10.00", occurredAt: null, note: "Liquidado" }); await page.getByRole("button", { name: "Actualizar", exact: true }).click(); await expect(card(page, "Estudios terminados").locator(".debt-badge")).toHaveText("Pagada");
  await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 90.00"); page.once("dialog", (dialog) => dialog.accept()); await card(page, "Estudios terminados").getByRole("button", { name: "Eliminar deuda", exact: true }).click(); await expect(card(page, "Estudios terminados")).toHaveCount(0); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 90.00");
  await page.getByLabel("Mostrar en").selectOption("USD"); await expect(card(page, "Dólares")).toBeVisible(); await expect(page.locator(".debt-availability > strong")).toHaveText("US$ 0.00");
});

test("confirmación perdida reintenta el mismo pago, conserva el formulario y no duplica", async ({ page, context }) => {
  const session = (await financialSession(page, context))!; await command(context, input()); await navigate(page, "Deudas"); await card(page, "Estudios").getByRole("button", { name: "Registrar pago", exact: true }).click(); const form = page.locator(".debt-editor");
  await form.getByLabel("Importe del pago").fill("5"); await form.getByLabel("Cuenta del pago").selectOption(session.accounts[0].id); await form.getByLabel("Categoría del gasto").selectOption(session.expense.id);
  await page.route("**/api/v1/debts", async (route) => { if (route.request().method() === "POST") { await route.fetch(); await route.abort("failed"); } else await route.continue(); }); await form.getByRole("button", { name: "Registrar pago", exact: true }).click(); await expect(page.getByRole("button", { name: "Reintentar el mismo guardado" })).toBeVisible(); await expect(form.getByLabel("Importe del pago")).toBeDisabled(); await page.unroute("**/api/v1/debts"); await page.getByRole("button", { name: "Reintentar el mismo guardado" }).click(); await expect(form).toHaveCount(0); await expect(card(page, "Estudios").locator(".debt-amount > strong")).toHaveText("S/ 195.00"); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 95.00");
});

test("móvil, teclado, fallos de carga y formulario sin guardar", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await financialSession(page, context); await command(context, input());
  await page.route("**/api/v1/debts", (route) => route.abort("failed")); await navigate(page, "Deudas"); await expect(page.locator(".debt-workspace [role=alert]")).toContainText("No pudimos actualizar"); await page.unroute("**/api/v1/debts"); await page.getByRole("button", { name: "Reintentar actualización" }).click(); await expect(card(page, "Estudios")).toBeVisible();
  await page.getByRole("button", { name: "Registrar deuda", exact: true }).click(); await page.getByLabel("Nombre", { exact: true }).fill("Borrador"); page.once("dialog", (dialog) => dialog.dismiss()); await navigate(page, "Inicio"); await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Borrador"); await page.getByRole("button", { name: "Cerrar navegación", exact: true }).click(); await page.getByLabel("Nombre", { exact: true }).focus(); await page.keyboard.press("Tab"); await expect(page.getByLabel("A quién le debes")).toBeFocused();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click(); await page.getByRole("button", { name: "Abrir navegación", exact: true }).click(); await page.getByRole("button", { name: "Cerrar navegación", exact: true }).click();
  const skip = page.getByRole("link", { name: "Saltar al contenido", exact: true }); await skip.focus(); await expect(skip).toHaveCSS("clip-path", "none"); await page.getByRole("heading", { name: "Tus deudas.", exact: true }).focus(); await expect(skip).toHaveCSS("clip-path", "inset(50%)");
  for (const width of [360, 390, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
});

test("anular y desvincular explican sus efectos y conservan el historial", async ({ page, context }) => {
  const session = (await financialSession(page, context))!;
  expect((await context.request.post("/api/v1/accounts", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), name: "Cuenta diaria", type: "bank", currency: "PEN", openingBalance: "1300" } })).status()).toBe(200);
  const today = (await (await context.request.get("/api/v1/debts")).json()).today;
  const offset = (days: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  await command(context, input({ name: "Mi laptop", creditor: "Tienda de tecnología", amount: "1200.00", dueDate: offset(3), category: "shopping", icon: "briefcase" }));
  const studies = await command(context, input({ amount: "380.00", dueDate: offset(-3) })); const home = await command(context, input({ name: "Alquiler de noviembre", creditor: "Arrendador", amount: "300.00", category: "services", icon: "home" }));
  for (const [id, amount] of [[studies.id, "80.00"], [home.id, "300.00"]]) await command(context, { action: "pay", id, requestId: crypto.randomUUID(), mode: "new", accountId: session.accounts[0].id, categoryId: session.expense.id, amount, occurredAt: null, note: "Pago acordado" });
  await navigate(page, "Deudas"); await expect(page.locator(".debt-card")).toHaveCount(3); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 1,020.00");
  if (process.env.CAPTURE_DEBTS === "1") { await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: ".impeccable/review/debts-desktop.png", fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 }); await card(page, "Mi laptop").getByRole("button", { name: "Registrar pago", exact: true }).click();
  const form = page.locator(".debt-editor"); await form.getByLabel("Importe del pago").fill("85"); await form.getByLabel("Cuenta del pago").selectOption(session.accounts[0].id); await form.getByLabel("Categoría del gasto").selectOption(session.expense.id); await expect(form.locator(".debt-payment-preview")).toContainText("negativo");
  if (process.env.CAPTURE_DEBTS === "1") { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: ".impeccable/review/debts-mobile.png", fullPage: true }); }
  await form.getByRole("button", { name: "Registrar pago", exact: true }).click(); await expect(form).toHaveCount(0); await card(page, "Mi laptop").getByRole("button", { name: "Ver detalle", exact: true }).click();
  page.once("dialog", (d) => d.accept()); await card(page, "Mi laptop").getByRole("button", { name: "Anular gasto", exact: true }).click(); await expect(card(page, "Mi laptop").locator(".debt-amount > strong")).toHaveText("S/ 1,200.00"); await expect(card(page, "Mi laptop")).toContainText("Sin efecto en esta deuda"); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 1,020.00");
  await card(page, "Estudios").getByRole("button", { name: "Ver detalle", exact: true }).click(); page.once("dialog", (d) => d.accept()); await card(page, "Estudios").getByRole("button", { name: "Desvincular pago", exact: true }).click(); await expect(card(page, "Estudios").locator(".debt-amount > strong")).toHaveText("S/ 380.00"); await expect(page.locator(".debt-availability > strong")).toHaveText("S/ 1,020.00");
});
