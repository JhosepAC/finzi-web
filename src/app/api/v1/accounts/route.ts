import { NextRequest, NextResponse } from "next/server";
import { createAccountSchema, deleteAccountSchema, updateAccountSchema } from "@/modules/accounts/domain/account";
import { readOwnedAccounts } from "@/modules/accounts/server";
import { createUserScopedClient } from "@/modules/identity/server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { getFieldErrors } from "@/modules/identity/domain/auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers });
export async function GET() {
  try { const accounts = await readOwnedAccounts(); return accounts ? reply(200, { ok: true, accounts }) : reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." }); }
  catch { return reply(503, { ok: false, message: "No pudimos cargar tus cuentas. Inténtalo de nuevo." }); }
}
function rejected(request: NextRequest) {
  const env = getAuthEnvironment();
  if (!env) return reply(503, { ok: false, message: "Las cuentas no están disponibles ahora." });
  if (request.headers.get("origin") !== env.origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { ok: false, message: "Recarga la página para continuar." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, { ok: false, message: "El formato no es válido." });
  return null;
}
async function jsonBody(request: NextRequest): Promise<{ input: unknown } | { response: NextResponse }> {
  const reader = request.body?.getReader();
  if (!reader) return { response: reply(400, { ok: false, message: "La solicitud está vacía." }) };
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return { response: reply(413, { ok: false, message: "La solicitud es demasiado grande." }) }; }
      chunks.push(value);
    }
    return { input: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch { return { response: reply(400, { ok: false, message: "La solicitud no es válida." }) }; }
}
function mapped(error: { code?: string } | null) {
  if (!error) return null;
  if (error.code === "55000") return reply(409, { ok: false, code: "OPENING_LOCKED", message: "Esta cuenta ya tiene historial. El saldo inicial se conserva; actualiza las cuentas antes de continuar." });
  if (error.code === "40001") return reply(409, { ok: false, code: "CONFLICT", message: "La cuenta cambió o este intento ya se utilizó. Actualiza las cuentas antes de continuar." });
  if (error.code === "P0002") return reply(404, { ok: false, message: "No se encontró la cuenta." });
  if (error.code === "42501") return reply(403, { ok: false, message: "Completa tu perfil para registrar cuentas." });
  if (error.code === "54000") return reply(409, { ok: false, code: "ACCOUNT_LIMIT", message: "Alcanzaste el límite inicial de 100 cuentas, incluidas las archivadas." });
  if (error.code === "23514") return reply(422, { ok: false, message: "No pudimos validar la cuenta. Revisa el nombre y el importe." });
  return null;
}
async function write(request: NextRequest, updating: boolean) {
  const blocked = rejected(request); if (blocked) return blocked;
  const read = await jsonBody(request); if ("response" in read) return read.response;
  const parsed = (updating ? updateAccountSchema : createAccountSchema).safeParse(read.input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const client = await createUserScopedClient();
    if (!client) return reply(503, { ok: false, message: "Las cuentas no están disponibles ahora." });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user?.email_confirmed_at) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const d = parsed.data;
    const result = "id" in d
      ? await client.schema("api").rpc("update_account", { p_id: d.id, p_name: d.name, p_opening: d.openingBalance, p_archived: d.archived, p_expected_version: d.expectedVersion })
      : await client.schema("api").rpc("create_account", { p_request_id: d.requestId, p_name: d.name, p_type: d.type, p_currency: d.currency, p_opening: d.openingBalance });
    const failure = mapped(result.error);
    if (failure) return failure;
    if (result.error || !result.data) return reply(503, { ok: false, message: "No pudimos confirmar el guardado. Conserva este formulario y reintenta la misma operación." });
    return reply(200, { ok: true, account: result.data });
  } catch { return reply(503, { ok: false, message: "No pudimos conectar. Tus cambios siguen aquí; puedes reintentar." }); }
}
export async function POST(request: NextRequest) { return write(request, false); }
export async function PATCH(request: NextRequest) { return write(request, true); }
export async function DELETE(request: NextRequest) {
  const blocked = rejected(request); if (blocked) return blocked;
  const read = await jsonBody(request); if ("response" in read) return read.response;
  const parsed = deleteAccountSchema.safeParse(read.input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const client = await createUserScopedClient();
    if (!client) return reply(503, { ok: false, message: "Las cuentas no están disponibles ahora." });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user?.email_confirmed_at) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const result = await client.schema("api").rpc("delete_account", { p_id: parsed.data.id, p_expected_version: parsed.data.expectedVersion });
    const failure = mapped(result.error);
    if (failure) return failure;
    if (result.error || !result.data) return reply(503, { ok: false, message: "No pudimos confirmar la eliminación. Actualiza las cuentas y reintenta." });
    return reply(200, { ok: true, accounts: result.data });
  } catch { return reply(503, { ok: false, message: "No pudimos conectar. La cuenta sigue disponible; puedes reintentar." }); }
}
