import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Update } from "grammy/types";
const credential = z.object({ user: z.string().regex(/^\d+$/), challengeHash: z.string(), capability: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number() });
const schema = z.object({ botId: z.string(), offset: z.number().int().nonnegative(), inbox: z.array(z.unknown()).max(100), credentials: z.array(credential).max(1000) });
export type State = z.infer<typeof schema> & { inbox: Update[] };
export function outsideWorkspace(value: string) {
 const target=path.resolve(value), relative=path.relative(process.cwd(),target);
 if(relative==="" || (!relative.startsWith(".."+path.sep) && relative!==".." && !path.isAbsolute(relative))) throw new Error("Custody must be outside the workspace");
 return target;
}
function noLinks(value: string) {
 let current=path.resolve(value);
 while(true) { if(existsSync(current)&&lstatSync(current).isSymbolicLink()) throw new Error("Linked custody path refused"); const parent=path.dirname(current); if(parent===current)break;current=parent; }
}
export function openStore(directory: string, keyFile: string, botId: string) {
 directory=outsideWorkspace(directory);keyFile=outsideWorkspace(keyFile);noLinks(directory);noLinks(keyFile);
 const relative=path.relative(directory,keyFile);
 if(!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative)) throw new Error("Keep key separate from store");
 mkdirSync(directory,{recursive:true,mode:0o700});mkdirSync(path.dirname(keyFile),{recursive:true,mode:0o700});
 if(!existsSync(keyFile)) throw new Error("Missing custody key; run telegram:setup. Never regenerate a lost key over an existing store");
 const key=readFileSync(keyFile); if(key.length!==32)throw new Error("Invalid custody key");
 if(!/^\d+$/.test(botId))throw new Error("Invalid bot identity");
 const filename=path.join(directory,botId+".enc");noLinks(filename);
 let state: State={botId,offset:0,inbox:[],credentials:[]};
 if(existsSync(filename)) {
  const bytes=readFileSync(filename);if(bytes.length>4*1024*1024||bytes.length<29)throw new Error("Invalid encrypted store");
  const decipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));decipher.setAAD(Buffer.from(botId));decipher.setAuthTag(bytes.subarray(12,28));
  state=schema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString("utf8"))) as State;
  if(state.botId!==botId)throw new Error("Wrong bot store");
 }
 function persist() {
  schema.parse(state);const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from(botId));
  const content=Buffer.from(JSON.stringify(state)); if(content.length>4*1024*1024)throw new Error("Custody capacity reached");
  const encrypted=Buffer.concat([cipher.update(content),cipher.final()]),temporary=filename+"."+randomBytes(8).toString("hex")+".tmp";
  const fd=openSync(temporary,"wx",0o600);try{writeFileSync(fd,Buffer.concat([iv,cipher.getAuthTag(),encrypted]));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,filename);
 }
 function save(){try{persist();}catch{throw new Error("Custody failure");}}
 return {state,save,sign:(value:string)=>createHmac("sha256",key).update("callback:"+botId+":"+value).digest("hex").slice(0,48)};
}
