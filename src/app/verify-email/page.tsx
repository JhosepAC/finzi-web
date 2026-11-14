import { AuthForm } from "@/modules/identity/presentation/auth-form";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
export const metadata = { title: "Confirmar correo" };
export default function VerifyEmail() { return <AuthShell intent="other"><AuthForm kind="resend" /></AuthShell>; }
