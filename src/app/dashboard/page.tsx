import { redirect } from "next/navigation";
import { readIdentity } from "@/modules/identity/infrastructure/session";
import { readProfile } from "@/modules/identity/infrastructure/profile";
import { DashboardHome } from "@/modules/reporting/presentation/dashboard-home";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inicio" };
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  if (!(await readIdentity())?.verified) redirect("/login");
  const profile = await readProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");
  return <DashboardHome key={profile.user_id} profile={profile} demo={(await searchParams).demo === "1"} />;
}
