import { describe, expect, it } from "vitest";
import { createAccountSchema, updateAccountSchema } from "../../src/modules/accounts/domain/account";
import { decimalMoney, formatMoney, openingMinor } from "../../src/shared/money";
const input = { requestId: "10101010-1010-4010-8010-101010101010", name: "  Efectivo  ", type: "cash", currency: "PEN", openingBalance: "0012,30" };
describe("cuentas y dinero exacto", () => {
  it("normaliza nombre e importe sin perder centavos", () => { expect(createAccountSchema.parse(input)).toMatchObject({ name: "Efectivo", openingBalance: "12.30" }); });
  it.each(["cash", "bank", "savings", "custom"])("permite cuenta %s", (type) => { expect(createAccountSchema.safeParse({ ...input, type }).success).toBe(true); });
  it.each(["0", "-0.50", "9999999999999999.99", "-9999999999999999,99"])("acepta apertura %s", (openingBalance) => { expect(createAccountSchema.safeParse({ ...input, openingBalance }).success).toBe(true); });
  it.each(["NaN", "Infinity", "1e5", "1.001", "10000000000000000", "1,234.56", "", ".5"])("rechaza importe %s", (openingBalance) => { expect(createAccountSchema.safeParse({ ...input, openingBalance }).success).toBe(false); });
  it.each([{ user_id: "otro" }, { currency: "EUR" }, { type: "credit" }, { name: " " }, { name: "x".repeat(101) }, { openingAt: "2020-01-01" }])("rechaza campos/reglas inválidas %j", (change) => { expect(createAccountSchema.safeParse({ ...input, ...change }).success).toBe(false); });
  it("no acepta cambios de moneda o dueño en una edición", () => {
    const update = { id: input.requestId, name: "Cuenta", openingBalance: "0", archived: true, expectedVersion: 1 };
    expect(updateAccountSchema.safeParse(update).success).toBe(true);
    expect(updateAccountSchema.safeParse({ ...update, currency: "USD" }).success).toBe(false);
    expect(updateAccountSchema.safeParse({ ...update, expectedVersion: 0 }).success).toBe(false);
  });
  it("formatea valores fuera del entero seguro sin convertir dinero a Number", () => {
    expect(formatMoney(openingMinor("9999999999999999.99"), "PEN")).toBe("S/ 9,999,999,999,999,999.99");
    expect(decimalMoney(openingMinor("0.10") + openingMinor("0.20"))).toBe("0.30");
  });
});
