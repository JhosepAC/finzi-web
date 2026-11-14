import { redirect } from "next/navigation";
import { readIdentity } from "@/modules/identity/infrastructure/session";
export const dynamic = "force-dynamic";
export default async function Home() { redirect((await readIdentity())?.verified ? "/dashboard" : "/login"); }
