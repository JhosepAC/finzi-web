import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
export function runSupabase(args) {
  return execFileSync(process.execPath, [require.resolve("supabase/dist/supabase.js"), ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
}
