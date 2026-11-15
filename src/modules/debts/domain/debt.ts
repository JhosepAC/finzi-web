import { z } from "zod";
import { decimalMoney, openingMinor } from "@/shared/money";

export const debtCategories = { personal: "Personal", services: "Servicios", loans: "Préstamos", shopping: "Compras", education: "Educación", other: "Otra" } as const;
export const debtIcons = { wallet: "Cartera", home: "Hogar", book: "Estudios", cart: "Compras", heart: "Bienestar", briefcase: "Trabajo" } as const;
export const debtStates = { pending: "Pendiente", partial: "Pago parcial", paid: "Pagada" } as const;
const money = z.string().refine((v) => { try { return openingMinor(v) > 0n; } catch { return false; } }, "Escribe un importe mayor que cero, sin miles y con hasta 2 decimales.").transform((v) => decimalMoney(openingMinor(v)));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "1900-01-01"; }, "Elige una fecha válida, desde 1900.");
const fields = { name: z.string().trim().min(1).max(100), detail: z.string().trim().max(2000), creditor: z.string().trim().min(1).max(150), icon: z.enum(Object.keys(debtIcons) as [keyof typeof debtIcons, ...Array<keyof typeof debtIcons>]), category: z.enum(Object.keys(debtCategories) as [keyof typeof debtCategories, ...Array<keyof typeof debtCategories>]).nullable(), currency: z.enum(["PEN", "USD"]), amount: money, dueDate: date.nullable() };
const identity = { id: z.uuid() };
const version = { ...identity, expectedVersion: z.number().int().min(1).max(2147483646) };
export const debtCommandSchema = z.union([
  z.object({ action: z.literal("create"), requestId: z.uuid(), ...fields }).strict(),
  z.object({ action: z.literal("update"), ...version, ...fields }).strict(),
  z.object({ action: z.literal("delete"), ...version }).strict(),
  z.object({ action: z.literal("pay"), ...identity, requestId: z.uuid(), mode: z.literal("new"), accountId: z.uuid(), categoryId: z.uuid(), amount: money, occurredAt: z.string().datetime({ offset: true }).nullable(), note: z.string().trim().max(1000) }).strict(),
  z.object({ action: z.literal("pay"), ...identity, requestId: z.uuid(), mode: z.literal("existing"), movementId: z.uuid(), note: z.string().trim().max(1000) }).strict(),
  z.object({ action: z.literal("unlink"), ...identity, paymentId: z.uuid() }).strict(),
  z.object({ action: z.literal("voidpay"), ...identity, paymentId: z.uuid() }).strict(),
]);
export type DebtCommand = z.infer<typeof debtCommandSchema>;
const minor = z.string().regex(/^\d+$/);
export const debtSchema = z.object({ id: z.uuid(), name: z.string(), detail: z.string(), creditor: z.string(), icon: z.enum(["wallet", "home", "book", "cart", "heart", "briefcase"]), category: z.enum(["personal", "services", "loans", "shopping", "education", "other"]).nullable(), currency_code: z.enum(["PEN", "USD"]), amount_minor: minor, paid_minor: minor, due_date: date.nullable(), version: z.number().int().positive(), created_at: z.string(), deleted_at: z.string().nullable(), payments: z.array(z.object({ id: z.uuid(), origin_id: z.uuid(), effective_id: z.uuid(), amount_minor: minor, active: z.boolean(), created_expense: z.boolean(), note: z.string(), occurred_at: z.string(), description: z.string() })).max(2000) });
export const debtCatalogSchema = z.object({ today: date, debts: z.array(debtSchema).max(200), accounts: z.array(z.object({ id: z.uuid(), name: z.string(), type: z.enum(["cash", "bank", "savings", "custom"]), currency_code: z.enum(["PEN", "USD"]), opening_minor: z.string().regex(/^-?\d+$/), balance_minor: z.string().regex(/^-?\d+$/), can_edit_opening: z.boolean(), opening_at: z.string(), status: z.enum(["active", "archived"]), version: z.number().int().positive() })) });
export type Debt = z.infer<typeof debtSchema>;
export type DebtCatalog = z.infer<typeof debtCatalogSchema>;
export function remaining(debt: Debt) { return BigInt(debt.amount_minor) - BigInt(debt.paid_minor); }
export function debtState(debt: Debt): keyof typeof debtStates { return remaining(debt) === 0n ? "paid" : BigInt(debt.paid_minor) > 0n ? "partial" : "pending"; }
export function deadline(debt: Debt, today: string): "paid" | "none" | "overdue" | "upcoming" | "later" {
  if (remaining(debt) === 0n) return "paid";
  if (!debt.due_date) return "none";
  if (debt.due_date < today) return "overdue";
  return new Date(`${debt.due_date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime() <= 7 * 86400000 ? "upcoming" : "later";
}
