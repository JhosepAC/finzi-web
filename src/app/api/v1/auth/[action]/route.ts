import { NextRequest, NextResponse } from "next/server";
import { executeAuth } from "@/modules/identity/application/auth-service";
import { isAuthAction } from "@/modules/identity/domain/auth";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { createAuthClient } from "@/modules/identity/infrastructure/supabase-server";
import { proofCookie,proofCookiePath } from "@/modules/identity/infrastructure/security";
import { supabaseGateway } from "@/modules/identity/infrastructure/supabase-gateway";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const error = (status: number, code: string, message: string) => NextResponse.json({ ok: false, code, message }, { status, headers });

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!isAuthAction(action)) return error(404, "NOT_FOUND", "No se encontró esta operación.");
  const env = getAuthEnvironment();
  if (!env) return error(503, "AUTH_UNAVAILABLE", "El acceso no está disponible ahora. Inténtalo más tarde.");
  if (request.headers.get("origin") !== env.origin || request.headers.get("sec-fetch-site") === "cross-site") return error(403, "INVALID_ORIGIN", "La solicitud no pudo verificarse. Recarga la página.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return error(415, "INVALID_CONTENT_TYPE", "El formato de la solicitud no es válido.");
  const reader = request.body?.getReader();
  if (!reader) return error(400, "INVALID_BODY", "La solicitud está vacía.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return error(413, "BODY_TOO_LARGE", "La solicitud es demasiado grande."); }
      chunks.push(value);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const client = await createAuthClient();
    if (!client) return error(503, "AUTH_UNAVAILABLE", "El acceso no está disponible ahora.");
    const gateway = supabaseGateway(client);
    if (action === "logout" && !await gateway.identity()) return error(401, "UNAUTHENTICATED", "Tu sesión terminó. Inicia sesión de nuevo.");
    const response = await executeAuth(action, input, gateway);
    const result = NextResponse.json(response.body, { status: response.status, headers });
    if (action === "logout" && response.body.ok) result.cookies.set(proofCookie,"",{httpOnly:true,secure:env.secure,sameSite:"strict",path:proofCookiePath,maxAge:0});
    return result;
  } catch {
    return error(400, "INVALID_REQUEST", "No se pudo procesar la solicitud. Recarga la página e inténtalo de nuevo.");
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ action: string }> }) {
  if ((await context.params).action !== "session") return error(405, "METHOD_NOT_ALLOWED", "Esta operación requiere un envío de formulario.");
  const client = await createAuthClient();
  if (!client) return error(503, "AUTH_UNAVAILABLE", "El acceso no está disponible ahora.");
  try {
    const user = await supabaseGateway(client).identity();
    if (!user?.verified) return error(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
    return NextResponse.json({ ok: true, user }, { headers });
  } catch { return error(503, "AUTH_UNAVAILABLE", "No se pudo comprobar tu sesión."); }
}
