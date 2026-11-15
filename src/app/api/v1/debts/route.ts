import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/modules/identity/server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { getFieldErrors } from "@/modules/identity/domain/auth";
import { debtCatalogSchema, debtCommandSchema } from "@/modules/debts/domain/debt";

export const dynamic = "force-dynamic";
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function client() {
  const c = await createUserScopedClient(); if (!c) return null;
  const user = await c.auth.getUser(); return !user.error && user.data.user?.email_confirmed_at ? c : null;
}
export async function GET() {
  try {
    const c = await client(); if (!c) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const result = await c.schema("api").rpc("read_debts"); const parsed = debtCatalogSchema.safeParse(result.data);
    if (result.error || !parsed.success) throw new Error();
    return reply(200, { ok: true, ...parsed.data });
  } catch { return reply(503, { ok: false, message: "No pudimos cargar tus deudas. Reintenta para actualizar los datos." }); }
}
export async function POST(request: NextRequest) {
  const env = getAuthEnvironment(); if (!env) return reply(503, { ok: false, message: "Las deudas no están disponibles ahora." });
  if (request.headers.get("origin") !== env.origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { ok: false, message: "Recarga la página para continuar." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, { ok: false, message: "El formato no es válido." });
  const reader = request.body?.getReader(); if (!reader) return reply(400, { ok: false, message: "La solicitud está vacía." });
  let input: unknown;
  try {
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 16384) { await reader.cancel(); return reply(413, { ok: false, message: "La solicitud es demasiado grande." }); } chunks.push(value); }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return reply(400, { ok: false, message: "La solicitud no es válida." }); }
  const parsed = debtCommandSchema.safeParse(input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const c = await client(); if (!c) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const result = await c.schema("api").rpc("debt_command", { p_command: parsed.data });
    const code = result.error?.code;
    if (code === "40001") return reply(409, { ok: false, message: "La deuda cambió o este intento ya confirmó otros datos. Actualiza antes de continuar." });
    if (code === "42501") return reply(403, { ok: false, message: "Completa tu perfil para gestionar deudas." });
    if (code === "P0002") return reply(404, { ok: false, message: "No se encontró la deuda o el pago. Actualiza los datos." });
    if (code === "54000") return reply(409, { ok: false, message: "Alcanzaste un límite inicial: 200 deudas, 2000 pagos o 10000 movimientos, incluida su historia." });
    if (code === "22008") return reply(422, { ok: false, message: "El pago debe haber ocurrido y no ser anterior a la apertura de la cuenta." });
    if (["23514", "23503", "23505", "23502", "22P02", "22003"].includes(code ?? "")) return reply(422, { ok: false, message: "Revisa el importe pendiente, la moneda y que el gasto no esté vinculado a otra deuda. La cuenta y la categoría de gasto deben estar activas." });
    if (result.error || !result.data?.id) throw new Error();
    return reply(200, { ok: true, id: result.data.id });
  } catch { return reply(503, { ok: false, message: "No pudimos confirmar el guardado. Conserva el formulario y reintenta la misma operación." }); }
}
