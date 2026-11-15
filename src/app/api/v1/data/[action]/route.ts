import { NextRequest } from "next/server";
import { z } from "zod";
import { createAuthClient } from "@/modules/identity/infrastructure/supabase-server";
import { getFieldErrors } from "@/modules/identity/domain/auth";
import { dataReauthSchema,exportSchema,deletionSchema,receiptSchema,csvSnapshotSchema,csvLines } from "@/modules/identity/domain/portability";
import { cookieReceipt,dataBody,dataCookie,dataReply,downloadHeaders,newReceipt,receiptCookie,setDataCookie } from "@/modules/identity/infrastructure/data-http";
export const dynamic="force-dynamic";
export const maxDuration=60;
const empty=z.object({}).strict();
export async function GET(request:NextRequest,{params}:{params:Promise<{action:string}>}){
 if((await params).action!=="deletion-status")return dataReply(405,{ok:false,message:"Usa el formulario para esta operación."});
 const receipt=cookieReceipt(request);if(!receipt)return dataReply(404,{ok:false,message:"Carga tu comprobante privado para consultar el estado."});
 try{const client=await createAuthClient();if(!client)throw new Error();const r=await client.schema("api").rpc("deletion_status",{p_id:receipt.requestId,p_tracking_token:receipt.trackingToken});if(r.error)throw new Error();return r.data?dataReply(200,{ok:true,receipt:r.data}):dataReply(404,{ok:false,message:"Todavía no hay una solicitud con este comprobante. Si el envío fue interrumpido, puedes volver a enviarlo con los mismos datos."});}catch{return dataReply(503,{ok:false,message:"No pudimos consultar el estado. Conserva tu comprobante y reintenta."});}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}){
 const action=(await params).action;if(!["reauthenticate","export","prepare-deletion","request-deletion","load-receipt","forget-receipt"].includes(action))return dataReply(404,{ok:false,message:"No se encontró esta operación."});
 const input=await dataBody(request);if(input.response)return input.response;
 const schema=action==="reauthenticate"?dataReauthSchema:action==="export"?exportSchema:action==="request-deletion"?deletionSchema:action==="load-receipt"?receiptSchema:empty;
 const parsed=schema.safeParse(input.input);if(!parsed.success)return dataReply(422,{ok:false,message:"Revisa los campos indicados.",fieldErrors:getFieldErrors(parsed.error)});
 try{
  if(action==="forget-receipt"){await setDataCookie(receiptCookie,"",0);return dataReply(200,{ok:true});}
  if(action==="load-receipt"){await setDataCookie(receiptCookie,JSON.stringify(receiptSchema.parse(parsed.data)),60*60*24*30);return dataReply(200,{ok:true});}
  const client=await createAuthClient();if(!client)throw new Error();const identity=await client.auth.getUser();if(identity.error||!identity.data.user?.email_confirmed_at)return dataReply(401,{ok:false,message:"Tu sesión terminó. Inicia sesión de nuevo; tu comprobante permite consultar una eliminación ya enviada."});
  const identityReadAt=new Date().toISOString();
  if(action==="prepare-deletion")return dataReply(200,{ok:true,receipt:newReceipt()});
  if(action==="reauthenticate"){
   const d=dataReauthSchema.parse(parsed.data);const signed=await client.auth.signInWithPassword({email:identity.data.user.email!,password:d.password});
   if(signed.error)return dataReply(signed.error.status===429?429:(signed.error.status??500)>=500?503:401,{ok:false,message:"No pudimos confirmar tu contraseña. Revisa la actual y reintenta."});
   if(signed.data.user.id!==identity.data.user.id){await client.auth.signOut({scope:"local"});return dataReply(401,{ok:false,message:"Tu identidad cambió. Inicia sesión de nuevo."});}
   const proof=await client.schema("api").rpc("issue_reauth_proof",{p_purpose:d.purpose});if(proof.error||!proof.data?.token)return dataReply(proof.error?.code==="54000"?429:503,{ok:false,message:"No pudimos autorizar la operación. Espera unos minutos y confirma de nuevo tu contraseña."});
   await setDataCookie(dataCookie(d.purpose),proof.data.token,300);return dataReply(200,{ok:true,expiresAt:proof.data.expires_at,purpose:d.purpose});
  }
  if(action==="request-deletion"){
   const d=deletionSchema.parse(parsed.data);await setDataCookie(receiptCookie,JSON.stringify({requestId:d.requestId,trackingToken:d.trackingToken}),60*60*24*30);
   const r=await client.schema("api").rpc("request_deletion",{p_request_id:d.requestId,p_tracking_token:d.trackingToken,p_proof:request.cookies.get(dataCookie("delete_account"))?.value??"",p_confirmation:d.confirmation});
   if(r.error?.code==="42501")return dataReply(403,{ok:false,code:"REAUTH_REQUIRED",message:"Confirma tu contraseña para esta eliminación y vuelve a enviar el mismo comprobante."});
   if(r.error?.code==="40001"||r.error?.code==="23505")return dataReply(409,{ok:false,message:"Ya existe otra solicitud para esta cuenta. Conserva el comprobante original para consultarla."});
   if(r.error)throw new Error();
   await setDataCookie(dataCookie("delete_account"),"",0);
   // Revocation is also performed durably by the worker; a failed local sign-out cannot cancel the accepted request.
   try{await client.auth.signOut({scope:"global"});}catch{/* Worker completes revocation. */}
   return dataReply(202,{ok:true,requestId:d.requestId,redirectTo:"/deletion"});
  }
  const d=exportSchema.parse(parsed.data);const p=d.format==="csv"?d:null;
  const result=await client.schema("api").rpc("export_personal_data",{p_proof:request.cookies.get(dataCookie("export_data"))?.value??"",p_format:d.format,p_currency:p?.currency??"PEN",p_kind:p?.kind??null,p_account_id:p?.accountId??null,p_category_id:p?.categoryId??null,p_from:p?.from??null,p_to:p?.to??null,p_query:p?.query??"",p_status:p?.status??"all"});
  if(result.error?.code==="42501")return dataReply(403,{ok:false,code:"REAUTH_REQUIRED",message:"Confirma tu contraseña para exportar antes de descargar."});
  if(result.error?.code==="54000")return dataReply(429,{ok:false,message:"Límite inicial: tres exportaciones por hora. Espera antes de solicitar otra, sin pagar una mejora."});
  if(result.error?.code==="P0002"||result.error?.code==="23514")return dataReply(422,{ok:false,message:"Revisa la moneda, las fechas y los filtros propios."});
  if(result.error||!result.data)throw new Error();await setDataCookie(dataCookie("export_data"),"",0);
  const stamp=new Date().toISOString().slice(0,10);
  if(d.format==="json"){
   const output={...result.data,identity:{id:identity.data.user.id,email:identity.data.user.email,email_confirmed_at:identity.data.user.email_confirmed_at,created_at:identity.data.user.created_at,updated_at:identity.data.user.updated_at,last_sign_in_at:identity.data.user.last_sign_in_at},identity_read_at:identityReadAt};
   const json=JSON.stringify(output,null,2);if(Buffer.byteLength(json)>128*1024*1024)return dataReply(413,{ok:false,message:"La exportación supera el límite inicial de 128 MiB. No se descargó un archivo incompleto. Se requiere un proceso de portabilidad de mayor capacidad antes de ampliar este límite."});
   return new Response(json,{headers:downloadHeaders("json",`finzi-datos-${stamp}.json`)});
  }
  const snapshot=csvSnapshotSchema.parse(result.data),encoder=new TextEncoder(),lines=csvLines(snapshot);
  const stream=new ReadableStream<Uint8Array>({pull(controller){const next=lines.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(next.value));},cancel(){lines.return(undefined);}});
  return new Response(stream,{headers:downloadHeaders("csv",`finzi-movimientos-${snapshot.currency}-${stamp}.csv`)});
 }catch{return dataReply(503,{ok:false,message:action==="request-deletion"?"No pudimos confirmar la solicitud. Conserva el comprobante: consulta su estado o reenvía los mismos datos; no crees otra solicitud.":"No pudimos completar la operación. Una autorización ya usada debe confirmarse de nuevo antes de reintentar."});}
}
