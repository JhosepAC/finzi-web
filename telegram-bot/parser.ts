import { openingMinor,decimalMoney,type Currency } from "../src/shared/money.ts";
import { localDateTime,wallTimeToUtc } from "../src/shared/time.ts";
export type Field="kind"|"amount"|"currency"|"accountId"|"categoryId"|"description"|"occurredAt";
export type AccountOption={id:string;name:string;currency_code:Currency;status:string;opening_at:string};
export type CategoryOption={parent_id?:string|null;id:string;name:string;kind:"income"|"expense";status:string;effective_archived:boolean};
export type Catalog={timezone:string;accounts:AccountOption[];categories:CategoryOption[]};
export type Payload={kind:"income"|"expense"|null;amount:string|null;currency:Currency|null;accountId:string|null;categoryId:string|null;description:string|null;occurredAt:string|null;receivedAt:string;timezone:string;note:string;warnings:string[]};
export const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const mentions=(s:string,name:string)=>new RegExp("(?<![a-z0-9])"+escape(normalize(name))+"(?![a-z0-9])","i").test(s);
const aliases:Record<string,string[]>={alimentacion:["almuerzo","comida","viveres","supermercado","desayuno","cena"],transporte:["taxi","bus","pasaje","transporte"],servicios:["internet","telefonia","electricidad","agua"],salario:["sueldo","salario"],sueldo:["sueldo","salario"],freelance:["freelance"],suscripciones:["spotify","netflix","suscripcion"],salud:["farmacia","medicamento","consulta medica"]};
export function parseAmount(raw:string):string|null{
 if(!/^[0-9]{1,16}(?:[.,][0-9]{1,2})?$/.test(raw.trim()))return null;
 try{const amount=openingMinor(raw);return amount>0n?decimalMoney(amount):null;}catch{return null;}
}
export function parseDate(text:string,receivedAt:string,timezone:string):{value:string|null;warning?:string}{
 const s=normalize(text);
 if(/\d{4}-\d{2}-\d{2}t/.test(s))return {value:null,warning:"Usa una fecha y hora locales separadas por espacio: AAAA-MM-DD HH:mm."};
 if(/\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana pasada|mes pasado)\b|\d{1,2}\s+de\s+[a-z]+/.test(s))return {value:null,warning:"Indica la fecha como AAAA-MM-DD y, si corresponde, HH:mm."};
 const today=localDateTime(receivedAt,timezone).slice(0,10);
 const dateHints=[...s.matchAll(/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/g)];
 if(dateHints.length>1||/\b\d{1,2}\s*[ap]\.?m\.?\b|por la (?:tarde|noche|manana)/.test(s))return {value:null,warning:"Indica una sola fecha y una hora de 24 horas: AAAA-MM-DD HH:mm."};
 let date=today;const iso=s.match(/\b(\d{4}-\d{2}-\d{2})\b/),local=s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
 if(dateHints.length&&!iso&&!local)return {value:null,warning:"Usa una fecha AAAA-MM-DD o DD/MM/AAAA."};
 if(iso)date=iso[1];else if(local)date=`${local[3]}-${local[2].padStart(2,"0")}-${local[1].padStart(2,"0")}`;
 else if(/\b(ayer|anteayer)\b/.test(s)){const d=new Date(today+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-(/\banteayer\b/.test(s)?2:1));date=d.toISOString().slice(0,10);}
 const time=s.match(/(?:\ba las?\s+|\b)([0-2]?[0-9]):([0-5][0-9])\b/);
 try{
  if(!iso&&!local&&!/\b(ayer|anteayer|hoy)\b/.test(s)&&!time)return {value:receivedAt};
  if(date===today&&!time)return {value:receivedAt};
  const wall=time?`${time[1].padStart(2,"0")}:${time[2]}`:date===today?localDateTime(receivedAt,timezone).slice(11):"12:00";
  const value=wallTimeToUtc(date+"T"+wall,timezone);
  if(new Date(value).getTime()>new Date(receivedAt).getTime())return {value:null,warning:"La fecha debe haber ocurrido. Indica una fecha y hora anteriores o iguales al mensaje original."};
  return {value,...(!time&&date!==today?{warning:"Sin hora indicada: se propone 12:00 en tu zona horaria."}:{})};
 }catch{return {value:null,warning:"La fecha u hora no es válida o es ambigua por el cambio de horario. Usa AAAA-MM-DD HH:mm."};}
}
export function availableAccounts(catalog:Catalog,p:Payload){return catalog.accounts.filter(a=>a.status==="active"&&(!p.currency||a.currency_code===p.currency));}
export function availableCategories(catalog:Catalog,p:Payload){return catalog.categories.filter(c=>c.status==="active"&&!c.effective_archived&&c.kind===p.kind);}
export function missing(p:Payload):Field[]{return (["kind","amount","currency","accountId","categoryId","description","occurredAt"] as Field[]).filter(f=>!p[f]);}
export function parseMessage(text:string,catalog:Catalog,receivedAt:string):{recognized:boolean;payload:Payload}{
 const s=normalize(text),expense=/\b(gaste|pague|compre|gasto|egreso)\b/.test(s),income=/\b(recibi|ganancia|depositaron|cobre|ingreso)\b/.test(s);
 const p:Payload={kind:expense&&!income?"expense":income&&!expense?"income":null,amount:null,currency:null,accountId:null,categoryId:null,description:null,occurredAt:null,receivedAt,timezone:catalog.timezone,note:"",warnings:[]};
 if(/€|£|¥|\b(euros?|eur|pesos?|mxn|ars|clp|cop|brl|gbp|btc|eth|usdt|yenes)\b/.test(s))return {recognized:false,payload:p};
 if(!expense&&!income||/\b(no|nunca|quiero|voy a|manana)\b/.test(s))return {recognized:false,payload:p};
 const date=parseDate(text,receivedAt,catalog.timezone);p.occurredAt=date.value;if(date.warning)p.warnings.push(date.warning);
 const stripped=s.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}:\d{2}\b/g,"");
 const amounts=[...stripped.matchAll(/(?<![a-z0-9.,])[+-]?\d+(?:[.,]\d+)*/g)].map(m=>m[0]);
 if(amounts.length===1)p.amount=parseAmount(amounts[0]);
 if(amounts.length>1)p.warnings.push("Hay varios importes. Prepara un solo movimiento por mensaje e indica su importe.");
 const pen=/\b(soles|sol|pen)\b|s\//.test(s),usd=/\b(usd|dolares|dolar)\b|us\$/.test(s);
 if(pen!==usd)p.currency=pen?"PEN":"USD";
 const named=catalog.accounts.filter(a=>a.status==="active"&&mentions(s,a.name));
 if(named.length===1&&(!p.currency||named[0].currency_code===p.currency)){p.accountId=named[0].id;if(!p.currency&&!s.includes("$"))p.currency=named[0].currency_code;}
 else if(!named.length&&!/\bcon (?:la )?tarjeta\b/.test(s)){
  const eligible=availableAccounts(catalog,p);if(eligible.length===1&&!s.includes("$")){p.accountId=eligible[0].id;p.currency??=eligible[0].currency_code;}
 }
 const eligible=availableCategories(catalog,p),direct=eligible.filter(c=>mentions(s,c.name));
 const candidates=direct.length?direct:eligible.filter(c=>Object.entries(aliases).some(([name,words])=>normalize(c.name)===name&&words.some(word=>mentions(s,word))));
 if(candidates.length===1)p.categoryId=candidates[0].id;
 let description=text.replace(/^(?:me\s+)?(?:gast[eé]|pagu[eé]|compr[eé]|recib[ií]|ganancia|depositaron|cobr[eé]|ingreso|gasto|egreso)\s*/i,"");
 if(amounts.length===1)description=description.replace(amounts[0],"");
 description=description.replace(/\b(?:soles?|PEN|USD|d[oó]lares?)\b|S\/|US\$|\$/gi,"").replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}:\d{2}\b/g,"").replace(/\b(?:hoy|ayer|anteayer|a las?)\b/gi,"").replace(/\s+/g," ").replace(/^\s*(?:(?:en|de|por)\s+)+/i,"").replace(/\b(?:por|de|en)\s+(?=con\b)/gi,"").trim();
 if(description.length>=1&&description.length<=200)p.description=description;
 if(p.accountId&&p.occurredAt&&new Date(p.occurredAt)<new Date(catalog.accounts.find(a=>a.id===p.accountId)!.opening_at)){p.occurredAt=null;p.warnings.push("La fecha es anterior a la apertura de la cuenta. Indica otra fecha y hora.");}
 return {recognized:true,payload:p};
}
export function clarify(p:Payload,field:Field,text:string,catalog:Catalog):Payload{
 const next:Payload={...p,warnings:[]};
 if(field==="amount")next.amount=parseAmount(text);
 else if(field==="description")next.description=text.trim().length>=1&&text.trim().length<=200?text.trim():null;
 else if(field==="occurredAt"){
  if(!/\b(?:hoy|ayer|anteayer)\b|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(normalize(text)))next.occurredAt=null;
  else {const d=parseDate(text,p.receivedAt,p.timezone);next.occurredAt=d.value;if(d.warning)next.warnings.push(d.warning);}
  const a=catalog.accounts.find(a=>a.id===p.accountId);if(next.occurredAt&&a&&new Date(next.occurredAt)<new Date(a.opening_at))next.occurredAt=null;
 }
 else next.warnings.push("Elige una de las opciones del mensaje para este campo.");
 return next;
}
