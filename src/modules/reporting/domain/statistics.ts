import { z } from "zod";
import { calendarDate } from "./overview";

export const statisticsPeriods = { week: "Esta semana", month: "Este mes", three_months: "Últimos 3 meses", six_months: "Últimos 6 meses", year: "Este año", custom: "Personalizado" } as const;
export type StatisticsPeriod = keyof typeof statisticsPeriods;
export type StatisticsSelection = { currency: "PEN" | "USD"; period: StatisticsPeriod; from: string; to: string };
export const statisticsQuerySchema = z.object({ currency: z.enum(["PEN", "USD"]).default("PEN"), period: z.enum(["week", "month", "three_months", "six_months", "year", "custom"]).default("month"), from: calendarDate.optional(), to: calendarDate.optional() }).strict()
  .refine((d) => d.period === "custom" ? !!d.from && !!d.to && d.from <= d.to && (new Date(d.to).getTime() - new Date(d.from).getTime()) / 86400000 <= 3659 : !d.from && !d.to);
const minor = z.string().regex(/^\d+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const child = z.object({ id: z.uuid(), name: z.string(), amount_minor: minor, previous_amount_minor: minor });
export const statisticsSchema = z.object({ currency_code: z.enum(["PEN", "USD"]), period: z.enum(["week", "month", "three_months", "six_months", "year", "custom"]), timezone: z.string(), as_of: z.string().datetime({ offset: true }), today: calendarDate,
  from: calendarDate, to: calendarDate, previous_from: date, previous_to: date, granularity: z.enum(["day", "week", "month"]), movement_count: z.number().int().min(0).max(10000), previous_movement_count: z.number().int().min(0).max(10000),
  income_minor: minor, expense_minor: minor, previous_income_minor: minor, previous_expense_minor: minor,
  series: z.array(z.object({ from: calendarDate, to: calendarDate, previous_from: date, previous_to: date, income_minor: minor, expense_minor: minor, previous_income_minor: minor, previous_expense_minor: minor })).max(122),
  categories: z.array(child.extend({ color: z.string(), children: z.array(child).max(200) })).max(200),
});
export type Statistics = z.infer<typeof statisticsSchema>;
export function statisticsMetrics(income: string, expense: string) {
  const net = BigInt(income) - BigInt(expense), savings = net > 0n ? net : 0n;
  return { income: BigInt(income), expense: BigInt(expense), net, savings, rate: BigInt(income) > 0n ? (savings * 10000n + BigInt(income) / 2n) / BigInt(income) : null };
}
export function rateLabel(hundredths: bigint | null) {
  if (hundredths === null) return "No calculable";
  const absolute = hundredths < 0n ? -hundredths : hundredths;
  return `${hundredths < 0n ? "−" : ""}${absolute / 100n},${String(absolute % 100n).padStart(2, "0")}%`;
}
export function statisticsSeries(report: Statistics) {
  let cumulative = 0n, previousCumulative = 0n;
  return report.series.map((point) => {
    const current = statisticsMetrics(point.income_minor, point.expense_minor), previous = statisticsMetrics(point.previous_income_minor, point.previous_expense_minor);
    cumulative += current.net; previousCumulative += previous.net;
    return { ...point, current, previous, cumulative, previousCumulative };
  });
}
// BigInt money becomes a bounded ratio only when mapping it into SVG geometry.
export function chartScale(values: bigint[], height = 160) {
  const low = values.reduce((a, b) => a < b ? a : b, 0n), high = values.reduce((a, b) => a > b ? a : b, 0n);
  return { low, high, y: (value: bigint) => high === low ? height : height - Number((value - low) * BigInt(height * 100) / (high - low)) / 100 };
}
