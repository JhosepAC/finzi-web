import "server-only";

export type AuthEnvironment = { url: string; key: string; origin: string; secure: boolean };
export function getAuthEnvironment(): AuthEnvironment | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const origin = process.env.APP_URL;
  if (!url || !key || !origin) return null;
  // A configuration mistake must never turn the ordinary Auth client into an admin client.
  if (key.startsWith("sb_secret_")) return null;
  if (!key.startsWith("sb_publishable_")) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      if (payload.role !== "anon") return null;
    } catch { return null; }
  }
  try {
    const app = new URL(origin);
    const backend = new URL(url);
    const valid = (u: URL) => u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
    if (!valid(app) || !valid(backend) || app.origin !== origin || app.username || app.password) return null;
    return { url: backend.origin, key, origin: app.origin, secure: app.protocol === "https:" };
  } catch { return null; }
}
