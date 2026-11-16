import { InlineKeyboard } from "grammy";
import type { Gateway } from "./gateway.ts";
import { availableAccounts,availableCategories,clarify,parseMessage,type Catalog,type Field,type Payload } from "./parser.ts";
import { openingMinor,formatMoney } from "../src/shared/money.ts";
import { createHash } from "node:crypto";
export type Draft={id:string;version:number;state:string;payload:Payload;awaiting:Field|null;expiresAt:string;page?:number};
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const labels:Record<Field,string>={kind:"Tipo",amount:"Importe",currency:"Moneda",accountId:"Cuenta",categoryId:"Categoría",description:"Concepto",occurredAt:"Fecha"};
const prompts:Record<Field,string>={kind:"¿Es un ingreso o un gasto?",amount:"¿Cuál es el importe? Escribe solo una cifra positiva, por ejemplo 25.50.",currency:"¿En qué moneda?",accountId:"Elige la cuenta que usaste.",categoryId:"Elige una categoría.",description:"Escribe un concepto de 1 a 200 caracteres.",occurredAt:"Escribe la fecha y hora: AAAA-MM-DD HH:mm, en tu zona horaria."};
export async function renderDraft(port:Gateway,c:Record<string,string>,draft:Draft,catalog:Catalog,sign:(v:string)=>string){
 if(!["needs_input","pending"].includes(draft.state))return {text:draft.state==="cancelled"?"Borrador cancelado. No se registró ningún movimiento.":"Este borrador venció. Envía un mensaje nuevo.",keyboard:undefined};
 const p=draft.payload,account=catalog.accounts.find(a=>a.id===p.accountId),category=catalog.categories.find(a=>a.id===p.categoryId);
 const categoryLabel=category?.parent_id?`${catalog.categories.find(c=>c.id===category.parent_id)?.name??"Categoría"} / ${category.name}`:category?.name;
 const amount=p.amount&&p.currency?formatMoney(openingMinor(p.amount),p.currency):p.amount??"Por indicar";
 const date=p.occurredAt?new Intl.DateTimeFormat("es-PE",{dateStyle:"short",timeStyle:"short",timeZone:p.timezone}).format(new Date(p.occurredAt)):"Por indicar";
 let text=`Borrador ${p.kind==="expense"?"de gasto":p.kind==="income"?"de ingreso":"de movimiento"} · Sin registrar\nImporte: ${amount}\nCuenta: ${account?.name??"Por elegir"}\nCategoría: ${categoryLabel??"Por elegir"}\nConcepto: ${p.description??"Por indicar"}\nFecha: ${date} (${p.timezone})\nVence: ${new Intl.DateTimeFormat("es-PE",{timeStyle:"short",timeZone:p.timezone}).format(new Date(draft.expiresAt))}`;
 if((p.accountId&&account?.status!=="active")||(p.categoryId&&(!category||category.effective_archived))||p.timezone!==catalog.timezone)text+="\nRevisa los datos: cambió la disponibilidad de la cuenta, categoría o zona horaria.";
 if(p.warnings.length)text+="\n\n"+p.warnings.join("\n");
 const choices:{label:string;field:string;value:string}[]=[];
 const field=draft.awaiting;
 if(field){text+="\n\n"+prompts[field];
  if(field==="kind")choices.push({label:"Gasto",field,value:"expense"},{label:"Ingreso",field,value:"income"});
  if(field==="currency")choices.push({label:"Soles · PEN",field,value:"PEN"},{label:"Dólares · USD",field,value:"USD"});
  if(field==="accountId"||field==="categoryId"){
   const options=field==="accountId"?availableAccounts(catalog,p).map(a=>({label:a.name+" · "+a.currency_code,field,value:a.id})):availableCategories(catalog,p).map(a=>({label:a.parent_id?`${catalog.categories.find(c=>c.id===a.parent_id)?.name??"Categoría"} / ${a.name}`:a.name,field,value:a.id}));
   const page=Math.min(draft.page??0,Math.max(0,Math.ceil(options.length/20)-1));choices.push(...options.slice(page*20,page*20+20));
   if(page>0)choices.push({label:"Anterior",field:"page",value:String(page-1)});
   if((page+1)*20<options.length)choices.push({label:"Siguiente",field:"page",value:String(page+1)});
   if(!options.length){text+="\nNo hay opciones activas compatibles. Revisa tus cuentas o categorías en Finzi.";choices.push({label:"Cambiar moneda",field:"edit",value:"currency"});}
  }
 }else{text+="\n\nVista previa completa. Todavía no se ha registrado. Puedes corregir los datos o cancelar; el registro se habilitará en la siguiente fase.";
  choices.push(...Object.entries(labels).map(([value,label])=>({label:"Corregir "+label.toLowerCase(),field:"edit",value})));
 }
 choices.push({label:"Cancelar borrador",field:"cancel",value:"cancel"});
 const keyboard=new InlineKeyboard();const rows=choices.map(choice=>{const token="f4:"+sign(JSON.stringify([draft.id,draft.version,choice.field,choice.value]));keyboard.text(choice.label,token).row();return {hash:hash(token),field:choice.field,value:choice.value};});
 await port.callbacks(c,draft.id,draft.version,rows);return {text,keyboard};
}
export async function messageDraft(port:Gateway,c:Record<string,string>,text:string,updateId:string,receivedAt:string):Promise<Draft|string>{
 const replay:Draft|null=await port.command(c,{action:"replay",updateId});if(replay)return replay;
 const catalog:Catalog=await port.catalog(c),current:Draft|null=await port.command(c,{action:"read"});
 if(text==="/borrador")return current??"No tienes un borrador vigente.";
 if(text==="/cancelar")return current?await port.command(c,{action:"cancel",id:current.id,version:current.version,updateId}):"No tienes un borrador vigente.";
 if(text.startsWith("/"))return "Usa /borrador para revisar tu borrador o /cancelar para descartarlo. Describe un ingreso o gasto para empezar.";
 const parsed=parseMessage(text,catalog,receivedAt);
 if(current){
  if(parsed.recognized)return "Tienes un borrador en curso. Revísalo con /borrador o usa /cancelar antes de enviar otro movimiento.";
  if(!current.awaiting)return "Usa los botones de la vista previa para corregir datos, o /cancelar para descartar el borrador.";
  const payload=clarify(current.payload,current.awaiting,text,catalog);
  return await port.command(c,{action:"amend",id:current.id,version:current.version,updateId,payload});
 }
 if(!parsed.recognized)return "Describe un gasto o ingreso ya ocurrido, por ejemplo: Gasté 25 soles en almuerzo.";
 return await port.command(c,{action:"start",updateId,text,payload:parsed.payload});
}
