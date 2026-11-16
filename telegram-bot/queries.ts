import { InlineKeyboard } from "grammy";
import { createHash } from "node:crypto";
import { formatMoney } from "../src/shared/money.ts";
import type { Gateway } from "./gateway.ts";
export const queryCommands=["hoy","semana","mes","saldo","gastos","ingresos","cuentas","categorias","pendientes"] as const;
export type QueryCommand=typeof queryCommands[number];
export type QueryPage={id:string;command:QueryCommand;currency:"PEN"|"USD";timezone:string;as_of:string;from?:string;to?:string;income_minor?:string;expense_minor?:string;balance_minor?:string;page:number;total:number;items:Record<string,unknown>[]};
export const queryHelp="Consultas: /hoy, /semana (últimos 7 días), /mes, /saldo, /gastos, /ingresos, /cuentas, /categorias y /pendientes. Usa PEN o USD después del comando; por defecto PEN. /borrador revisa tu borrador y /cancelar lo descarta.";
// No parse_mode: user-provided labels remain literal text, including markup.
const clean=(v:unknown)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").slice(0,210);
const money=(v:unknown,c:"PEN"|"USD")=>formatMoney(BigInt(String(v??"0")),c);
export async function renderQuery(port:Gateway,c:Record<string,string>,q:QueryPage,sign:(v:string)=>string){
 let text=`${({hoy:"Hoy",semana:"Últimos 7 días",mes:"Este mes",saldo:"Saldo actual",gastos:"Gastos por categoría",ingresos:"Ingresos del mes",cuentas:"Tus cuentas",categorias:"Tus categorías",pendientes:"Borradores pendientes"})[q.command]}${["categorias","pendientes"].includes(q.command)?"":" · "+q.currency}\nZona: ${q.timezone}\nCorte: ${new Intl.DateTimeFormat("es-PE",{dateStyle:"short",timeStyle:"medium",timeZone:q.timezone}).format(new Date(q.as_of))}`;
 if(q.from)text+=`\nPeríodo: ${q.from} a ${q.to}`;
 if(q.income_minor!==undefined)text+=`\nIngresos: ${money(q.income_minor,q.currency)}\nGastos: ${money(q.expense_minor,q.currency)}`;
 if(q.balance_minor!==undefined)text+=`\nSaldo: ${money(q.balance_minor,q.currency)}\nIncluye cuentas archivadas; excluye eliminadas.`;
 if(q.command==="gastos")text+="\nCada padre incluye sus subcategorías una sola vez.";
 if(q.command==="pendientes")text+="\nSolo borradores del bot; no incluye deudas ni gastos fijos. Usa /borrador para continuar.";
 for(const row of q.items){
  if(q.command==="ingresos")text+=`\n\n${clean(row.description)} · ${money(row.amount_minor,q.currency)}\n${new Intl.DateTimeFormat("es-PE",{dateStyle:"short",timeStyle:"short",timeZone:q.timezone}).format(new Date(String(row.occurred_at)))} · ${clean(row.account_name)}`;
  else if(q.command==="categorias")text+=`\n${row.kind==="income"?"Ingreso":"Gasto"} · ${clean(row.name)}${row.archived?" · No disponible (archivada)":""}`;
  else if(q.command==="pendientes")text+=`\n${row.state==="pending"?"Por confirmar":"Faltan datos"} · Vence ${new Intl.DateTimeFormat("es-PE",{timeStyle:"short",timeZone:q.timezone}).format(new Date(String(row.expires_at)))}`;
  else text+=`\n${clean(row.name)} · ${money(row.amount_minor??row.balance_minor,q.currency)}${row.status==="archived"?" · Archivada":""}`;
 }
 if(!q.total&&!["hoy","semana","mes"].includes(q.command))text+="\nSin registros para esta consulta.";
 const keyboard=new InlineKeyboard(),choices:{hash:string;page:number}[]=[];
 for(const page of [q.page-1,q.page+1])if(page>=0&&page<Math.ceil(q.total/10)){
  const token="f6:"+sign(JSON.stringify([q.id,page]));keyboard.text(page<q.page?"Anterior":"Siguiente",token);
  choices.push({hash:createHash("sha256").update(token).digest("hex"),page});
 }
 if(q.total>0)text+=`\n\nPágina ${q.page+1} de ${Math.ceil(q.total/10)} · ${q.total} registros`;
 if(choices.length)await port.query(c,{action:"buttons",id:q.id,page:q.page,choices});
 return {text,keyboard:choices.length?keyboard:undefined};
}
