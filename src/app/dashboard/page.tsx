import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Check, WalletCards } from "lucide-react";
import { readIdentity } from "@/modules/identity/infrastructure/session";
import { readProfile } from "@/modules/identity/infrastructure/profile";
import { FinziMark } from "@/modules/identity/presentation/auth-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tu espacio financiero" };
export default async function Dashboard() {
  const identity = await readIdentity();
  if (!identity?.verified) redirect("/login");
  const profile = await readProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");
  return <div className="dashboard-page"><a className="skip-link" href="#dashboard-main">Saltar al contenido</a><header className="dashboard-header"><Link className="wordmark" href="/dashboard" aria-label="Finzi, inicio"><FinziMark /><span>finzi</span></Link><nav aria-label="Personal"><Link className="text-link" href="/onboarding?edit=1">Mi perfil</Link><Link className="text-link" href="/session">Sesión y seguridad</Link></nav></header><main id="dashboard-main"><div className="dashboard-welcome"><p className="profile-ready"><Check size={16} aria-hidden="true" />Perfil configurado</p><h1>Hola, {profile.display_name}.</h1><p>Tu espacio financiero empieza aquí.</p></div><section className="dashboard-empty" aria-labelledby="empty-title"><div className="empty-art" aria-hidden="true"><WalletCards size={64} strokeWidth={1.2} /></div><h2 id="empty-title">Un comienzo con todo por organizar.</h2><p>Aún no tienes cuentas ni movimientos registrados.<br />El registro de cuentas estará disponible en una próxima actualización.</p><Link className="text-link" href="/onboarding?edit=1">Revisar mi perfil<ArrowUpRight size={16} aria-hidden="true" /></Link></section><section className="dashboard-preferences" aria-labelledby="preferences-title"><h2 id="preferences-title">Tu punto de partida</h2><dl><div><dt>Moneda de referencia</dt><dd>{profile.preferred_currency === "PEN" ? "Soles peruanos · PEN" : "Dólares estadounidenses · USD"}</dd></div><div><dt>Zona horaria</dt><dd>{profile.timezone?.replaceAll('_', ' ')}</dd></div><div><dt>Idioma</dt><dd>Español</dd></div></dl><p>La moneda de referencia no convierte ni suma importes de monedas diferentes.</p></section></main><footer className="setup-footer">Finzi es gratuita y sin publicidad.</footer></div>;
}
