import { AuthForm } from "@/modules/identity/presentation/auth-form";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
export const metadata = { title: "Recuperar acceso" };
export default function ForgotPassword() { return <AuthShell intent="other"><AuthForm kind="forgot-password" /></AuthShell>; }
