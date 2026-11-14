import { describe, expect, it } from "vitest";
import { balance, createSample, decimal, money, newSampleMovement, parseMinor, sampleCsv, summarize } from "../../src/modules/reporting/domain/demo";

describe("muestra financiera exacta y separada por moneda", () => {
  it.each([["0.10", 10n], ["12,34", 1234n], ["002.05", 205n], ["999999999.99", 99999999999n]] as const)("normaliza %s sin redondear", (value, expected) => { expect(parseMinor(value)).toBe(expected); });
  it.each(["0", "-1", "NaN", "Infinity", "1e3", "12.345", "1,234.56", "1000000000", "", ".5"])("rechaza importe inválido %s", (value) => { expect(() => parseMinor(value)).toThrow(); });
  it("permite apertura negativa o cero sin convertirla en ingreso", () => {
    expect(parseMinor("-0,50", true)).toBe(-50n); expect(parseMinor("0", true)).toBe(0n);
    expect(decimal(parseMinor("0.1") + parseMinor("0.2"))).toBe("0.30");
    expect(money(900719925474099399n, "PEN")).toBe("S/ 9,007,199,254,740,993.99");
  });
  it("reconstruye los saldos y no incluye aperturas en ingresos del período", () => {
    const sample = createSample(); const summary = summarize(sample.accounts, sample.movements, "PEN", "2026-11");
    expect(summary.total).toBe(2022000n); expect(summary.income).toBe(480000n); expect(summary.expense).toBe(263500n); expect(summary.net).toBe(216500n);
    expect(balance(sample.accounts[2], sample.movements)).toBe(8000n);
    expect(summary.categories.reduce((sum, c) => sum + c.amount, 0n)).toBe(summary.expense);
    expect(summary.categories.reduce((sum, c) => sum + c.share, 0)).toBe(100);
    const october = summarize(sample.accounts, sample.movements, "PEN", "2026-10");
    expect(october.total).toBe(summary.total); expect(october.income).toBe(475000n); expect(october.expense).toBe(261300n);
    const usd = summarize(sample.accounts, sample.movements, "USD", "2026-11");
    expect(usd.total).toBe(265000n); expect(usd.income).toBe(32000n); expect(usd.expense).toBe(4500n); expect(usd.accounts).toHaveLength(1);
  });
  it("editar la apertura modifica saldo pero no el flujo", () => {
    const sample = createSample(); sample.accounts[0].openingMinor = "500000";
    const summary = summarize(sample.accounts, sample.movements, "PEN", "2026-11");
    expect(summary.total).toBe(2042000n); expect(summary.income).toBe(480000n); expect(summary.expense).toBe(263500n);
  });
  it("añadir gasto de prueba recalcula todo y una muestra nueva no lo conserva", () => {
    const sample = createSample();
    const movement = newSampleMovement({ accountId: "bank", kind: "expense", amount: "15.90", description: " Café de prueba ", category: "Ocio", date: "2026-11-14" }, sample.accounts);
    sample.movements.push(movement);
    const summary = summarize(sample.accounts, sample.movements, "PEN", "2026-11");
    expect(summary.total).toBe(2020410n); expect(summary.expense).toBe(265090n); expect(movement.description).toBe("Café de prueba");
    expect(createSample().movements.some((m) => m.id === movement.id)).toBe(false);
  });
  it.each([{ date: "2026-06-31" }, { date: "2026-11-15" }, { date: "2025-01-01" }, { accountId: "other" }, { category: "Sueldo" }, { description: " " }])("valida la operación de muestra %j", (change) => {
    expect(() => newSampleMovement({ accountId: "bank", kind: "expense", amount: "1.00", description: "Prueba", category: "Ocio", date: "2026-11-14", ...change }, createSample().accounts)).toThrow();
  });
  it("CSV etiqueta muestra, conserva exactitud y neutraliza fórmulas", () => {
    const sample = createSample();
    const movement = newSampleMovement({ accountId: "bank", kind: "expense", amount: "12.34", description: '=HYPERLINK("x")', category: "Ocio", date: "2026-11-14" }, sample.accounts);
    const csv = sampleCsv(sample.accounts, [movement]);
    expect(csv).toContain("Datos simulados Finzi"); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('"12.34"'); expect(csv).toContain('"PEN"');
  });
});
