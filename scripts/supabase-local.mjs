import { runSupabase } from "./supabase-cli.mjs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
if (!["start", "stop", "db"].includes(args[0]) || (args[0] === "db" && args.join(" ") !== "db reset --local")) {
  console.error("Este script solo administra el entorno local de Finzi."); process.exit(1);
}
try {
  console.log(`Supabase local: ${args.join(" ")}. La primera descarga puede tardar unos minutos.`);
  const output = runSupabase(args);
  if (args[0] === "db") {
    // Local CLI 3 may retain REST's old database connection after recreating the DB.
    execFileSync("docker", ["restart", "supabase_rest_finzi-auth"], { stdio: "pipe" });
  }
  // CLI output includes local admin keys. Never relay it to logs.
  const safe = output.split(/\r?\n/).filter((line) => !line.trim().startsWith("{") && !/key|secret|token|postgresql:\/\//i.test(line));
  if (safe.join("").trim()) console.log(safe.join("\n").trim());
  console.log("Operación local completada. Para generar la configuración: pnpm supabase:env.");
} catch (error) {
  const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.error?.message) console.error(`${event.error.code}: ${event.error.message}`);
    } catch { /* Never print a status object containing local credentials. */ }
  }
  const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
  const safe = stderr.split(/\r?\n/).filter((line) => !/key|secret|token|postgresql:\/\//i.test(line));
  if (safe.join("").trim()) console.error(safe.join("\n").trim());
  console.error("No se completó la operación local. Revisa Docker, los puertos y la configuración del proyecto.");
  process.exit(1);
}
