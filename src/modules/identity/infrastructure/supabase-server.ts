import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAuthEnvironment } from "./environment";

export async function createAuthClient() {
  const env = getAuthEnvironment();
  if (!env) return null;
  const jar = await cookies();
  return createServerClient(env.url, env.key, {
    cookieOptions: { httpOnly: true, secure: env.secure, sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try { for (const { name, value, options } of values) jar.set(name, value, options); }
        catch { /* Server Components cannot write; proxy performs the refresh first. */ }
      }
    }
  });
}
