import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { passwordProofTime } from "../domain/security";
export const proofCookie = "finzi-password-proof";
export const proofCookiePath = "/api/v1/security";
export async function securityStatus(client:SupabaseClient,token?:string) {
 const {data,error}=await client.auth.getUser();if(error || !data.user?.email_confirmed_at)return null;
 const claims=await client.auth.getClaims();if(claims.error || !claims.data?.claims.session_id)return null;
 const verified=claims.data.claims as Record<string,unknown>;
 const expires=typeof verified.exp === "number" ? new Date(verified.exp*1000).toISOString() : null;
 const proof=token ? await client.schema("api").rpc("read_reauth_proof",{p_token:token}) : null;
 if(proof?.error)throw new Error("No se pudo comprobar la reautenticación.");
 return {email:data.user.email!,verified:true,expiresAt:expires,passwordVerifiedAt:passwordProofTime(verified),reauthExpiresAt:proof?.data?.expires_at ?? null};
}
