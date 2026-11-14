import { NextRequest, NextResponse } from "next/server";
import { createCategorySchema, updateCategorySchema, initializeCategoriesSchema, catalogSchema } from "@/modules/classification/domain/category";
import { createUserScopedClient } from "@/modules/identity/server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { getFieldErrors } from "@/modules/identity/domain/auth";

export const dynamic = "force-dynamic";
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET() {
  try {
    const client = await createUserScopedClient();
    if (!client) return reply(503, { ok: false, message: "Las categorías no están disponibles ahora." });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user?.email_confirmed_at) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const result = await client.schema("api").rpc("read_categories");
    const catalog = catalogSchema.safeParse(result.data);
    if (result.error || !catalog.success) throw new Error("Lectura fallida");
    return reply(200, { ok: true, ...catalog.data });
  } catch { return reply(503, { ok: false, message: "No pudimos cargar tus categorías. Inténtalo de nuevo." }); }
}
async function write(request: NextRequest, updating: boolean) {
  const env = getAuthEnvironment();
  if (!env) return reply(503, { ok: false, message: "Las categorías no están disponibles ahora." });
  if (request.headers.get("origin") !== env.origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { ok: false, message: "Recarga la página para continuar." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, { ok: false, message: "El formato no es válido." });
  const reader = request.body?.getReader(); if (!reader) return reply(400, { ok: false, message: "La solicitud está vacía." });
  const chunks: Uint8Array[] = []; let bytes = 0; let input: unknown;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4096) { await reader.cancel(); return reply(413, { ok: false, message: "La solicitud es demasiado grande." }); } chunks.push(value); }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return reply(400, { ok: false, message: "La solicitud no es válida." }); }
  const parsed = (updating ? updateCategorySchema : zCreate).safeParse(input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const client = await createUserScopedClient();
    if (!client) return reply(503, { ok: false, message: "Las categorías no están disponibles ahora." });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user?.email_confirmed_at) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const d = parsed.data;
    const result = "action" in d ? await client.schema("api").rpc("initialize_categories")
      : "id" in d ? await client.schema("api").rpc("update_category", { p_id: d.id, p_name: d.name, p_description: d.description, p_color: d.color, p_icon: d.icon, p_archived: d.archived, p_expected_version: d.expectedVersion })
      : await client.schema("api").rpc("create_category", { p_request_id: d.requestId, p_parent_id: d.parentId, p_kind: d.kind, p_name: d.name, p_description: d.description, p_color: d.color, p_icon: d.icon });
    if (result.error?.code === "40001") return reply(409, { ok: false, code: "CONFLICT", message: "Las categorías cambiaron o este intento ya se utilizó. Actualiza antes de continuar." });
    if (result.error?.code === "23505") return reply(409, { ok: false, message: "Ya existe ese nombre en este grupo, incluso entre las archivadas. Usa otro nombre o restaura la categoría." });
    if (result.error?.code === "P0002") return reply(404, { ok: false, message: "No se encontró la categoría." });
    if (result.error?.code === "42501") return reply(403, { ok: false, message: "Completa tu perfil para organizar categorías." });
    if (result.error?.code === "54000") return reply(409, { ok: false, message: "El límite inicial es de 200 categorías, incluidas las archivadas." });
    if (result.error?.code === "23514" || result.error?.code === "23503") return reply(422, { ok: false, message: "Revisa los campos y que el padre sea una categoría principal activa del mismo tipo." });
    const catalog = catalogSchema.safeParse(result.data);
    if (result.error || !catalog.success) throw new Error("Guardado no confirmado");
    return reply(200, { ok: true, ...catalog.data });
  } catch { return reply(503, { ok: false, message: "No pudimos confirmar el guardado. Conserva el formulario y reintenta la misma operación." }); }
}
const zCreate = createCategorySchema.or(initializeCategoriesSchema);
export async function POST(request: NextRequest) { return write(request, false); }
export async function PATCH(request: NextRequest) { return write(request, true); }
