import { expect, test, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { financialSession, localOrigin, navigate } from "../helpers/financial";

async function seed(context: BrowserContext) {
  const profile = (await (await context.request.get("/api/v1/profile")).json()).profile, uid = profile.user_id, accountId = crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(uid)) throw new Error("Solo identidad sintética verificada");
  const container = process.env.FINZI_TEST_DB_CONTAINER ?? "supabase_db_finzi-auth";
  if (!/^supabase_db_finzi-[a-z0-9-]+$/.test(container)) throw new Error("Contenedor local inválido");
  execFileSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", `begin;set local role app_executor;select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true);insert into finance.accounts(id,user_id,create_request_id,name,type,currency_code,opening_balance,opening_at) values('${accountId}','${uid}',gen_random_uuid(),'Cuenta histórica estadística','cash','PEN',0,'2026-01-01Z');commit;`], { stdio: "pipe" });
  const catalog = (await (await context.request.get("/api/v1/categories")).json()).categories;
  const income = catalog.find((c: { kind: string }) => c.kind === "income"), expense = catalog.find((c: { kind: string }) => c.kind === "expense");
  const created = await context.request.post("/api/v1/categories", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), name: "Transporte estadístico", description: "", color: "amber", icon: "car", kind: "expense", parentId: null, imagePath: null } }); expect(created.status()).toBe(200);
  const other = (await created.json()).categories.find((c: { name: string }) => c.name === "Transporte estadístico");
  async function post(kind: string, amount: string, date: string, categoryId: string, description = "Movimiento para estadísticas") {
    const result = await context.request.post("/api/v1/movements", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), kind, accountId, categoryId, amount, description, note: "", occurredAt: `${date}T12:00:00Z` } }); expect(result.status()).toBe(200); return result.json();
  }
  for (const [at, kind, amount, id] of [["2026-04-05", "income", "100", income.id], ["2026-04-06", "expense", "40", expense.id], ["2026-04-08", "expense", "30", other.id], ["2026-05-05", "income", "200", income.id], ["2026-05-06", "expense", "50", expense.id], ["2026-05-07", "expense", "10", other.id]]) await post(kind, amount, at, id);
  return { post, expense, income, other };
}

test("estadísticas API: identidad, filtros estrictos, fechas y caché privada", async ({ page, context, request }) => {
  expect((await request.get("/api/v1/statistics")).status()).toBe(401);
  for (const query of ["currency=USD&currency=PEN", "user_id=otro", "period=quarter", "period=custom&from=2026-02-30&to=2026-03-01"]) expect((await request.get(`/api/v1/statistics?${query}`)).status()).toBe(422);
  await financialSession(page, context); const result = await context.request.get("/api/v1/statistics"); expect(result.status()).toBe(200); expect(result.headers()["cache-control"]).toContain("no-store"); expect((await result.json()).income_minor).toBe("0");
  expect((await context.request.get("/api/v1/statistics?period=custom&from=2026-01-01&to=2099-01-01")).status()).toBe(422);
});

test("indicadores, cuatro gráficos y categorías concilian con movimientos reales", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message)); await financialSession(page, context); const fixture = await seed(context); await navigate(page, "Estadísticas");
  await page.getByRole("combobox", { name: "Período", exact: true }).selectOption("custom"); await page.getByLabel("Fecha inicial").fill("2026-05-01"); await page.getByLabel("Fecha final").fill("2026-05-31");
  await expect(page.locator(".statistics-metric.income > strong")).toHaveText("S/ 200.00"); await expect(page.locator(".statistics-metric.expense > strong")).toHaveText("S/ 60.00"); await expect(page.locator(".statistics-metric.net > strong")).toHaveText("S/ 140.00"); await expect(page.locator(".statistics-metric.savings > strong")).toHaveText("S/ 140.00"); await expect(page.locator(".statistics-metric.rate > strong")).toHaveText("70,00%");
  await expect(page.locator(".statistics-metric.rate")).toContainText("+40,00 pp"); await expect(page.locator(".statistics-visuals > section")).toHaveCount(4);
  await page.locator(".statistics-donut-legend").getByRole("button", { name: /Transporte estadístico/ }).click(); await expect(page.locator(".statistics-donut-detail")).toContainText("S/ 10.00");
  await page.getByRole("button", { name: "Menor gasto", exact: true }).click(); await expect(page.locator(".statistics-categories tbody tr")).toHaveCount(1); await expect(page.locator(".statistics-categories tbody")).toContainText("Transporte estadístico");
  await page.getByRole("button", { name: "Mayor incremento", exact: true }).click(); await expect(page.locator(".statistics-categories tbody")).toContainText(fixture.expense.name);
  await page.getByRole("combobox", { name: "Intervalo de Ingresos vs. gastos", exact: true }).selectOption("4"); await expect(page.locator(".statistics-chart.flow .statistics-readout")).toContainText("S/ 200.00"); await page.locator(".statistics-chart.flow").getByRole("button", { name: "Ver movimientos del intervalo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tus movimientos.", exact: true })).toBeVisible(); await expect(page.locator(".ledger-record")).toHaveCount(1); await navigate(page, "Estadísticas"); await expect(page.getByLabel("Fecha inicial")).toHaveValue("2026-05-01"); await expect(page.locator(".statistics-metric.net > strong")).toHaveText("S/ 140.00");
  await fixture.post("expense", "400", "2026-05-08", fixture.expense.id); await page.getByRole("button", { name: "Actualizar", exact: true }).click(); await expect(page.locator(".statistics-metric.net > strong")).toHaveText("−S/ 260.00"); await expect(page.locator(".statistics-metric.savings > strong")).toHaveText("S/ 0.00"); await expect(page.locator(".statistics-metric.rate > strong")).toHaveText("0,00%");
  expect(await page.locator(".statistics-svg path").evaluateAll((paths) => paths.every((p) => !/NaN|Infinity/.test(p.getAttribute("d") ?? "")))).toBe(true); expect(errors).toEqual([]);
});

test("todos los períodos actualizan automáticamente, sin mezclar moneda ni resultados fallidos", async ({ page, context }) => {
  await financialSession(page, context); await seed(context); await navigate(page, "Estadísticas");
  for (const period of ["week", "month", "three_months", "six_months", "year"]) {
    await page.getByRole("combobox", { name: "Período", exact: true }).selectOption(period); await expect(page.locator(".statistics-range")).toBeVisible(); const response = await context.request.get(`/api/v1/statistics?period=${period}`); const data = await response.json(); await expect(page.locator(".statistics-metric.income > strong")).toHaveText(`S/ ${data.income_minor === "30000" ? "300.00" : data.income_minor === "20000" ? "200.00" : "0.00"}`);
  }
  await page.getByRole("button", { name: "Mayor incremento", exact: true }).click(); await expect(page.locator(".statistics-empty-inline")).toContainText("No hay movimientos en el período anterior");
  await page.route("**/api/v1/statistics?currency=USD**", (route) => route.fulfill({ status: 503, json: { message: "Lectura temporalmente no disponible." } })); await page.getByRole("combobox", { name: "Moneda", exact: true }).selectOption("USD"); await expect(page.locator(".statistics-error")).toContainText("Lectura temporalmente"); await expect(page.locator(".statistics-metrics")).toHaveCount(0); await page.unroute("**/api/v1/statistics?currency=USD**"); await page.getByRole("button", { name: "Reintentar estadísticas" }).click(); await expect(page.locator(".statistics-metric.income > strong")).toHaveText("US$ 0.00"); await expect(page.locator(".statistics-metric.rate > strong")).toHaveText("No calculable");
  await page.getByRole("combobox", { name: "Período", exact: true }).selectOption("custom"); await page.getByLabel("Fecha inicial").fill("2099-01-01"); await expect(page.locator("#statistics-period-error")).toBeVisible(); await expect(page.locator(".statistics-metrics")).toHaveCount(0);
});

test("vacío, teclado y gráficos responsive sin imágenes adicionales", async ({ page, context }) => {
  await financialSession(page, context); await navigate(page, "Estadísticas"); await expect(page.locator(".statistics-empty")).toContainText("Sin ingresos ni gastos"); await expect(page.locator(".statistics-metric.rate > strong")).toHaveText("No calculable");
  const control = page.getByRole("combobox", { name: "Período", exact: true }); await control.focus(); await expect(control).toBeFocused();
  for (const width of [320, 390, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.locator(".statistics-empty").getByRole("button", { name: "Ir a Movimientos", exact: true }).click(); await expect(page.getByRole("heading", { name: "Tus movimientos.", exact: true })).toBeVisible();
});

test("datos exactos, interacción móvil y dos capturas de revisión", async ({ page, context }) => {
  await financialSession(page, context); await seed(context); await navigate(page, "Estadísticas"); await page.getByRole("combobox", { name: "Período", exact: true }).selectOption("custom"); await page.getByLabel("Fecha inicial").fill("2026-05-01"); await page.getByLabel("Fecha final").fill("2026-05-31"); await expect(page.locator(".statistics-metric.rate > strong")).toHaveText("70,00%");
  if (process.env.CAPTURE_STATISTICS === "1") { await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: ".impeccable/review/statistics-desktop.png", fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("combobox", { name: "Intervalo de Tendencia de ahorro", exact: true }).selectOption("4"); await expect(page.locator(".statistics-chart.savings .statistics-readout")).toContainText("S/ 200.00");
  const categoryNote = page.locator(".statistics-categories > .statistics-table-note"); await expect(categoryNote).toBeVisible(); expect(await categoryNote.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  if (process.env.CAPTURE_STATISTICS === "1") { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: ".impeccable/review/statistics-mobile.png", fullPage: true }); }
  await page.getByText("Ver datos exactos de los gráficos", { exact: true }).click(); await expect(page.locator(".statistics-data tbody tr")).toHaveCount(31); await expect(page.locator(".statistics-data")).toContainText("S/ 140.00"); expect(await page.locator(".statistics-data > .statistics-table-note").evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CAPTURE_STATISTICS === "1") writeFileSync(".impeccable/review/statistics-note-measurements.json", JSON.stringify(await page.locator(".statistics-table-note").evaluateAll((notes) => notes.map((el) => ({ viewport: innerWidth, width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, lineHeight: getComputedStyle(el).lineHeight, right: el.getBoundingClientRect().right, insideHorizontalScroll: !!el.closest(".statistics-table-scroll"), textLength: el.textContent?.length }))), null, 2));
});
