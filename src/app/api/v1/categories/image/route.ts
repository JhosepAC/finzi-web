import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/modules/identity/server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { deleteCategoryImage, downloadCategoryImage, isOwnedCategoryImage, maxCategoryImageBytes, uploadCategoryImage } from "@/modules/classification/server/category-image";

export const dynamic = "force-dynamic";
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function verified() {
  const client = await createUserScopedClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return !error && data.user?.email_confirmed_at ? { client, userId: data.user.id } : null;
}
function sameOrigin(request: NextRequest) {
  const env = getAuthEnvironment();
  return Boolean(env && request.headers.get("origin") === env.origin && request.headers.get("sec-fetch-site") !== "cross-site");
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply(403, { ok: false, message: "Recarga la página para continuar." });
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  if (!type || !["image/webp", "image/png", "image/jpeg"].includes(type)) return reply(415, { ok: false, message: "Usa una imagen PNG, JPG o WebP." });
  const reader = request.body?.getReader(); if (!reader) return reply(400, { ok: false, message: "La solicitud está vacía." });
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maxCategoryImageBytes) { await reader.cancel(); return reply(413, { ok: false, message: "La imagen supera 1 MB." }); } chunks.push(value); }
  } catch { return reply(400, { ok: false, message: "La imagen no se pudo leer." }); }
  try {
    const session = await verified(); if (!session) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const path = await uploadCategoryImage(session.client, session.userId, Buffer.concat(chunks));
    return reply(200, { ok: true, path });
  } catch { return reply(422, { ok: false, message: "No pudimos usar esa imagen. Prueba con un PNG, JPG o WebP de hasta 1 MB." }); }
}
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  try {
    const session = await verified(); if (!session) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    if (!isOwnedCategoryImage(path, session.userId)) return reply(404, { ok: false, message: "No se encontró la imagen." });
    const data = await downloadCategoryImage(session.client, path);
    if (!data) return reply(404, { ok: false, message: "No se encontró la imagen." });
    return new NextResponse(new Uint8Array(data), { status: 200, headers: {
      "Content-Type": "image/webp", "Content-Length": String(data.byteLength), "Cache-Control": "private, max-age=300",
      "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return reply(503, { ok: false, message: "No pudimos cargar la imagen." }); }
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return reply(403, { ok: false, message: "Recarga la página para continuar." });
  const path = request.nextUrl.searchParams.get("path") ?? "";
  try {
    const session = await verified(); if (!session) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    if (!isOwnedCategoryImage(path, session.userId)) return reply(404, { ok: false, message: "No se encontró la imagen." });
    await deleteCategoryImage(session.client, path);
    return reply(200, { ok: true });
  } catch { return reply(503, { ok: false, message: "No pudimos quitar la imagen." }); }
}
