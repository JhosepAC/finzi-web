import { z } from "zod";
import { movementSchema } from "@/modules/transactions/domain/movement";
import type { Currency } from "@/shared/money";
import type { Period } from "@/shared/period";
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const d = new Date(`${value}T12:00:00Z`); return value >= "1900-01-01" && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value; });
export const overviewQuerySchema = z.object({ currency: z.enum(["PEN", "USD"]).default("PEN"), period: z.enum(["day", "week", "month", "quarter", "year", "custom"]).default("month"), anchor: calendarDate.optional(), from: calendarDate.optional(), to: calendarDate.optional(), accountId: z.uuid().optional() }).strict()
  .refine((d) => d.period === "custom" ? Boolean(d.from && d.to && !d.anchor && d.from <= d.to && (new Date(d.to).getTime() - new Date(d.from).getTime()) / 86400000 <= 3659) : !d.from && !d.to, "Elige fechas válidas, hasta 3660 días; solo Personalizado acepta un intervalo.");
const minor = z.string().regex(/^\d+$/), signed = z.string().regex(/^-?\d+$/);
export const overviewSchema = z.object({ currency_code: z.enum(["PEN", "USD"]), timezone: z.string(), as_of: z.string().datetime({ offset: true }), account_id: z.uuid().nullable(), from: calendarDate, to: calendarDate, previous_from: z.string(), previous_to: z.string(), partial: z.boolean(), granularity: z.enum(["day", "month"]), balance_minor: signed, movement_count: z.number().int().min(0).max(10000), income_minor: minor, expense_minor: minor, previous_income_minor: minor, previous_expense_minor: minor,
  accounts: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.enum(["active", "archived"]), balance_minor: signed })).max(100),
  series: z.array(z.object({ from: calendarDate, to: calendarDate, balance_minor: signed.nullable(), income_minor: minor, expense_minor: minor })).max(122),
  categories: z.array(z.object({ kind: z.enum(["income", "expense"]), category_id: z.uuid(), name: z.string(), color: z.string(), amount_minor: minor, children: z.array(z.object({ category_id: z.uuid(), name: z.string(), amount_minor: minor })).max(200) })).max(200), recent: z.array(movementSchema).max(5) });
export type Overview = z.infer<typeof overviewSchema>;
export type OverviewSelection = { currency: Currency; period: Period; anchor: string; from: string; to: string; accountId: string };
// Ratios are presentation only: money stays bigint, and division cannot overflow a Number.
export function shareTenths(amount: bigint, total: bigint) { return total > 0n ? Number((amount * 1000n + total / 2n) / total) : 0; }
export function comparison(current: bigint, previous: bigint) {
  const difference = current - previous;
  if (previous === 0n) return { difference, percent: null };
  const tenths = (difference * 1000n) / (previous < 0n ? -previous : previous);
  return { difference, percent: `${tenths > 0n ? "+" : tenths < 0n ? "−" : ""}${tenths < 0n ? -tenths / 10n : tenths / 10n},${tenths < 0n ? -tenths % 10n : tenths % 10n}%` };
}
