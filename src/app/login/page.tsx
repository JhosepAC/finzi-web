import { redirect } from "next/navigation";
import { AuthForm } from "@/modules/identity/presentation/auth-form";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
import { readIdentity } from "@/modules/identity/infrastructure/session";
export const metadata = { title: "Iniciar sesión" };
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if ((await readIdentity())?.verified) redirect("/dashboard");
  const { notice } = await searchParams;
  const notices: Record<string, string> = { "password-updated": "Contraseña actualizada. Inicia sesión con tu nueva contraseña.", "signed-out": "Sesión cerrada." };
  return <AuthShell><AuthForm kind="login" notice={notice ? notices[notice] : undefined} /></AuthShell>;
}
