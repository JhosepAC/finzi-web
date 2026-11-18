import { assertStagingLoadAllowed } from "./staging-load-gate.mjs";
process.env.WRANGLER_WRITE_LOGS="false";
process.env.WRANGLER_SEND_METRICS="false";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { unstable_dev } from "wrangler";
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
assertStagingLoadAllowed();
process.loadEnvFile(".env.telegram-webhook-staging.local");
assert.equal(process.env.TELEGRAM_WEBHOOK_BOT_ID,"970000003");
const local=new URL(process.env.TELEGRAM_WEBHOOK_DATABASE_URL);local.port="6543";local.searchParams.set("sslmode","verify-full");local.searchParams.set("sslrootcert",resolve("infrastructure/supabase/prod-ca-2021.crt"));
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TELEGRAM_DB=local.toString();
const vars=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("TELEGRAM_WEBHOOK_")&&k!=="TELEGRAM_WEBHOOK_DATABASE_URL"));
let worker;
try {
 worker=await unstable_dev("telegram-webhook/worker.ts",{config:"wrangler.telegram.jsonc",vars,port:0,local:true,persist:false,logLevel:"error",experimental:{disableExperimentalWarning:true,watch:false,disableDevRegistry:true}});
 const event={update_id:Date.now(),message:{message_id:1,date:Math.floor(Date.now()/1000),from:{id:700000003,is_bot:false,first_name:"Synthetic"},chat:{id:700000003,type:"private"},text:"/start",entities:[{type:"bot_command",offset:0,length:6}]}};
 const wrong=await worker.fetch("http://localhost/telegram/webhook",{method:"POST",headers:{"content-type":"application/json","X-Telegram-Bot-Api-Secret-Token":"wrong"},body:JSON.stringify(event)});
 assert.equal(wrong.status,403);
 const valid=await worker.fetch("http://localhost/telegram/webhook",{method:"POST",headers:{"content-type":"application/json","X-Telegram-Bot-Api-Secret-Token":vars.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(event)});
 const result={invalidSecret:wrong.status,validWebhook:valid.status,updateId:event.update_id,localWorkerd:true,published:false};
 writeFileSync("docs/deployment/evidence/phase3-workerd.json",JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 assert.equal(valid.status,200,"Local workerd must persist in real staging with verified TLS");
} catch(error) { console.error("Workerd verification failed:",error instanceof assert.AssertionError?error.message.split("\n")[0]:"runtime startup or transport failure; details suppressed");process.exitCode=1; }
finally {await worker?.stop();}
