import { redirect } from "next/navigation";
import { AuthForm } from "@/modules/identity/presentation/auth-form";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
import { readIdentity } from "@/modules/identity/infrastructure/session";
export const metadata = { title: "Crear cuenta" };
export const dynamic = "force-dynamic";
export default async function Register() {
  if ((await readIdentity())?.verified) redirect("/session");
  return <AuthShell intent="register"><AuthForm kind="register" /></AuthShell>;
}
