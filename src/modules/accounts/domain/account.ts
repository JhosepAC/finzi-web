import { z } from "zod";
import { decimalMoney, openingMinor, type Currency } from "@/shared/money";

export const accountTypes = { cash: "Efectivo", bank: "Cuenta bancaria", savings: "Ahorros", custom: "Otra cuenta personal" } as const;
const name = z.string().trim().min(1, "Escribe un nombre para la cuenta.").max(100, "Usa como máximo 100 caracteres.");
const amount = z.string().refine((value) => { try { openingMinor(value); return true; } catch { return false; } }, "Usa hasta 16 dígitos y 2 decimales, sin separadores de miles.").transform((value) => decimalMoney(openingMinor(value)));
export const createAccountSchema = z.object({ requestId: z.uuid(), name, type: z.enum(["cash", "bank", "savings", "custom"]), currency: z.enum(["PEN", "USD"]), openingBalance: amount }).strict();
export const updateAccountSchema = z.object({ id: z.uuid(), name, openingBalance: amount, archived: z.boolean(), expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
export type Account = { id: string; name: string; type: keyof typeof accountTypes; currency_code: Currency; opening_minor: string; opening_at: string; status: "active" | "archived"; version: number };
