import { expect, type Page, type BrowserContext } from "@playwright/test";
import { findMailLink } from "./mail";
export const localOrigin = "http://127.0.0.1:3000";
export async function financialSession(page: Page, context: BrowserContext, funded = true) {
  process.loadEnvFile(".env.local");
  if (!process.env.SUPABASE_URL || !["127.0.0.1", "localhost"].includes(new URL(process.env.SUPABASE_URL).hostname)) throw new Error("Solo Supabase local.");
  const email = `ledger-ui-${crypto.randomUUID()}@example.test`;
  await page.goto("/register"); await page.getByLabel("Correo electrónico", { exact: true }).fill(email); await page.getByLabel("Contraseña", { exact: true }).fill("una frase de prueba financiera 64"); await page.getByLabel("Confirmar contraseña", { exact: true }).fill("una frase de prueba financiera 64");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click(); await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto(await findMailLink(email, "signup")); await page.getByRole("button", { name: "Confirmar correo", exact: true }).click(); await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Tu nombre", { exact: true }).fill("Andrea"); await page.getByRole("button", { name: "Continuar", exact: true }).click(); await page.getByRole("button", { name: "Continuar", exact: true }).click(); await page.getByRole("button", { name: "Guardar y continuar" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  if (!funded) return null;
  const accounts = [];
  for (const currency of ["PEN", "USD"]) {
    const response = await context.request.post("/api/v1/accounts", { headers: { Origin: localOrigin }, data: { requestId: crypto.randomUUID(), name: currency === "PEN" ? "Efectivo" : "Dólares", type: "cash", currency, openingBalance: currency === "PEN" ? "100" : "0" } });
    expect(response.status()).toBe(200); accounts.push((await response.json()).account);
  }
  const response = await context.request.post("/api/v1/categories", { headers: { Origin: localOrigin }, data: { action: "initialize" } }); expect(response.status()).toBe(200);
  const categories = (await response.json()).categories;
  await page.reload();
  return { accounts, income: categories.find((c: { kind: string }) => c.kind === "income"), expense: categories.find((c: { kind: string }) => c.kind === "expense") };
}
export async function navigate(page: Page, name: string) {
  if (await page.getByRole("button", { name: "Abrir navegación", exact: true }).isVisible()) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
  await page.getByRole("navigation", { name: "Navegación principal" }).filter({ visible: true }).getByRole("button", { name, exact: true }).click();
}
