import { describe, expect, it } from "vitest";
import { profileSchema } from "../../src/modules/identity/domain/profile";

const valid = { displayName: "  Sol  ", preferredCurrency: "PEN", timezone: "America/Lima", expectedVersion: 0 };
describe("contrato del perfil financiero", () => {
  it("normaliza el nombre sin exigir identidad legal", () => { expect(profileSchema.parse(valid).displayName).toBe("Sol"); });
  it.each(["PEN", "USD"])("permite la moneda %s sin conversión", (preferredCurrency) => { expect(profileSchema.safeParse({ ...valid, preferredCurrency }).success).toBe(true); });
  it.each(["America/Lima", "America/Bogota", "Asia/Tokyo", "UTC"])("valida zona %s", (timezone) => { expect(profileSchema.safeParse({ ...valid, timezone }).success).toBe(true); });
  it.each([
    { displayName: "  " }, { displayName: "x".repeat(101) }, { preferredCurrency: "EUR" },
    { timezone: "Mars/Olympus" }, { timezone: "PST" }, { timezone: "" },
    { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: "0" }, { user_id: "otro" }, { locale: "en" }
  ])("rechaza un perfil inválido o campos de dueño/idioma inyectados: %j", (change) => { expect(profileSchema.safeParse({ ...valid, ...change }).success).toBe(false); });
});
