import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

// Inspect names only: never print file contents or credentials on failure.
const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const credentialPath = /(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|[^/]+\.(?:pem|key))$/i;
const allowed = new Set([".env.example", ".dev.vars.example"]);
for (const path of paths) {
  assert(!path.startsWith("docs/"), "Private docs must remain untracked");
  assert(!credentialPath.test(path) || allowed.has(path), "Credential file must remain untracked");
  assert(!/^(?:\.vercel|\.wrangler|\.open-next|\.cloudflare-bundle)\//.test(path), "Generated cloud artifacts must remain untracked");
}
const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
for (const scope of [config, config.env.staging]) {
  assert.equal(scope.workers_dev, false, "Publishing workers.dev is not enabled during preparation");
  assert.equal(scope.preview_urls, false);
  assert.deepEqual(scope.routes, []);
  assert.deepEqual(scope.triggers.crons, [], "Cron requires implemented, tested handlers in later phases");
  for (const name of ["r2_buckets", "queues", "images", "hyperdrive", "ai", "d1_databases", "durable_objects"]) {
    assert(!(name in scope), "Additional services require a separate free/no-card review");
  }
}
assert.deepEqual(Object.keys(config.env.staging.vars).sort(), ["APP_URL", "SUPABASE_URL", "TELEGRAM_BOT_USERNAME"]);
const web = JSON.parse(readFileSync("vercel.json", "utf8"));
assert.equal(web.framework, "nextjs", "Web SSR uses native Next.js on Vercel");
assert.equal(web.buildCommand, "pnpm build");
assert.equal(web.installCommand, "pnpm install --frozen-lockfile");
assert.deepEqual(web.regions, ["gru1"], "Hobby uses a single region near Supabase");
assert.deepEqual(web.git, { deploymentEnabled: false }, "Automatic publishing remains disabled");
assert.deepEqual(Object.keys(web).sort(), ["$schema", "buildCommand", "framework", "git", "installCommand", "regions"].sort(), "No web cron, secrets, rewrites or additional services");
const webIgnore = new Set(readFileSync(".vercelignore", "utf8").split(/\r?\n/).map(line => line.trim()));
for (const entry of [".env*", ".dev.vars*", "docs/", "telegram-bot/", "telegram-webhook/", "deletion-worker/", "scripts/", "/infrastructure/", "supabase/"]) {
  assert(webIgnore.has(entry), "Private files and independent workers stay outside Vercel uploads");
}
assert(!webIgnore.has("infrastructure/"), "A root-only exclusion must preserve src domain infrastructure adapters");
const telegram = JSON.parse(readFileSync("wrangler.telegram.jsonc", "utf8"));
assert.equal(telegram.main, "telegram-webhook/worker.ts");
assert.equal(telegram.workers_dev, true, "Telegram publication authorized in phase 8; Deletion remains disabled");
assert.equal(telegram.preview_urls, false);
assert.deepEqual(telegram.routes, []);
assert.deepEqual(telegram.triggers.crons, ["* * * * *"], "Only the explicitly authorized Telegram minute schedule");
const deletion = JSON.parse(readFileSync("wrangler.deletion.jsonc", "utf8"));
assert.equal(deletion.main, "deletion-worker/worker.ts");
assert.equal(deletion.workers_dev, false);
assert.equal(deletion.preview_urls, false);
assert.deepEqual(deletion.routes, []);
assert.deepEqual(deletion.triggers.crons, ["0 * * * *"], "Only the authorized hourly disabled Deletion schedule");
assert.deepEqual(deletion.vars, { DELETION_ENABLED: "false" }, "Deletion must remain strictly disabled; provider URL is a runtime secret");
assert.deepEqual(deletion.d1_databases, [{ binding: "DELETION_MANIFESTS", database_name: "finzi-deletion-manifests-staging", database_id: "bca8d6c5-b08f-4af8-b0ee-a3c675fefb5b", migrations_dir: "infrastructure/deletion" }], "Only the authorized independent D1 custody database");
for (const name of ["queues", "r2_buckets", "durable_objects", "hyperdrive", "ai"]) assert(!(name in deletion));
const smtp = JSON.parse(readFileSync("infrastructure/supabase/smtp.plan.json", "utf8"));
assert.equal(smtp.status, "deployed_s1_validated");
assert.equal(smtp.s1_validation.source, "user_acceptance_and_sanitized_runtime_evidence");
assert.equal(smtp.s1_validation.registration_confirmation_validated, true);
assert.equal(smtp.s1_validation.recovery_password_change_validated, true);
assert.equal(smtp.s1_validation.new_password_login_validated, true);
assert.equal(smtp.s1_validation.financial_impact_zero, true);
assert.equal(smtp.global_gate, "completed");
assert.equal(smtp.project_ref, "mkzclztzyqdmftesnwcw");
assert.equal(smtp.automatic_apply_enabled, false, "The SMTP inventory must not apply hosted changes");
assert.equal(smtp.custom_smtp_enabled, true, "Manual SMTP application was reported by the user");
assert.equal(smtp.public_signup_enabled, true, "Signup was separately authorized and verified in phase 8");
assert.equal(smtp.selected_provider, "gmail_personal");
assert.equal(smtp.reported_remote_state.source, "user_confirmation");
assert.equal(smtp.reported_remote_state.remote_read_back_performed, false);
assert.equal(smtp.reported_remote_state.delivery_validated, false);
assert.deepEqual(smtp.reported_remote_state.templates_pasted, ["confirmation", "recovery", "email_change"]);
assert.equal(smtp.sender_email, "");
assert.equal(smtp.site_url, "https://finzi-beta.vercel.app");
assert.deepEqual(smtp.redirect_allow_list, ["https://finzi-beta.vercel.app/auth/confirm"]);
for (const path of ["supabase/config.toml", "infrastructure/supabase/supabase/config.toml"]) {
  const auth = readFileSync(path, "utf8");
  assert(/enable_confirmations\s*=\s*true/.test(auth));
  assert(/double_confirm_changes\s*=\s*true/.test(auth));
  assert(/secure_password_change\s*=\s*true/.test(auth));
  assert(!/\[auth\.email\.smtp\]/.test(auth), "SMTP credentials stay outside repository configuration");
}
for (const item of Object.values(smtp.templates)) assert(readFileSync(item.path, "utf8").includes('<html lang="es">'));
console.log("Infrastructure checks passed: Telegram minute and disabled Deletion hourly Cron; Git automatic deployment disabled; credentials excluded.");
