import { NextRequest, NextResponse } from "next/server";
import { profileSchema } from "@/modules/identity/domain/profile";
import { getFieldErrors } from "@/modules/identity/domain/auth";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { createAuthClient } from "@/modules/identity/infrastructure/supabase-server";
import { readProfile } from "@/modules/identity/infrastructure/profile";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function reply(status: number, body: Record<string, unknown>) { return NextResponse.json(body, { status, headers }); }
export async function GET() {
  try {
    const profile = await readProfile();
    return profile ? reply(200, { ok: true, profile }) : reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
  } catch { return reply(503, { ok: false, message: "No pudimos cargar tu perfil. Inténtalo de nuevo." }); }
}
export async function POST(request: NextRequest) {
  const env = getAuthEnvironment();
  if (!env) return reply(503, { ok: false, message: "El perfil no está disponible ahora." });
  if (request.headers.get("origin") !== env.origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { ok: false, message: "Recarga la página para continuar." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, { ok: false, message: "El formato no es válido." });
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { ok: false, message: "La solicitud está vacía." });
  const chunks: Uint8Array[] = []; let bytes = 0; let input: unknown;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return reply(413, { ok: false, message: "La solicitud es demasiado grande." }); }
      chunks.push(value);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return reply(400, { ok: false, message: "La solicitud no es válida." }); }
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const client = await createAuthClient();
    if (!client) return reply(503, { ok: false, message: "El perfil no está disponible ahora." });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user?.email_confirmed_at) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const { displayName, preferredCurrency, timezone, expectedVersion } = parsed.data;
    const { data, error } = await client.schema("api").rpc("configure_profile", { p_display_name: displayName, p_currency: preferredCurrency, p_timezone: timezone, p_expected_version: expectedVersion });
    if (error?.code === "40001") return reply(409, { ok: false, code: "PROFILE_CONFLICT", message: "Tu perfil cambió en otra pestaña. Revisa la versión guardada antes de continuar." });
    if (error?.code === "23514") return reply(422, { ok: false, message: "Revisa tus preferencias antes de continuar.", fieldErrors: { timezone: "La base de datos no admite esta zona horaria. Elige otra." } });
    if (error) return reply(503, { ok: false, message: "No pudimos guardar tu perfil. Tus cambios siguen aquí; puedes reintentar." });
    return reply(200, { ok: true, profile: data, redirectTo: "/dashboard" });
  } catch { return reply(503, { ok: false, message: "No pudimos conectar. Tus cambios siguen aquí; vuelve a intentarlo." }); }
}
