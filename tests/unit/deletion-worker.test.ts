import {describe,expect,it,vi,afterEach} from "vitest";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {manifestStore,processDeletion} from "../../scripts/deletion-worker.mjs";
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0)){const absolute=path.resolve(dir);if(!absolute.startsWith(path.join(tmpdir(),"finzi-worker-")))throw new Error("Fuera de fixture");rmSync(absolute,{recursive:true,force:true});}});
const job={id:crypto.randomUUID(),user_id:crypto.randomUUID(),tracking_hash:"a".repeat(64),lease:"b".repeat(64)};
describe("procesamiento durable de eliminación",()=>{
 it("manifiesto privado cifrado estable, clave separada y rechazo de alteración",()=>{const dir=mkdtempSync(path.join(tmpdir(),"finzi-worker-"));dirs.push(dir);const root=path.join(dir,"manifests"),key=path.join(dir,"keys","key"),store=manifestStore(root,key);const digest=store.save(job);expect(store.save(job)).toBe(digest);const file=path.join(root,`${job.id}.manifest.enc`),raw=readFileSync(file,"utf8");expect(raw).not.toContain(job.user_id);expect(store.all()[0].subjectId).toBe(job.user_id);const value=JSON.parse(raw);value.ciphertext=Buffer.from("alterado").toString("base64");writeFileSync(file,JSON.stringify(value));expect(()=>store.all()).toThrow();});
 it("rechaza almacén dentro de proyecto",()=>{expect(()=>manifestStore(path.resolve(".private"),path.resolve(".key"))).toThrow();});
 it("secuencia manifiesto antes de purga, identidad y finalización",async()=>{const calls:string[]=[];const port={manifest:vi.fn(async()=>{calls.push("persist");return "a".repeat(64);}),step:vi.fn(async(_j:unknown,a:string)=>{calls.push(a);}),deleteIdentity:vi.fn(async()=>{calls.push("auth");})};expect(await processDeletion(job,port)).toBe(true);expect(calls).toEqual(["persist","manifest","purge","auth","complete"]);});
 it.each(["manifest","purge","auth","complete"])("fallo en %s mantiene pendiente y es reintentable",async(fail)=>{let failed=false;const port={manifest:vi.fn(async()=>{if(fail==="manifest"&&!failed){failed=true;throw new Error();}return "a".repeat(64);}),step:vi.fn(async(_j:unknown,a:string)=>{if(a===fail&&!failed){failed=true;throw new Error();}}),deleteIdentity:vi.fn(async()=>{if(fail==="auth"&&!failed){failed=true;throw new Error();}})};expect(await processDeletion(job,port)).toBe(false);if(fail==="manifest")expect(port.deleteIdentity).not.toHaveBeenCalled();expect(await processDeletion(job,port)).toBe(true);});
});
