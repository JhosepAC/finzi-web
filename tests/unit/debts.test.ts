import { describe, expect, it } from "vitest";
import { debtCommandSchema, debtSchema, debtState, deadline, remaining } from "../../src/modules/debts/domain/debt";
const base = { name: "Estudios", detail: "", creditor: "Instituto", icon: "book", category: "education", currency: "PEN", amount: "10.10", dueDate: "2026-11-16" };
const create = { action: "create", requestId: crypto.randomUUID(), ...base };
const debt = debtSchema.parse({ id: crypto.randomUUID(), ...base, currency_code: "PEN", amount_minor: "1010", paid_minor: "0", due_date: "2026-11-16", version: 1, created_at: "2026-11-15T00:00:00Z", deleted_at: null, payments: [] });
describe("contrato de deudas exacto y estados derivados", () => {
  it("normaliza centavos sin float, incluso el máximo admitido", () => {
    expect(debtCommandSchema.parse({ ...create, amount: "9999999999999999,99" })).toMatchObject({ amount: "9999999999999999.99" });
    expect(remaining({ ...debt, amount_minor: "999999999999999999", paid_minor: "1" })).toBe(999999999999999998n);
  });
  it.each(["0", "-1", "0.001", "1e2", "NaN", "Infinity", "1,000.00", "10000000000000000"])("rechaza importe %s", (amount) => expect(debtCommandSchema.safeParse({ ...create, amount }).success).toBe(false));
  it("requiere acreedor, rechaza estado manual, identidad y campos extra", () => {
    for (const extra of [{ creditor: " " }, { state: "paid" }, { user_id: crypto.randomUUID() }, { currency: "EUR" }]) expect(debtCommandSchema.safeParse({ ...create, ...extra }).success).toBe(false);
  });
  it.each(["2026-02-30", "1899-01-01", "infinity"])("rechaza fecha %s", (dueDate) => expect(debtCommandSchema.safeParse({ ...create, dueDate }).success).toBe(false));
  it("acepta fecha/categoría ausentes y dos modos de pago sin mezclarlos", () => {
    expect(debtCommandSchema.safeParse({ ...create, dueDate: null, category: null }).success).toBe(true);
    const payment = { action: "pay", id: debt.id, requestId: crypto.randomUUID(), mode: "existing", movementId: crypto.randomUUID(), note: "" };
    expect(debtCommandSchema.safeParse(payment).success).toBe(true); expect(debtCommandSchema.safeParse({ ...payment, amount: "1" }).success).toBe(false);
    expect(debtCommandSchema.safeParse({ action: "pay", id: debt.id, requestId: crypto.randomUUID(), mode: "new", accountId: crypto.randomUUID(), categoryId: crypto.randomUUID(), amount: "0.10", occurredAt: null, note: "" }).success).toBe(true);
  });
  it("deriva pendientes/parciales/pagadas y fechas inclusivas de hoy a 7 días", () => {
    expect(debtState(debt)).toBe("pending"); expect(debtState({ ...debt, paid_minor: "10" })).toBe("partial"); expect(debtState({ ...debt, paid_minor: "1010" })).toBe("paid");
    expect(deadline(debt, "2026-11-17")).toBe("overdue"); expect(deadline(debt, "2026-11-16")).toBe("upcoming"); expect(deadline(debt, "2026-11-09")).toBe("upcoming"); expect(deadline(debt, "2026-11-08")).toBe("later"); expect(deadline({ ...debt, due_date: null }, "2026-11-17")).toBe("none"); expect(deadline({ ...debt, paid_minor: "1010" }, "2026-11-17")).toBe("paid");
  });
});
