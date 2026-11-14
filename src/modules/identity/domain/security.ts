import { z } from "zod";
import { passwordSchema } from "./auth";
export const reauthSchema = z.object({ password: z.string().min(1,"Escribe tu contraseña actual.").max(128,"Usa como máximo 128 caracteres.") }).strict();
export const changePasswordSchema = z.object({ password: passwordSchema,confirmPassword: z.string().max(128) }).strict().refine((d) => d.password === d.confirmPassword,{path:["confirmPassword"],message:"Las contraseñas no coinciden."});
export function passwordProofTime(claims: Record<string,unknown> | undefined): string | null {
 if (!claims || !Array.isArray(claims.amr)) return null;
 const entries=claims.amr.filter((a):a is {method:string;timestamp:number}=>typeof a === "object" && a !== null && a.method === "password" && typeof a.timestamp === "number" && Number.isFinite(a.timestamp) && a.timestamp>0);
 const timestamp=Math.max(...entries.map(a=>a.timestamp));
 return Number.isFinite(timestamp) && timestamp<253402300800 ? new Date(timestamp*1000).toISOString() : null;
}
