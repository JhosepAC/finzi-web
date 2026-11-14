import { AuthShell } from "@/modules/identity/presentation/auth-shell";
import { VerifyLink } from "@/modules/identity/presentation/verify-link";
export const metadata = { title: "Verificar enlace" };
export default function ConfirmEmail() { return <AuthShell intent="other"><VerifyLink /></AuthShell>; }
