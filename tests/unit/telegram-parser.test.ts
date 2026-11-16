import {describe,it,expect} from "vitest";
import {parseMessage,parseAmount,parseDate,clarify,missing,type Catalog} from "../../telegram-bot/parser";
const now="2026-11-16T15:30:00.000Z";
const catalog:Catalog={timezone:"America/Lima",accounts:[{id:"cash",name:"Efectivo",currency_code:"PEN",status:"active",opening_at:"2026-01-01T00:00:00Z"},{id:"usd",name:"Dólares",currency_code:"USD",status:"active",opening_at:"2026-01-01T00:00:00Z"}],categories:[{id:"food",name:"Alimentación",kind:"expense",status:"active",effective_archived:false},{id:"services",name:"Servicios",kind:"expense",status:"active",effective_archived:false},{id:"transport",name:"Transporte",kind:"expense",status:"active",effective_archived:false},{id:"salary",name:"Salario",kind:"income",status:"active",effective_archived:false},{id:"freelance",name:"Freelance",kind:"income",status:"active",effective_archived:false}]};
describe("Telegram deterministic Spanish parser",()=>{
 it.each([
 ["Gasté 25 soles en almuerzo","expense","25.00","food"],
 ["Pagué 80 soles de internet","expense","80.00","services"],
 ["Compré víveres por 120 soles con tarjeta","expense","120.00","food"],
 ["Gasté 15 soles en transporte hoy","expense","15.00","transport"],
 ["Recibí 1500 soles de sueldo","income","1500.00","salary"],
 ["Ganancia de 250 soles por freelance","income","250.00","freelance"],
 ["Me depositaron 500 soles","income","500.00",null],
 ["Recibí 100 soles de devolución","income","100.00",null]
 ])("recognizes %s without inventing catalog references",(text,kind,amount,category)=>{
  const result=parseMessage(text,catalog,now);expect(result.recognized).toBe(true);expect(result.payload).toMatchObject({kind,amount,categoryId:category,receivedAt:now});
 });
 it("keeps incomplete and ambiguous data out of valid previews",()=>{
  const p=parseMessage("Me depositaron 500 soles",catalog,now).payload;expect(missing(p)).toContain("description");
  expect(parseMessage("Compré víveres por 120 soles con tarjeta",catalog,now).payload.accountId).toBeNull();
  expect(parseMessage("Gasté $25 en almuerzo",catalog,now).payload.currency).toBeNull();
  expect(parseMessage("Gasté 25 y 30 soles",catalog,now).payload.amount).toBeNull();
  expect(parseMessage("Gasté 25 euros",catalog,now).recognized).toBe(false);
 });
 it.each(["hola","No gasté 25 soles","Voy a pagar 25 soles","Quiero gastar 25","mañana pagaré 25"])("does not create an executed operation from %s",text=>{expect(parseMessage(text,catalog,now).recognized).toBe(false);});
 it.each(["0","-1","1.234","1,234.50","1 234","NaN","1e3","Infinity"])("rejects noncanonical/ambiguous amount %s",amount=>{expect(parseAmount(amount)).toBeNull();});
 it("uses exact decimals, including the supported maximum, and comma fractions",()=>{expect(parseAmount("9999999999999999.99")).toBe("9999999999999999.99");expect(parseAmount("25,50")).toBe("25.50");});
 it("rejects multiple catalog matches and archived accounts/categories",()=>{
  const c={...catalog,accounts:[...catalog.accounts,{...catalog.accounts[0],id:"other",name:"Banco"}],categories:[...catalog.categories,{...catalog.categories[0],id:"food2"}]};
  const p=parseMessage("Gasté 25 soles en almuerzo",c,now).payload;expect(p.accountId).toBeNull();expect(p.categoryId).toBeNull();
  expect(parseMessage("Gasté 25 soles en almuerzo",{...catalog,categories:catalog.categories.map(c=>({...c,effective_archived:true}))},now).payload.categoryId).toBeNull();
 });
 it("resolves relative dates in the profile zone and rejects future, unsupported and DST wall times",()=>{
  expect(parseDate("ayer",now,"America/Lima").value).toBe("2026-11-15T17:00:00.000Z");
  expect(parseDate("2026-11-17",now,"America/Lima").value).toBeNull();
  expect(parseDate("15-11-2026",now,"America/Lima").value).toBeNull();
  expect(parseDate("2026/11/15",now,"America/Lima").value).toBeNull();
  expect(parseDate("2026-11-14 y 2026-11-15",now,"America/Lima").value).toBeNull();
  expect(parseDate("hoy",now,"America/Lima").value).toBe(now);
  expect(parseDate("15 de noviembre",now,"America/Lima").value).toBeNull();
  expect(parseDate("2026-11-01 01:30",now,"America/New_York").value).toBeNull();
  expect(parseDate("2026-03-08 02:30",now,"America/New_York").value).toBeNull();
 });
 it("amends only the requested field and freezes original receipt time",()=>{const p=parseMessage("Gasté en almuerzo",catalog,now).payload;const next=clarify(p,"amount","0,10",catalog);expect(next.amount).toBe("0.10");expect(next.receivedAt).toBe(now);expect(next.occurredAt).toBe(p.occurredAt);});
});
