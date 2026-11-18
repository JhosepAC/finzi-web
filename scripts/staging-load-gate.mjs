import { readFileSync } from "node:fs";
export function assertStagingLoadAllowed() {
 const gate = JSON.parse(readFileSync("infrastructure/supabase/staging-load-gate.json", "utf8"));
 if (gate.project_ref !== "mkzclztzyqdmftesnwcw" || gate.status !== "allowed") {
  throw new Error("Remote load tests require separate explicit authorization. Deployment closure does not authorize network or financial test requests.");
 }
}
