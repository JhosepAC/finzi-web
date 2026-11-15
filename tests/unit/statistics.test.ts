import { describe, expect, it } from "vitest";
import { chartScale, rateLabel, statisticsMetrics, statisticsQuerySchema, statisticsSeries, type Statistics } from "../../src/modules/reporting/domain/statistics";
describe("estadísticas exactas", () => {
  it("excedente confirmado: balance firmado, ahorro positivo y tasa sin división por cero", () => {
    expect(statisticsMetrics("20000", "6000")).toMatchObject({ net: 14000n, savings: 14000n, rate: 7000n });
    expect(statisticsMetrics("20000", "25000")).toMatchObject({ net: -5000n, savings: 0n, rate: 0n });
    expect(statisticsMetrics("0", "10")).toMatchObject({ net: -10n, savings: 0n, rate: null });
    expect(rateLabel(null)).toBe("No calculable"); expect(rateLabel(1234n)).toBe("12,34%"); expect(rateLabel(-500n)).toBe("−5,00%");
  });
  it("no pierde centavos grandes; porcentajes se redondean solo para presentación", () => {
    expect(statisticsMetrics("999999999999999999", "1").net).toBe(999999999999999998n);
    expect(statisticsMetrics("3", "2").rate).toBe(3333n);
  });
  it("escala SVG acotada con negativos y sin barras falsas de cero", () => {
    const s = chartScale([-999999999999999999n, 999999999999999999n]);
    expect(s.y(0n)).toBe(80); expect(s.y(s.low)).toBe(160); expect(s.y(s.high)).toBe(0); expect(chartScale([0n]).y(0n)).toBe(160);
  });
  it("balance acumula desde cero; ahorro de intervalos no se suma como ahorro total", () => {
    const report = { series: [{ income_minor: "100", expense_minor: "0", previous_income_minor: "0", previous_expense_minor: "50" }, { income_minor: "0", expense_minor: "200", previous_income_minor: "200", previous_expense_minor: "0" }] } as Statistics;
    expect(statisticsSeries(report).map((p) => p.cumulative)).toEqual([100n, -100n]); expect(statisticsSeries(report).map((p) => p.previousCumulative)).toEqual([-50n, 150n]); expect(statisticsMetrics("100", "200").savings).toBe(0n);
  });
  it.each(["week", "month", "three_months", "six_months", "year"])("valida %s sin fechas ajenas al preset", (period) => {
    expect(statisticsQuerySchema.safeParse({ period, currency: "PEN" }).success).toBe(true); expect(statisticsQuerySchema.safeParse({ period, from: "2026-01-01", to: "2026-01-02" }).success).toBe(false);
  });
  it.each([{ period: "quarter" }, { currency: "EUR" }, { user_id: crypto.randomUUID() }, { period: "custom", from: "2026-02-30", to: "2026-03-01" }, { period: "custom", from: "2026-03-02", to: "2026-03-01" }, { period: "custom", from: "1900-01-01", to: "2026-01-01" }, { period: "custom", from: "2026-01-01" }])("rechaza %j", (v) => expect(statisticsQuerySchema.safeParse(v).success).toBe(false));
});
