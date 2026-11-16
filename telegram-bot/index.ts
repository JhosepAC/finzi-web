import { safeDiagnostic,type RuntimeStage } from "./diagnostics.ts";
import { queryCommands } from "./queries.ts";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { gateway } from "./gateway.ts";
import { openStore } from "./store.ts";
import { createBot,pruneCredentials } from "./bot.ts";
import { drain,receive } from "./polling.ts";
import { BotError, GrammyError } from "grammy";
let stage:RuntimeStage="configuration";
async function main() {
 if(process.argv.slice(2).some(arg=>arg!=="--check"))throw new Error("Unknown runtime option");
 const token=process.env.TELEGRAM_BOT_TOKEN??"",url=process.env.TELEGRAM_DATABASE_URL??"";
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(token) || !url)throw new Error("Configure TELEGRAM_BOT_TOKEN and TELEGRAM_DATABASE_URL locally");
 const base=path.join(homedir(),process.platform==="win32"?"AppData/Local":".local/share","Finzi","telegram");
 const key=process.env.FINZI_TELEGRAM_KEY_PATH??path.join(base,"keys","custody.key");
 if(!existsSync(key))throw new Error("Run telegram:setup first");
 const port=gateway(url),stop=new AbortController();
 const shutdown=()=>stop.abort(); process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);
 try {
  stage="identity";
  const probe=createBot(token,port,{state:{botId:"0",offset:0,inbox:[],credentials:[]},save:()=>{},sign:()=>""});await probe.init();
  const info=probe.botInfo;
  if(!Number.isSafeInteger(info.id))throw new Error("Unsafe bot identity");
  if(process.env.TELEGRAM_BOT_USERNAME && process.env.TELEGRAM_BOT_USERNAME.toLowerCase()!==info.username?.toLowerCase())throw new Error("Configured bot username does not match token identity");
  await port.checkConnection();
  const webhook=await probe.api.getWebhookInfo();if(webhook.url)throw new Error("Remove the existing webhook explicitly before polling");
  stage="custody";
  const store=openStore(process.env.FINZI_TELEGRAM_STORE??path.join(base,"store"),key,String(info.id));
  const bot=createBot(token,port,store,info);
  if(process.argv.includes("--check")){console.log("Telegram configuration, identity, custody and restricted connection verified.");return;}
  stage="lease";
  await port.lock(String(info.id));
  stage="commands";
  await bot.api.setMyCommands([{command:"start",description:"Vincular o revisar tu cuenta de Finzi"},{command:"borrador",description:"Revisar el borrador vigente"},{command:"cancelar",description:"Cancelar el borrador sin registrar dinero"},...queryCommands.map(command=>({command,description:({hoy:"Resumen de hoy",semana:"Últimos siete días",mes:"Resumen del mes",saldo:"Saldos por cuenta",gastos:"Gastos por categoría",ingresos:"Ingresos del mes",cuentas:"Cuentas y estados",categorias:"Categorías y disponibilidad",pendientes:"Borradores del bot"})[command]}))]);
  console.log("Finzi Telegram: local polling started.");let failures=0,lastPrune=0;
  while(!stop.signal.aborted) {
   try {
    stage="lease";await port.assertLock();
    stage="dispatch";await drain(store,u=>bot.handleUpdate(u));
    if(Date.now()-lastPrune>300000){stage="maintenance";await pruneCredentials(port,store,String(info.id));await port.sweepQueries();lastPrune=Date.now();}
    stage="polling";const updates=await bot.api.getUpdates({offset:store.state.offset,timeout:20,limit:100,allowed_updates:["message","callback_query"]},stop.signal as unknown as NonNullable<Parameters<typeof bot.api.getUpdates>[1]>);
    receive(store,updates);failures=0;
   } catch(error) {
    if(stop.signal.aborted)break;
    console.error(JSON.stringify({...safeDiagnostic(error,stage),attempt:failures+1}));
    const original=error instanceof BotError?error.error:error;
    if(original instanceof Error && original.message==="Custody failure")throw original;
    if((error as Error).message==="Poller lease lost; restart explicitly")throw error;
    if(original instanceof GrammyError && original.error_code===409)throw new Error("Another Telegram consumer is active");
    if(++failures>=5)throw new Error("Repeated polling or delivery failure; durable inbox preserved");
    const seconds=original instanceof GrammyError?original.parameters.retry_after??Math.min(2**failures,30):Math.min(2**failures,30);
    await new Promise<void>(resolve=>{const timer=setTimeout(resolve,seconds*1000);stop.signal.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true});});
   }
  }
 } finally {process.removeListener("SIGINT",shutdown);process.removeListener("SIGTERM",shutdown);await port.close();}
}
main().catch(error=>{console.error(JSON.stringify(safeDiagnostic(error,stage)));console.error("Finzi Telegram could not start or continue. Check local configuration, custody and connectivity. No credentials were logged.");process.exitCode=1;});
