import { redirect } from "next/navigation";
import { AuthForm } from "@/modules/identity/presentation/auth-form";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
import { readRecoverySession } from "@/modules/identity/infrastructure/session";
export const metadata = { title: "Nueva contraseña" };
export const dynamic = "force-dynamic";
export default async function ResetPassword() {
  if (!await readRecoverySession()) redirect("/forgot-password");
  return <AuthShell intent="other"><AuthForm kind="reset-password" /></AuthShell>;
}
