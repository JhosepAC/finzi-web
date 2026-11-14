import { NextRequest,NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAuthClient } from "@/modules/identity/infrastructure/supabase-server";
import { getAuthEnvironment } from "@/modules/identity/infrastructure/environment";
import { changeOwnPassword } from "@/modules/identity/application/password-change";
import { reauthSchema,changePasswordSchema } from "@/modules/identity/domain/security";
import { getFieldErrors } from "@/modules/identity/domain/auth";
import { securityStatus,proofCookie,proofCookiePath } from "@/modules/identity/infrastructure/security";
export const dynamic="force-dynamic";
const reply=(status:number,body:object)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
export async function GET(request:NextRequest,{params}:{params:Promise<{action:string}>}) {
 if((await params).action!=="status")return reply(405,{ok:false,message:"Esta operación requiere un formulario."});
 try { const client=await createAuthClient();const status=client && await securityStatus(client,request.cookies.get(proofCookie)?.value);return status?reply(200,{ok:true,...status}):reply(401,{ok:false,message:"Tu sesión terminó. Inicia sesión de nuevo."}); }
 catch {return reply(503,{ok:false,message:"No pudimos comprobar tu sesión. Reintenta para actualizarla."});}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}) {
 const action=(await params).action;if(!["reauthenticate","change-password"].includes(action))return reply(404,{ok:false,message:"No se encontró esta operación."});
 const env=getAuthEnvironment();if(!env)return reply(503,{ok:false,message:"La seguridad no está disponible ahora."});
 if(request.headers.get("origin")!==env.origin || request.headers.get("sec-fetch-site")==="cross-site")return reply(403,{ok:false,message:"Recarga la página para continuar."});
 if(!request.headers.get("content-type")?.startsWith("application/json"))return reply(415,{ok:false,message:"El formato no es válido."});
 let input:unknown;const reader=request.body?.getReader();if(!reader)return reply(400,{ok:false,message:"La solicitud está vacía."});
 try { const chunks:Uint8Array[]=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return reply(413,{ok:false,message:"La solicitud es demasiado grande."});}chunks.push(value);}input=JSON.parse(Buffer.concat(chunks).toString("utf8")); }
 catch{return reply(400,{ok:false,message:"La solicitud no es válida."});}
 const parsed=(action==="reauthenticate"?reauthSchema:changePasswordSchema).safeParse(input);
 if(!parsed.success)return reply(422,{ok:false,message:"Revisa los campos indicados.",fieldErrors:getFieldErrors(parsed.error)});
 try {
  const client=await createAuthClient();if(!client)return reply(503,{ok:false,message:"La seguridad no está disponible ahora."});
  const identity=await client.auth.getUser();if(identity.error || !identity.data.user?.email_confirmed_at)return reply(401,{ok:false,code:"SESSION_EXPIRED",message:"Tu sesión terminó. Inicia sesión de nuevo."});
  const jar=await cookies();
  if(action==="reauthenticate") {
   const signed=await client.auth.signInWithPassword({email:identity.data.user.email!,password:parsed.data.password});
   if(signed.error?.status===429)return reply(429,{ok:false,message:"Espera unos minutos antes de intentar confirmar tu contraseña de nuevo."});
   if(signed.error)return reply((signed.error.status??500)>=500?503:401,{ok:false,code:"REAUTH_FAILED",message:"No pudimos confirmar tu contraseña. Revisa la contraseña actual y reintenta."});
   if(signed.data.user.id!==identity.data.user.id){await client.auth.signOut({scope:"local"});return reply(401,{ok:false,code:"SESSION_EXPIRED",message:"Tu identidad cambió. Inicia sesión de nuevo."});}
   const proof=await client.schema("api").rpc("issue_reauth_proof",{p_purpose:"change_password"});
   if(proof.error?.code==="54000")return reply(429,{ok:false,message:"Has confirmado varias veces. Espera cinco minutos antes de volver a intentarlo."});
   if(proof.error || !proof.data?.token)return reply(503,{ok:false,message:"No pudimos confirmar una autorización segura. Reintenta tu contraseña."});
   jar.set(proofCookie,proof.data.token,{httpOnly:true,secure:env.secure,sameSite:"strict",path:proofCookiePath,maxAge:300});
   return reply(200,{ok:true,message:"Contraseña confirmada. Puedes cambiarla durante los próximos cinco minutos.",expiresAt:proof.data.expires_at});
  }
  const result=await changeOwnPassword(parsed.data.password,{
   async consumeProof(){const proof=await client.schema("api").rpc("consume_reauth_proof",{p_token:request.cookies.get(proofCookie)?.value??"",p_purpose:"change_password"});if(proof.error)throw new Error("No se pudo consumir la autorización.");return proof.data===true;},
   async updatePassword(password){const result=await client.auth.updateUser({password});return result.error?{code:result.error.code,status:result.error.status}:null;},
   async logoutGlobal(){const result=await client.auth.signOut({scope:"global"});return result.error?{code:result.error.code,status:result.error.status}:null;},
  });
  jar.set(proofCookie,"",{httpOnly:true,secure:env.secure,sameSite:"strict",path:proofCookiePath,maxAge:0});
  return reply(result.status,result.body);
 } catch{return reply(503,{ok:false,code:action==="change-password"?"CHANGE_UNCONFIRMED":"UNAVAILABLE",message:action==="change-password"?"No pudimos confirmar el cambio. Comprueba el acceso con la nueva contraseña o usa recuperación antes de volver a cambiarla.":"No pudimos comprobar tu contraseña. Reintenta cuando recuperes la conexión."});}
}
