import "server-only";
import { createAuthClient } from "./supabase-server";
import { supabaseGateway } from "./supabase-gateway";

export async function readIdentity() {
  const client = await createAuthClient();
  if (!client) return null;
  try { return await supabaseGateway(client).identity(); }
  catch { return null; }
}
export async function readRecoverySession() {
  const client = await createAuthClient();
  if (!client) return false;
  try {
    const gateway = supabaseGateway(client);
    return Boolean(await gateway.identity()) && await gateway.recoverySession();
  } catch { return false; }
}
