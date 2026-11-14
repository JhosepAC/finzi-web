import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/modules/identity/server";
import { overviewQuerySchema, overviewSchema } from "@/modules/reporting/domain/overview";
export const dynamic = "force-dynamic";
const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = overviewQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success || [...params.keys()].some((key) => params.getAll(key).length > 1)) return reply(422, { ok: false, message: "Revisa el período y las fechas. El intervalo personalizado admite hasta 3660 días y debe terminar hoy o antes." });
  try {
    const client = await createUserScopedClient();
    const identity = client && await client.auth.getUser();
    if (!client || !identity || identity.error || !identity.data.user?.email_confirmed_at) return reply(401, { ok: false, message: "Tu sesión terminó. Inicia sesión de nuevo." });
    const d = parsed.data;
    const result = await client.schema("api").rpc("read_overview", { p_currency: d.currency, p_period: d.period, p_anchor: d.anchor ?? null, p_from: d.from ?? null, p_to: d.to ?? null, p_account_id: d.accountId ?? null });
    if (result.error?.code === "P0002") return reply(404, { ok: false, message: "No se encontró la cuenta en esta moneda." });
    if (result.error?.code === "23514") return reply(422, { ok: false, message: "Revisa el período y las fechas; no consultes fechas futuras ni más de 3660 días personalizados." });
    const report = overviewSchema.safeParse(result.data);
    if (result.error || !report.success) throw new Error("Lectura fallida");
    return reply(200, { ok: true, ...report.data });
  } catch { return reply(503, { ok: false, message: "No pudimos actualizar el resumen. Reintenta para consultar tus datos." }); }
}
