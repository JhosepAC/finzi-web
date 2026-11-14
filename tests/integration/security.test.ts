import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `security-${crypto.randomUUID()}@example.test`;
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
function sql(uid: string, statement: string, prefix = "") {
  if (!/^[a-f0-9-]{36}$/i.test(uid)) throw new Error("UUID inválido.");
  return execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", `begin; ${prefix} set local role app_executor; select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true); ${statement}; commit;`], { encoding: "utf8", stdio: "pipe" });
}
function denied(uid: string, statement: string, code: string, prefix = "") { let message = ""; try { sql(uid, statement, prefix); } catch (error) { message = String((error as { stderr: string }).stderr); } expect(message).toContain(code); }

const purpose={p_purpose:"change_password"};
const issue=(x:Context)=>x.c.schema("api").rpc("issue_reauth_proof",purpose);
const consume=(x:Context,token:string,p="change_password")=>x.c.schema("api").rpc("consume_reauth_proof",{p_token:token,p_purpose:p});
async function passwordLogin(x:Context){const user=await x.c.auth.getUser();expect((await x.c.auth.signInWithPassword({email:user.data.user!.email!,password:"una frase de prueba para movimientos 64"})).error).toBeNull();}
describe("A-09 prueba de contraseña, sesión y auditoría de preferencias",()=>{
 let a:Context,b:Context;
 beforeAll(async()=>{a=await setup();b=await setup();});
 it("OTP fresco no es contraseña; usuario anónimo no emite comprobantes",async()=>{expect((await issue(a)).error?.code).toBe("42501");expect((await client().schema("api").rpc("issue_reauth_proof",purpose)).error?.code).toBe("42501");});
 it("contraseña real emite secreto hash, fin máximo cinco minutos y solo estado visible",async()=>{
  await passwordLogin(a);const r=await issue(a);expect(r.error).toBeNull();expect(r.data.token).toMatch(/^[a-f0-9]{64}$/);expect(new Date(r.data.expires_at).getTime()).toBeLessThanOrEqual(Date.now()+300100);
  expect(sql(a.uid,`select token_hash=sha256(convert_to('${r.data.token}','UTF8')) from finance.reauth_proofs`)).toContain("\nt\n");
  const status=await a.c.schema("api").rpc("read_reauth_proof",{p_token:r.data.token});expect(status.data).toEqual({expires_at:r.data.expires_at});expect((await consume(a,r.data.token)).data).toBe(true);expect((await consume(a,r.data.token)).data).toBe(false);expect((await a.c.schema("api").rpc("read_reauth_proof",{p_token:r.data.token})).data).toBeNull();
 });
 it("usuario, sesión y finalidad están vinculados; otra sesión del mismo usuario no consume",async()=>{
  const r=await issue(a);expect(r.error).toBeNull();expect((await consume(b,r.data.token)).data).toBe(false);expect((await consume(a,r.data.token,"export")).data).toBe(false);
  const session=client(),user=await a.c.auth.getUser();expect((await session.auth.signInWithPassword({email:user.data.user!.email!,password:"una frase de prueba para movimientos 64"})).error).toBeNull();expect((await session.schema("api").rpc("consume_reauth_proof",{p_token:r.data.token,...purpose})).data).toBe(false);expect((await consume(a,r.data.token)).data).toBe(true);
 });
 it("consumo concurrente y rotación solo permiten un comprobante vigente por sesión/finalidad",async()=>{
  const first=await issue(a),second=await issue(a);expect((await consume(a,first.data.token)).data).toBe(false);const results=await Promise.all([consume(a,second.data.token),consume(a,second.data.token)]);expect(results.map(r=>r.data).sort()).toEqual([false,true]);
 });
 it("comprobante vencido o malformado nunca autoriza",async()=>{
  const r=await issue(a);sql(a.uid,"update finance.reauth_proofs set created_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes'");expect((await consume(a,r.data.token)).data).toBe(false);expect((await consume(a,"x")).data).toBe(false);expect((await issue(a)).error).toBeNull();
 });
 it.each(["old","future","otp","missing"])("AMR %s no se rejuvenece por iat o refresh",async(kind)=>{
  const claims=(await a.c.auth.getClaims()).data!.claims;const timestamp=Math.floor(Date.now()/1000)+(kind==="future"?600:-301);
  const amr=kind==="missing"?[]:[{method:kind==="otp"?"otp":"password",timestamp:kind==="otp"?Math.floor(Date.now()/1000):timestamp}];
  const json=JSON.stringify({sub:a.uid,role:"authenticated",session_id:claims.session_id,iat:Math.floor(Date.now()/1000),amr});
  denied(a.uid,`select set_config('request.jwt.claims','${json}',true);select api.issue_reauth_proof('change_password')`,"42501");
 });
 it("auditoría registra zona/moneda anterior/nueva sin copiar nombre; reintento no duplica",async()=>{
  const profile=(await a.c.schema("api").rpc("read_profile")).data;
  const command={p_display_name:"Preferencias de prueba",p_currency:"USD",p_timezone:"America/New_York",p_expected_version:profile.version};
  expect((await a.c.schema("api").rpc("configure_profile",command)).error).toBeNull();expect((await a.c.schema("api").rpc("configure_profile",command)).error).toBeNull();const events=await a.c.schema("api").rpc("read_profile_events");expect(events.error).toBeNull();expect(events.data).toHaveLength(2);expect(events.data[0]).toMatchObject({previous_timezone:"America/Lima",new_timezone:"America/New_York",previous_currency:"PEN",new_currency:"USD"});expect(JSON.stringify(events.data)).not.toContain("Preferencias de prueba");expect((await b.c.schema("api").rpc("read_profile_events")).data).toHaveLength(1);
 });
 it("fallo de auditoría revierte preferencias/versión; conflicto no sobrescribe",async()=>{
  const p=(await a.c.schema("api").rpc("read_profile")).data;
  const prefix="create function pg_temp.fail_profile() returns trigger language plpgsql as $body$ begin raise exception 'induced'; end $body$;create trigger fail_profile before insert on finance.profile_events for each row execute function pg_temp.fail_profile();";
  denied(a.uid,`select api.configure_profile('No guardar','PEN','UTC',${p.version})`,"P0001",prefix);expect((await a.c.schema("api").rpc("read_profile")).data).toEqual(p);
  expect((await a.c.schema("api").rpc("configure_profile",{p_display_name:"No sobreescribir",p_currency:"PEN",p_timezone:"UTC",p_expected_version:p.version-1})).error?.code).toBe("40001");
 });
 it("roles efectivos no acceden a comprobantes/auditoría ni a datos ajenos",()=>{
  denied(a.uid,"set local role authenticated;select * from finance.reauth_proofs","42501");denied(a.uid,"set local role authenticated;select * from finance.profile_events","42501");expect(sql(a.uid,"select count(*) from finance.reauth_proofs where user_id<>finance.request_user_id()")).toContain("\n0\n");
  expect(sql(a.uid,"select bool_and(r.rolname='app_executor' and not r.rolbypassrls) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='api' and p.proname in ('issue_reauth_proof','consume_reauth_proof','read_reauth_proof','read_profile_events')")).toContain("\nt\n");
 });
 it("refresh oficial firma JWT nuevo conservando AMR password antiguo",async()=>{
  const x=await setup();await passwordLogin(x);const before=(await x.c.auth.getClaims()).data!.claims;const sid=before.session_id;if(typeof sid!=="string"||!/^[a-f0-9-]{36}$/.test(sid))throw new Error("Sesión de prueba inválida");
  execFileSync("docker",["exec","supabase_db_finzi-auth","psql","-U","supabase_admin","-d","postgres","-v","ON_ERROR_STOP=1","-c",`update auth.mfa_amr_claims set created_at=now()-interval '10 minutes',updated_at=now()-interval '10 minutes' where session_id='${sid}' and authentication_method='password';`],{stdio:"pipe"});
  expect((await x.c.auth.refreshSession()).error).toBeNull();const after=(await x.c.auth.getClaims()).data!.claims;expect(after.iat).toBeGreaterThanOrEqual(before.iat);const methods=after.amr as {method:string;timestamp:number}[];expect(methods.find(a=>a.method==="password")!.timestamp).toBeLessThan(Date.now()/1000-300);expect((await issue(x)).error?.code).toBe("42501");
 });

});
