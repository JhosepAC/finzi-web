export function authOutcome(method, path, search, status, data) {
  const known = new Set(["invalid_credentials", "email_not_confirmed", "user_not_found", "refresh_token_not_found", "refresh_token_already_used", "otp_expired", "same_password"]);
  const code = known.has(data?.code) ? data.code : "UNCLASSIFIED";
  const expectedRejection = method === "POST" && path === "/auth/v1/token"
    && new URLSearchParams(search).get("grant_type") === "password" && [400, 401].includes(status)
    && ["invalid_credentials", "email_not_confirmed", "user_not_found"].includes(code);
  return { code, terminal: status >= 400 && !expectedRejection };
}
export function safeAuthHeaders(headers) {
  const result = { "content-type": headers.get("content-type") ?? "application/json", "cache-control": "no-store" };
  const version = headers.get("x-supabase-api-version");
  if (version && /^\d{4}-\d{2}-\d{2}$/.test(version)) result["x-supabase-api-version"] = version;
  return result;
}
