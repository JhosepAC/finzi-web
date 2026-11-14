import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Solo Supabase local.");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function setup(zone = "America/Lima") {
  const c = client(), email = `reports-${crypto.randomUUID()}@example.test`;
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

const overview = (x: Context, args = {}) => x.c.schema("api").rpc("read_overview",{p_currency:"PEN",p_period:"month",p_anchor:"2026-05-15",...args});
async function historic(x: Context, name = "Histórica", currency = "PEN", opening = "100") {
 const id = crypto.randomUUID(); sql(x.uid,`insert into finance.accounts(id,user_id,create_request_id,name,type,currency_code,opening_balance,opening_at) values('${id}','${x.uid}',gen_random_uuid(),'${name}','cash','${currency}',${opening},'2026-01-01Z')`); return id;
}
describe("A-08 reporting real reconciliado",() => {
 let x: Context,b: Context,source: string,destination: string,expenseId:string;
 beforeAll(async () => {
  x=await setup();b=await setup();source=await historic(x);destination=await historic(x,"Destino","PEN","0");
  for(const [date,kind,amount] of [["2026-04-10T12:00:00Z","income","40"],["2026-04-11T12:00:00Z","expense","10"],["2026-05-10T12:00:00Z","income","50"],["2026-05-11T12:00:00Z","expense","20"]]) {
   const r=await post(x,{p_account_id:source,p_kind:kind,p_category_id:kind==="income"?x.income.id:x.expense.id,p_amount:amount,p_occurred_at:date});expect(r.error).toBeNull();if(kind==="expense" && amount==="20")expenseId=r.data.id;
  }
  expect((await x.c.schema("api").rpc("post_transfer",{p_request_id:crypto.randomUUID(),p_account_id:source,p_destination_id:destination,p_amount:"30",p_description:"Traslado",p_note:"",p_occurred_at:"2026-05-12T12:00:00Z"})).error).toBeNull();
 });
 it("totales coinciden con historial y saldo actual real, sin inflar flujo por apertura/transferencia",async () => {
  const r=await overview(x);expect(r.error).toBeNull();expect(r.data).toMatchObject({income_minor:"5000",expense_minor:"2000",previous_income_minor:"4000",previous_expense_minor:"1000",balance_minor:"26000",movement_count:3,from:"2026-05-01",to:"2026-05-31",partial:false});
  const ledger=await read(x,{p_from:"2026-05-01",p_to:"2026-05-31",p_status:"posted"});expect(ledger.data.income_minor).toBe(r.data.income_minor);expect(ledger.data.expense_minor).toBe(r.data.expense_minor);
  expect((await accounts(x)).data.reduce((v:bigint,a:{balance_minor:string})=>v+BigInt(a.balance_minor),0n).toString()).toBe(r.data.balance_minor);
 });
 it("series completan días sin operaciones y solo incorporan cuentas desde su apertura",async () => {
  const r=(await overview(x)).data;expect(r.series).toHaveLength(31);expect(r.series[0]).toMatchObject({balance_minor:"13000",income_minor:"0",expense_minor:"0"});expect(r.series.at(-1).balance_minor).toBe("16000");
  const early=await overview(x,{p_anchor:null,p_period:"custom",p_from:"2025-12-30",p_to:"2026-01-02"});expect(early.error).toBeNull();expect(early.data.series.map((s:{balance_minor:string|null})=>s.balance_minor)).toEqual([null,"10000","10000","10000"]);
 });
 it("transferencia afecta la evolución de una cuenta, se cuenta una vez y no entra a ingresos/gastos",async () => {
  const sourceReport=(await overview(x,{p_account_id:source})).data,destReport=(await overview(x,{p_account_id:destination})).data;
  expect(sourceReport).toMatchObject({balance_minor:"13000",income_minor:"5000",expense_minor:"2000",movement_count:3});expect(destReport).toMatchObject({balance_minor:"3000",income_minor:"0",expense_minor:"0",movement_count:1});expect(destReport.series.at(-1).balance_minor).toBe("3000");
 });
 it.each([["day","2026-05-15","2026-05-15","2026-05-14","2026-05-14"],["week","2026-05-11","2026-05-17","2026-05-04","2026-05-10"],["quarter","2026-04-01","2026-06-30","2026-01-01","2026-03-31"],["year","2026-01-01","2026-12-31","2025-01-01","2025-12-31"]])("%s y período anterior calendario",async(period,from,to,previous_from,previous_to) => {
  const r=await overview(x,{p_period:period});expect(r.error).toBeNull();expect(r.data).toMatchObject({from,to,previous_from,previous_to});
 });
 it("custom compara igual cantidad de días y año usa cierres mensuales sin futuros",async()=>{
  const r=await overview(x,{p_period:"custom",p_anchor:null,p_from:"2026-05-05",p_to:"2026-05-10"});expect(r.data).toMatchObject({previous_from:"2026-04-29",previous_to:"2026-05-04"});
  const annual=(await overview(x,{p_period:"year"})).data;expect(annual.granularity).toBe("month");expect(annual.series.length).toBeLessThanOrEqual(12);expect(annual.series.at(-1).to).toBe(annual.as_of.slice(0,10));
 });
 it("agrupa categoría padre e hijos una vez, reconcilia distribución con historial y permite categorías archivadas",async()=>{
  const child=crypto.randomUUID();sql(x.uid,`insert into finance.categories(id,user_id,create_request_id,parent_id,kind,name,description,color,icon) values('${child}','${x.uid}',gen_random_uuid(),'${x.expense.id}','expense','Subcategoría de prueba','','blue','tag')`);
  expect((await post(x,{p_account_id:source,p_kind:"expense",p_category_id:child,p_amount:"5",p_occurred_at:"2026-05-13T12:00:00Z"})).error).toBeNull();
  const r=(await overview(x)).data,c=r.categories.find((c:{kind:string})=>c.kind==="expense");expect(c).toMatchObject({category_id:x.expense.id,amount_minor:"2500"});expect(c.children).toHaveLength(2);expect(c.children.reduce((sum:bigint,c:{amount_minor:string})=>sum+BigInt(c.amount_minor),0n).toString()).toBe(r.expense_minor);
  expect((await read(x,{p_from:r.from,p_to:r.to,p_category_id:c.category_id,p_status:"posted"})).data.expense_minor).toBe("2500");
  expect((await x.c.schema("api").rpc("update_category",{p_id:x.expense.id,p_name:x.expense.name,p_description:x.expense.description,p_color:x.expense.color,p_icon:x.expense.icon,p_archived:true,p_expected_version:1})).error).toBeNull();expect((await overview(x)).data.expense_minor).toBe("2500");
 });
 it("reemplazar fecha/tipo reclasifica ambos períodos y la serie; anular sucesor no restaura el original",async()=>{
  const c=await x.c.schema("api").rpc("replace_movement",{p_request_id:crypto.randomUUID(),p_id:expenseId,p_expected_version:1,p_reason:"Fecha y tipo corregidos",p_kind:"income",p_account_id:source,p_destination_id:null,p_category_id:x.income.id,p_amount:"20",p_description:"Corregido",p_note:"",p_occurred_at:"2026-04-20T12:00:00Z"});expect(c.error).toBeNull();
  expect((await overview(x)).data).toMatchObject({expense_minor:"500",previous_income_minor:"6000"});
  expect((await x.c.schema("api").rpc("void_movement",{p_id:c.data.id,p_expected_version:1,p_reason:"No ocurrió"})).error).toBeNull();expect((await overview(x)).data).toMatchObject({expense_minor:"500",previous_income_minor:"4000"});
 });
 it("aislamiento A/B, anónimo, cuenta de otra moneda e intento de parámetros inválidos",async()=>{
  expect((await overview(b)).data.income_minor).toBe("0");expect((await overview(b,{p_account_id:source})).error?.code).toBe("P0002");expect((await client().schema("api").rpc("read_overview")).error?.code).toBe("42501");
  const usd=await historic(x,"Dólares","USD","900");expect((await overview(x,{p_account_id:usd})).error?.code).toBe("P0002");expect((await overview(x,{p_currency:"USD"})).data.balance_minor).toBe("90000");
  for(const args of [{p_currency:"EUR"},{p_period:"all"},{p_anchor:"infinity"},{p_anchor:"2099-01-01"},{p_period:"custom",p_anchor:null,p_from:"2000-01-01",p_to:"2026-01-01"},{p_period:"custom",p_anchor:null,p_from:"2026-01-01",p_to:"2099-01-01"}]) expect((await overview(x,args)).error?.code).toBe("23514");
  denied(x.uid,"set local role authenticated; select * from finance.transactions","42501");
 });
 it("DST usa días locales de 23 y 25 horas con base exacta y sin duplicar extremos",async()=>{
  const ny=await setup("America/New_York"),id=await historic(ny);
  for(const instant of ["2026-03-08T04:59:59Z","2026-03-08T05:00:00Z","2026-03-09T03:59:59Z","2026-03-09T04:00:00Z","2026-11-01T03:59:59Z","2026-11-01T04:00:00Z","2026-11-02T04:59:59Z","2026-11-02T05:00:00Z"]) expect((await post(ny,{p_account_id:id,p_amount:"0.10",p_occurred_at:instant})).error).toBeNull();
  for(const p_anchor of ["2026-03-08","2026-11-01"]) {const r=await overview(ny,{p_period:"day",p_anchor});expect(r.data.income_minor).toBe("20");expect(r.data.series).toHaveLength(1);expect(r.data.series[0].income_minor).toBe("20");}
 });
 it("último cierre de hoy reconcilia saldo actual y cuentas archivadas siguen incluidas",async()=>{
  const r=await overview(x,{p_period:"day",p_anchor:null});expect(r.error).toBeNull();expect(r.data.series.at(-1).balance_minor).toBe(r.data.balance_minor);
  const current=(await accounts(x)).data.find((a:{id:string})=>a.id===source);expect((await x.c.schema("api").rpc("update_account",{p_id:source,p_name:current.name,p_opening:"100",p_archived:true,p_expected_version:current.version})).error).toBeNull();expect((await overview(x)).data.accounts.find((a:{id:string})=>a.id===source).status).toBe("archived");
 });
 it("precisión superior a Number, decimales y JSON monetario exacto",async()=>{
  const p=await setup(),id=await historic(p,"Grande","PEN","9999999999999999.99");
  for(const amount of ["0.10","0.20"]) expect((await post(p,{p_kind:"expense",p_account_id:id,p_category_id:p.expense.id,p_amount:amount})).error).toBeNull();
  const r=await overview(p,{p_period:"day",p_anchor:null});expect(r.error).toBeNull();expect(r.data).toMatchObject({expense_minor:"30",balance_minor:"1000000000000009969"});expect(r.data.series.at(-1).balance_minor).toBe(r.data.balance_minor);
 });
 it("RPC de reporting es STABLE, ejecutor sin bypass y no concede acceso a tablas",()=>{
  expect(sql(x.uid,"select p.provolatile::text||':'||r.rolname||':'||r.rolbypassrls from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='api' and p.proname='read_overview'")).toContain("s:app_executor:false");
 });

 it("agregados y distribución usan todo el historial, no solo los cinco recientes o primera página",async()=>{
  const p=await setup();sql(p.uid,`insert into finance.transactions(user_id,create_request_id,kind,description,amount,currency_code,category_id,occurred_at) select '${p.uid}',gen_random_uuid(),'income','Muchos registros',1,'PEN','${p.income.id}',now() from generate_series(1,60); insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) select user_id,id,'${p.account.id}',1 from finance.transactions; insert into finance.transaction_events(user_id,transaction_id,action,version) select user_id,id,'posted',1 from finance.transactions`);
  const r=await overview(p,{p_anchor:null});expect(r.error).toBeNull();expect(r.data).toMatchObject({income_minor:"6000",movement_count:60,balance_minor:"16000"});expect(r.data.recent).toHaveLength(5);expect(r.data.categories[0].amount_minor).toBe("6000");expect((await read(p)).data.income_minor).toBe("6000");
 });

});
