import { redirect } from "next/navigation";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
import { SessionPanel } from "@/modules/identity/presentation/session-panel";
import { readIdentity } from "@/modules/identity/infrastructure/session";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tu sesión" };
export default async function Session({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await readIdentity();
  if (!user?.verified) redirect("/login");
  return <AuthShell intent="other"><SessionPanel user={user} confirmed={(await searchParams).notice === "email-verified"} /></AuthShell>;
}
