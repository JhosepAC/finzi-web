import { redirect } from "next/navigation";
import { readProfile } from "@/modules/identity/infrastructure/profile";
import { readIdentity } from "@/modules/identity/infrastructure/session";
import { Onboarding } from "@/modules/identity/presentation/onboarding";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configura tu perfil" };
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const identity = await readIdentity();
  if (!identity?.verified) redirect("/login");
  const profile = await readProfile();
  if (!profile) redirect("/login");
  if (profile.onboarding_completed_at) redirect((await searchParams).edit === "1" ? "/profile" : "/dashboard");
  const editing = false;
  const zones = Array.from(new Set(["America/Lima", "America/Bogota", "UTC", ...Intl.supportedValuesOf("timeZone"), ...(profile.timezone ? [profile.timezone] : [])]));
  return <Onboarding key={profile.user_id} initial={profile} zones={zones} editing={editing} />;
}
