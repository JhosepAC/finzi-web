import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { openStore } from "../../telegram-bot/store";
import { createBot,hash,pruneCredentials } from "../../telegram-bot/bot";
import { drain,receive } from "../../telegram-bot/polling";
import type { Update,UserFromGetMe } from "grammy/types";
const roots:string[]=[];
function fixture(){const root=mkdtempSync(path.join(tmpdir(),"finzi-telegram-"));roots.push(root);mkdirSync(path.join(root,"keys"));const key=path.join(root,"keys","key");writeFileSync(key,randomBytes(32));return {root,key,directory:path.join(root,"store"),store:openStore(path.join(root,"store"),key,"9001")};}
afterEach(()=>{for(const root of roots.splice(0)){if(path.dirname(root)!==path.resolve(tmpdir())||!path.basename(root).startsWith("finzi-telegram-"))throw new Error("Invalid test custody");rmSync(root,{recursive:true,force:true});}});
const info:UserFromGetMe={id:9001,is_bot:true,first_name:"Finzi test",username:"finzi_test_bot",can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false,has_topics_enabled:false,allows_users_to_create_topics:false,can_manage_bots:false,supports_join_request_queries:false};
function message(text:string,id=1,chatType:"private"|"group"="private",age=0):Update{return {update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000)-age,chat:chatType==="private"?{id:7001,type:"private",first_name:"Synthetic"}:{id:-7001,type:"group",title:"Synthetic"},from:{id:7001,is_bot:false,first_name:"Synthetic"},text,...(text.startsWith("/start")?{entities:[{offset:0,length:6,type:"bot_command" as const}]}:{})}};}
function harness(){const f=fixture(),calls:{capability:string;challenge:string}[]=[],replies:string[]=[];let active=false;
 const bot=createBot("9001:synthetic_token",{claim:async(challenge,_bot,_user,_chat,capability)=>{calls.push({challenge,capability});},context:async()=>active?{linkId:"linked"}:null,catalog:async()=>({timezone:"America/Lima",accounts:[],categories:[]}),command:async()=>null,callbacks:async()=>{}},f.store,info);
 bot.api.config.use(async(_previous,method,payload)=>{if(method==="sendMessage")replies.push((payload as {text:string}).text);return {ok:true,result:method==="answerCallbackQuery"?true:{message_id:1,date:1,chat:{id:7001,type:"private"},text:"ok"}} as Awaited<ReturnType<typeof _previous>>;});
 return {...f,bot,calls,replies,setActive:()=>{active=true;}};
}
describe("Telegram runtime: encrypted custody and durable polling",()=>{
 it("encrypts credentials and inbox, authenticates content and preserves state across restart",()=>{
  const f=fixture(),cap=randomBytes(32).toString("hex");f.store.state.credentials.push({user:"7001",challengeHash:hash("challenge"),capability:cap,createdAt:Date.now()});receive(f.store,[message("private text")]);
  const raw=readFileSync(path.join(f.directory,"9001.enc"));expect(raw.toString()).not.toContain(cap);expect(raw.toString()).not.toContain("private text");
  expect(openStore(f.directory,f.key,"9001").state).toEqual(f.store.state);
  raw[raw.length-1]^=1;writeFileSync(path.join(f.directory,"9001.enc"),raw);expect(()=>openStore(f.directory,f.key,"9001")).toThrow();
 });
 it("never acknowledges undurable input and replays unprocessed messages after failure",async()=>{
  const f=fixture();receive(f.store,[message("pending",4)]);expect(f.store.state.offset).toBe(5);
  await expect(drain(f.store,async()=>{throw new Error("Transport down");})).rejects.toThrow();
  const reopened=openStore(f.directory,f.key,"9001");expect(reopened.state.inbox).toHaveLength(1);
  await drain(reopened,async()=>{});expect(openStore(f.directory,f.key,"9001").state.inbox).toHaveLength(0);
 });
 it("a custody write failure cannot advance acknowledgement or remove the durable head",async()=>{
  const f=fixture();f.store.save();const failing={state:f.store.state,save:()=>{throw new Error("Disk failure");}};
  expect(()=>receive(failing,[message("pending",5)])).toThrow();expect(failing.state.offset).toBe(0);expect(failing.state.inbox).toHaveLength(0);
  receive(f.store,[message("pending",5)]);await expect(drain(failing,async()=>{})).rejects.toThrow();expect(failing.state.inbox).toHaveLength(1);expect(openStore(f.directory,f.key,"9001").state.inbox).toHaveLength(1);
 });
 it("refuses missing keys and workspace custody instead of silently resetting",()=>{
  const f=fixture();f.store.save();unlinkSync(f.key);expect(()=>openStore(f.directory,f.key,"9001")).toThrow();expect(()=>openStore(process.cwd(),f.key,"9001")).toThrow();
 });
 it("persists a capability before claiming and reuses it on duplicate /start",async()=>{
  const h=harness(),challenge=randomBytes(32).toString("hex");await h.bot.handleUpdate(message("/start "+challenge));
  const persisted=openStore(h.directory,h.key,"9001").state.credentials[0];expect(h.calls[0].capability).toBe(hash(persisted.capability));
  await h.bot.handleUpdate(message("/start "+challenge,2));expect(h.calls[1]).toEqual(h.calls[0]);expect(h.replies.at(-1)).toContain("confirma la vinculación");
 });
 it("ignores groups and rejects old/malformed challenges without querying identity",async()=>{
  const h=harness();await h.bot.handleUpdate(message("/start "+"a".repeat(64),1,"group"));expect(h.replies).toHaveLength(0);
  await h.bot.handleUpdate(message("/start invalid"));await h.bot.handleUpdate(message("/start "+"a".repeat(64),2,"private",901));expect(h.calls).toHaveLength(0);
 });
 it("prunes revoked/expired local capabilities while retaining pending enrollment",async()=>{
  const h=harness();h.store.state.credentials.push({user:"7001",challengeHash:"pending",capability:"a".repeat(64),createdAt:Date.now()},{user:"7001",challengeHash:"revoked",capability:"b".repeat(64),createdAt:Date.now()-360000});h.store.save();
  await pruneCredentials({context:async()=>null},h.store,"9001");expect(h.store.state.credentials.map(c=>c.challengeHash)).toEqual(["pending"]);
 });
 it("checks active linkage for every message and never records money",async()=>{
  const h=harness();await h.bot.handleUpdate(message("Gasté 25 soles"));expect(h.replies.at(-1)).toContain("Vincula tu cuenta");
  await h.bot.handleUpdate(message("/start "+"a".repeat(64),2));h.setActive();await h.bot.handleUpdate(message("hola",3));expect(h.replies.at(-1)).toContain("Describe un gasto o ingreso");
 });
});
