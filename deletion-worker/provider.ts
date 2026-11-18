import { uuid, type Provider } from "./protocol.ts";

export function provider(baseUrl: string, key: string, request: typeof fetch = fetch): Provider {
  const url = new URL(baseUrl);
  if (url.href !== "https://mkzclztzyqdmftesnwcw.supabase.co/" || !key || /[\r\n]/.test(key)) throw new Error("provider_configuration_invalid");
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  async function call(path: string, method: string, body?: unknown) {
    return request(new URL(path, url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(8000) });
  }
  async function authCall(id: string, method: string) {
    if (!uuid.test(id)) throw new Error("identity_invalid");
    const response = await call(`/auth/v1/admin/users/${id}`, method);
    if (response.status === 404) {
      const result = await response.json().catch(() => null);
      if (result?.code === "user_not_found" || result?.error_code === "user_not_found") return false;
    }
    if (!response.ok) throw new Error("auth_unavailable");
    return true;
  }
  return {
    async removeFiles(files) {
      if (!files.length || files.length > 50 || files.some(f => f.bucket !== files[0].bucket || !f.path || f.path.length > 1024)) throw new Error("inventory_invalid");
      const response = await call(`/storage/v1/object/${encodeURIComponent(files[0].bucket)}`, "DELETE", { prefixes: files.map(f => f.path) });
      if (!response.ok) throw new Error("storage_unavailable");
    },
    async removeIdentity(id) { await authCall(id, "DELETE"); },
    async identityAbsent(id) { return !await authCall(id, "GET"); },
  };
}
