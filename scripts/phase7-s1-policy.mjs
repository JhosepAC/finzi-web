export const upstream = "https://mkzclztzyqdmftesnwcw.supabase.co";
export const origin = "http://127.0.0.1:3030";
export function authorizeRequest(state, recipient, method, path, search, body) {
  if (state.stopped || Date.now() > state.deadline) throw new Error("PILOT_STOPPED");
  if (state.authRequests >= (state.authRequestLimit ?? 40)) throw new Error("AUTH_BUDGET");
  const params = new URLSearchParams(search);
  let allowed = false;
  if (method === "GET" && ["/auth/v1/user", "/auth/v1/.well-known/jwks.json"].includes(path)) allowed = true;
  if (method === "POST" && path === "/auth/v1/signup") {
    if (state.phase !== "ready_registration" || state.registrationReserved || body.email !== recipient) throw new Error("REGISTRATION_NOT_AUTHORIZED");
    state.registrationReserved = true; state.emailsReserved++; allowed = true;
  }
  if (method === "POST" && path === "/auth/v1/recover") {
    if (state.phase !== "ready_recovery" || state.recoveryReserved || body.email !== recipient) throw new Error("RECOVERY_NOT_AUTHORIZED");
    state.recoveryReserved = true; state.emailsReserved++; allowed = true;
  }
  if (method === "POST" && path === "/auth/v1/verify") {
    allowed = (body.type === "signup" && ["waiting_confirmation", "confirmation_review"].includes(state.phase))
      || (body.type === "recovery" && state.phase === "waiting_recovery");
  }
  if (method === "POST" && path === "/auth/v1/token") {
    allowed = params.get("grant_type") === "refresh_token"
      || (params.get("grant_type") === "password" && body.email === recipient && state.phase === "recovery_review");
  }
  if (method === "PUT" && path === "/auth/v1/user") {
    allowed = state.phase === "waiting_recovery" && state.recoveryVerified && typeof body.password === "string"
      && Object.keys(body).every(k => k === "password" || k === "nonce" || k === "gotrue_meta_security"
        || (["code_challenge", "code_challenge_method"].includes(k) && body[k] === null));
  }
  if (method === "POST" && path === "/auth/v1/logout") allowed = true;
  if (method === "POST" && ["/rest/v1/rpc/ensure_profile", "/rest/v1/rpc/read_profile"].includes(path)) {
    allowed = state.identityVerified && Object.keys(body).length === 0;
  }
  if (!allowed || state.emailsReserved > (state.emailLimit ?? 2)) throw new Error("UPSTREAM_OPERATION_DENIED");
  state.authRequests++;
}
export function wrapPilotFetch(nativeFetch, bridge, token) {
  return async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    if (url.origin !== upstream) {
      if (url.hostname.endsWith(".supabase.co")) throw new Error("WRONG_SUPABASE_PROJECT");
      return nativeFetch(input, init);
    }
    const headers = new Headers(req.headers); headers.set("x-finzi-s1-guard", token);
    return nativeFetch(bridge + "/upstream" + url.pathname + url.search, {
      method: req.method, headers, signal: req.signal, redirect: "error",
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
    });
  };
}
