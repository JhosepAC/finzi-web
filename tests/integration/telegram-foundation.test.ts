import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
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
