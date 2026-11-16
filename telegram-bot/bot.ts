import { messageDraft,renderDraft,type Draft } from "./conversation.ts";
import { Bot } from "grammy";
import { createHash,randomBytes } from "node:crypto";
import type { UserFromGetMe } from "grammy/types";
import type { Gateway } from "./gateway.ts";
import type { State } from "./store.ts";
export const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export function createBot(token:string,port:Gateway,store:{state:State;save:()=>void;sign:(value:string)=>string},info?:UserFromGetMe) {
 const bot=new Bot(token,{client:{timeoutSeconds:35},...(info?{botInfo:info}:{})});
 bot.use(async(ctx,next)=>{
  if(ctx.chat?.type!=="private" || !ctx.from || String(ctx.from.id)!==String(ctx.chat.id))return;
  if(![ctx.from.id,ctx.chat.id,ctx.me.id].every(Number.isSafeInteger))return;
  if(ctx.message && Math.abs(Date.now()/1000-ctx.message.date)>900) { await ctx.reply("Este mensaje venció y no se procesó. Envía uno nuevo o revisa /borrador.");return; }
  await next();
 });
 async function authorized(user:string,chat:string,botId:string) {
  for(const record of store.state.credentials.filter(r=>r.user===user).reverse()) {
   const context=await port.context(record.capability,botId,user,chat);if(context)return {...context,capability:record.capability};
  }
  return null;
 }
 bot.command("start",async(ctx)=>{
  const challenge=ctx.match.trim(),user=String(ctx.from!.id),chat=String(ctx.chat.id),botId=String(ctx.me.id);
  if(!challenge) { await ctx.reply(await authorized(user,chat,botId)?"Tu cuenta está vinculada a Finzi. Puedes desvincularla desde Mi perfil.":"Abre Mi perfil en Finzi para vincular tu cuenta de Telegram.");return; }
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
 async function response(c:Record<string,string>,draft:Draft){return renderDraft(port,c,draft,await port.catalog(c),store.sign);}
 const expected=(error:unknown)=>["42501","40001","23514","P0002","22008","22P02","54000"].includes((error as {code?:string}).code??"");
 bot.on("callback_query",async(ctx)=>{
  const c=await authorized(String(ctx.from.id),String(ctx.chat!.id),String(ctx.me.id));
  if(!c||!/^f4:[a-f0-9]{48}$/.test(ctx.callbackQuery.data??"")){await ctx.answerCallbackQuery({text:"Esta opción no está disponible."});return;}
  await ctx.answerCallbackQuery();
  try{const draft:Draft=await port.command(c,{action:"choice",tokenHash:hash(ctx.callbackQuery.data!),updateId:String(ctx.update.update_id)});const output=await response(c,draft);await ctx.reply(output.text,{reply_markup:output.keyboard});}
  catch(error){if(!expected(error))throw error;await ctx.reply("La opción cambió o venció. Usa /borrador para revisar el estado actual, o /cancelar para empezar de nuevo.");}
 });
 bot.on("message:text",async(ctx)=>{
  const c=await authorized(String(ctx.from.id),String(ctx.chat.id),String(ctx.me.id));
  if(!c){await ctx.reply("Vincula tu cuenta desde Mi perfil en Finzi para continuar.");return;}
  if(ctx.message.text.length>2000){await ctx.reply("Usa un mensaje de hasta 2000 caracteres.");return;}
  try{const draft=await messageDraft(port,c,ctx.message.text,String(ctx.update.update_id),new Date(ctx.message.date*1000).toISOString());
   if(typeof draft==="string"){await ctx.reply(draft);return;}const output=await response(c,draft);await ctx.reply(output.text,{reply_markup:output.keyboard});
  }catch(error){if(!expected(error))throw error;await ctx.reply("No pudimos actualizar el borrador: puede haber vencido o haber cambiado la cuenta, categoría o zona horaria. Revisa /borrador o usa /cancelar. No se registró ningún movimiento.");}
 });
 bot.on("message",async(ctx)=>{await ctx.reply("Por ahora solo se interpretan mensajes de texto. No envíes comprobantes o datos sensibles.");});
 return bot;
}

export async function pruneCredentials(port:Pick<Gateway,"context">,store:{state:State;save:()=>void},botId:string){
 const retained:State["credentials"]=[];
 for(const record of store.state.credentials){
  if(Date.now()-record.createdAt<300000 || await port.context(record.capability,botId,record.user,record.user))retained.push(record);
 }
 if(retained.length!==store.state.credentials.length){store.state.credentials=retained;store.save();}
}
