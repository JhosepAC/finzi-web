import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { prepareStagingMigrations } from "./staging-migration-files.mjs";
const ref="mkzclztzyqdmftesnwcw",bot="970000003";
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
process.loadEnvFile(".env.supabase-staging.local");
assert.equal(process.env.SUPABASE_PROJECT_REF,ref);
assert.equal(process.env.SUPABASE_URL,`https://${ref}.supabase.co`);
const mode=process.argv[2];assert(["plan","apply","credentials"].includes(mode));
const cli=createRequire(import.meta.url).resolve("supabase/dist/supabase.js");
function run(args) {
 const result=spawnSync(process.execPath,[cli,...args],{encoding:"utf8",env:process.env,timeout:180000,maxBuffer:4*1024*1024});
 if(result.status!==0){
  const code=(result.stdout+result.stderr).match(/SQLSTATE ([A-Z0-9]{5})/)?.[1];
  throw new Error(`Staging Telegram command failed; output suppressed${code?"; SQLSTATE "+code:""}`);
 }
 return result.stdout;
}
const projects=JSON.parse(run(["projects","list","--output","json"]));
const project=projects.find(p=>p.id===ref);assert(project?.name==="finzi-staging"&&project.status==="ACTIVE_HEALTHY"&&project.database.postgres_engine==="17");
const history=JSON.parse(run(["db","query",`--remote=${ref}`,"--read-only","--output-format","json","select version from supabase_migrations.schema_migrations order by version"])).rows.map(r=>r.version);
const base=JSON.parse(readFileSync("infrastructure/supabase/migrations.manifest.json","utf8"));
assert.deepEqual(history.slice(0,34),base.map(x=>x.file.split("_")[0]));
const additive=JSON.parse(readFileSync("infrastructure/supabase/telegram-webhook-migration.manifest.json","utf8"));
if(mode==="credentials") {
 assert.equal(history.length,35);assert.equal(history[34],"20261116000900");
 const envPath=".env.telegram-webhook-staging.local";
 try { readFileSync(envPath);throw new Error("Credentials already exist; never overwrite custody keys"); } catch(error) {if(error.code!=="ENOENT")throw error;}
 const password=randomBytes(32).toString("hex");
 const file=".staging-migrations/provision-telegram.sql";
 const sql=`begin; do $$ begin if exists(select 1 from pg_stat_activity where usename='finzi_telegram_gateway') then raise exception 'Stop gateway consumers before provisioning';end if; if not pg_try_advisory_xact_lock(hashtextextended('finzi-telegram:${bot}',0)) then raise exception 'Polling consumer active';end if; end $$; alter role finzi_telegram_gateway password '${password}'; insert into telegram_private.transport_bots(bot_id,mode,enabled) values('${bot}','webhook',true); commit;`;
 writeFileSync(file,sql,{mode:0o600});
 try { run(["db","query",`--remote=${ref}`,"--file",file,"--yes","--output-format","json"]); } finally {unlinkSync(file);}
 const env={TELEGRAM_WEBHOOK_DATABASE_URL:`postgresql://finzi_telegram_gateway.${ref}:${password}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`,TELEGRAM_WEBHOOK_BOT_ID:bot,TELEGRAM_WEBHOOK_BOT_USERNAME:"FinziSyntheticBot",TELEGRAM_WEBHOOK_BOT_TOKEN:bot+":synthetic_test_only",TELEGRAM_WEBHOOK_SECRET:randomBytes(32).toString("hex"),TELEGRAM_WEBHOOK_CUSTODY_KEY:randomBytes(32).toString("hex"),TELEGRAM_WEBHOOK_CALLBACK_KEY:randomBytes(32).toString("hex"),TELEGRAM_WEBHOOK_URL:""};
 writeFileSync(envPath,Object.entries(env).map(([k,v])=>`${k}=${v}`).join("\n")+"\n",{mode:0o600});
 console.log("Synthetic bot registered; restricted gateway credentials and independent keys saved only to ignored staging file. No Telegram API called.");
} else {
 assert.equal(history.length,34,"Migration already applied or unexpected history");
 prepareStagingMigrations(additive);
 const args=["db","push",`--remote=${ref}`,"--workdir",".staging-migrations","--skip-vault","--yes"];
 if(mode==="plan")args.push("--dry-run");
 run(args);console.log(`Telegram transport migration ${mode} succeeded on the exact staging ref.`);
}
