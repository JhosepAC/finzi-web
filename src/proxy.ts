import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";

export async function proxy(request: NextRequest) {
  const env = getAuthEnvironment();
  const development = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = [
    "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  function next() {
    requestHeaders.set("cookie", request.cookies.toString());
    const result = NextResponse.next({ request: { headers: requestHeaders } });
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("Content-Security-Policy", policy);
    return result;
  }
  let response = next();
  if (!env) return response;
  const client = createServerClient(env.url, env.key, {
    cookieOptions: { httpOnly: true, secure: env.secure, sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        // Auth can flush verifier/session cookies in several batches. Preserve earlier
        // Set-Cookie headers when rebuilding the forwarded request after each batch.
        const previous = response.cookies.getAll();
        for (const { name, value, options } of values) {
          if (options.maxAge === 0) request.cookies.delete(name);
          else request.cookies.set(name, value);
        }
        response = next();
        for (const cookie of previous) response.cookies.set(cookie);
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      }
    }
  });
  try { await client.auth.getUser(); } catch { /* Pages and endpoints independently fail closed. */ }
  return response;
}
export const config = { matcher: ["/", "/login", "/register", "/forgot-password", "/verify-email", "/auth/confirm", "/session", "/reset-password", "/api/v1/auth/:path*", "/api/v1/profile", "/api/v1/security/:path*", "/profile", "/security", "/data", "/deletion", "/api/v1/data/:path*", "/api/v1/overview", "/api/v1/accounts", "/api/v1/categories", "/api/v1/movements", "/onboarding", "/dashboard"] };
