import {createClient} from "@supabase/supabase-js";
import {execFileSync} from "node:child_process";
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from "node:crypto";
import {closeSync,existsSync,fsyncSync,linkSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,statSync,unlinkSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {runSupabase} from "./supabase-cli.mjs";
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,hex=/^[a-f0-9]{64}$/;
function checked(value,pattern){if(typeof value!=="string"||!pattern.test(value))throw new Error("Identificador operacional inválido.");return value;}
function outsideProject(target){const absolute=path.resolve(target),relative=path.relative(project,absolute);if(relative===""||(!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative)))throw new Error("El almacén privado debe estar fuera del proyecto.");return absolute;}
export function manifestStore(root=process.env.FINZI_DELETION_STORE??path.join(homedir(),process.platform==="win32"?"AppData/Local":".local/share","Finzi","deletion-manifests"),keyFile=process.env.FINZI_DELETION_KEY_PATH??path.join(path.dirname(root),"deletion-keys","manifest.key")){
 root=outsideProject(root);keyFile=outsideProject(keyFile);if(path.relative(root,keyFile)===""||!path.relative(root,keyFile).startsWith(".."+path.sep)&&!path.isAbsolute(path.relative(root,keyFile)))throw new Error("La clave debe conservarse separada del almacén de manifiestos.");
 mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(path.dirname(keyFile),{recursive:true,mode:0o700});
 if(!existsSync(keyFile)){if(readdirSync(root).some(n=>n.endsWith(".manifest.enc")))throw new Error("Falta la clave del manifiesto existente.");writeFileSync(keyFile,randomBytes(32),{flag:"wx",mode:0o600});const fd=openSync(keyFile,"r+");try{fsyncSync(fd);}finally{closeSync(fd);}}
 if(lstatSync(keyFile).isSymbolicLink())throw new Error("Clave enlazada no admitida.");const key=readFileSync(keyFile);if(key.length!==32)throw new Error("Clave operacional inválida.");
 const filename=id=>path.join(root,`${checked(id,uuid)}.manifest.enc`);
 function read(file){if(lstatSync(file).isSymbolicLink()||statSync(file).size>16384)throw new Error("Manifiesto inválido.");const raw=readFileSync(file),payload=JSON.parse(raw.toString("utf8"));if(payload.version!==1)throw new Error("Versión de manifiesto no admitida.");const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(payload.iv,"base64"));decipher.setAuthTag(Buffer.from(payload.tag,"base64"));const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext,"base64")),decipher.final()]).toString("utf8"));checked(data.requestId,uuid);checked(data.subjectId,uuid);checked(data.trackingHash,hex);if(data.version!==1)throw new Error("Manifiesto inválido.");return{data,digest:createHash("sha256").update(raw).digest("hex")};}
 return{
  root,keyFile,
  save(job){const file=filename(job.id),subject=checked(job.user_id,uuid),tracking=checked(job.tracking_hash,hex);
   if(existsSync(file)){const found=read(file);if(found.data.subjectId!==subject||found.data.trackingHash!==tracking)throw new Error("Manifiesto incompatible.");return found.digest;}
   const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv),data=JSON.stringify({version:1,requestId:job.id,subjectId:subject,trackingHash:tracking,recordedAt:new Date().toISOString()});const ciphertext=Buffer.concat([cipher.update(data,"utf8"),cipher.final()]);const raw=JSON.stringify({version:1,keyVersion:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")});
   const temp=path.join(root,`${job.id}.${randomUUID()}.tmp`);writeFileSync(temp,raw,{flag:"wx",mode:0o600});const fd=openSync(temp,"r+");try{fsyncSync(fd);}finally{closeSync(fd);}try{linkSync(temp,file);}catch(e){if(e.code!=="EEXIST")throw e;}finally{unlinkSync(temp);}const found=read(file);if(found.data.subjectId!==subject||found.data.trackingHash!==tracking)throw new Error("Manifiesto incompatible.");return found.digest;
  },
  all(){return readdirSync(root).filter(n=>n.endsWith(".manifest.enc")).map(n=>{const id=n.slice(0,-".manifest.enc".length);checked(id,uuid);const record=read(filename(id));if(record.data.requestId!==id)throw new Error("Manifiesto incompatible.");return record.data;});},
 };
}
export function localQuery(statement){
 const raw=execFileSync("docker",["exec","-i","supabase_db_finzi-auth","psql","-U","supabase_admin","-d","postgres","-qAt","-v","ON_ERROR_STOP=1"],{input:`begin;set local role finzi_deletion_worker;${statement};commit;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();
 return raw?JSON.parse(raw):null;
}
export async function processDeletion(job,port){let failure="manifest_unavailable";try{const digest=await port.manifest(job);failure="database_unavailable";await port.step(job,"manifest",digest);await port.step(job,"purge");failure="auth_unavailable";await port.deleteIdentity(job.user_id);failure="database_unavailable";await port.step(job,"complete");return true;}catch{try{await port.step(job,failure);}catch{/* Expired leases are safely reclaimed later. */}return false;}}
function workerPort(store,client){return{
 manifest:job=>store.save(job),
 step(job,action,digest=null){checked(job.id,uuid);checked(job.lease,hex);if(!["manifest","purge","complete","manifest_unavailable","database_unavailable","auth_unavailable"].includes(action))throw new Error("Paso inválido.");if(digest!==null)checked(digest,hex);localQuery(`select to_jsonb(ops.deletion_step('${job.id}','${job.lease}','${action}',${digest?`'${digest}'`:"null"}))`);},
 async deleteIdentity(id){checked(id,uuid);const r=await client.auth.admin.deleteUser(id);if(r.error&&r.error.status!==404&&r.error.code!=="user_not_found")throw new Error("Identidad pendiente.");},
};}
export function restoreManifests(store){let count=0;for(const m of store.all()){if(localQuery(`select to_jsonb(ops.restore_deletion('${m.requestId}','${m.subjectId}','${m.trackingHash}'))`))count++;}return count;}
export async function runBatch({store=manifestStore(),limit=5}={}){
 const status=JSON.parse(runSupabase(["status","-o","json"]));if(!status.API_URL||!["127.0.0.1","localhost"].includes(new URL(status.API_URL).hostname))throw new Error("Solo se admite Supabase local.");
 const admin=status.SECRET_KEY??status.SERVICE_ROLE_KEY;if(!admin)throw new Error("Falta acceso operacional local a Auth.");
 const client=createClient(status.API_URL,admin,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}}),port=workerPort(store,client);let completed=0,retries=0;
 for(let i=0;i<limit;i++){const job=localQuery("select ops.claim_deletion()");if(!job)break;checked(job.id,uuid);checked(job.user_id,uuid);checked(job.tracking_hash,hex);checked(job.lease,hex);if(await processDeletion(job,port))completed++;else retries++;}
 return{completed,retries};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const flags=process.argv.slice(2);if(flags.some(f=>!["--watch","--restore-manifests"].includes(f))){console.error("Opciones: --watch o --restore-manifests. Sin objetivos de usuario arbitrarios.");process.exit(1);}
 try{const store=manifestStore();if(flags.includes("--restore-manifests"))console.log(`Manifiestos reaplicados: ${restoreManifests(store)}.`);do{const r=await runBatch({store});if(r.completed||r.retries||!flags.includes("--watch"))console.log(`Eliminaciones completadas: ${r.completed}. Con reintento: ${r.retries}.`);if(flags.includes("--watch"))await new Promise(resolve=>setTimeout(resolve,15000));}while(flags.includes("--watch"));}catch{console.error("No se completó el proceso local. Revisa Docker y la custodia privada de manifiestos/clave. No se mostraron datos o credenciales.");process.exitCode=1;}
}
