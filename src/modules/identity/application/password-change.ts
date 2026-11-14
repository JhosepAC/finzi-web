export type SecurityFailure={code?:string;status?:number}|null;
export interface PasswordChangeGateway {
 consumeProof():Promise<boolean>;
 updatePassword(password:string):Promise<SecurityFailure>;
 logoutGlobal():Promise<SecurityFailure>;
}
export type PasswordChangeResult={status:number;body:{ok:boolean;message:string;code?:string;passwordChanged?:boolean;redirectTo?:string}};
const needsProof=(status=403):PasswordChangeResult=>({status,body:{ok:false,code:"REAUTH_REQUIRED",message:"Confirma de nuevo tu contraseña actual antes de cambiarla."}});
const uncertain=():PasswordChangeResult=>({status:503,body:{ok:false,code:"CHANGE_UNCONFIRMED",message:"No pudimos confirmar el cambio. Comprueba el acceso con la nueva contraseña o usa recuperación antes de volver a cambiarla."}});
const incomplete=():PasswordChangeResult=>({status:503,body:{ok:false,code:"PASSWORD_CHANGED_SIGNOUT_INCOMPLETE",passwordChanged:true,message:"La contraseña cambió, pero falta cerrar las sesiones. Reintenta el cierre global."}});
export async function changeOwnPassword(password:string,gateway:PasswordChangeGateway):Promise<PasswordChangeResult> {
 let attempted=false,changed=false;
 try {
  if(!await gateway.consumeProof())return needsProof();
  attempted=true;const error=await gateway.updatePassword(password);
  if(error){if((error.status??500)>=500)return uncertain();return {status:error.status===429?429:422,body:{ok:false,code:"REAUTH_REQUIRED",message:error.code==="same_password"?"Elige una contraseña diferente. Confirma de nuevo tu contraseña actual.":"No pudimos cambiar la contraseña. Confirma de nuevo la actual antes de reintentar."}};}
  changed=true;if(await gateway.logoutGlobal())return incomplete();
  return {status:200,body:{ok:true,passwordChanged:true,message:"Contraseña actualizada. Inicia sesión con la nueva contraseña.",redirectTo:"/login?notice=password-updated"}};
 }catch{return changed?incomplete():attempted?uncertain():needsProof(503);}
}
