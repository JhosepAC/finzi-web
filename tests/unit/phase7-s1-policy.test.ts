import { describe, expect, it, vi } from "vitest";
import { authorizeRequest, wrapPilotFetch, upstream } from "../../scripts/phase7-s1-policy.mjs";
import { createClient } from "@supabase/supabase-js";
function state() { return { phase: "ready_registration", stopped: false, deadline: Date.now() + 100000, authRequests: 0, emailsReserved: 0, identityVerified: false }; }
describe("S1 zero-finance, one-recipient policy", () => {
  it("reserves registration once before the network and forbids another recipient", () => {
    const s = state(); expect(() => authorizeRequest(s, "allowed@example.test", "POST", "/auth/v1/signup", "", { email: "other@example.test" })).toThrow();
    authorizeRequest(s, "allowed@example.test", "POST", "/auth/v1/signup", "", { email: "allowed@example.test" });
    expect(s.emailsReserved).toBe(1);
    expect(() => authorizeRequest(s, "allowed@example.test", "POST", "/auth/v1/signup", "", { email: "allowed@example.test" })).toThrow();
  });
  it.each(["post_movement", "replace_movement", "create_account", "initialize_categories", "configure_profile"])("blocks %s", name => {
    expect(() => authorizeRequest(state(), "allowed@example.test", "POST", "/rest/v1/rpc/" + name, "", {})).toThrow();
  });
  it("blocks recovery until explicitly armed, then reserves exactly one message", () => {
    const s = state(); expect(() => authorizeRequest(s, "allowed@example.test", "POST", "/auth/v1/recover", "", { email: "allowed@example.test" })).toThrow();
    s.phase = "ready_recovery"; authorizeRequest(s, "allowed@example.test", "POST", "/auth/v1/recover", "", { email: "allowed@example.test" });
    expect(() => authorizeRequest(s, "allowed@example.test", "POST", "/auth/v1/recover", "", { email: "allowed@example.test" })).toThrow();
  });
  it("enforces deadline, stopped state, Auth budget and zero arbitrary profile targets", () => {
    for (const s of [{ ...state(), stopped: true }, { ...state(), deadline: 0 }, { ...state(), authRequests: 40 }]) expect(() => authorizeRequest(s, "allowed@example.test", "GET", "/auth/v1/user", "", {})).toThrow();
    expect(() => authorizeRequest({ ...state(), identityVerified: true }, "allowed@example.test", "POST", "/rest/v1/rpc/ensure_profile", "", { user_id: "other" })).toThrow();
  });
  it("routes every staging SDK fetch to the shared loopback counter, preserving method and signal", async () => {
    const target = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    await wrapPilotFetch(target, "http://127.0.0.1:3031", "synthetic")(upstream + "/auth/v1/user", { headers: { apikey: "public-synthetic" } });
    expect(target.mock.calls[0][0]).toBe("http://127.0.0.1:3031/upstream/auth/v1/user");
    expect(new Headers(target.mock.calls[0][1]?.headers).get("x-finzi-s1-guard")).toBe("synthetic");
    await expect(wrapPilotFetch(target, "http://127.0.0.1:3031", "synthetic")("https://other.supabase.co/auth/v1/user")).rejects.toThrow("WRONG_SUPABASE_PROJECT");
  });
  it("accepts the installed SDK's password-only update shape with null PKCE fields, entirely offline", async () => {
    const s = { ...state(), phase: "waiting_recovery", identityVerified: true, recoveryVerified: true };
    let observed: Record<string, unknown> | undefined;
    const user = { id: "synthetic-user", email: "allowed@example.test" };
    const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user };
    const storage = new Map([["offline-s1", JSON.stringify(session)]]);
    const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const req = new Request(input, init), url = new URL(req.url);
      if (req.method !== "PUT" || url.pathname !== "/auth/v1/user") throw new Error("Unexpected offline SDK operation");
      const data = await req.json(); observed = data;
      authorizeRequest(s, "allowed@example.test", req.method, url.pathname, url.search, data);
      return new Response(JSON.stringify(user), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createClient("https://offline.invalid", "synthetic-key", { auth: {
      storageKey: "offline-s1", autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
      storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: k => { storage.delete(k); } },
    }, global: { fetch: transport } });
    const result = await client.auth.updateUser({ password: "offline-synthetic-only-password" });
    expect(result.error).toBeNull(); expect(transport).toHaveBeenCalledTimes(1);
    expect(observed).toEqual({ password: "offline-synthetic-only-password", code_challenge: null, code_challenge_method: null });
    expect(s.authRequests).toBe(1);
  });
  it.each([
    { email: "other@example.test" }, { phone: "synthetic" }, { data: {} },
    { code_challenge: "non-null" }, { code_challenge_method: "s256" }, { unknown: null },
  ])("continues rejecting unrelated update attributes: %j", fields => {
    const s = { ...state(), phase: "waiting_recovery", identityVerified: true, recoveryVerified: true };
    expect(() => authorizeRequest(s, "allowed@example.test", "PUT", "/auth/v1/user", "", { password: "synthetic", ...fields })).toThrow();
    expect(s.authRequests).toBe(0);
  });
  it("requires verified recovery and remaining budget even with the compatible SDK shape", () => {
    const body = { password: "synthetic", code_challenge: null, code_challenge_method: null };
    for (const s of [{ ...state(), phase: "waiting_recovery", recoveryVerified: false }, { ...state(), phase: "waiting_recovery", recoveryVerified: true, authRequests: 40 }]) {
      expect(() => authorizeRequest(s, "allowed@example.test", "PUT", "/auth/v1/user", "", body)).toThrow();
    }
  });
  it("keeps the original limit unless a continuation explicitly supplies its bounded allowance", () => {
    expect(() => authorizeRequest({ ...state(), authRequests: 40 }, "allowed@example.test", "GET", "/auth/v1/user", "", {})).toThrow("AUTH_BUDGET");
    const continuation = { ...state(), authRequests: 36, authRequestLimit: 48 };
    for (let n = 0; n < 12; n++) authorizeRequest(continuation, "allowed@example.test", "GET", "/auth/v1/user", "", {});
    expect(() => authorizeRequest(continuation, "allowed@example.test", "GET", "/auth/v1/user", "", {})).toThrow("AUTH_BUDGET");
  });
});
