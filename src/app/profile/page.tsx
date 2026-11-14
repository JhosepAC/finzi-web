import { redirect } from "next/navigation";
import { readIdentity } from "@/modules/identity/infrastructure/session";
import { readProfile } from "@/modules/identity/infrastructure/profile";
import { SettingsShell } from "@/modules/identity/presentation/settings-shell";
export const dynamic="force-dynamic";
export const metadata={title:"Mi perfil"};
export default async function SettingsPage() {
 const user=await readIdentity();if(!user?.verified)redirect("/login");const profile=await readProfile();if(!profile)redirect("/login");
 if(!profile.onboarding_completed_at)redirect("/onboarding");
 const zones=Array.from(new Set(["America/Lima","America/Bogota","UTC",...Intl.supportedValuesOf("timeZone"),...(profile.timezone?[profile.timezone]:[])]));
 return <SettingsShell key={user.id} tab="profile" user={user} profile={profile} zones={zones}/>;
}
