import { z } from "zod";
import { decimalMoney, openingMinor } from "@/shared/money";

const money = z.string().refine((value) => { try { return openingMinor(value) > 0n; } catch { return false; } }, "Escribe un importe mayor que cero, hasta 16 dígitos y 2 decimales, sin separadores de miles.").transform((value) => decimalMoney(openingMinor(value)));
export const postMovementSchema = z.object({
  requestId: z.uuid(), kind: z.enum(["income", "expense"]), accountId: z.uuid("Elige una cuenta."), categoryId: z.uuid("Elige una categoría."),
  amount: money, description: z.string().trim().min(1, "Describe el movimiento.").max(200, "Usa como máximo 200 caracteres."),
  note: z.string().trim().max(2000, "Usa como máximo 2000 caracteres."), occurredAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export const postTransferSchema = postMovementSchema.omit({ kind: true, categoryId: true }).extend({ kind: z.literal("transfer"), destinationId: z.uuid("Elige una cuenta de destino.") }).strict().refine((d) => d.accountId !== d.destinationId, { message: "El destino debe ser otra cuenta.", path: ["destinationId"] });
export const createMovementSchema = z.discriminatedUnion("kind", [postMovementSchema, postTransferSchema]);
const replacementFields = { id: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646), reason: z.string().trim().min(1, "Escribe el motivo de la edición.").max(300, "Usa como máximo 300 caracteres.") };
export const replaceMovementSchema = z.discriminatedUnion("kind", [
  postMovementSchema.extend(replacementFields).strict(),
  postTransferSchema.safeExtend(replacementFields).strict(),
]);
export const movementDetailQuerySchema = z.object({ id: z.uuid() }).strict();
export type MovementKind = "income" | "expense" | "transfer";
export const voidMovementSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646), reason: z.string().trim().min(1, "Escribe el motivo de archivado.").max(300, "Usa como máximo 300 caracteres.") }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; });
export const movementQuerySchema = z.object({
  currency: z.enum(["PEN", "USD"]).default("PEN"), kind: z.enum(["income", "expense", "transfer"]).optional(),
  accountId: z.uuid().optional(), categoryId: z.uuid().optional(), from: date.optional(), to: date.optional(),
  query: z.string().trim().max(200).default(""), cursorAt: z.string().datetime({ offset: true }).optional(), cursorId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25), status: z.enum(["all", "posted", "void", "replaced"]).default("all"),
}).strict().refine((data) => Boolean(data.cursorAt) === Boolean(data.cursorId), "El cursor no es válido.")
  .refine((data) => !data.from || !data.to || data.from <= data.to, "La fecha inicial debe ser anterior a la final.");
export const movementSchema = z.object({ id: z.uuid(), kind: z.enum(["income", "expense", "transfer"]), description: z.string(), note: z.string(), amount_minor: z.string().regex(/^\d+$/),
  currency_code: z.enum(["PEN", "USD"]), account_id: z.uuid(), account_name: z.string(), destination_id: z.uuid().nullable(), destination_name: z.string().nullable(), category_id: z.uuid().nullable(), category_name: z.string().nullable(), parent_name: z.string().nullable(),
  occurred_at: z.string().datetime({ offset: true }), status: z.enum(["posted", "void"]), version: z.number().int().positive(), void_reason: z.string().nullable(), recorded_at: z.string().datetime({ offset: true }), voided_at: z.string().datetime({ offset: true }).nullable(),
  replaces_id: z.uuid().nullable(), replaced_by_id: z.uuid().nullable(), replacement_reason: z.string().nullable() });
export const movementPageSchema = z.object({ currency_code: z.enum(["PEN", "USD"]), total_count: z.number().int().min(0).max(10000), income_minor: z.string().regex(/^\d+$/), expense_minor: z.string().regex(/^\d+$/),
  has_more: z.boolean(), next_cursor: z.object({ at: z.string().datetime({ offset: true }), id: z.uuid() }).nullable(), movements: z.array(movementSchema).max(50) });
export type Movement = z.infer<typeof movementSchema>;
export type MovementPage = z.infer<typeof movementPageSchema>;
