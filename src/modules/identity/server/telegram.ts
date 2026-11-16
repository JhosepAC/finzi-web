import "server-only";
import { randomBytes,createHash } from "node:crypto";
import { createUserScopedClient } from "../server";
import { telegramAction,telegramStatus } from "../domain/telegram";
import { dataBody,dataReply } from "../infrastructure/data-http";
import type { NextRequest } from "next/server";
const username=()=>/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(process.env.TELEGRAM_BOT_USERNAME??"")&&/bot$/i.test(process.env.TELEGRAM_BOT_USERNAME??"")?process.env.TELEGRAM_BOT_USERNAME!:null;
async function verified(){const c=await createUserScopedClient();if(!c)return null;const u=await c.auth.getUser();return !u.error&&u.data.user?.email_confirmed_at?c:null;}
export async function readTelegram(){
 try{const c=await verified();if(!c)return dataReply(401,{ok:false,message:"Inicia sesión para gestionar Telegram."});
 const result=await c.schema("api").rpc("telegram_link_status");if(result.error)throw new Error();
 const data=telegramStatus.parse({...result.data,username:username()});return dataReply(200,{ok:true,...data});
 }catch{return dataReply(503,{ok:false,message:"No pudimos cargar la conexión con Telegram."});}
}
export async function changeTelegram(request:NextRequest){
 const body=await dataBody(request);if(body.response)return body.response;
 const parsed=telegramAction.safeParse(body.input);if(!parsed.success)return dataReply(422,{ok:false,message:"Revisa la acción solicitada."});
 try{const c=await verified();if(!c)return dataReply(401,{ok:false,message:"Inicia sesión para gestionar Telegram."});
 const d=parsed.data;let result;let challenge:string|undefined;
 if(d.action==="create"){
  if(!username())return dataReply(503,{ok:false,message:"Telegram aún no está configurado."});
  challenge=randomBytes(32).toString("hex");result=await c.schema("api").rpc("telegram_issue_link",{p_challenge_hash:createHash("sha256").update(challenge).digest("hex")});
 }else if(d.action==="activate")result=await c.schema("api").rpc("telegram_activate_link",{p_attempt:d.attemptId});
 else if(d.action==="movement-permission")result=await c.schema("api").rpc("telegram_set_movement_permission",{p_id:d.linkId,p_version:d.expectedVersion,p_allow:d.allow});
 else result=await c.schema("api").rpc("telegram_revoke_link_versioned",{p_id:d.linkId,p_version:d.expectedVersion});
 if(result.error){const code=result.error.code;return dataReply(code==="54000"?429:code==="23505"||code==="40001"?409:code==="42501"||code==="P0002"?403:503,{ok:false,message:code==="54000"?"Espera unos minutos antes de generar otro enlace.":code==="23505"?"Ya existe una cuenta vinculada. Desvincúlala antes de continuar.":"El vínculo cambió o venció. Actualiza su estado antes de continuar."});}
 return dataReply(200,{ok:true,...(challenge?{challenge,expiresAt:result.data.expires_at}:{} )});
 }catch{return dataReply(503,{ok:false,message:"No pudimos confirmar la acción. Actualiza el estado antes de reintentar."});}
}
