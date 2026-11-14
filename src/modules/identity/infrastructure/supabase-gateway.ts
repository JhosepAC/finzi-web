import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthGateway, GatewayResult } from "../application/auth-service";
import { hasRecentEmailProof } from "../domain/auth";
import { getAuthEnvironment } from "./environment";

function result(error: { code?: string } | null): GatewayResult { return { error: error ? (error.code ?? "provider_error") : null }; }
export function supabaseGateway(client: SupabaseClient): AuthGateway {
  return {
    async register(email, password) {
      const response = await client.auth.signUp({ email, password });
      // Registration always waits for email confirmation, even if an external project was misconfigured.
      if (response.data.session) {
        await client.auth.signOut({ scope: "local" });
        return { error: "email_confirmation_disabled" };
      }
      return result(response.error);
    },
    async login(email, password) { return result((await client.auth.signInWithPassword({ email, password })).error); },
    async recover(email) { return result((await client.auth.resetPasswordForEmail(email, { redirectTo: `${getAuthEnvironment()!.origin}/auth/confirm` })).error); },
    async resend(email) { return result((await client.auth.resend({ type: "signup", email })).error); },
    async verify(tokenHash, type) { return result((await client.auth.verifyOtp({ token_hash: tokenHash, type })).error); },
    async identity() {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user?.email) return null;
      return { id: data.user.id, email: data.user.email, verified: Boolean(data.user.email_confirmed_at) };
    },
    async recoverySession() {
      const { data, error } = await client.auth.getClaims();
      return !error && hasRecentEmailProof(data?.claims as Record<string, unknown> | undefined);
    },
    async updatePassword(password) { return result((await client.auth.updateUser({ password })).error); },
    async logout(scope) { return result((await client.auth.signOut({ scope })).error); },
    async ensureProfile() { return result((await client.schema("api").rpc("ensure_profile")).error); }
  };
}
