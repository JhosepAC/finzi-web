import { Bot } from "grammy";
import { createHash,randomBytes } from "node:crypto";
import type { UserFromGetMe } from "grammy/types";
import type { Gateway } from "./gateway.ts";
import type { State } from "./store.ts";
export const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export function createBot(token:string,port:Gateway,store:{state:State;save:()=>void},info?:UserFromGetMe) {
 const bot=new Bot(token,{client:{timeoutSeconds:35},...(info?{botInfo:info}:{})});
 bot.use(async(ctx,next)=>{
  if(ctx.chat?.type!=="private" || !ctx.from || String(ctx.from.id)!==String(ctx.chat.id))return;
  if(![ctx.from.id,ctx.chat.id,ctx.me.id].every(Number.isSafeInteger))return;
  if(ctx.message && Math.abs(Date.now()/1000-ctx.message.date)>900) { await ctx.reply("Este mensaje venció. Abre un enlace nuevo desde Mi perfil en Finzi.");return; }
  await next();
 });
 async function linked(user:string,chat:string,botId:string) {
  for(const record of store.state.credentials.filter(r=>r.user===user).reverse()) {
   if(await port.context(record.capability,botId,user,chat))return true;
  }
  return false;
 }
 bot.command("start",async(ctx)=>{
  const challenge=ctx.match.trim(),user=String(ctx.from!.id),chat=String(ctx.chat.id),botId=String(ctx.me.id);
  if(!challenge) { await ctx.reply(await linked(user,chat,botId)?"Tu cuenta está vinculada a Finzi. Puedes desvincularla desde Mi perfil.":"Abre Mi perfil en Finzi para vincular tu cuenta de Telegram.");return; }
  if(!/^[a-f0-9]{64}$/.test(challenge)) { await ctx.reply("El enlace no es válido. Genera uno nuevo desde Mi perfil en Finzi.");return; }
  let record=store.state.credentials.find(r=>r.user===user&&r.challengeHash===hash(challenge));
  if(!record) {
   const mine=store.state.credentials.filter(r=>r.user===user);
   if(mine.filter(r=>Date.now()-r.createdAt<15*60*1000).length>=5){await ctx.reply("Espera unos minutos antes de intentar otro enlace.");return;}
   store.state.credentials=store.state.credentials.filter(r=>Date.now()-r.createdAt<31*86400000);
   record={user,challengeHash:hash(challenge),capability:randomBytes(32).toString("hex"),createdAt:Date.now()};store.state.credentials.push(record);store.save();
  }
  try { await port.claim(challenge,botId,user,chat,hash(record.capability)); }
  catch(error) { if(["42501","23514"].includes((error as {code?:string}).code??"")){await ctx.reply("El enlace venció o ya pertenece a otro intento. Genera uno nuevo en Finzi.");return;}throw error; }
  await ctx.reply(`Solicitud recibida. Tu identificador de Telegram es ${user}. Vuelve a Mi perfil en Finzi, comprueba el identificador y confirma la vinculación.`);
 });
 bot.on("callback_query",async(ctx)=>{await ctx.answerCallbackQuery({text:"Esta acción no está disponible. Revisa tu vínculo en Finzi."});});
 bot.on("message",async(ctx)=>{await ctx.reply(await linked(String(ctx.from.id),String(ctx.chat.id),String(ctx.me.id))?"Tu vínculo con Finzi está activo. El registro y las consultas financieras todavía no están habilitados.":"Vincula tu cuenta desde Mi perfil en Finzi para continuar.");});
 return bot;
}

export async function pruneCredentials(port:Gateway,store:{state:State;save:()=>void},botId:string){
 const retained:State["credentials"]=[];
 for(const record of store.state.credentials){
  if(Date.now()-record.createdAt<300000 || await port.context(record.capability,botId,record.user,record.user))retained.push(record);
 }
 if(retained.length!==store.state.credentials.length){store.state.credentials=retained;store.save();}
}
