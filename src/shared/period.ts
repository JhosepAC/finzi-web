import { localDateTime } from "./time";
export type Period = "day" | "week" | "month" | "quarter" | "year" | "custom";
export const periodLabels: Record<Period, string> = { day: "Día", week: "Semana", month: "Mes", quarter: "Trimestre", year: "Año", custom: "Personalizado" };
export function shiftDay(value: string, days: number): string { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function periodRange(period: Exclude<Period, "custom">, anchor: string): { from: string; to: string } {
  const d = new Date(`${anchor}T12:00:00Z`), year = d.getUTCFullYear(), month = d.getUTCMonth();
  let from = anchor, to = anchor;
  if (period === "week") { from = shiftDay(anchor, -((d.getUTCDay() + 6) % 7)); to = shiftDay(from, 6); }
  if (period === "month" || period === "quarter" || period === "year") {
    const start = period === "year" ? 0 : period === "quarter" ? Math.floor(month / 3) * 3 : month;
    from = new Date(Date.UTC(year, start, 1, 12)).toISOString().slice(0, 10);
    to = new Date(Date.UTC(year, start + (period === "year" ? 12 : period === "quarter" ? 3 : 1), 0, 12)).toISOString().slice(0, 10);
  }
  return { from, to };
}
export function todayInZone(now: string, timezone: string) { return localDateTime(now, timezone).slice(0, 10); }
export function dateLabel(date: string) { return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
