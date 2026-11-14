import { z } from "zod";

export const emailSchema = z.string().trim().max(254, "El correo es demasiado largo.").email("Escribe un correo electrónico válido.").toLowerCase();
export const passwordSchema = z.string().min(12, "Usa al menos 12 caracteres.").max(128, "Usa como máximo 128 caracteres.");
const credentials = { email: emailSchema, password: z.string().min(1, "Escribe tu contraseña.").max(128, "La contraseña es demasiado larga.") };
const newPassword = z.object({ password: passwordSchema, confirmPassword: z.string() }).strict()
  .refine((input) => input.password === input.confirmPassword, { path: ["confirmPassword"], message: "Las contraseñas no coinciden." });

export const authSchemas = {
  register: z.object({ email: emailSchema, password: passwordSchema, confirmPassword: z.string() }).strict()
    .refine((input) => input.password === input.confirmPassword, { path: ["confirmPassword"], message: "Las contraseñas no coinciden." }),
  login: z.object(credentials).strict(),
  "forgot-password": z.object({ email: emailSchema }).strict(),
  resend: z.object({ email: emailSchema }).strict(),
  "reset-password": newPassword,
  verify: z.object({ tokenHash: z.string().regex(/^(?:pkce_)?[a-f0-9]{32,128}$/i, "El enlace no es válido."), type: z.enum(["signup", "recovery"]) }).strict(),
  logout: z.object({ scope: z.enum(["local", "global"]) }).strict()
};
export type AuthAction = keyof typeof authSchemas;
export type FieldErrors = Record<string, string>;
export type AuthIdentity = { id: string; email: string; verified: boolean };
export type AuthResult = { ok: boolean; message: string; code?: string; fieldErrors?: FieldErrors; redirectTo?: string };
export function isAuthAction(action: string): action is AuthAction {
  return Object.hasOwn(authSchemas, action);
}
export function getFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Supabase encodes verified email links as otp. Require recent email possession, not token issuance or a password-only login. */
export function hasRecentEmailProof(claims: Record<string, unknown> | undefined, now = Date.now()): boolean {
  if (!claims || typeof claims.session_id !== "string" || !Array.isArray(claims.amr)) return false;
  return claims.amr.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return false;
    const { method, timestamp } = entry as Record<string, unknown>;
    return (method === "recovery" || method === "otp") && typeof timestamp === "number" && timestamp <= now / 1000 && now / 1000 - timestamp <= 3600;
  });
}
