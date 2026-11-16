import { gateway } from "../../telegram-bot/gateway";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createBot } from "../../telegram-bot/bot";
import { findMailLink } from "../helpers/mail";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Local Supabase only");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const secret = () => randomBytes(32).toString("hex");
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
function sql(query: string, role = "finzi_telegram_gateway") {
 return execFileSync("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-h", "127.0.0.1", "-U", role, "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { input: query, encoding: "utf8", stdio: "pipe" }).trim();
}
function asyncSql(query: string, role = "finzi_telegram_gateway", onOutput?: (value: string) => void): Promise<string> {
 return new Promise((resolve,reject) => {
  const child = spawn("docker", ["exec","-i","supabase_db_finzi-auth","psql","-h","127.0.0.1","-U",role,"-d","postgres","-Atq","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose"], { stdio: "pipe" });
  let output="", error="";
  child.stdout.on("data", chunk => { output+=String(chunk); onOutput?.(output); });
  child.stderr.on("data", chunk => { error+=String(chunk); });
  child.on("error",reject); child.on("close",code => code===0?resolve(output.trim()):reject(new Error(error)));
  child.stdin.end(query);
 });
}
function denied(query: string, code = "42501", role?: string) {
 let error = ""; try { sql(query, role); } catch (e) { error = String((e as { stderr: string }).stderr); }
 expect(error).toContain(code);
}
async function setup() {
 const c = client(), email = `telegram-${crypto.randomUUID()}@example.test`;
 expect((await c.auth.signUp({ email, password: "telegram isolated test password 2026" })).error).toBeNull();
 const link = new URL(await findMailLink(email, "signup"));
 const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" });
 expect(verified.error).toBeNull();
 expect((await c.schema("api").rpc("ensure_profile")).error).toBeNull();
 expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Telegram test", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 })).error).toBeNull();
 const account = await c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Own account", p_type: "cash", p_currency: "PEN", p_opening: "100" });
 expect(account.error).toBeNull();
 return { c, uid: verified.data.user!.id, account: account.data.id };
}
type User = Awaited<ReturnType<typeof setup>>;
async function bind(u: User, identity: string) {
 const challenge = secret(), capability = secret();
 const issued = await u.c.schema("api").rpc("telegram_issue_link", { p_challenge_hash: hash(challenge) });
 expect(issued.error).toBeNull();
 const attempt = sql(`select telegram_private.claim_link(${quote(challenge)},'9001',${quote(identity)},${quote(identity)},${quote(hash(capability))});`);
 expect(attempt).toBe(issued.data.id);
 expect(sql(`select telegram_private.link_context(${quote(capability)},'9001',${quote(identity)},${quote(identity)}) is null;`)).toBe("t");
 const activated = await u.c.schema("api").rpc("telegram_activate_link", { p_attempt: attempt });
 expect(activated.error).toBeNull();
 const resolved=JSON.parse(sql(`select telegram_private.link_context(${quote(capability)},'9001',${quote(identity)},${quote(identity)});`));
 expect(resolved.linkId).toBe(activated.data.id);expect(resolved.capability).toBeUndefined();
 return { linkId: activated.data.id as string, generation: "1", botId: "9001", telegramUserId: identity, chatId: identity, capability, scope: "catalog:read" };
}
type Context = Awaited<ReturnType<typeof bind>>;
const ctx = (c: Context) => `${quote(JSON.stringify(c))}::jsonb`;
const catalog = (c: Context) => `select telegram_private.read_catalog(${ctx(c)},'accounts');`;
const draft = (c: Context, update: string, text = "Unparsed source") => `select telegram_private.create_draft(${ctx({ ...c, scope: "draft:write" })},${quote(update)},${quote(text)});`;

describe("Telegram phase 2: real delegated roles, persistence and web regression", () => {
 let a: User, b: User, ac: Context, bc: Context;
 beforeAll(async () => { a = await setup(); b = await setup(); ac = await bind(a, "81001" + Math.floor(Math.random()*1000000)); bc = await bind(b, "82001" + Math.floor(Math.random()*1000000)); });
 it("real gateway login is restricted and sees only its linked owner's accounts", () => {
  expect(sql("select session_user,current_user;")).toBe("finzi_telegram_gateway|finzi_telegram_gateway");
  const result = JSON.parse(sql(catalog(ac))); expect(result.map((v: {id:string}) => v.id)).toEqual([a.account]);
  expect(JSON.parse(sql(catalog(bc))).map((v: {id:string}) => v.id)).toEqual([b.account]);
  denied("select * from finance.accounts;"); denied("select * from telegram_private.links;");
  denied("set role app_executor;"); denied("set role authenticated;");
  denied("select api.read_accounts();"); denied("select api.post_movement(null,null,null,null,null,null,null,null);");
  denied(`select telegram_private.resolve_identity(${ctx(ac)});`);
 });
 it("schema, function owners and effective RLS grants keep the gateway outside financial DML", () => {
  expect(sql("select (not rolsuper and not rolbypassrls and not rolinherit and not rolcreatedb and not rolcreaterole)::text from pg_roles where rolname='finzi_telegram_gateway';","supabase_admin")).toBe("true");
  expect(sql("select count(*) from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='finzi_telegram_gateway';","supabase_admin")).toBe("0");
  expect(sql("select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='telegram_private' and c.relkind='r';","supabase_admin")).toBe("t");
  expect(sql("select bool_and(r.rolname='app_executor' and not r.rolbypassrls) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='telegram_private' and p.proname in ('read_catalog','create_draft');","supabase_admin")).toBe("t");
  expect(sql(`begin; set local role app_executor; set local request.jwt.claims='{"sub":"${a.uid}"}'; select count(*) from telegram_private.links where user_id<>'${a.uid}'; rollback;`,"supabase_admin")).toBe("0");
  denied(`begin; set local role authenticated; select * from telegram_private.link_attempts;`,"42501","supabase_admin");
 });
 it("forged claims, flags, generation, chat and capability never authorize", () => {
  for (const patch of [{ capability: secret() }, { chatId: bc.chatId }, { telegramUserId: bc.telegramUserId }, { linkId: bc.linkId }, { generation: "2" }, { scope: "movement:confirm" }]) denied(catalog({ ...ac, ...patch }));
  denied(`begin; set local request.jwt.claims='{"sub":"${b.uid}","role":"authenticated"}'; set local finzi.user_id='${b.uid}'; set local finzi.verified='true'; ${catalog({ ...ac, capability: secret() })}`);
  expect(JSON.parse(sql(`begin; set local request.jwt.claims='{"sub":"${b.uid}"}'; ${catalog(ac)} commit;`)).map((v:{id:string})=>v.id)).toEqual([a.account]);
 });
 it("same database connection restores context after success and rollback", () => {
  const output = sql(`begin; ${catalog(ac)} select coalesce(nullif(current_setting('finzi.telegram.context',true),''),'empty'); ${catalog(bc)} rollback; select coalesce(nullif(current_setting('finzi.telegram.context',true),''),'empty');`).split("\n");
  expect(output[1]).toBe("empty"); expect(output.at(-1)).toBe("empty");
  denied(`begin; set local role anon; ${catalog(ac)}`, "42501", "supabase_admin");
 });
 it("draft deduplication is durable, no financial entry is published, conflict preserves the first payload", () => {
  const first = JSON.parse(sql(draft(ac, "1"))), again = JSON.parse(sql(draft(ac, "1")));
  expect(first).toEqual(again); expect(first.state).toBe("needs_input");
  expect(new Date(first.expires_at).getTime()).toBeLessThanOrEqual(Date.now()+901000);
  denied(draft(ac,"1","Different source"),"40001");
  expect(sql(`select count(*) from finance.transactions where user_id='${a.uid}';`,"supabase_admin")).toBe("0");
  expect(sql(`select count(*) from telegram_private.receipts where user_id='${a.uid}';`,"supabase_admin")).toBe("1");
 });
 it("web RPC and RLS still isolate A/B and status never exports hashes or capabilities", async () => {
  const status = await a.c.schema("api").rpc("telegram_link_status"); expect(status.error).toBeNull();
  expect(status.data.links).toHaveLength(1); expect(JSON.stringify(status.data)).not.toMatch(/capability|challenge|hash/);
  expect((await b.c.schema("api").rpc("telegram_revoke_link",{p_id:ac.linkId})).error?.code).toBe("P0002");
  expect((await client().schema("api").rpc("telegram_link_status")).error).not.toBeNull();
  expect((await a.c.schema("api").rpc("read_accounts")).data.map((v:{id:string})=>v.id)).toEqual([a.account]);
 });
 it("concurrent duplicate updates persist one draft and one receipt", async () => {
  const results=await Promise.all([asyncSql(draft(ac,"900")),asyncSql(draft(ac,"900"))]);
  expect(JSON.parse(results[0])).toEqual(JSON.parse(results[1]));
  expect(sql(`select count(*) from telegram_private.receipts where link_id='${ac.linkId}' and update_id='900';`,"supabase_admin")).toBe("1");
 });
 it("permission expires while a catalog request waits for the profile lock", async () => {
  let locked!:()=>void; const ready=new Promise<void>(resolve=>{locked=resolve;});
  const blocker=asyncSql(`begin; select 1 from finance.profiles where user_id='${a.uid}' for update; select 'locked'; select pg_sleep(1); update telegram_private.links set created_at=now()-interval '31 days',expires_at=now()-interval '1 day' where id='${ac.linkId}'; commit;`,"supabase_admin",out=>{if(out.includes("locked"))locked();});
  await ready; await expect(asyncSql(catalog(ac))).rejects.toThrow("42501"); await blocker;
  sql(`update telegram_private.links set created_at=now(),expires_at=now()+interval '1 day' where id='${ac.linkId}';`,"supabase_admin");
 });
 it("revocation while a catalog request waits is rechecked before reading money", async () => {
  const u=await setup(), c=await bind(u,"84001"+Math.floor(Math.random()*1000000));
  let locked!:()=>void; const ready=new Promise<void>(resolve=>{locked=resolve;});
  const blocker=asyncSql(`begin; select 1 from finance.profiles where user_id='${u.uid}' for update; select 'locked'; select pg_sleep(1); update telegram_private.links set revoked_at=clock_timestamp() where id='${c.linkId}'; commit;`,"supabase_admin",out=>{if(out.includes("locked"))locked();});
  await ready; await expect(asyncSql(catalog(c))).rejects.toThrow("42501"); await blocker;
 });
 it("challenge is single use, A cannot activate B, and an expired attempt cannot be claimed", async () => {
  const challenge=secret(); const issued=await a.c.schema("api").rpc("telegram_issue_link",{p_challenge_hash:hash(challenge)}); expect(issued.error).toBeNull();
  const command=`select telegram_private.claim_link(${quote(challenge)},'9001','999123','999123',${quote(hash(secret()))});`;
  const claimed=sql(command); expect(sql(command)).toBe(claimed);
  denied(command.replaceAll("999123","999125"));
  expect((await b.c.schema("api").rpc("telegram_activate_link",{p_attempt:issued.data.id})).error?.code).toBe("42501");
  const second=secret(), next=await b.c.schema("api").rpc("telegram_issue_link",{p_challenge_hash:hash(second)}); expect(next.error).toBeNull();
  sql(`update telegram_private.link_attempts set created_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes' where id='${next.data.id}';`,"supabase_admin");
  denied(`select telegram_private.claim_link(${quote(second)},'9001','999124','999124',${quote(hash(secret()))});`);
 });
 it("draft expiry and cleanup leave a replay tombstone and cannot alter financial balances", () => {
  const d=JSON.parse(sql(draft(ac,"901")));
  sql(`update telegram_private.drafts set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' where id='${d.id}'; select telegram_private.cleanup();`,"supabase_admin");
  expect(sql(`select state||':'||(source_text is null)::text from telegram_private.drafts where id='${d.id}';`,"supabase_admin")).toBe("expired:true");
  expect(JSON.parse(sql(draft(ac,"901")))).toMatchObject({id:d.id,state:"expired"});
  denied("select telegram_private.cleanup();");
  expect(JSON.parse(sql(catalog(ac)))[0].balance_minor).toBe("10000");
 });
 it("exports own Telegram data without credential hashes; normal deletion cascades metadata", async () => {
  const u=await setup(), c=await bind(u,"83001"+Math.floor(Math.random()*1000000)); sql(draft(c,"1"));
  const email=(await u.c.auth.getUser()).data.user!.email!;
  expect((await u.c.auth.signInWithPassword({email,password:"telegram isolated test password 2026"})).error).toBeNull();
  const proof=await u.c.schema("api").rpc("issue_reauth_proof",{p_purpose:"export_data"}); expect(proof.error).toBeNull();
  const exported=await u.c.schema("api").rpc("export_personal_data",{p_proof:proof.data.token,p_format:"json"}); expect(exported.error).toBeNull();
  expect(exported.data.telegram.links[0].id).toBe(c.linkId); expect(exported.data.telegram.drafts).toHaveLength(1);
  expect(JSON.stringify(exported.data.telegram)).not.toMatch(/capability|challenge|hash/);
  expect(JSON.stringify(exported.data.telegram)).not.toContain(ac.linkId);
  const deletionProof=await u.c.schema("api").rpc("issue_reauth_proof",{p_purpose:"delete_account"}); expect(deletionProof.error).toBeNull();
  const receipt=crypto.randomUUID(), tracking=secret();
  const queued=await u.c.schema("api").rpc("request_deletion",{p_request_id:receipt,p_tracking_token:tracking,p_proof:deletionProof.data.token,p_confirmation:"ELIMINAR"}); expect(queued.error).toBeNull(); denied(catalog(c));
  // Exercise the established leased purge under the actual worker role, with a test manifest digest.
  const lease=secret();
  sql(`update ops.deletion_receipts set lease_hash=decode('${hash(lease)}','hex'),lease_until=now()+interval '2 minutes' where id='${receipt}';`,"supabase_admin");
  sql(`begin; set local role finzi_deletion_worker; select ops.deletion_step('${receipt}','${lease}','manifest','${hash("synthetic manifest")}'); select ops.deletion_step('${receipt}','${lease}','purge',null); commit;`,"supabase_admin");
  for(const table of ["links","link_attempts","drafts","receipts"]) expect(sql(`select count(*) from telegram_private.${table} where user_id='${u.uid}';`,"supabase_admin")).toBe("0");
 });
 it("expiry, missing scope, deleted-account block and revocation are enforced on every request", async () => {
  sql(`update telegram_private.links set scopes=array['draft:write'] where id='${ac.linkId}';`,"supabase_admin"); denied(catalog(ac));
  sql(`update telegram_private.links set scopes=array['catalog:read','draft:write'],created_at=now()-interval '31 days',expires_at=now()-interval '1 day' where id='${ac.linkId}';`,"supabase_admin"); denied(catalog(ac));
  sql(`update telegram_private.links set created_at=now(),expires_at=now()+interval '1 day' where id='${ac.linkId}'; insert into ops.deletion_blocks(user_id) values('${a.uid}');`,"supabase_admin"); denied(catalog(ac));
  expect((await a.c.schema("api").rpc("read_accounts")).error?.code).toBe("42501");
  sql(`delete from ops.deletion_blocks where user_id='${a.uid}';`,"supabase_admin");
  expect((await a.c.schema("api").rpc("telegram_revoke_link",{p_id:ac.linkId})).data).toBe(true);
  denied(catalog(ac)); denied(draft(ac,"2"));
  expect(sql(`select count(*) from telegram_private.drafts where user_id='${a.uid}' and (state not in ('cancelled','expired') or source_text is not null);`,"supabase_admin")).toBe("0");
  expect((await a.c.schema("api").rpc("telegram_revoke_link",{p_id:ac.linkId})).data).toBe(true);
 });
});


describe("Telegram phase 4: versioned conversations without financial publication",()=>{
 let a:User,b:User,ac:Context,bc:Context,category:string;
 const command=(c:Context,value:Record<string,unknown>)=>`select telegram_private.draft_command(${ctx({...c,scope:"draft:write"})},${quote(JSON.stringify(value))}::jsonb);`;
 const callbacks=(c:Context,d:{id:string;version:number},rows:{hash:string;field:string;value:string}[])=>`select telegram_private.register_callbacks(${ctx({...c,scope:"draft:write"})},'${d.id}',${d.version},${quote(JSON.stringify(rows))}::jsonb);`;
 function payload(){const received=new Date().toISOString();return {kind:"expense",amount:"25.00",currency:"PEN",accountId:a.account,categoryId:category,description:"Synthetic lunch",occurredAt:received,receivedAt:received,timezone:"America/Lima",note:"",warnings:[]};}
 function start(update:string,patch={}){const p={...payload(),...patch};return {action:"start",updateId:update,text:"Synthetic expense",payload:p};}
 beforeAll(async()=>{a=await setup();b=await setup();ac=await bind(a,"88001"+Math.floor(Math.random()*1000000));bc=await bind(b,"89001"+Math.floor(Math.random()*1000000));const cats=await a.c.schema("api").rpc("initialize_categories");expect(cats.error).toBeNull();category=cats.data.categories.find((c:{kind:string})=>c.kind==="expense").id;});
 it("loads only authorized profile/catalogs and prepares a complete pending preview once",()=>{
  const result=JSON.parse(sql(`select telegram_private.conversation_catalog(${ctx(ac)});`));expect(result.timezone).toBe("America/Lima");expect(result.accounts.map((v:{id:string})=>v.id)).toEqual([a.account]);
  const op=start("4001"),d=JSON.parse(sql(command(ac,op)));expect(d.state).toBe("pending");expect(d.awaiting).toBeNull();expect(JSON.parse(sql(command(ac,op)))).toEqual(d);
  expect(sql(`select count(*) from finance.transactions where user_id='${a.uid}';`,"supabase_admin")).toBe("0");
 });
 it("rejects JSON money numbers, unknown currencies, future/opening dates and foreign references",()=>{
  const bad=[{amount:25},{amount:"NaN"},{amount:"1.234"},{currency:"EUR"},{accountId:b.account},{kind:"income"}];
  for(let i=0;i<bad.length;i++)denied(command(ac,start(String(4100+i),bad[i])),"23514");
  denied(command(ac,start("4110",{occurredAt:new Date(Date.now()+86400000).toISOString()})),"22008");
  denied(command(ac,start("4111",{occurredAt:"2000-01-01T12:00:00Z"})),"22008");
  denied(`select telegram_private.validate_payload('{}',null);`);
 });
 it("stores missing fields, amends under expected version and never extends expiry or receipt date",()=>{
  const op=start("4200",{amount:null}),d=JSON.parse(sql(command(ac,op)));expect(d.state).toBe("needs_input");expect(d.awaiting).toBe("amount");
  const next={action:"amend",id:d.id,version:d.version,updateId:"4201",payload:{...d.payload,amount:"30.10"}};
  const updated=JSON.parse(sql(command(ac,next)));expect(updated.state).toBe("pending");expect(updated.version).toBe(d.version+1);expect(updated.expiresAt).toBe(d.expiresAt);expect(updated.payload.receivedAt).toBe(d.payload.receivedAt);
  expect(JSON.parse(sql(command(ac,next)))).toEqual(updated);
  denied(command(ac,{...next,updateId:"4202"}),"40001");
  denied(command(ac,{...next,version:undefined,updateId:"4203"}),"40001");
  denied(command(ac,{...next,version:updated.version,updateId:"4204",payload:{...updated.payload,receivedAt:"2000-01-01T00:00:00Z"}}),"23514");
 });
 it("binds callback hashes to owner/link/version and invalidates previous keyboards",()=>{
  const d=JSON.parse(sql(command(ac,start("4300")))),token=secret();sql(callbacks(ac,d,[{hash:hash(token),field:"currency",value:"USD"}]));
  denied(command(bc,{action:"choice",tokenHash:hash(token),updateId:"4301"}),"P0002");
  denied(command(ac,{action:"choice",tokenHash:hash(secret()),updateId:"4301"}),"P0002");
  const op={action:"choice",tokenHash:hash(token),updateId:"4302"},changed=JSON.parse(sql(command(ac,op)));expect(changed.payload.currency).toBe("USD");expect(changed.payload.accountId).toBeNull();expect(changed.awaiting).toBe("accountId");
  expect(JSON.parse(sql(command(ac,op)))).toEqual(changed);
  denied(command(ac,{...op,updateId:"4303"}),"P0002");
  denied(callbacks(ac,d,[{hash:hash(secret()),field:"cancel",value:"cancel"}]),"40001");
 });
 it("replays the canonical update after restart and never reinterprets a completed amendment",()=>{
  const op=start("4350"),d=JSON.parse(sql(command(ac,op)));
  expect(JSON.parse(sql(command(ac,{action:"replay",updateId:"4350"})))).toEqual(d);
  const amended=JSON.parse(sql(command(ac,{action:"amend",id:d.id,version:d.version,updateId:"4351",payload:{...d.payload,description:"Corrected"}})));
  expect(JSON.parse(sql(command(ac,{action:"replay",updateId:"4350"})))).toEqual(amended);
 });
 it("selecting an account opened after the proposed date asks for a valid date without extending receipt time",async()=>{
  const account=await a.c.schema("api").rpc("create_account",{p_request_id:crypto.randomUUID(),p_name:"New account",p_type:"cash",p_currency:"PEN",p_opening:"0"});expect(account.error).toBeNull();
  const d=JSON.parse(sql(command(ac,start("4360",{accountId:null,occurredAt:new Date(Date.now()-600000).toISOString()})))),token=secret();
  sql(callbacks(ac,d,[{hash:hash(token),field:"accountId",value:account.data.id}]));
  const selected=JSON.parse(sql(command(ac,{action:"choice",tokenHash:hash(token),updateId:"4361"})));expect(selected.awaiting).toBe("occurredAt");expect(selected.payload.occurredAt).toBeNull();expect(selected.payload.receivedAt).toBe(d.payload.receivedAt);
  const fixed=JSON.parse(sql(command(ac,{action:"amend",id:d.id,version:selected.version,updateId:"4362",payload:{...selected.payload,occurredAt:d.payload.receivedAt}})));expect(fixed.state).toBe("pending");
 });
 it("cancel is idempotent, scrubs private payload and old buttons cannot revive it",()=>{
  const d=JSON.parse(sql(command(ac,start("4400")))),token=secret();sql(callbacks(ac,d,[{hash:hash(token),field:"cancel",value:"cancel"}]));
  const op={action:"choice",tokenHash:hash(token),updateId:"4401"},cancelled=JSON.parse(sql(command(ac,op)));expect(cancelled.state).toBe("cancelled");expect(cancelled.payload).toEqual({});expect(JSON.parse(sql(command(ac,op)))).toEqual(cancelled);
  expect(sql(`select source_text is null from telegram_private.drafts where id='${d.id}';`,"supabase_admin")).toBe("t");
  denied(command(ac,{...op,updateId:"4402"}),"P0002");
 });
 it("dispatches real grammY corrections, cancellation and confirmation, recovering after a lost success notification",async()=>{
  const u=await setup(),context=await bind(u,"86001"+Math.floor(Math.random()*1000000));expect((await u.c.schema("api").rpc("initialize_categories")).error).toBeNull();
  const user={id:Number(context.telegramUserId),is_bot:false,first_name:"Synthetic"},chat={id:user.id,type:"private" as const,first_name:"Synthetic"};
  const info={id:9001,is_bot:true as const,first_name:"Finzi test",username:"finzi_test_bot",can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false,has_topics_enabled:false,allows_users_to_create_topics:false,can_manage_bots:false,supports_join_request_queries:false};
  let publicationAllowed=false,catalogUnavailable=false,failNotification=false,expiredAck=false;
  const port={query:async()=>{throw new Error("Unexpected query");},confirm:async(c:Record<string,string>,tokenHash:string,updateId:string)=>JSON.parse(sql(`select telegram_private.confirm_draft(${ctx({...context,...c,scope:"movement:confirm"})},'${tokenHash}','${updateId}');`)),claim:async()=>{},context:async()=>({...context,canConfirm:String(publicationAllowed)}),catalog:async(c:Record<string,string>)=>{if(catalogUnavailable)throw new Error("Catalog deliberately unavailable after commit");return JSON.parse(sql(`select telegram_private.conversation_catalog(${ctx({...context,...c,scope:"catalog:read"})});`));},command:async(c:Record<string,string>,cmd:Record<string,unknown>)=>{try{const result=sql(command({...context,...c},cmd));return result?JSON.parse(result):null;}catch(error){const code=String((error as {stderr:string}).stderr).match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];throw Object.assign(new Error("Synthetic SQL transport error"),{code});}},callbacks:async(c:Record<string,string>,id:string,version:number,rows:{hash:string;field:string;value:string}[])=>{sql(callbacks({...context,...c},{id,version},rows));}};
  const replies:{text:string;reply_markup?:{inline_keyboard:{text:string;callback_data:string}[][]}}[]=[];
  const bot=createBot("9001:synthetic_token",port,{state:{botId:"9001",offset:0,inbox:[],credentials:[{user:String(user.id),capability:context.capability,challengeHash:"synthetic",createdAt:Date.now()}]},save:()=>{},sign:v=>hash("synthetic signing key:"+v).slice(0,48)},info);
  bot.api.config.use(async(prev,method,payload)=>{if(method==="answerCallbackQuery"&&expiredAck)return {ok:false,error_code:400,description:"Bad Request: query is too old"};if(method==="sendMessage"){if(failNotification&&(payload as {text:string}).text.startsWith("Movimiento registrado"))throw new Error("Synthetic notification outage after commit");replies.push(payload as typeof replies[number]);}return {ok:true,result:method==="answerCallbackQuery"?true:{message_id:1,date:1,chat,text:"ok"}} as Awaited<ReturnType<typeof prev>>;});
  const send=async(text:string,id:number)=>bot.handleUpdate({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat,from:user,text}});
  const click=async(data:string,id:number)=>bot.handleUpdate({update_id:id,callback_query:{id:"synthetic-"+id,from:user,chat_instance:"synthetic",data,message:{message_id:1,date:Math.floor(Date.now()/1000),chat,from:info}}});
  await new Promise(resolve=>setTimeout(resolve,1100)); // Telegram timestamps have second precision; stay after opening.
  await send("Gasté 25 soles en almuerzo",4600);expect(replies.at(-1)!.text).toContain("Sin registrar");
  const old=replies.at(-1)!.reply_markup!.inline_keyboard.flat().find(b=>b.text==="Corregir importe")!.callback_data;
  await click(old,4601);expect(replies.at(-1)!.text).toContain("¿Cuál es el importe?");
  await send("30,10",4602);expect(replies.at(-1)!.text).toContain("S/ 30.10");
  const cancel=replies.at(-1)!.reply_markup!.inline_keyboard.flat().find(b=>b.text==="Cancelar borrador")!.callback_data;
  await click(cancel,4603);expect(replies.at(-1)!.text).toContain("Borrador cancelado");
  await click(old,4604);expect(replies.at(-1)!.text).toContain("cambió, venció");
  expect(sql(`select count(*) from finance.transactions where user_id='${u.uid}';`,"supabase_admin")).toBe("0");
  expect((await u.c.schema("api").rpc("telegram_set_movement_permission",{p_id:context.linkId,p_version:1,p_allow:true})).error).toBeNull();publicationAllowed=true;
  const cs=await u.c.schema("api").rpc("read_categories"),category=cs.data.categories.find((v:{kind:string;parent_id:string|null})=>v.kind==="expense"&&!v.parent_id);
  await send(`Gasté 25 soles en ${category.name}`,4610);
  const confirmation=replies.at(-1)!.reply_markup!.inline_keyboard.flat().find(b=>b.text==="Confirmar movimiento")!.callback_data;
  failNotification=true;await expect(click(confirmation,4611)).rejects.toThrow();
  expect(sql(`select count(*) from finance.transactions where user_id='${u.uid}';`,"supabase_admin")).toBe("1");
  failNotification=false;catalogUnavailable=true;expiredAck=true;await click(confirmation,4611);const canonical=replies.at(-1)!.text;expect(canonical).toContain("Movimiento registrado");expect(canonical).toContain("S/ 25.00");await click(confirmation,4612);expect(replies.at(-1)!.text).toBe(canonical);
  expect(sql(`select count(*) from finance.transactions where user_id='${u.uid}';`,"supabase_admin")).toBe("1");
 });
 it.skipIf(!process.env.TELEGRAM_DATABASE_URL)("uses the actual postgres driver for draft updates and confirmation guards without publication",async()=>{
  const port=gateway(process.env.TELEGRAM_DATABASE_URL!);
  try{
   expect((await port.catalog(ac)).timezone).toBe("America/Lima");
   const d=await port.command(ac,start("4990",{amount:null}));expect(d.awaiting).toBe("amount");
   const updated=await port.command(ac,{action:"amend",id:d.id,version:d.version,updateId:"4991",payload:{...d.payload,amount:"12.50"}});expect(updated.state).toBe("pending");
   const token=secret();await port.callbacks(ac,updated.id,updated.version,[{hash:hash(token),field:"cancel",value:"cancel"}]);
   const read=await port.command(ac,{action:"read",id:updated.id});expect(read.id).toBe(updated.id);
   expect((await port.command(ac,{action:"choice",tokenHash:hash(token),updateId:"4992"})).state).toBe("cancelled");
   // Even the actual financial entrypoint must reject a cancelled keyboard without publishing.
   expect((await a.c.schema("api").rpc("telegram_set_movement_permission",{p_id:ac.linkId,p_version:1,p_allow:true})).error).toBeNull();
   await expect(port.confirm(ac,hash(token),"4993")).rejects.toMatchObject({code:"P0002"});
   expect(sql(`select count(*) from finance.transactions where user_id='${a.uid}';`,"supabase_admin")).toBe("0");
  }finally{await port.close();}
 });
 it("expired drafts reject interactions and keep actual balance unchanged",()=>{
  const d=JSON.parse(sql(command(ac,start("4500"))));sql(`update telegram_private.drafts set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' where id='${d.id}';`,"supabase_admin");
  denied(command(ac,{action:"amend",id:d.id,version:d.version,updateId:"4501",payload:d.payload}),"23514");
  expect(JSON.parse(sql(catalog(ac)))[0].balance_minor).toBe("10000");
  expect(sql(`select count(*) from finance.transactions where user_id='${a.uid}';`,"supabase_admin")).toBe("0");
 });
});


describe("Telegram phase 5: explicit atomic confirmation with real roles",()=>{
 let a:User,b:User,ac:Context,bc:Context,category:string;let sequence=5000;
 const next=()=>String(++sequence);
 const command=(c:Context,op:object)=>`select telegram_private.draft_command(${ctx({...c,scope:"draft:write"})},${quote(JSON.stringify(op))}::jsonb);`;
 const confirm=(c:Context,token:string,update=next())=>`select telegram_private.confirm_draft(${ctx({...c,scope:"movement:confirm"})},'${hash(token)}','${update}');`;
 const register=(c:Context,d:{id:string;version:number},token:string)=>`select telegram_private.register_callbacks(${ctx({...c,scope:"draft:write"})},'${d.id}',${d.version},'[{"hash":"${hash(token)}","field":"confirm","value":"confirm"}]');`;
 const count=(u:User)=>Number(sql(`select count(*) from finance.transactions where user_id='${u.uid}';`,"supabase_admin"));
 async function permission(u:User,c:Context,allow:boolean){const status=await u.c.schema("api").rpc("telegram_link_status");expect(status.error).toBeNull();const l=status.data.links.find((l:{id:string})=>l.id===c.linkId);const r=await u.c.schema("api").rpc("telegram_set_movement_permission",{p_id:c.linkId,p_version:l.version,p_allow:allow});expect(r.error).toBeNull();}
 function pending(c=ac,u=a,patch:object={}){const receivedAt=new Date().toISOString();return JSON.parse(sql(command(c,{action:"start",updateId:next(),text:"Synthetic confirmation source",payload:{kind:"expense",amount:"25.10",currency:"PEN",accountId:u.account,categoryId:category,description:"Synthetic confirmed expense",note:"",timezone:"America/Lima",receivedAt,occurredAt:receivedAt,warnings:[],...patch}})));}
 const prepared=()=>{const d=pending(),token=secret();sql(register(ac,d,token));return {d,token};};
 beforeAll(async()=>{a=await setup();b=await setup();ac=await bind(a,"88001"+Math.floor(Math.random()*1000000));bc=await bind(b,"89001"+Math.floor(Math.random()*1000000));expect((await a.c.schema("api").rpc("initialize_categories")).error).toBeNull();const categories=await a.c.schema("api").rpc("read_categories");category=categories.data.categories.find((c:{kind:string;parent_id:string|null})=>c.kind==="expense"&&!c.parent_id).id;});
 it("keeps old links read/draft only until the web owner explicitly grants publication",async()=>{
  const d=pending(),token=secret();denied(register(ac,d,token));denied(confirm(ac,token));
  const foreign=await b.c.schema("api").rpc("telegram_set_movement_permission",{p_id:ac.linkId,p_version:1,p_allow:true});expect(foreign.error?.code).toBe("42501");
  await permission(a,ac,true);const status=await a.c.schema("api").rpc("telegram_link_status");expect(status.data.links[0].can_confirm).toBe(true);expect(status.data.links[0].scopes).toBeUndefined();
  expect(JSON.parse(sql(`select telegram_private.link_context('${ac.capability}','9001','${ac.telegramUserId}','${ac.chatId}');`)).canConfirm).toBe("true");
  sql(register(ac,d,token));denied(command(ac,{action:"choice",tokenHash:hash(token),updateId:next()}));denied(confirm(bc,token));expect(count(a)).toBe(0);
 });
 it("double clicks concurrently return the same exact receipt and a single signed ledger entry visible to web",async()=>{
  const {d,token}=prepared(),before=count(a),ids=[next(),next()];
  const results=await Promise.all(ids.map(id=>asyncSql(confirm(ac,token,id)).then(JSON.parse)));expect(results[0]).toEqual(results[1]);
  const result=results[0];expect(result.state).toBe("confirmed");expect(result.payload).toEqual({});expect(result.receipt).toMatchObject({kind:"expense",amountMinor:"2510",currency:"PEN",accountName:"Own account",description:"Synthetic confirmed expense"});
  expect(count(a)).toBe(before+1);expect(JSON.parse(sql(catalog(ac)))[0].balance_minor).toBe("7490");
  expect(sql(`select count(*) from finance.transaction_entries where user_id='${a.uid}' and transaction_id='${result.receipt.movementId}' and signed_amount=-25.10;`,"supabase_admin")).toBe("1");
  const movement=await a.c.schema("api").rpc("read_movements",{p_currency:"PEN"});expect(movement.error).toBeNull();expect(JSON.stringify(movement.data)).toContain(result.receipt.movementId);
  expect(JSON.parse(sql(confirm(ac,token,ids[0])))).toEqual(result);expect(JSON.parse(sql(confirm(ac,token)))).toEqual(result);
  denied(confirm(ac,secret(),ids[0]),"40001");expect(sql(`select source_text is null and movement_id='${result.receipt.movementId}' from telegram_private.drafts where id='${d.id}';`,"supabase_admin")).toBe("t");
 });
 it("publishes income with exact balances and web statistics, excluding the account opening",async()=>{
  const cs=await a.c.schema("api").rpc("read_categories"),income=cs.data.categories.find((v:{kind:string})=>v.kind==="income").id;
  const before=BigInt(JSON.parse(sql(catalog(ac)))[0].balance_minor),d=pending(ac,a,{kind:"income",categoryId:income,amount:"5.05"}),token=secret();sql(register(ac,d,token));const result=JSON.parse(sql(confirm(ac,token)));expect(result.receipt.amountMinor).toBe("505");
  expect(BigInt(JSON.parse(sql(catalog(ac)))[0].balance_minor)).toBe(before+505n);
  const report=await a.c.schema("api").rpc("read_statistics",{p_currency:"PEN",p_period:"month"});expect(report.error).toBeNull();expect(report.data).toMatchObject({income_minor:"505",expense_minor:"2510",movement_count:2});
  const usd=await a.c.schema("api").rpc("create_account",{p_request_id:crypto.randomUUID(),p_name:"USD confirmation",p_type:"cash",p_currency:"USD",p_opening:"5"});expect(usd.error).toBeNull();
  const dollars=pending(ac,a,{accountId:usd.data.id,currency:"USD",amount:"2.50"}),usdToken=secret();sql(register(ac,dollars,usdToken));expect(JSON.parse(sql(confirm(ac,usdToken))).receipt.currency).toBe("USD");
  const usdReport=await a.c.schema("api").rpc("read_statistics",{p_currency:"USD",p_period:"month"});expect(usdReport.error).toBeNull();expect(usdReport.data).toMatchObject({income_minor:"0",expense_minor:"250",movement_count:1});
  const penReport=await a.c.schema("api").rpc("read_statistics",{p_currency:"PEN",p_period:"month"});expect(penReport.data).toMatchObject({income_minor:"505",expense_minor:"2510",movement_count:2});
  const overflow=pending(ac,a,{kind:"income",categoryId:income,amount:"9999999999999999.99"}),invalid=secret(),total=count(a);sql(register(ac,overflow,invalid));denied(confirm(ac,invalid),"22003");expect(count(a)).toBe(total);expect(sql(`select state from telegram_private.drafts where id='${overflow.id}';`,"supabase_admin")).toBe("pending");
  denied("select * from telegram_private.confirmations;");denied(`begin;set local role authenticated;select telegram_private.confirm_draft('{}','${hash(token)}','5900');commit;`,"42501","supabase_admin");
 });
 it("retains a committed result after permission withdrawal without permitting another publication",async()=>{
  const {token}=prepared(),result=JSON.parse(sql(confirm(ac,token))),before=count(a);await permission(a,ac,false);
  expect(JSON.parse(sql(confirm(ac,token)))).toEqual(result);const d=pending();denied(register(ac,d,secret()));expect(count(a)).toBe(before);await permission(a,ac,true);
 });
 it("rejects incomplete, expired and superseded previews without financial writes",()=>{
  const before=count(a),incomplete=pending(ac,a,{amount:null});denied(register(ac,incomplete,secret()));
  const {d,token}=prepared();sql(command(ac,{action:"amend",id:d.id,version:d.version,updateId:next(),payload:{...d.payload,amount:"26"}}));denied(confirm(ac,token),"P0002");
  const expired=prepared();sql(`update telegram_private.drafts set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' where id='${expired.d.id}';`,"supabase_admin");denied(confirm(ac,expired.token),"40001");expect(count(a)).toBe(before);
 });
 it("revalidates category, account and timezone after preview and leaves no false confirmation",()=>{
  for(const change of ["category-archive","account","timezone","category-delete"]){
   const {d,token}=prepared(),before=count(a);let mutation:string,restore:string;
   if(change==="category-archive"){mutation=`update finance.categories set status='archived',version=version+1 where id='${category}'`;restore=`update finance.categories set status='active',version=version+1 where id='${category}'`;}
   else if(change==="category-delete"){mutation=`update finance.categories set deleted_at=now(),status='archived',version=version+1 where id='${category}'`;restore=`update finance.categories set deleted_at=null,status='active',version=version+1 where id='${category}'`;}
   else if(change==="account"){mutation=`update finance.accounts set status='archived',version=version+1 where id='${a.account}'`;restore=`update finance.accounts set status='active',version=version+1 where id='${a.account}'`;}
   else{mutation=`update finance.profiles set timezone='UTC',version=version+1 where user_id='${a.uid}'`;restore=`update finance.profiles set timezone='America/Lima',version=version+1 where user_id='${a.uid}'`;}
   sql(mutation,"supabase_admin");try{denied(confirm(ac,token),change==="timezone"?"40001":"23514");expect(count(a)).toBe(before);expect(sql(`select state from telegram_private.drafts where id='${d.id}';`,"supabase_admin")).toBe("pending");}finally{if(change!=="category-delete")sql(restore,"supabase_admin");else category=sql(`select id from finance.categories where user_id='${a.uid}' and kind='expense' and status='active' and deleted_at is null limit 1;`,"supabase_admin");}
  }
 });
 it("serializes cancellation against confirmation with one terminal winner",async()=>{
  const {d,token}=prepared(),before=count(a);const results=await Promise.allSettled([asyncSql(confirm(ac,token)),asyncSql(command(ac,{action:"cancel",id:d.id,version:d.version,updateId:next()}))]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);const state=sql(`select state from telegram_private.drafts where id='${d.id}';`,"supabase_admin");expect(["confirmed","cancelled"]).toContain(state);expect(count(a)-before).toBe(state==="confirmed"?1:0);
 });
 it("checks expiry after waiting for a competing profile lock",async()=>{
  const {d,token}=prepared(),before=count(a);sql(`update telegram_private.drafts set expires_at=clock_timestamp()+interval '600 milliseconds' where id='${d.id}';`,"supabase_admin");let ready!:()=>void;const locked=new Promise<void>(resolve=>{ready=resolve;});
  const holding=asyncSql(`begin;select 1 from finance.profiles where user_id='${a.uid}' for update;select 'locked';select pg_sleep(1);commit;`,"supabase_admin",out=>{if(out.includes("locked"))ready();});await locked;await expect(asyncSql(confirm(ac,token))).rejects.toThrow("40001");await holding;expect(count(a)).toBe(before);
 });
 it("rolls back the entire ledger if saving the canonical receipt fails, then retries once",()=>{
  const {d,token}=prepared(),before=count(a);sql(`create function telegram_private.test_receipt_failure() returns trigger language plpgsql as $$begin if new.draft_id='${d.id}' then raise exception 'Synthetic receipt storage failure';end if;return new;end $$;create trigger test_receipt_failure before insert on telegram_private.confirmations for each row execute function telegram_private.test_receipt_failure();`,"supabase_admin");
  try{denied(confirm(ac,token),"P0001");expect(count(a)).toBe(before);expect(sql(`select state from telegram_private.drafts where id='${d.id}';`,"supabase_admin")).toBe("pending");}finally{sql("drop trigger test_receipt_failure on telegram_private.confirmations;drop function telegram_private.test_receipt_failure();","supabase_admin");}
  expect(JSON.parse(sql(confirm(ac,token))).state).toBe("confirmed");expect(count(a)).toBe(before+1);
 });
 it("cannot read receipts or publish after revocation wins a concurrent profile lock",async()=>{
  const u=await setup(),c=await bind(u,"91001"+Math.floor(Math.random()*1000000));await permission(u,c,true);
  // Use a real owned category; admin below only coordinates a deterministic lock race.
  await u.c.schema("api").rpc("initialize_categories");const cs=await u.c.schema("api").rpc("read_categories"),cat=cs.data.categories.find((v:{kind:string})=>v.kind==="expense").id;
  const d=pending(c,u,{categoryId:cat}),token=secret();sql(register(c,d,token));let ready!:()=>void;const locked=new Promise<void>(r=>{ready=r;});
  const revocation=asyncSql(`begin;select 1 from finance.profiles where user_id='${u.uid}' for update;update telegram_private.links set revoked_at=now() where id='${c.linkId}';select 'locked';select pg_sleep(0.5);commit;`,"supabase_admin",out=>{if(out.includes("locked"))ready();});
  await locked;await expect(asyncSql(confirm(c,token))).rejects.toThrow("42501");await revocation;expect(count(u)).toBe(0);
 });
 it("rechecks a personal deletion block after waiting for the profile lock",async()=>{
  const u=await setup(),c=await bind(u,"93001"+Math.floor(Math.random()*1000000));await permission(u,c,true);await u.c.schema("api").rpc("initialize_categories");const cs=await u.c.schema("api").rpc("read_categories"),cat=cs.data.categories.find((v:{kind:string})=>v.kind==="expense").id;
  const d=pending(c,u,{categoryId:cat}),token=secret();sql(register(c,d,token));let ready!:()=>void;const locked=new Promise<void>(resolve=>{ready=resolve;});
  const deleting=asyncSql(`begin;select 1 from finance.profiles where user_id='${u.uid}' for update;insert into ops.deletion_blocks(user_id) values('${u.uid}');select 'locked';select pg_sleep(0.5);commit;`,"supabase_admin",out=>{if(out.includes("locked"))ready();});await locked;await expect(asyncSql(confirm(c,token))).rejects.toThrow("42501");await deleting;expect(count(u)).toBe(0);
 });
 it("personal deletion blocks confirmation and cascades canonical receipts on purge",async()=>{
  const u=await setup(),c=await bind(u,"92001"+Math.floor(Math.random()*1000000));await permission(u,c,true);await u.c.schema("api").rpc("initialize_categories");const cs=await u.c.schema("api").rpc("read_categories"),cat=cs.data.categories.find((v:{kind:string})=>v.kind==="expense").id;
  const d=pending(c,u,{categoryId:cat}),token=secret();sql(register(c,d,token));sql(confirm(c,token));
  const email=(await u.c.auth.getUser()).data.user!.email!;await u.c.auth.signInWithPassword({email,password:"telegram isolated test password 2026"});
  const exportProof=await u.c.schema("api").rpc("issue_reauth_proof",{p_purpose:"export_data"});expect(exportProof.error).toBeNull();
  const exported=await u.c.schema("api").rpc("export_personal_data",{p_proof:exportProof.data.token,p_format:"json"});expect(exported.error).toBeNull();expect(exported.data.telegram.confirmations[0].result.movementId).toMatch(/^[a-f0-9-]{36}$/);expect(JSON.stringify(exported.data.telegram)).not.toMatch(/capability|callback_hash|payload_hash/);
  const proof=await u.c.schema("api").rpc("issue_reauth_proof",{p_purpose:"delete_account"}),receipt=crypto.randomUUID(),tracking=secret();expect(proof.error).toBeNull();
  const queued=await u.c.schema("api").rpc("request_deletion",{p_request_id:receipt,p_tracking_token:tracking,p_proof:proof.data.token,p_confirmation:"ELIMINAR"});expect(queued.error).toBeNull();denied(confirm(c,token));
  const lease=secret();sql(`update ops.deletion_receipts set lease_hash=decode('${hash(lease)}','hex'),lease_until=now()+interval '2 minutes' where id='${receipt}';`,"supabase_admin");
  sql(`begin;set local role finzi_deletion_worker;select ops.deletion_step('${receipt}','${lease}','manifest','${hash("synthetic manifest")}');select ops.deletion_step('${receipt}','${lease}','purge',null);commit;`,"supabase_admin");
  expect(sql(`select count(*) from telegram_private.confirmations where user_id='${u.uid}';`,"supabase_admin")).toBe("0");
 });
});


describe("Telegram phase 6: scoped read-only queries",()=>{
 let a:User,b:User,ac:Context,bc:Context;let sequence=6000;
 const query=(c:Context,op:object)=>`select telegram_private.read_query(${ctx({...c,scope:"report:read"})},${quote(JSON.stringify(op))}::jsonb);`;
 const open=(command:string,currency="PEN")=>({action:"open",command,currency,updateId:String(++sequence)});
 const read=(op:object,c=ac)=>JSON.parse(sql(query(c,op)));
 beforeAll(async()=>{a=await setup();b=await setup();ac=await bind(a,"94001"+Math.floor(Math.random()*1000000));bc=await bind(b,"95001"+Math.floor(Math.random()*1000000));await a.c.schema("api").rpc("initialize_categories");
  expect((await a.c.schema("api").rpc("create_category",{p_request_id:crypto.randomUUID(),p_parent_id:null,p_kind:"expense",p_name:"Synthetic extra category",p_description:"",p_color:"blue",p_icon:"tag",p_image_path:null})).error).toBeNull();
 });
 it("requires explicit query permission and rejects other owners and financial publication permissions",async()=>{
  denied(query(ac,open("mes")));const foreign=await b.c.schema("api").rpc("telegram_set_query_permission",{p_id:ac.linkId,p_version:1,p_allow:true});expect(foreign.error?.code).toBe("42501");
  expect((await a.c.schema("api").rpc("telegram_set_query_permission",{p_id:ac.linkId,p_version:1,p_allow:true})).error).toBeNull();
  expect((await a.c.schema("api").rpc("telegram_link_status")).data.links[0]).toMatchObject({can_report:true,can_confirm:false});
  denied(query(bc,open("mes")));denied("select * from telegram_private.query_sessions;");denied("select api.read_overview();");
  expect((await b.c.schema("api").rpc("telegram_set_query_permission",{p_id:bc.linkId,p_version:1,p_allow:true})).error).toBeNull();
  expect(read(open("categorias"),bc).total).toBe(0);
 });
 it("matches core reports for local today, rolling seven days and month, including empty USD",async()=>{
  for(const command of ["hoy","semana","mes","gastos","ingresos"]){for(const currency of ["PEN","USD"]){
   const q=read(open(command,currency));const report=await a.c.schema("api").rpc("read_overview",{p_currency:currency,p_period:"custom",p_from:q.from,p_to:q.to});expect(report.error).toBeNull();
   expect(q).toMatchObject({income_minor:report.data.income_minor,expense_minor:report.data.expense_minor,timezone:report.data.timezone});
   if(command==="semana")expect((new Date(q.to).getTime()-new Date(q.from).getTime())/86400000).toBe(6);
  }}
  expect(read(open("saldo"))).toMatchObject({balance_minor:"10000",total:1});expect(read(open("saldo","USD"))).toMatchObject({balance_minor:"0",total:0});
 });
 it("paginates owner-bound snapshots and keeps totals stable across pages and replays",()=>{
  const op=open("categorias"),q=read(op);expect(q.total).toBeGreaterThan(10);expect(q.items).toHaveLength(10);expect(read(op)).toEqual(q);
  denied(query(ac,{...op,command:"cuentas"}),"40001");
  const token=secret();sql(query(ac,{action:"buttons",id:q.id,page:0,choices:[{hash:hash(token),page:1}]}));
  const page=read({action:"page",tokenHash:hash(token)});expect(page.page).toBe(1);expect(page.as_of).toBe(q.as_of);expect(page.total).toBe(q.total);
  denied(query(bc,{action:"page",tokenHash:hash(token)}),"P0002");
  denied(query(ac,{action:"buttons",id:q.id,page:0,choices:[{hash:hash(secret()),page:50}]}),"23514");
  sql(`update telegram_private.query_sessions set expires_at=now()-interval '1 second' where id='${q.id}';`,"supabase_admin");denied(query(ac,{action:"page",tokenHash:hash(token)}),"P0002");
 });
 it("rejects cached pages after a timezone change and invalidates snapshots on permission withdrawal",async()=>{
  const q=read(open("categorias")),token=secret();sql(query(ac,{action:"buttons",id:q.id,page:0,choices:[{hash:hash(token),page:1}]}));
  sql(`update finance.profiles set timezone='UTC',version=version+1 where user_id='${a.uid}';`,"supabase_admin");denied(query(ac,{action:"page",tokenHash:hash(token)}),"40001");
  const status=await a.c.schema("api").rpc("telegram_link_status");expect((await a.c.schema("api").rpc("telegram_set_query_permission",{p_id:ac.linkId,p_version:status.data.links[0].version,p_allow:false})).error).toBeNull();
  denied(query(ac,{action:"page",tokenHash:hash(token)}));expect(sql(`select count(*) from telegram_private.query_sessions where user_id='${a.uid}';`,"supabase_admin")).toBe("0");
  expect(sql(`select count(*) from finance.transactions where user_id in ('${a.uid}','${b.uid}');`,"supabase_admin")).toBe("0");
 });
 it.skipIf(!process.env.TELEGRAM_DATABASE_URL)("reads nonempty synthetic history across income pages using the production driver without creating movements",async({skip})=>{
  // Reuse only reserved synthetic accounts from previous local financial suites.
  const fixture=sql(`select jsonb_build_object('uid',m.user_id) from finance.movement_details m join auth.users u on u.id=m.user_id join finance.profiles p on p.user_id=m.user_id join finance.accounts a on a.user_id=m.user_id and a.id=m.account_id where u.email like '%@example.test' and u.email_confirmed_at is not null and p.onboarding_completed_at is not null and not exists(select 1 from ops.deletion_blocks b where b.user_id=m.user_id) and m.kind='income' and m.status='posted' and m.deleted_at is null and a.status<>'deleted' and m.currency_code='PEN' and m.occurred_at>=date_trunc('month',now()) group by m.user_id having count(*)>10 order by count(*) limit 1;`,"supabase_admin");
  if(!fixture){skip();return;}const uid=JSON.parse(fixture).uid as string;
  const web=(statement:string)=>sql(`begin;set local role app_executor;set local request.jwt.claims='{"sub":"${uid}"}';${statement};commit;`,"supabase_admin");
  const status=JSON.parse(web("select api.telegram_link_status()"));for(const l of status.links)if(!l.revoked_at)web(`select api.telegram_revoke_link_versioned('${l.id}',${l.version})`);
  const challenge=secret(),capability=secret(),identity="96001"+Math.floor(Math.random()*1000000);
  const attempt=JSON.parse(web(`select api.telegram_issue_link('${hash(challenge)}')`));sql(`select telegram_private.claim_link('${challenge}','9001','${identity}','${identity}','${hash(capability)}');`);
  const linked=JSON.parse(web(`select api.telegram_activate_link('${attempt.id}')`));web(`select api.telegram_set_query_permission('${linked.id}',1,true)`);
  const c={linkId:linked.id,generation:String(linked.generation??1),botId:"9001",telegramUserId:identity,chatId:identity,capability};
  // Generation is issued by the server, never guessed from older links.
  const resolved=JSON.parse(sql(`select telegram_private.link_context('${capability}','9001','${identity}','${identity}');`));Object.assign(c,resolved);
  const port=gateway(process.env.TELEGRAM_DATABASE_URL!),before=sql(`select count(*) from finance.transactions where user_id='${uid}';`,"supabase_admin");
  try{
   const q=await port.query(c,{action:"open",command:"ingresos",currency:"PEN",updateId:"6600"});expect(q.total).toBeGreaterThan(10);expect(q.items).toHaveLength(10);
   const report=JSON.parse(web(`select api.read_overview('PEN','custom',null,'${q.from}','${q.to}',null)`));expect(q.income_minor).toBe(report.income_minor);expect(BigInt(q.income_minor)).toBeGreaterThan(0n);
   const pageToken=secret();await port.query(c,{action:"buttons",id:q.id,page:0,choices:[{hash:hash(pageToken),page:1}]});const next=await port.query(c,{action:"page",tokenHash:hash(pageToken)});expect(next.page).toBe(1);expect(next.items.length).toBeGreaterThan(0);expect(next.income_minor).toBe(q.income_minor);expect(next.as_of).toBe(q.as_of);expect(next.items[0].id).not.toBe(q.items[0].id);
   for(const command of ["hoy","semana","mes","gastos"]){const r=await port.query(c,{action:"open",command,currency:"PEN",updateId:String(++sequence)});const core=JSON.parse(web(`select api.read_overview('PEN','custom',null,'${r.from}','${r.to}',null)`));expect(r.income_minor).toBe(core.income_minor);expect(r.expense_minor).toBe(core.expense_minor);}
   expect(sql(`select count(*) from finance.transactions where user_id='${uid}';`,"supabase_admin")).toBe(before);
  }finally{await port.close();const st=JSON.parse(web("select api.telegram_link_status()"));const l=st.links.find((v:{id:string})=>v.id===linked.id);if(l&&!l.revoked_at)web(`select api.telegram_revoke_link_versioned('${l.id}',${l.version})`);}
},90000);

 it.skipIf(!process.env.TELEGRAM_DATABASE_URL)("blocks queries when personal deletion wins the profile lock",async()=>{
  const status=await a.c.schema("api").rpc("telegram_link_status");expect((await a.c.schema("api").rpc("telegram_set_query_permission",{p_id:ac.linkId,p_version:status.data.links[0].version,p_allow:true})).error).toBeNull();
  let ready!:()=>void;const locked=new Promise<void>(r=>{ready=r;});
  const blocking=asyncSql(`begin;select 1 from finance.profiles where user_id='${a.uid}' for update;insert into ops.deletion_blocks(user_id) values('${a.uid}');select 'locked';select pg_sleep(0.5);commit;`,"supabase_admin",out=>{if(out.includes("locked"))ready();});await locked;
  const port=gateway(process.env.TELEGRAM_DATABASE_URL!);try{await expect(port.query(ac,open("saldo"))).rejects.toMatchObject({code:"42501"});await blocking;}finally{await port.close();}
  expect(sql(`select count(*) from finance.transactions where user_id='${a.uid}';`,"supabase_admin")).toBe("0");
 });

});
