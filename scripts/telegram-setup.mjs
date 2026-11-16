import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
try {
 const file=path.resolve(".env.telegram.local");if(existsSync(file))throw new Error("Existing configuration preserved");
 const base=path.join(homedir(),process.platform==="win32"?"AppData/Local":".local/share","Finzi","telegram"),key=path.join(base,"keys","custody.key"),store=path.join(base,"store");
 for(const target of [key,store]){let current=target;while(true){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error("Linked custody refused");const parent=path.dirname(current);if(parent===current)break;current=parent;}}
 if(!existsSync(key)&&existsSync(store)&&readdirSync(store).length)throw new Error("Restore the missing custody key");
 mkdirSync(path.dirname(key),{recursive:true,mode:0o700});mkdirSync(store,{recursive:true,mode:0o700});
 if(!existsSync(key))writeFileSync(key,randomBytes(32),{flag:"wx",mode:0o600});
 if(readFileSync(key).length!==32)throw new Error("Invalid custody key");
 const password=randomBytes(32).toString("hex");
 execFileSync("docker",["exec","-i","supabase_db_finzi-auth","psql","-U","supabase_admin","-d","postgres","-q","-v","ON_ERROR_STOP=1"],{input:`do $$ begin if exists(select 1 from pg_stat_activity where usename='finzi_telegram_gateway') then raise exception 'Stop the gateway first'; end if; end $$; alter role finzi_telegram_gateway login password '${password}';`,stdio:["pipe","pipe","pipe"]});
 writeFileSync(file,`# Local only. Never share this file.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_DATABASE_URL=postgresql://finzi_telegram_gateway:${password}@127.0.0.1:17322/postgres
FINZI_TELEGRAM_STORE=${JSON.stringify(store.split(path.sep).join("/"))}
FINZI_TELEGRAM_KEY_PATH=${JSON.stringify(key.split(path.sep).join("/"))}
`,{flag:"wx",mode:0o600});
 console.log("Local restricted connection and separate encrypted custody prepared. Configure the bot token locally; no credentials were printed.");
} catch {console.error("Setup was not completed. Existing configuration/custody was preserved. Check Docker, phase 3 migrations and local paths; no secrets were printed.");process.exitCode=1;}
