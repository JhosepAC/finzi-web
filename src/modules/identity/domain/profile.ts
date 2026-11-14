import { z } from "zod";

export function validTimezone(value: string) {
  if (value !== "UTC" && !value.includes("/")) return false;
  try { new Intl.DateTimeFormat("es", { timeZone: value }).format(); return true; }
  catch { return false; }
}
export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Escribe cómo quieres que te llamemos.").max(100, "Usa como máximo 100 caracteres."),
  preferredCurrency: z.enum(["PEN", "USD"], { error: "Elige soles o dólares." }),
  timezone: z.string().max(100).refine(validTimezone, "Elige una zona horaria válida."),
  expectedVersion: z.number().int().min(0).max(2147483646)
}).strict();
export type ProfileInput = z.infer<typeof profileSchema>;
export type FinancialProfile = {
  user_id: string; display_name: string | null; locale: "es";
  preferred_currency: "PEN" | "USD" | null; timezone: string | null;
  onboarding_completed_at: string | null; version: number;
};
