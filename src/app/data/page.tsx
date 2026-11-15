import {redirect} from "next/navigation";
import {readIdentity} from "@/modules/identity/infrastructure/session";
import {readProfile} from "@/modules/identity/infrastructure/profile";
import {SettingsShell} from "@/modules/identity/presentation/settings-shell";
export const dynamic="force-dynamic";export const metadata={title:"Mis datos"};
export default async function DataPage(){const user=await readIdentity();if(!user?.verified)redirect("/login");const profile=await readProfile();if(!profile)redirect("/login");if(!profile.onboarding_completed_at)redirect("/onboarding");return <SettingsShell key={user.id} tab="data" user={user} profile={profile} zones={[]}/>;}
