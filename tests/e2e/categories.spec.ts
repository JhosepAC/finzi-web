import { expect, test, type Page } from "@playwright/test";
import { findMailLink } from "../helpers/mail";
process.loadEnvFile(".env.local");
if (!process.env.SUPABASE_URL || !["127.0.0.1", "localhost"].includes(new URL(process.env.SUPABASE_URL).hostname)) throw new Error("Solo Supabase local.");
const appPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const origin = process.env.PLAYWRIGHT_ORIGIN ?? `http://127.0.0.1:${appPort}`;
async function enter(page: Page) {
  const email = `categories-ui-${crypto.randomUUID()}@example.test`, password = "una frase de prueba para categorías 64";
  await page.goto("/register"); await page.getByLabel("Correo electrónico", { exact: true }).fill(email); await page.getByLabel("Contraseña", { exact: true }).fill(password); await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click(); await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto((await findMailLink(email, "signup")).replace("127.0.0.1:3000", `127.0.0.1:${appPort}`)); await page.getByRole("button", { name: "Confirmar correo", exact: true }).click(); await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Tu nombre", { exact: true }).fill("Andrea"); await page.getByRole("button", { name: "Continuar", exact: true }).click(); await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Explorar con datos de prueba")).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar y continuar" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
}
async function navigate(page: Page, label: string) {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 1000;
  const active = page.locator(".home-topbar h1").filter({ hasText: label });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await active.isVisible()) return;
    if (mobile) {
      const dialog = page.getByRole("dialog", { name: "Navegación principal" });
      if (!(await dialog.isVisible())) {
        await page.locator(".mobile-nav-trigger").click();
        await page.waitForTimeout(150);
      }
      if (await dialog.isVisible()) await dialog.getByRole("button", { name: label, exact: true }).click();
    } else {
      await page.locator(".home-sidebar").getByRole("button", { name: label, exact: true }).click();
    }
    await page.waitForTimeout(250);
  }
  await expect(active).toBeVisible();
}
async function openCategories(page: Page) {
  await navigate(page, "Categorías");
  await expect(page.getByRole("heading", { name: "Tus categorías." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nueva categoría", exact: true })).toBeEnabled();
}
async function create(page: Page, name: string) {
  await page.getByRole("button", { name: "Nueva categoría", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva categoría", exact: true });
  await dialog.getByLabel("Nombre de la categoría").fill(name); await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog).not.toBeVisible();
}
test("categorías API: sesión, CSRF, tamaño, campos ajenos y estructura inmutable", async ({ page, request, context }) => {
  expect((await request.get("/api/v1/categories")).status()).toBe(401);
  expect((await request.post("/api/v1/categories", { headers: { Origin: "https://otro.example" }, data: { action: "initialize" } })).status()).toBe(403);
  expect((await request.post("/api/v1/categories", { headers: { Origin: origin }, data: { text: "x".repeat(5000) } })).status()).toBe(413);
  await enter(page);
  const data = { requestId: crypto.randomUUID(), parentId: null, kind: "expense", name: "Casa", description: "", color: "blue", icon: "home", imagePath: null };
  expect((await context.request.post("/api/v1/categories", { headers: { Origin: origin }, data: { ...data, user_id: crypto.randomUUID() } })).status()).toBe(422);
  expect((await context.request.patch("/api/v1/categories", { headers: { Origin: origin }, data: { id: crypto.randomUUID(), name: "Casa", description: "", color: "blue", icon: "home", imagePath: null, archived: false, expectedVersion: 1, kind: "income" } })).status()).toBe(422);
  const response = await context.request.get("/api/v1/categories"); expect(response.headers()["cache-control"]).toContain("no-store"); expect(response.headers()["content-security-policy"]).toContain("nonce-");
});
test("categorías propias: reintento incierto, personalización, hijas, búsqueda y persistencia", async ({ page, context }) => {
  await enter(page); await openCategories(page);
  await expect(page.getByRole("button", { name: "Actualizar categorías", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Nueva categoría", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Nueva categoría", exact: true });
  await expect(dialog.locator(".field-hint")).toHaveCount(0);
  await expect(dialog.getByLabel("Buscar icono")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog.getByLabel("Nombre de la categoría")).toBeFocused();
  await dialog.getByLabel("Nombre de la categoría").fill("Vivienda"); await dialog.getByLabel("Descripción").fill("Gastos de la casa"); await dialog.getByRole("radio", { name: "Morado", exact: true }).check();
  const iconTrigger = dialog.getByRole("button", { name: /^Elegir icono:/ });
  await iconTrigger.focus(); await page.keyboard.press("Enter"); await expect(iconTrigger).toHaveAttribute("aria-expanded", "true"); await expect(dialog.getByLabel("Buscar icono")).toBeFocused();
  await dialog.getByLabel("Buscar icono").fill("sin coincidencias"); await expect(dialog.getByText("No hay iconos con ese nombre.")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); await expect(iconTrigger).toBeFocused(); await expect(iconTrigger).toHaveAttribute("aria-expanded", "false");
  await iconTrigger.click(); await dialog.getByLabel("Buscar icono").fill("Casa"); await expect(dialog.getByRole("radio", { name: "Etiqueta", exact: true })).toHaveCount(0); await dialog.getByRole("radio", { name: "Casa", exact: true }).click();
  await expect(iconTrigger).toHaveAccessibleName("Elegir icono: Casa"); await expect(iconTrigger).toBeFocused(); await expect(dialog.getByLabel("Buscar icono")).toHaveCount(0);
  await iconTrigger.click(); await expect(dialog.getByRole("radio", { name: "Casa", exact: true })).toBeChecked(); await dialog.getByRole("button", { name: "Cerrar selector de iconos" }).click();
  let first = true; const keys: string[] = [];
  await page.route("**/api/v1/categories", async (route) => {
    if (route.request().method() === "POST") { keys.push(route.request().postDataJSON().requestId); if (first) { first = false; expect((await route.fetch()).status()).toBe(200); await route.fulfill({ status: 503, json: { ok: false, message: "Confirmación interrumpida. Reintenta." } }); return; } }
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog.getByText("Confirmación interrumpida. Reintenta.")).toBeVisible();
  await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); await page.unroute("**/api/v1/categories");
  await expect(page.locator(".finzi-toast-message")).toHaveText("Categoría guardada."); await expect(page.locator(".category-feedback")).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar notificación" }).click(); await expect(page.locator(".finzi-toast")).toHaveCount(0);
  const stored = (await (await context.request.get("/api/v1/categories")).json()).categories; expect(stored).toHaveLength(1); expect(stored[0]).toMatchObject({ icon: "home", color: "purple" });
  await page.getByRole("button", { name: "Añadir subcategoría a Vivienda" }).click();
  await dialog.getByLabel("Nombre de la categoría").fill("Alquiler"); await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByLabel("Buscar categorías").fill("Alquiler"); await expect(page.getByRole("heading", { name: "Vivienda", exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Alquiler", exact: true })).toBeVisible();
  await page.getByLabel("Buscar categorías").fill(""); await page.reload(); await openCategories(page); await expect(page.getByRole("heading", { name: "Alquiler", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar categoría Alquiler", exact: true }).click(); const edit = page.getByRole("dialog", { name: "Editar categoría", exact: true });
  await expect(edit.getByLabel("Tipo", { exact: true })).toBeDisabled(); await expect(edit.getByLabel("Categoría principal", { exact: true })).toBeDisabled();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); expect(await edit.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    const tops = await edit.locator(".category-appearance > .field").evaluateAll((fields) => fields.map((field) => field.getBoundingClientRect().top)); expect(tops[0]).toBe(tops[1]);
    await edit.evaluate((element) => { element.scrollTop = 0; }); await page.screenshot({ path: `.impeccable/review/category-form-${width}.png`, fullPage: true });
    await edit.getByRole("button", { name: /^Elegir icono:/ }).click(); await expect(edit.getByLabel("Buscar icono")).toBeFocused(); expect(await edit.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await expect(edit.locator(".category-icon-panel")).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `.impeccable/review/category-icons-${width}.png`, fullPage: true }); await page.keyboard.press("Escape"); await expect(edit).toBeVisible();
  }
  await edit.getByRole("button", { name: "Cancelar", exact: true }).click();
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: width > 767 ? 1000 : 844 }); await page.evaluate(() => window.scrollTo(0, 0)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/categories-${width}.png`, fullPage: true }); }
});
test("archivo efectivo, restauración y duplicados de categorías", async ({ page }) => {
  await enter(page); await openCategories(page); await create(page, "Casa");
  await page.getByRole("button", { name: "Añadir subcategoría a Casa" }).click(); let dialog = page.getByRole("dialog"); await dialog.getByLabel("Nombre de la categoría").fill("Luz"); await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Editar categoría Casa", exact: true }).click(); dialog = page.getByRole("dialog"); await dialog.getByRole("checkbox", { name: /Categoría archivada/ }).check(); await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Padre archivado", { exact: true })).toBeVisible(); await page.getByRole("checkbox", { name: "Mostrar archivadas" }).uncheck(); await expect(page.getByRole("heading", { name: "Luz", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Mostrar archivadas" }).check(); await page.getByRole("button", { name: "Editar categoría Casa", exact: true }).click(); await dialog.getByRole("checkbox", { name: /Categoría archivada/ }).uncheck(); await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog).not.toBeVisible(); await expect(page.getByText("Padre archivado", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Nueva categoría", exact: true }).click(); await dialog.getByLabel("Nombre de la categoría").fill("casa"); await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog.getByText(/Ya existe ese nombre/)).toBeVisible(); await expect(dialog.getByLabel("Nombre de la categoría")).toHaveValue("casa");
});
test("plantillas propias no duplican ni reemplazan ediciones; carga fallida es recuperable", async ({ page, context }) => {
  await enter(page);
  await page.route("**/api/v1/categories", (route) => route.fulfill({ status: 503, json: { ok: false, message: "Indisponible" } })); await openCategoriesWithoutLoading(page);
  await expect(page.getByRole("heading", { name: "Tus categorías no están disponibles." })).toBeVisible(); await expect(page.getByText("Dale un lugar a cada gasto.")).toHaveCount(0); await page.unroute("**/api/v1/categories");
  await page.getByRole("button", { name: "Reintentar carga", exact: true }).click(); await expect(page.getByRole("button", { name: "Nueva categoría", exact: true })).toBeEnabled();
  await page.route("**/api/v1/categories", (route) => route.request().method() === "POST" ? route.fulfill({ status: 409, json: { ok: false, message: "El límite inicial es de 200 categorías, incluidas las archivadas." } }) : route.continue());
  await page.getByRole("button", { name: "Usar categorías iniciales" }).click(); await expect(page.getByText("El límite inicial es de 200 categorías, incluidas las archivadas.")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar notificación", exact: true }).click();
  await page.unroute("**/api/v1/categories");
  await page.getByRole("button", { name: "Usar categorías iniciales" }).click(); await expect(page.getByRole("button", { name: "Usar categorías iniciales" })).toHaveCount(0);
  await page.getByRole("button", { name: "Editar categoría Alimentación" }).click(); const dialog = page.getByRole("dialog"); await dialog.getByLabel("Nombre de la categoría").fill("Comidas"); await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog).not.toBeVisible();
  expect((await context.request.post("/api/v1/categories", { headers: { Origin: origin }, data: { action: "initialize" } })).status()).toBe(200);
  const data = await (await context.request.get("/api/v1/categories")).json(); expect(data.categories).toHaveLength(10); expect(data.categories.some((c: { name: string }) => c.name === "Comidas")).toBe(true);
  await page.getByRole("button", { name: "Ingresos", exact: false }).filter({ hasText: "Ingresos" }).click(); await expect(page.getByRole("heading", { name: "Salario", exact: true })).toBeVisible();
});
async function openCategoriesWithoutLoading(page: Page) { await navigate(page, "Categorías"); }
test("conflicto y sesión expirada conservan el borrador de categoría", async ({ page, context }) => {
  await enter(page); await openCategories(page); await create(page, "Casa");
  const original = (await (await context.request.get("/api/v1/categories")).json()).categories[0];
  await page.getByRole("button", { name: "Editar categoría Casa", exact: true }).click(); const dialog = page.getByRole("dialog"); await dialog.getByLabel("Nombre de la categoría").fill("Mi borrador");
  expect((await context.request.patch("/api/v1/categories", { headers: { Origin: origin }, data: { id: original.id, name: "Otra pestaña", description: "", color: "blue", icon: "tag", imagePath: null, archived: false, expectedVersion: original.version } })).status()).toBe(200);
  await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog.getByText(/Las categorías cambiaron/)).toBeVisible(); await expect(dialog.getByLabel("Nombre de la categoría")).toHaveValue("Mi borrador"); await expect(dialog.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Descartar el borrador y actualizar categorías" }).click(); await expect(dialog).not.toBeVisible(); await expect(page.getByRole("heading", { name: "Otra pestaña", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar categoría Otra pestaña" }).click(); await dialog.getByLabel("Nombre de la categoría").fill("Sin sesión"); await context.clearCookies(); await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog.getByText(/Tu sesión terminó/)).toBeVisible(); await expect(dialog.getByLabel("Nombre de la categoría")).toHaveValue("Sin sesión");
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
test("elimina categorías sin uso con confirmación y ofrece archivar si tienen subcategorías", async ({ page }) => {
  await enter(page); await openCategories(page); await create(page, "Temporal");
  await page.getByRole("button", { name: "Eliminar categoría Temporal", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Eliminar categoría", exact: true });
  await expect(dialog.getByText("Se eliminará de forma definitiva. Esta acción no se puede deshacer.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Eliminar categoría", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole("heading", { name: "Temporal", exact: true })).toHaveCount(0); await expect(page.locator(".finzi-toast-message")).toHaveText("Categoría eliminada.");
  await create(page, "Hogar"); await page.getByRole("button", { name: "Añadir subcategoría a Hogar" }).click();
  dialog = page.getByRole("dialog", { name: "Nueva categoría", exact: true }); await dialog.getByLabel("Nombre de la categoría").fill("Luz"); await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Eliminar categoría Hogar", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Eliminar categoría", exact: true });
  await expect(dialog.getByText(/Tiene 1 subcategoría/)).toBeVisible(); await dialog.getByRole("button", { name: "Archivar categoría", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.locator(".finzi-toast-message")).toHaveText("Categoría archivada.");
  await page.getByRole("checkbox", { name: "Mostrar archivadas" }).uncheck(); await expect(page.getByRole("heading", { name: "Luz", exact: true })).toHaveCount(0);
});
test("sube, previsualiza y quita una imagen de categoría con acceso privado", async ({ page, context, request }) => {
  await enter(page); await openCategories(page);
  await page.getByRole("button", { name: "Nueva categoría", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Nueva categoría", exact: true });
  await dialog.getByLabel("Nombre de la categoría").fill("Con imagen");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "casa.png", mimeType: "image/png", buffer: png });
  await expect(dialog.getByRole("button", { name: "Reemplazar imagen", exact: true })).toBeVisible(); await expect(dialog.getByRole("img", { name: "Imagen de la categoría" })).toBeVisible();
  await dialog.getByRole("button", { name: "Crear categoría", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const created = (await (await context.request.get("/api/v1/categories")).json()).categories.find((category: { name: string }) => category.name === "Con imagen");
  expect(created.image_path).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/);
  await expect(page.locator(".category-row", { hasText: "Con imagen" }).locator("img")).toBeVisible();
  const route = `/api/v1/categories/image?path=${encodeURIComponent(created.image_path)}`;
  const served = await context.request.get(route); expect(served.status()).toBe(200); expect(served.headers()["content-type"]).toContain("image/webp"); expect(served.headers()["cache-control"]).toContain("private");
  expect((await request.get(route)).status()).toBe(401);
  await page.getByRole("button", { name: "Editar categoría Con imagen", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Editar categoría", exact: true }); await edit.getByRole("button", { name: "Quitar", exact: true }).click(); await edit.getByRole("button", { name: "Guardar cambios" }).click(); await expect(edit).not.toBeVisible();
  expect((await (await context.request.get("/api/v1/categories")).json()).categories.find((category: { name: string }) => category.name === "Con imagen").image_path).toBeNull();
});
test("categorías reales accesibles en menú móvil sin simulación", async ({ page }) => {
  await enter(page); await expect(page.locator(".home-footer, .real-sample-link")).toHaveCount(0); await expect(page.getByRole("button", { name: /simulación|Explorar con datos/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); await openCategories(page); await expect(page.getByRole("heading", { name: "Dale un lugar a cada gasto." })).toBeVisible();
});
