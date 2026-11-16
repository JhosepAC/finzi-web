import {describe,it,expect} from "vitest";
import {createHmac} from "node:crypto";
import {messageDraft,renderDraft,type Draft} from "../../telegram-bot/conversation";
import {parseMessage,type Catalog} from "../../telegram-bot/parser";
import type {Gateway} from "../../telegram-bot/gateway";
const catalog:Catalog={timezone:"America/Lima",accounts:[{id:"cash",name:"Efectivo",currency_code:"PEN",status:"active",opening_at:"2020-01-01T00:00:00Z"}],categories:[{id:"food",name:"Alimentación",kind:"expense",status:"active",effective_archived:false}]};
const c={linkId:"test",capability:"test"},received="2026-11-16T15:00:00.000Z";
const sign=(v:string)=>createHmac("sha256","synthetic signing key").update(v).digest("hex").slice(0,48);
function fixture(){let current:Draft|null=null,replay:Draft|null=null;const registered:{hash:string;field:string;value:string}[][]=[],commands:Record<string,unknown>[]=[];
 const port:Gateway={claim:async()=>{},context:async()=>c,catalog:async()=>catalog,callbacks:async(_c,_id,_v,rows)=>{registered.push(rows);},command:async(_c,cmd)=>{commands.push(cmd);if(cmd.action==="replay")return replay;if(cmd.action==="read")return current;return {...current,payload:cmd.payload,id:"draft",version:2,state:"needs_input",awaiting:"amount",expiresAt:"2026-11-16T15:15:00Z"};}};
 const draft:Draft={id:"draft",version:2,state:"pending",awaiting:null,payload:parseMessage("Gasté 25 soles en almuerzo",catalog,received).payload,expiresAt:"2026-11-16T15:15:00Z"};
 return {port,draft,registered,commands,setCurrent:(d:Draft)=>{current=d;},setReplay:(d:Draft)=>{replay=d;}};
}
describe("Telegram clarification and preview protocol",()=>{
 it("starts a draft from recognized finance text without any publication call",async()=>{const f=fixture();await messageDraft(f.port,c,"Gasté 25 soles en almuerzo","1",received);expect(f.commands.at(-1)).toMatchObject({action:"start",payload:{amount:"25.00",kind:"expense"}});expect(f.commands.some(c=>c.action==="confirm")).toBe(false);});
 it("amends only the awaited field using the current version and original receipt",async()=>{const f=fixture();f.setCurrent({...f.draft,state:"needs_input",awaiting:"amount",payload:{...f.draft.payload,amount:null}});await messageDraft(f.port,c,"10,20","2","2026-11-16T15:03:00Z");expect(f.commands.at(-1)).toMatchObject({action:"amend",version:2,payload:{amount:"10.20",receivedAt:received}});});
 it("does not silently replace an unfinished draft with another operation",async()=>{const f=fixture();f.setCurrent(f.draft);expect(await messageDraft(f.port,c,"Gasté 80 soles en internet","3",received)).toContain("borrador en curso");expect(f.commands.every(c=>c.action==="read"||c.action==="replay")).toBe(true);});
 it("recovers the canonical result after restart instead of reinterpreting a delivered update",async()=>{const f=fixture();f.setReplay(f.draft);expect(await messageDraft(f.port,c,"text no longer interpreted","4",received)).toEqual(f.draft);expect(f.commands).toHaveLength(1);});
 it("renders complete preview with opaque versioned correction/cancel buttons but no nonfunctional confirm",async()=>{
  const f=fixture(),a=await renderDraft(f.port,c,f.draft,catalog,sign),b=await renderDraft(f.port,c,{...f.draft,version:3},catalog,sign);
  expect(a.text).toContain("S/ 25.00");expect(a.text).toContain("Sin registrar");expect(a.text).toContain("America/Lima");
  const buttons=a.keyboard!.inline_keyboard.flat();expect(buttons.some(b=>b.text.includes("Confirmar"))).toBe(false);
  for(const button of buttons){expect("callback_data" in button&&button.callback_data).toMatch(/^f4:[a-f0-9]{48}$/);}
  expect(f.registered[0][0].hash).not.toBe(f.registered[1][0].hash);expect(b.text).toContain("Sin registrar");
 });
 it("asks for missing category with paginated options, never invents unavailable choices",async()=>{
  const f=fixture(),many={...catalog,categories:Array.from({length:45},(_,i)=>({...catalog.categories[0],id:String(i),name:"Categoría "+i}))};
  const rendered=await renderDraft(f.port,c,{...f.draft,awaiting:"categoryId",state:"needs_input",payload:{...f.draft.payload,categoryId:null}},many,sign);
  expect(rendered.keyboard!.inline_keyboard.flat()).toHaveLength(22);expect(f.registered[0].filter(c=>c.field==="categoryId")).toHaveLength(20);
  const empty=await renderDraft(f.port,c,{...f.draft,awaiting:"categoryId"},{...catalog,categories:[]},sign);expect(empty.text).toContain("No hay opciones activas");
 });
 it("terminal drafts cannot render an actionable keyboard",async()=>{const f=fixture();const cancelled=await renderDraft(f.port,c,{...f.draft,state:"cancelled"},catalog,sign);expect(cancelled.keyboard).toBeUndefined();expect(cancelled.text).toContain("No se registró");});
});
