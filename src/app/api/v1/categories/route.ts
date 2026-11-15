import { NextRequest, NextResponse } from "next/server";
import { createCategorySchema, updateCategorySchema, deleteCategorySchema, initializeCategoriesSchema, catalogSchema } from "@/modules/classification/domain/category";
import { createUserScopedClient } from "@/modules/identity/server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { getFieldErrors } from "@/modules/identity/domain/auth";
import { deleteCategoryImage } from "@/modules/classification/server/category-image";

export const dynamic = "force-dynamic";
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const zCreate = createCategorySchema.or(initializeCategoriesSchema);
async function verifiedClient() {
  const client = await createUserScopedClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return !error && data.user?.email_confirmed_at ? client : null;
}
async function readJson(request: NextRequest, limit: number): Promise<unknown | null> {
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) { await reader.cancel(); return undefined; } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; }
}
function guard(request: NextRequest) {
  const env = getAuthEnvironment();
  if (!env) return reply(503, { ok: false, message: "Las categorías no están disponibles ahora." });
  if (request.headers.get("origin") !== env.origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { ok: false, message: "Recarga la página para continuar." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, { ok: false, message: "El formato no es válido." });
  return null;
}
function writeError(code: string | undefined) {
  if (code === "40001") return reply(409, { ok: false, code: "CONFLICT", message: "Las categorías cambiaron o este intento ya se utilizó. Actualiza antes de continuar." });
  if (code === "23505") return reply(409, { ok: false, message: "Ya existe ese nombre en este grupo, incluso entre las archivadas. Usa otro nombre o restaura la categoría." });
  if (code === "P0002") return reply(404, { ok: false, message: "No se encontró la categoría." });
  if (code === "42501") return reply(403, { ok: false, message: "Completa tu perfil para organizar categorías." });
  if (code === "54000") return reply(409, { ok: false, message: "El límite inicial es de 200 categorías, incluidas las archivadas." });
  if (code === "23514" || code === "23503") return reply(422, { ok: false, message: "Revisa los campos, el icono, la imagen y que el padre sea una categoría principal activa del mismo tipo." });
  return reply(503, { ok: false, message: "No pudimos confirmar el guardado. Conserva el formulario y reintenta la misma operación." });
}
export async function GET() {
  if (!getAuthEnvironment()) return reply(503, { ok: false, message: "Las categorías no están disponibles ahora." });
  try {
    const client = await verifiedClient();
    if (!client) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const result = await client.schema("api").rpc("read_categories");
    const catalog = catalogSchema.safeParse(result.data);
    if (result.error || !catalog.success) throw new Error("Lectura fallida");
    return reply(200, { ok: true, ...catalog.data });
  } catch { return reply(503, { ok: false, message: "No pudimos cargar tus categorías. Inténtalo de nuevo." }); }
}
async function write(request: NextRequest, updating: boolean) {
  const blocked = guard(request); if (blocked) return blocked;
  const input = await readJson(request, 4096);
  if (input === undefined) return reply(413, { ok: false, message: "La solicitud es demasiado grande." });
  if (input === null) return reply(400, { ok: false, message: "La solicitud no es válida." });
  const parsed = (updating ? updateCategorySchema : zCreate).safeParse(input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const client = await verifiedClient();
    if (!client) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const d = parsed.data;
    let previousImage: string | null = null;
    if ("id" in d) {
      const current = catalogSchema.safeParse((await client.schema("api").rpc("read_categories")).data);
      if (!current.success) throw new Error("Lectura fallida");
      previousImage = current.data.categories.find((category) => category.id === d.id)?.image_path ?? null;
    }
    const result = "action" in d ? await client.schema("api").rpc("initialize_categories")
      : "id" in d ? await client.schema("api").rpc("update_category", { p_id: d.id, p_name: d.name, p_description: d.description, p_color: d.color, p_icon: d.icon, p_image_path: d.imagePath, p_archived: d.archived, p_expected_version: d.expectedVersion })
      : await client.schema("api").rpc("create_category", { p_request_id: d.requestId, p_parent_id: d.parentId, p_kind: d.kind, p_name: d.name, p_description: d.description, p_color: d.color, p_icon: d.icon, p_image_path: d.imagePath });
    if (result.error) return writeError(result.error.code);
    const catalog = catalogSchema.safeParse(result.data);
    if (!catalog.success) throw new Error("Guardado no confirmado");
    if (previousImage && previousImage !== ("imagePath" in d ? d.imagePath : null)) await deleteCategoryImage(client, previousImage);
    return reply(200, { ok: true, ...catalog.data });
  } catch { return reply(503, { ok: false, message: "No pudimos confirmar el guardado. Conserva el formulario y reintenta la misma operación." }); }
}
export async function POST(request: NextRequest) { return write(request, false); }
export async function PATCH(request: NextRequest) { return write(request, true); }
export async function DELETE(request: NextRequest) {
  const blocked = guard(request); if (blocked) return blocked;
  const input = await readJson(request, 4096);
  if (input === undefined) return reply(413, { ok: false, message: "La solicitud es demasiado grande." });
  if (input === null) return reply(400, { ok: false, message: "La solicitud no es válida." });
  const parsed = deleteCategorySchema.safeParse(input);
  if (!parsed.success) return reply(422, { ok: false, message: "Revisa la categoría antes de eliminarla.", fieldErrors: getFieldErrors(parsed.error) });
  try {
    const client = await verifiedClient();
    if (!client) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const current = catalogSchema.safeParse((await client.schema("api").rpc("read_categories")).data);
    if (!current.success) throw new Error("Lectura fallida");
    const image = current.data.categories.find((category) => category.id === parsed.data.id)?.image_path ?? null;
    const result = await client.schema("api").rpc("delete_category", { p_id: parsed.data.id, p_expected_version: parsed.data.expectedVersion });
    const code = result.error?.code;
    if (code === "40001") return reply(409, { ok: false, code: "CONFLICT", message: "La categoría cambió. Actualiza antes de eliminarla." });
    if (code === "2BP01") return reply(409, { ok: false, code: "HAS_CHILDREN", message: "Esta categoría tiene subcategorías. Elimínalas o archívalas primero." });
    if (code === "23503") return reply(409, { ok: false, code: "IN_USE", message: "Esta categoría tiene movimientos asociados. Archívala para ocultarla sin perder el historial." });
    if (code === "P0002") return reply(404, { ok: false, message: "No se encontró la categoría." });
    if (code === "42501") return reply(403, { ok: false, message: "Completa tu perfil para organizar categorías." });
    if (code === "23514") return reply(422, { ok: false, message: "No pudimos validar la categoría." });
    if (result.error) throw new Error("Eliminación no confirmada");
    const catalog = catalogSchema.safeParse(result.data);
    if (!catalog.success) throw new Error("Eliminación no confirmada");
    if (image) await deleteCategoryImage(client, image);
    return reply(200, { ok: true, ...catalog.data });
  } catch { return reply(503, { ok: false, message: "No pudimos confirmar la eliminación. Actualiza las categorías y reintenta." }); }
}
