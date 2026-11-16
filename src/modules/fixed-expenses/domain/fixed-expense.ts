import { z } from "zod";
import { decimalMoney, openingMinor } from "@/shared/money";
import { catalogSchema } from "@/modules/classification/domain/category";
import { debtCatalogSchema } from "@/modules/debts/domain/debt";

export const frequencies = { weekly: "Semanal", fortnightly: "Quincenal (cada 15 días)", monthly: "Mensual", quarterly: "Trimestral", yearly: "Anual" } as const;
const frequency = z.enum(["weekly", "fortnightly", "monthly", "quarterly", "yearly"]);
export const fixedDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01" && v <= "2100-12-31";
});
const money = z.string().refine((v) => { try { return openingMinor(v) > 0n; } catch { return false; } }, "Escribe un importe positivo con hasta 2 decimales.").transform((v) => decimalMoney(openingMinor(v)));
const fields = { name: z.string().trim().min(1).max(100), note: z.string().trim().max(2000), categoryId: z.uuid(), currency: z.enum(["PEN", "USD"]), amount: money, dueDate: fixedDate, frequency };
const identity = { id: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646) };
export const fixedCommandSchema = z.union([
  z.object({ action: z.literal("create"), requestId: z.uuid(), ...fields }).strict(),
  z.object({ action: z.literal("update"), ...identity, ...fields }).strict(),
  z.object({ action: z.literal("delete"), ...identity }).strict(),
  z.object({ action: z.literal("pay"), ...identity, ordinal: z.number().int().min(0).max(5300), requestId: z.uuid(), mode: z.literal("new"), accountId: z.uuid(), occurredAt: z.string().datetime({ offset: true }).nullable() }).strict(),
  z.object({ action: z.literal("pay"), ...identity, ordinal: z.number().int().min(0).max(5300), requestId: z.uuid(), mode: z.literal("existing"), movementId: z.uuid() }).strict(),
]);
const minor = z.string().regex(/^\d+$/);
export const fixedExpenseSchema = z.object({ id: z.uuid(), name: z.string(), note: z.string(), category_id: z.uuid(), category_name: z.string(), currency_code: z.enum(["PEN", "USD"]), amount_minor: minor, anchor: fixedDate, frequency, version: z.number().int().positive(), deleted_at: z.string().nullable(), created_at: z.string(), next_due: z.string().nullable() });
export const occurrenceSchema = z.object({ expense_id: z.uuid(), ordinal: z.number().int(), due_date: fixedDate, amount_minor: minor, paid: z.boolean(), movement_id: z.uuid().nullable(), paid_at: z.string().nullable() });
export const fixedCatalogSchema = z.object({ today: fixedDate, month: fixedDate, expenses: z.array(fixedExpenseSchema).max(200), occurrences: z.array(occurrenceSchema), payments: z.array(z.object({ id: z.uuid(), expense_id: z.uuid(), ordinal: z.number().int(), due_date: fixedDate, amount_minor: minor, active: z.boolean(), movement_id: z.uuid(), paid_at: z.string(), recorded_at: z.string() })).max(2000), accounts: debtCatalogSchema.shape.accounts, categories: catalogSchema.shape.categories });
export type FixedExpense = z.infer<typeof fixedExpenseSchema>;
export type Occurrence = z.infer<typeof occurrenceSchema>;
export type FixedCatalog = z.infer<typeof fixedCatalogSchema>;
export function daysUntil(due: string, today: string) { return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000); }
export function dueLabel(due: string, today: string) { const n = daysUntil(due, today); return n < 0 ? `Vencido hace ${-n} ${n === -1 ? "día" : "días"}` : n === 0 ? "Vence hoy" : n === 1 ? "Vence mañana" : `Faltan ${n} días`; }
