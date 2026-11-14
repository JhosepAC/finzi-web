import { existsSync, writeFileSync } from "node:fs";
import { runSupabase } from "./supabase-cli.mjs";

if (existsSync(".env.local")) {
  console.error(".env.local ya existe; no se sobrescribió. Revisa la configuración manualmente.");
  process.exit(1);
}
let status;
try {
  status = JSON.parse(runSupabase(["status", "-o", "json"]));
} catch { console.error("Inicia Supabase local con pnpm supabase:start antes de generar el entorno."); process.exit(1); }
const url = status.API_URL;
const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
if (!url || !key || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  console.error("Solo se admite un proyecto Supabase local para generar este archivo."); process.exit(1);
}
writeFileSync(".env.local", `SUPABASE_URL=${url}\nSUPABASE_PUBLISHABLE_KEY=${key}\nAPP_URL=http://127.0.0.1:3000\n`, { flag: "wx", mode: 0o600 });
console.log(".env.local creado con URL y clave publicable del entorno local. Ninguna clave administrativa fue guardada.");
