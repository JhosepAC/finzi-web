import "server-only";
import { createUserScopedClient } from "@/modules/identity/server";
import type { Account } from "./domain/account";

export async function readOwnedAccounts(): Promise<Account[] | null> {
  const client = await createUserScopedClient();
  if (!client) throw new Error("Cuentas no disponibles.");
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user?.email_confirmed_at) return null;
  const { data, error } = await client.schema("api").rpc("read_accounts");
  if (error || !Array.isArray(data) || data.some((row) => !Number.isInteger(row.version) || !/^-?\d+$/.test(row.opening_minor))) throw new Error("Cuentas no disponibles.");
  return data as Account[];
}
