import "server-only";
import { randomBytes,randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest,NextResponse } from "next/server";
import { getAuthEnvironment } from "./environment";
import { receiptSchema } from "../domain/portability";
export const receiptCookie="finzi-deletion-receipt";
export const dataPath="/api/v1/data";
export const dataCookie=(purpose:"export_data"|"delete_account")=>`finzi-${purpose}-proof`;
export const dataReply=(status:number,body:object)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
export async function dataBody(request:NextRequest):Promise<{input:unknown;response?:never}|{response:NextResponse;input?:never}>{
 const env=getAuthEnvironment();if(!env)return{response:dataReply(503,{ok:false,message:"Tus datos no están disponibles ahora."})};
 if(request.headers.get("origin")!==env.origin||request.headers.get("sec-fetch-site")==="cross-site")return{response:dataReply(403,{ok:false,message:"Recarga la página para continuar."})};
 if(!request.headers.get("content-type")?.startsWith("application/json"))return{response:dataReply(415,{ok:false,message:"El formato no es válido."})};
 const reader=request.body?.getReader();if(!reader)return{response:dataReply(400,{ok:false,message:"La solicitud está vacía."})};
 try{let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return{response:dataReply(413,{ok:false,message:"La solicitud es demasiado grande."})};}chunks.push(value);}return{input:JSON.parse(Buffer.concat(chunks).toString("utf8"))};}catch{return{response:dataReply(400,{ok:false,message:"La solicitud no es válida."})};}
}
export async function setDataCookie(name:string,value:string,maxAge:number){const env=getAuthEnvironment()!;const jar=await cookies();jar.set(name,value,{httpOnly:true,secure:env.secure,sameSite:"strict",path:dataPath,maxAge});}
export function newReceipt(){return{requestId:randomUUID(),trackingToken:randomBytes(32).toString("hex")};}
export function cookieReceipt(request:NextRequest){try{return receiptSchema.parse(JSON.parse(request.cookies.get(receiptCookie)?.value??""));}catch{return null;}}
export const downloadHeaders=(format:"json"|"csv",name:string)=>({"Content-Type":format==="json"?"application/json; charset=utf-8":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${name}"`,"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'"});
