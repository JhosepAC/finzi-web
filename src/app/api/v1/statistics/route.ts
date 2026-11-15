import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/modules/identity/server";
import { statisticsQuerySchema, statisticsSchema } from "@/modules/reporting/domain/statistics";

export const dynamic = "force-dynamic";
const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams, parsed = statisticsQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success || [...params.keys()].some((key) => params.getAll(key).length > 1)) return reply(422, { ok: false, message: "Elige un período válido. Personalizado requiere ambas fechas, hasta 3660 días y sin fechas futuras." });
  try {
    const client = await createUserScopedClient(); const identity = client && await client.auth.getUser();
    if (!client || !identity || identity.error || !identity.data.user?.email_confirmed_at) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const d = parsed.data;
    const result = await client.schema("api").rpc("read_statistics", { p_currency: d.currency, p_period: d.period, p_from: d.from ?? null, p_to: d.to ?? null });
    if (result.error?.code === "23514") return reply(422, { ok: false, message: "Revisa las fechas: el intervalo debe terminar hoy o antes y no superar 3660 días." });
    if (result.error?.code === "42501") return reply(403, { ok: false, message: "Completa tu perfil para consultar tus estadísticas." });
    const report = statisticsSchema.safeParse(result.data);
    if (result.error || !report.success) throw new Error();
    return reply(200, { ok: true, ...report.data });
  } catch { return reply(503, { ok: false, message: "No pudimos cargar tus estadísticas. Reintenta para consultar los datos actuales." }); }
}
