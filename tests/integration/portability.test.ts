import { afterAll,beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `portability-${crypto.randomUUID()}@example.test`;
  expect((await c.auth.signUp({ email, password: "una frase de prueba para movimientos 64" })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
  expect(verified.error).toBeNull(); await c.schema("api").rpc("ensure_profile");
  expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Prueba movimientos", p_currency: "PEN", p_timezone: zone, p_expected_version: 0 })).error).toBeNull();
  const account = await c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Efectivo", p_type: "cash", p_currency: "PEN", p_opening: "100" }); expect(account.error).toBeNull();
  const categories = await c.schema("api").rpc("initialize_categories"); expect(categories.error).toBeNull();
  return { c, uid: verified.data.user!.id, account: account.data, income: categories.data.categories.find((c: { kind: string }) => c.kind === "income"), expense: categories.data.categories.find((c: { kind: string }) => c.kind === "expense") };
}
type Context = Awaited<ReturnType<typeof setup>>;
const post = (x: Context, overrides = {}) => x.c.schema("api").rpc("post_movement", { p_request_id: crypto.randomUUID(), p_kind: "income", p_account_id: x.account.id, p_category_id: x.income.id, p_amount: "50", p_description: "Ingreso real", p_note: "", p_occurred_at: null, ...overrides });
const read = (x: Context, overrides = {}) => x.c.schema("api").rpc("read_movements", { p_currency: "PEN", ...overrides });
const accounts = (x: Context) => x.c.schema("api").rpc("read_accounts");
function sql(uid: string, statement: string, prefix = "") {
  if (!/^[a-f0-9-]{36}$/i.test(uid)) throw new Error("UUID inválido.");
  return execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", `begin; ${prefix} set local role app_executor; select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true); ${statement}; commit;`], { encoding: "utf8", stdio: "pipe" });
}
function denied(uid: string, statement: string, code: string, prefix = "") { let message = ""; try { sql(uid, statement, prefix); } catch (error) { message = String((error as { stderr: string }).stderr); } expect(message).toContain(code); }

const purposeToken=async(x:Context,purpose:string)=>{const user=await x.c.auth.getUser();expect((await x.c.auth.signInWithPassword({email:user.data.user!.email!,password:"una frase de prueba para movimientos 64"})).error).toBeNull();const r=await x.c.schema("api").rpc("issue_reauth_proof",{p_purpose:purpose});expect(r.error).toBeNull();return r.data.token as string;};
const exportData=(x:Context,token:string,args={})=>x.c.schema("api").rpc("export_personal_data",{p_proof:token,p_format:"json",...args});
const requestDeletion=async(x:Context)=>{const receipt={id:crypto.randomUUID(),token:crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","")};const proof=await purposeToken(x,"delete_account");const r=await x.c.schema("api").rpc("request_deletion",{p_request_id:receipt.id,p_tracking_token:receipt.token,p_proof:proof,p_confirmation:"ELIMINAR"});expect(r.error).toBeNull();return receipt;};
const status=(id:string,token:string)=>client().schema("api").rpc("deletion_status",{p_id:id,p_tracking_token:token});
describe("A-10 datos reales, comprobantes, bloqueo y eliminación local",()=>{
 let a:Context,b:Context;
 const temporary:string[]=[];
 beforeAll(async()=>{a=await setup();b=await setup();});
 afterAll(async()=>{const {rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),path=await import("node:path");for(const d of temporary){if(!path.resolve(d).startsWith(path.join(tmpdir(),"finzi-deletion-")))throw new Error("Fuera de fixture");rmSync(d,{recursive:true,force:true});}});
 it("JSON completo preserva dinero exacto, archivos, anulación/reemplazo y excluye secretos",async()=>{
  const p=await post(a,{p_amount:"0.10"});expect(p.error).toBeNull();const replacement=await a.c.schema("api").rpc("replace_movement",{p_request_id:crypto.randomUUID(),p_id:p.data.id,p_expected_version:1,p_reason:"Revisado",p_kind:"expense",p_account_id:a.account.id,p_destination_id:null,p_category_id:a.expense.id,p_amount:"0.20",p_description:"=1+1",p_note:"Privada",p_occurred_at:null});expect(replacement.error).toBeNull();
  const r=await exportData(a,await purposeToken(a,"export_data"));expect(r.error).toBeNull();expect(r.data.format_version).toBe("finzi.personal-data/v1");expect(r.data.movements).toHaveLength(2);expect(r.data.entries.map((e:{signed_minor:string})=>e.signed_minor).sort()).toEqual(["-20","10"]);expect(r.data.movements.some((m:{replaced_by_id:string})=>m.replaced_by_id===replacement.data.id)).toBe(true);expect(JSON.stringify(r.data)).not.toMatch(/token_hash|password|create_request_id|lease_hash/);expect(r.data.accounts[0].balance_minor).toBe("9980");
 });
 it("CSV filtra todo el conjunto por moneda/cuenta/tipo/estado y no repite transferencias",async()=>{
  const p=await post(a,{p_amount:"5",p_description:"Literal, texto"});expect(p.error).toBeNull();const r=await exportData(a,await purposeToken(a,"export_data"),{p_format:"csv",p_currency:"PEN",p_kind:"expense",p_status:"posted"});expect(r.error).toBeNull();expect(r.data.movements).toHaveLength(1);expect(r.data.movements[0].description).toBe("=1+1");expect((await read(a,{p_kind:"expense",p_status:"posted"})).data.expense_minor).toBe("20");
 });
 it("pruebas no cruzan finalidades/usuarios, anónimo no exporta, filtro ajeno no revela",async()=>{
  const passwordProof=await purposeToken(b,"change_password");expect((await exportData(b,passwordProof)).error?.code).toBe("42501");const proof=await purposeToken(b,"export_data");expect((await exportData(a,proof)).error?.code).toBe("42501");expect((await exportData(b,proof,{p_format:"csv",p_account_id:a.account.id})).error?.code).toBe("P0002");expect((await client().schema("api").rpc("export_personal_data",{p_proof:proof,p_format:"json"})).error?.code).toBe("42501");
 });
 it("cuota serializada, comprobante consumido y más de una página exportada completa",async()=>{
  const x=await setup();sql(x.uid,`insert into finance.transactions(user_id,create_request_id,kind,description,amount,currency_code,category_id,occurred_at) select '${x.uid}',gen_random_uuid(),'income','Sesenta',1,'PEN','${x.income.id}',now() from generate_series(1,60);insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) select user_id,id,'${x.account.id}',1 from finance.transactions;insert into finance.transaction_events(user_id,transaction_id,action,version) select user_id,id,'posted',1 from finance.transactions`);
  const token=await purposeToken(x,"export_data"),first=await exportData(x,token);expect(first.error).toBeNull();expect(first.data.movements).toHaveLength(60);expect((await exportData(x,token)).error?.code).toBe("42501");for(let i=0;i<2;i++)expect((await exportData(x,await purposeToken(x,"export_data"))).error).toBeNull();expect((await exportData(x,await purposeToken(x,"export_data"))).error?.code).toBe("54000");
 });
 it("eliminación confirmada bloquea inmediatamente RLS/RPC con JWT vigente y reintenta la misma solicitud",async()=>{
  const x=await setup(),receipt=await requestDeletion(x);expect((await x.c.schema("api").rpc("read_profile")).data).toBeNull();expect((await accounts(x)).error?.code).toBe("42501");expect((await post(x)).error?.code).toBe("42501");expect((await x.c.schema("api").rpc("ensure_profile")).error?.code).toBe("42501");expect((await x.c.schema("api").rpc("request_deletion",{p_request_id:receipt.id,p_tracking_token:receipt.token,p_proof:"",p_confirmation:"ELIMINAR"})).error).toBeNull();expect((await status(receipt.id,"a".repeat(64))).data).toBeNull();expect((await status(receipt.id,receipt.token)).data.status).toBe("requested");
  const {localQuery}=await import("../../scripts/deletion-worker.mjs");expect(localQuery(`select to_jsonb(count(*)) from ops.deletion_subjects where user_id='${x.uid}'`)).toBe(1);
 });
 it("consumo/bloqueo/solicitud son atómicos si falla la aceptación",async()=>{
  const x=await setup(),proof=await purposeToken(x,"delete_account"),id=crypto.randomUUID(),token="c".repeat(64);const prefix="create function pg_temp.fail_request() returns trigger language plpgsql as $body$ begin raise exception 'induced';end $body$;create trigger fail_request before insert on ops.deletion_blocks for each row execute function pg_temp.fail_request();";
  const signed=(await x.c.auth.getClaims()).data!.claims;const scoped=JSON.stringify({sub:x.uid,role:"authenticated",session_id:signed.session_id});
  denied(x.uid,`select set_config('request.jwt.claims','${scoped}',true);select api.request_deletion('${id}','${token}','${proof}','ELIMINAR')`,"P0001",prefix);expect((await accounts(x)).data).toHaveLength(1);expect((await x.c.schema("api").rpc("request_deletion",{p_request_id:id,p_tracking_token:token,p_proof:proof,p_confirmation:"ELIMINAR"})).error).toBeNull();
 });
 it("worker real cifra manifiesto antes de purgar, elimina Auth y conserva estado sin identidad",async()=>{
  const {manifestStore,runBatch,localQuery}=await import("../../scripts/deletion-worker.mjs"),{mkdtempSync,readFileSync}=await import("node:fs"),{tmpdir}=await import("node:os"),path=await import("node:path");const dir=mkdtempSync(path.join(tmpdir(),"finzi-deletion-"));temporary.push(dir);const store=manifestStore(path.join(dir,"manifests"),path.join(dir,"keys","key"));await runBatch({store,limit:20});
  const x=await setup();expect((await post(x)).error).toBeNull();const debt=await x.c.schema("api").rpc("debt_command",{p_command:{action:"create",requestId:crypto.randomUUID(),name:"Deuda a eliminar",creditor:"Persona sintética",detail:"",icon:"wallet",category:null,currency:"PEN",amount:"10.00",dueDate:null}});expect(debt.error).toBeNull();expect((await x.c.schema("api").rpc("debt_command",{p_command:{action:"pay",id:debt.data.id,requestId:crypto.randomUUID(),mode:"new",accountId:x.account.id,categoryId:x.expense.id,amount:"1.00",occurredAt:null,note:""}})).error).toBeNull();const receipt=await requestDeletion(x);expect((await x.c.schema("api").rpc("read_debts")).error?.code).toBe("42501");const r=await runBatch({store,limit:5});expect(r.retries).toBe(0);expect((await status(receipt.id,receipt.token)).data.status).toBe("completed");expect(JSON.stringify((await status(receipt.id,receipt.token)).data)).not.toContain(x.uid);expect(localQuery(`select to_jsonb(count(*)) from ops.deletion_subjects where user_id='${x.uid}'`)).toBe(0);expect(readFileSync(path.join(store.root,`${receipt.id}.manifest.enc`),"utf8")).not.toContain(x.uid);expect((await x.c.auth.getUser()).error).not.toBeNull();expect((await accounts(x)).data).toEqual([]);
 });
 it("reaplicar manifiesto independiente bloquea identidad restaurada antes de volver a servir datos",async()=>{
  const {manifestStore,runBatch,restoreManifests}=await import("../../scripts/deletion-worker.mjs"),{mkdtempSync}=await import("node:fs"),{tmpdir}=await import("node:os"),path=await import("node:path");const dir=mkdtempSync(path.join(tmpdir(),"finzi-deletion-"));temporary.push(dir);const store=manifestStore(path.join(dir,"manifests"),path.join(dir,"keys","key"));const x=await setup(),receipt=await requestDeletion(x);await runBatch({store,limit:5});expect((await status(receipt.id,receipt.token)).data.status).toBe("completed");
  const {runSupabase}=await import("../../scripts/supabase-cli.mjs");const config=JSON.parse(runSupabase(["status","-o","json"]));const admin=createClient(config.API_URL,config.SECRET_KEY??config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});expect((await admin.auth.admin.createUser({id:x.uid,email:`restored-${x.uid}@example.test`,password:"una clave restaurada de prueba 42",email_confirm:true})).error).toBeNull();
  expect(restoreManifests(store)).toBe(1);expect((await x.c.schema("api").rpc("read_profile")).data).toBeNull();expect((await x.c.schema("api").rpc("ensure_profile")).error?.code).toBe("42501");expect((await runBatch({store,limit:5})).retries).toBe(0);expect((await status(receipt.id,receipt.token)).data.status).toBe("completed");
 });
 it("roles de aplicación no pueden operar worker ni leer comprobantes/manifiestos",()=>{
  denied(a.uid,"select ops.claim_deletion()","42501");denied(a.uid,"set local role authenticated;select * from ops.deletion_receipts","42501");expect(sql(b.uid,"select count(*) from ops.deletion_subjects where user_id<>finance.raw_request_user_id()")).toContain("\n0\n");
 });
});
