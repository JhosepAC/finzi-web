import { NextRequest, NextResponse } from "next/server";
import { movementQuerySchema, postMovementSchema, voidMovementSchema, movementPageSchema } from "@/modules/transactions/domain/movement";
import { createUserScopedClient } from "@/modules/identity/server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { getFieldErrors } from "@/modules/identity/domain/auth";

export const dynamic = "force-dynamic";
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function verifiedClient() {
  const client = await createUserScopedClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return !error && data.user?.email_confirmed_at ? client : null;
}
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = movementQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success || [...params.keys()].some((key) => params.getAll(key).length > 1)) return reply(422, { ok: false, message: "Revisa los filtros y las fechas." });
  try {
    const client = await verifiedClient();
    if (!client) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const d = parsed.data;
    const result = await client.schema("api").rpc("read_movements", { p_currency: d.currency, p_kind: d.kind ?? null, p_account_id: d.accountId ?? null, p_category_id: d.categoryId ?? null,
      p_from: d.from ?? null, p_to: d.to ?? null, p_query: d.query, p_cursor_at: d.cursorAt ?? null, p_cursor_id: d.cursorId ?? null, p_limit: d.limit, p_status: d.status });
    const page = movementPageSchema.safeParse(result.data);
    if (result.error || !page.success) throw new Error("Lectura fallida");
    return reply(200, { ok: true, ...page.data });
  } catch { return reply(503, { ok: false, message: "No pudimos cargar tus movimientos. Reintenta para actualizar los datos." }); }
}
async function write(request: NextRequest, voiding: boolean) {
  const env = getAuthEnvironment();
  if (!env) return reply(503, { ok: false, message: "Los movimientos no están disponibles ahora." });
  if (request.headers.get("origin") !== env.origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { ok: false, message: "Recarga la página para continuar." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, { ok: false, message: "El formato no es válido." });
  const reader = request.body?.getReader(); if (!reader) return reply(400, { ok: false, message: "La solicitud está vacía." });
  const chunks: Uint8Array[] = []; let bytes = 0; let input: unknown;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 8192) { await reader.cancel(); return reply(413, { ok: false, message: "La solicitud es demasiado grande." }); } chunks.push(value); }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return reply(400, { ok: false, message: "La solicitud no es válida." }); }
  const parsed = (voiding ? voidMovementSchema : postMovementSchema).safeParse(input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const client = await verifiedClient();
    if (!client) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const d = parsed.data;
    const result = "id" in d ? await client.schema("api").rpc("void_movement", { p_id: d.id, p_expected_version: d.expectedVersion, p_reason: d.reason })
      : await client.schema("api").rpc("post_movement", { p_request_id: d.requestId, p_kind: d.kind, p_account_id: d.accountId, p_category_id: d.categoryId, p_amount: d.amount, p_description: d.description, p_note: d.note, p_occurred_at: d.occurredAt });
    if (result.error?.code === "40001") return reply(409, { ok: false, code: "CONFLICT", message: "Este intento ya confirmó otros datos o el movimiento cambió. Actualiza antes de continuar." });
    if (result.error?.code === "P0002") return reply(404, { ok: false, message: "No se encontró el movimiento, la cuenta o la categoría." });
    if (result.error?.code === "42501") return reply(403, { ok: false, message: "Completa tu perfil para registrar movimientos." });
    if (result.error?.code === "54000") return reply(409, { ok: false, message: "Alcanzaste el límite inicial de 10000 movimientos, incluidos los anulados." });
    if (result.error?.code === "22008") return reply(422, { ok: false, message: "La fecha debe haber ocurrido y no ser anterior a la apertura de la cuenta.", fieldErrors: { occurredAt: "Elige una fecha ya ocurrida, posterior o igual a la apertura." } });
    if (result.error?.code === "22003") return reply(422, { ok: false, message: "Este importe deja el saldo fuera del rango admitido. Revisa el movimiento." });
    if (result.error?.code === "23514" || result.error?.code === "23503") return reply(422, { ok: false, message: "Revisa el importe y que la cuenta, la categoría y su padre estén activos y sean del tipo correcto." });
    if (result.error || !result.data?.id) throw new Error("Guardado no confirmado");
    return reply(200, { ok: true, ...result.data });
  } catch { return reply(503, { ok: false, message: "No pudimos confirmar el guardado. Conserva el formulario y reintenta la misma operación." }); }
}
export async function POST(request: NextRequest) { return write(request, false); }
export async function PATCH(request: NextRequest) { return write(request, true); }
