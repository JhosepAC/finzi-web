import { expect, it } from "vitest";
import { authOutcome, safeAuthHeaders } from "../../scripts/phase7-auth-outcome.mjs";
import { createClient } from "@supabase/supabase-js";
it("lets the product handle a normal rejected password login without stopping the pilot", () => {
  expect(authOutcome("POST", "/auth/v1/token", "?grant_type=password", 400, { code: "invalid_credentials" })).toEqual({ code: "invalid_credentials", terminal: false });
});
it("keeps refresh rejection, quotas, infrastructure and unknown failures terminal", () => {
  for (const [search, status, code] of [["?grant_type=refresh_token", 400, "refresh_token_not_found"], ["?grant_type=password", 429, "invalid_credentials"], ["?grant_type=password", 500, "invalid_credentials"], ["?grant_type=password", 400, "unknown"]] as const) expect(authOutcome("POST", "/auth/v1/token", search, status, { code }).terminal).toBe(true);
});
it("never persists arbitrary provider messages or secret values", () => {
  expect(authOutcome("PUT", "/auth/v1/user", "", 400, { code: "sensitive-value", message: "sensitive-message" })).toEqual({ code: "UNCLASSIFIED", terminal: true });
});
it("preserves the version header required by the installed SDK to classify a rejected login", async () => {
  const headers = safeAuthHeaders(new Headers({"content-type":"application/json", "x-supabase-api-version":"2024-01-01", "set-cookie":"private", "authorization":"private"}));
  expect(headers).not.toHaveProperty("set-cookie"); expect(headers).not.toHaveProperty("authorization");
  const client = createClient("https://offline.invalid", "synthetic", {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async()=>new Response(JSON.stringify({code:"invalid_credentials",msg:"Invalid credentials"}),{status:400,headers})}});
  expect((await client.auth.signInWithPassword({email:"synthetic@example.test",password:"synthetic"})).error?.code).toBe("invalid_credentials");
});
