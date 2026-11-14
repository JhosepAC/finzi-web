import "server-only";
import { createAuthClient } from "./supabase-server";
import type { FinancialProfile } from "../domain/profile";

export async function readProfile(): Promise<FinancialProfile | null> {
  const client = await createAuthClient();
  if (!client) throw new Error("Perfil no disponible.");
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || !identity.user?.email_confirmed_at) return null;
  const { data, error } = await client.schema("api").rpc("read_profile");
  if (error || !data || !Number.isInteger(data.version)) throw new Error("Perfil no disponible.");
  return data as FinancialProfile;
}
