import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { findMailLink } from "../helpers/mail";
import { localTransport, fixtureSql, secret, hash } from "../helpers/telegram-transport";
import { recoverySql } from "../../scripts/telegram-recovery";

const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("local_only");
const password = "synthetic transported gateway passphrase 2026";
async function setup() {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `telegram-${crypto.randomUUID()}@example.test`;
  expect((await c.auth.signUp({ email, password })).error).toBeNull();
  const link = new URL(await findMailLink(email, "signup"));
  const verified = await c.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" }); expect(verified.error).toBeNull();
  expect((await c.schema("api").rpc("ensure_profile")).error).toBeNull();
  expect((await c.schema("api").rpc("configure_profile", { p_display_name: "Synthetic transport", p_currency: "PEN", p_timezone: "America/Lima", p_expected_version: 0 })).error).toBeNull();
  const account = await c.schema("api").rpc("create_account", { p_request_id: crypto.randomUUID(), p_name: "Own account", p_type: "cash", p_currency: "PEN", p_opening: "100" }); expect(account.error).toBeNull();
  const categories = await c.schema("api").rpc("initialize_categories"); expect(categories.error).toBeNull();
  return { c, email, uid: verified.data.user!.id, account: account.data.id as string, category: categories.data.categories.find((v: { kind: string }) => v.kind === "expense").id as string };
}
type User = Awaited<ReturnType<typeof setup>>;
describe("Telegram current webhook contract: restricted event/lease RPC, real PostgreSQL and financial sessions", () => {
  let t: ReturnType<typeof localTransport>, a: User, b: User;
  let ac: Record<string,string>, bc: Record<string,string>, lastReceipt: string;
  const peer = "810000001", otherPeer = "810000002";
  const invoke = async (user: string, op: string, args: Record<string,unknown> = {}) => JSON.parse(JSON.stringify(await t.invoke(user, op, args)));
  const call = (c: Record<string,string>, op: string, args: Record<string,unknown> = {}) => invoke(c.telegramUserId, op, { context: c, ...args });
  const command = (c: Record<string,string>, op: Record<string,unknown>) => call(c, "command", { command: op });
  const query = (c: Record<string,string>, op: Record<string,unknown>) => call(c, "query", { operation: op });
  const count = (u: User) => Number(fixtureSql(`select count(*) from finance.transactions where user_id='${u.uid}';`));
  function payload(u = a, patch: Record<string,unknown> = {}) {
    const now = new Date().toISOString(); return { kind: "expense", amount: "25.10", currency: "PEN", accountId: u.account, categoryId: u.category, description: "Synthetic transported expense", note: "", timezone: "America/Lima", occurredAt: now, receivedAt: now, warnings: [], ...patch };
  }
  const start = (c = ac, u = a, patch: Record<string,unknown> = {}) => command(c, { action: "start", updateId: "assigned_by_event", text: "Synthetic source", payload: payload(u, patch) });
  async function permission(u: User, c: Record<string,string>, kind: "movement" | "query", allow: boolean) {
    const st = await u.c.schema("api").rpc("telegram_link_status"); expect(st.error).toBeNull();
    const link = st.data.links.find((v: {id:string}) => v.id === c.linkId);
    const r = await u.c.schema("api").rpc(kind === "movement" ? "telegram_set_movement_permission" : "telegram_set_query_permission", { p_id: c.linkId, p_version: link.version, p_allow: allow }); expect(r.error).toBeNull();
  }
  async function bind(u: User, user: string) {
    const challenge = secret(), capability = secret();
    const issued = await u.c.schema("api").rpc("telegram_issue_link", { p_challenge_hash: hash(challenge) }); expect(issued.error).toBeNull();
    await invoke(user, "claim", { challenge, hash: hash(capability) });
    expect(await invoke(user, "context", { capability })).toBeNull();
    const activated = await u.c.schema("api").rpc("telegram_activate_link", { p_attempt: issued.data.id });expect(activated.error).toBeNull();
    const c = await invoke(user, "context", { capability }); expect(c.linkId).toBe(activated.data.id); return { ...c, capability } as Record<string,string>;
  }
  async function prepared() {
    const d = await start(), token = secret();
    await call(ac, "callbacks", { id: d.id, version: d.version, choices: [{ hash: hash(token), field: "confirm", value: "confirm" }] });
    return { d, token };
  }
  beforeAll(async () => { t = localTransport(); await t.db.check(); a = await setup(); b = await setup(); ac = await bind(a, peer); bc = await bind(b, otherPeer); });
  afterAll(async () => { if (t) { await t.close(); fixtureSql(`update telegram_private.transport_bots set enabled=false where bot_id='${t.bot}';`); } });
  it("uses the restricted transport driver and isolates the actual owner's catalog", async () => {
    await t.db.check(); expect((await call(ac,"catalog")).accounts.map((v:{id:string})=>v.id)).toEqual([a.account]);
    expect((await call(bc,"catalog")).accounts.map((v:{id:string})=>v.id)).toEqual([b.account]);
  });
  it("does not restore direct legacy function permissions or gateway DML", () => {
    expect(fixtureSql("select has_function_privilege('finzi_telegram_gateway','telegram_private.confirm_draft(jsonb,text,text)','execute') or has_function_privilege('finzi_telegram_gateway','telegram_private.claim_link(text,text,text,text,text)','execute');")).toBe("f");
    expect(fixtureSql("select count(*) from pg_class t join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('finance','telegram_private') and t.relkind='r' and has_table_privilege('finzi_telegram_gateway',t.oid,'select,insert,update,delete');")).toBe("0");
  });
  it("rejects a forged event context even if B's capability is otherwise valid", async () => {
    await expect(invoke(peer,"catalog",{context:bc})).rejects.toMatchObject({code:"42501"});
  });
  it("rejects an invalid capability and a fabricated owner", async () => {
    await expect(call({...ac,capability:secret()},"catalog")).rejects.toMatchObject({code:"42501"});
    await expect(call({...ac,linkId:bc.linkId},"catalog")).rejects.toMatchObject({code:"42501"});
  });
  it("keeps incomplete previews nonfinancial and preserves expiry/receivedAt through amendment", async () => {
    const d=await start(ac,a,{amount:null});expect(d.state).toBe("needs_input");expect(d.awaiting).toBe("amount");
    const changed=await command(ac,{action:"amend",id:d.id,version:d.version,updateId:"event",payload:{...d.payload,amount:"30.10"}});
    expect(changed.state).toBe("pending");expect(changed.version).toBe(d.version+1);expect(changed.expiresAt).toBe(d.expiresAt);expect(changed.payload.receivedAt).toBe(d.payload.receivedAt);expect(count(a)).toBe(0);
    await expect(command(ac,{action:"amend",id:d.id,version:d.version,updateId:"event",payload:changed.payload})).rejects.toMatchObject({code:"40001"});
  });
  it.each([25,"NaN","1.234","0","1e2"])("rejects invalid financial amount %j before publication", async amount => {
    await expect(start(ac,a,{amount})).rejects.toMatchObject({code:"23514"});expect(count(a)).toBe(0);
  });
  it("rejects a foreign account, unsupported currency and future date", async () => {
    await expect(start(ac,a,{accountId:b.account})).rejects.toMatchObject({code:"23514"});
    await expect(start(ac,a,{currency:"EUR"})).rejects.toMatchObject({code:"23514"});
    await expect(start(ac,a,{occurredAt:new Date(Date.now()+86400000).toISOString()})).rejects.toMatchObject({code:"22008"});
  });
  it("binds keyboard choices to owner and draft version", async () => {
    const d=await start(), token=secret(); await call(ac,"callbacks",{id:d.id,version:d.version,choices:[{hash:hash(token),field:"currency",value:"USD"}]});
    await expect(command(bc,{action:"choice",tokenHash:hash(token),updateId:"event"})).rejects.toMatchObject({code:"P0002"});
    const changed=await command(ac,{action:"choice",tokenHash:hash(token),updateId:"event"});expect(changed.payload.currency).toBe("USD");expect(changed.payload.accountId).toBeNull();
    await expect(call(ac,"callbacks",{id:d.id,version:d.version,choices:[{hash:hash(secret()),field:"cancel",value:"cancel"}]})).rejects.toMatchObject({code:"40001"});
  });
  it("cancels without money, scrubs payload and rejects the old keyboard", async () => {
    const d=await start(), token=secret();await call(ac,"callbacks",{id:d.id,version:d.version,choices:[{hash:hash(token),field:"cancel",value:"cancel"}]});
    const cancelled=await command(ac,{action:"choice",tokenHash:hash(token),updateId:"event"});expect(cancelled).toMatchObject({state:"cancelled",payload:{}});
    await expect(command(ac,{action:"choice",tokenHash:hash(token),updateId:"event"})).rejects.toMatchObject({code:"P0002"});expect(count(a)).toBe(0);
  });
  it("requires explicit financial permission from the web owner", async () => {
    const d=await start();await expect(call(ac,"callbacks",{id:d.id,version:d.version,choices:[{hash:hash(secret()),field:"confirm",value:"confirm"}]})).rejects.toMatchObject({code:"42501"});
    expect((await b.c.schema("api").rpc("telegram_set_movement_permission",{p_id:ac.linkId,p_version:1,p_allow:true})).error?.code).toBe("42501");
    await permission(a,ac,"movement",true);
  });
  it("two actual simultaneous SQL confirmations commit exactly one movement and receipt", async () => {
    const {token}=await prepared(), e=await t.event(peer,true);
    try {
      const args={context:ac,tokenHash:hash(token)};
      const raced=await Promise.allSettled([t.db.call(t.bot,e.event.id,e.lease,"confirm",args),t.other.call(t.bot,e.event.id,e.lease,"confirm",args)]);
      const successes=raced.filter((r):r is PromiseFulfilledResult<unknown>=>r.status==="fulfilled");expect(successes.length).toBeGreaterThan(0);
      for(const r of raced)if(r.status==="rejected")expect(r.reason.code).toBe("55P03");
      for(const r of successes)expect(r.value).toEqual(successes[0].value);
      const value=JSON.parse(JSON.stringify(successes[0].value));expect(value.state).toBe("confirmed");expect(value.receipt.amountMinor).toBe("2510");lastReceipt=value.receipt.movementId;
      expect(count(a)).toBe(1);expect((await a.c.schema("api").rpc("read_accounts")).data[0].balance_minor).toBe("7490");expect(count(b)).toBe(0);
      expect(fixtureSql(`select count(*) from finance.transaction_entries where user_id='${a.uid}' and transaction_id='${lastReceipt}' and signed_amount=-25.10;`)).toBe("1");
      const replay=await t.other.call(t.bot,e.event.id,e.lease,"confirm",args);expect(replay).toEqual(successes[0].value);
    } finally { await t.complete(e.event,e.lease); }
  });
  it("canonical confirmation survives lost notification/replay in a later event", async () => {
    const {token}=await prepared();const before=count(a);const original=await call(ac,"confirm",{tokenHash:hash(token)});const replay=await call(ac,"confirm",{tokenHash:hash(token)});
    expect(replay).toEqual(original);expect(count(a)).toBe(before+1);expect(replay.receipt.amountMinor).toBe("2510");
  });
  it("rejects a forged callback and keeps B's balance intact", async () => {
    const before=count(a);await expect(call(ac,"confirm",{tokenHash:hash(secret())})).rejects.toMatchObject({code:"P0002"});expect(count(a)).toBe(before);expect((await b.c.schema("api").rpc("read_accounts")).data[0].balance_minor).toBe("10000");
  });
  it("revalidates timezone after preview without a financial commit", async () => {
    const {token}=await prepared(),before=count(a);fixtureSql(`update finance.profiles set timezone='UTC',version=version+1 where user_id='${a.uid}';`);
    try { await expect(call(ac,"confirm",{tokenHash:hash(token)})).rejects.toMatchObject({code:"40001"});expect(count(a)).toBe(before); }
    finally { fixtureSql(`update finance.profiles set timezone='America/Lima',version=version+1 where user_id='${a.uid}';`); }
  });
  it("rejects an expired preview and scrubs nothing from the immutable ledger", async () => {
    const {d,token}=await prepared(),before=count(a);fixtureSql(`update telegram_private.drafts set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' where id='${d.id}';`);
    await expect(call(ac,"confirm",{tokenHash:hash(token)})).rejects.toMatchObject({code:"40001"});expect(count(a)).toBe(before);
  });
  it("a confirmed canonical receipt remains available after publication permission withdrawal", async () => {
    const {token}=await prepared(),original=await call(ac,"confirm",{tokenHash:hash(token)}),before=count(a);await permission(a,ac,"movement",false);
    expect(await call(ac,"confirm",{tokenHash:hash(token)})).toEqual(original);expect(count(a)).toBe(before);
  });
  it("query permission is independent from publication permission", async () => {
    await expect(query(ac,{action:"open",command:"saldo",currency:"PEN",updateId:"event"})).rejects.toMatchObject({code:"42501"});await permission(a,ac,"query",true);
    const q=await query(ac,{action:"open",command:"saldo",currency:"PEN",updateId:"event"});expect(q.balance_minor).toBe((await a.c.schema("api").rpc("read_accounts")).data[0].balance_minor);
  });
  it.each(["hoy","semana","mes","gastos","ingresos"])("%s agrees with native reports without financial writes", async cmd => {
    const before=count(a),q=await query(ac,{action:"open",command:cmd,currency:"PEN",updateId:"event"});const report=await a.c.schema("api").rpc("read_overview",{p_currency:"PEN",p_period:"custom",p_from:q.from,p_to:q.to});expect(report.error).toBeNull();expect(q.income_minor).toBe(report.data.income_minor);expect(q.expense_minor).toBe(report.data.expense_minor);expect(count(a)).toBe(before);
  });
  it("keeps USD empty instead of mixing currencies", async () => {
    const q=await query(ac,{action:"open",command:"saldo",currency:"USD",updateId:"event"});expect(q.balance_minor).toBe("0");
  });
  it("paginates stable owner-bound snapshots and rejects foreign cursors", async () => {
    expect((await a.c.schema("api").rpc("create_category",{p_request_id:crypto.randomUUID(),p_parent_id:null,p_kind:"expense",p_name:"Transport extra",p_description:"",p_color:"blue",p_icon:"tag",p_image_path:null})).error).toBeNull();
    const q=await query(ac,{action:"open",command:"categorias",currency:"PEN",updateId:"event"}),token=secret();expect(q.total).toBeGreaterThan(10);expect(q.items).toHaveLength(10);
    await query(ac,{action:"buttons",id:q.id,page:0,choices:[{hash:hash(token),page:1}]});const page=await query(ac,{action:"page",tokenHash:hash(token)});expect(page.page).toBe(1);expect(page.total).toBe(q.total);expect(page.as_of).toBe(q.as_of);
    await permission(b,bc,"query",true);await expect(query(bc,{action:"page",tokenHash:hash(token)})).rejects.toMatchObject({code:"P0002"});
  });
  it("query revocation clears its snapshots and prevents stale reads", async () => {
    await permission(a,ac,"query",false);await expect(query(ac,{action:"open",command:"saldo",currency:"PEN",updateId:"event"})).rejects.toMatchObject({code:"42501"});expect(fixtureSql(`select count(*) from telegram_private.query_sessions where user_id='${a.uid}';`)).toBe("0");
  });
  it("expired query cursors cannot return a stale private snapshot", async () => {
    await permission(a,ac,"query",true);const q=await query(ac,{action:"open",command:"categorias",currency:"PEN",updateId:"event"}),token=secret();
    await query(ac,{action:"buttons",id:q.id,page:0,choices:[{hash:hash(token),page:1}]});
    fixtureSql(`update telegram_private.query_sessions set expires_at=clock_timestamp()-interval '1 second' where id='${q.id}';`);
    await expect(query(ac,{action:"page",tokenHash:hash(token)})).rejects.toMatchObject({code:"P0002"});
  });
  it("export retains history but excludes capabilities, hashes and cursor tokens", async () => {
    expect((await a.c.auth.signInWithPassword({email:a.email,password})).error).toBeNull();const proof=await a.c.schema("api").rpc("issue_reauth_proof",{p_purpose:"export_data"});expect(proof.error).toBeNull();const exported=await a.c.schema("api").rpc("export_personal_data",{p_proof:proof.data.token,p_format:"json"});expect(exported.error).toBeNull();expect(JSON.stringify(exported.data.telegram)).not.toMatch(/capability|callback_hash|token_hash|payload_hash/);expect(JSON.stringify(exported.data)).toContain(lastReceipt);
  });
  it("expired leases cannot dispatch, and a reclaimed lease fences the previous owner", async () => {
    const e=await t.event(peer);fixtureSql(`update telegram_private.transport_events set lease_until=clock_timestamp()-interval '1 second' where id='${e.event.id}' and bot_id='${t.bot}';`);await expect(t.db.call(t.bot,e.event.id,e.lease,"catalog",{context:ac})).rejects.toMatchObject({code:"42501"});const lease=secret();const recovered=await t.other.claim(t.bot,lease,"process");expect(recovered?.id).toBe(e.event.id);await expect(t.db.call(t.bot,e.event.id,e.lease,"catalog",{context:ac})).rejects.toMatchObject({code:"42501"});await t.complete(e.event,lease);
  });
  it("five recoverable failures become dead with no sixth claim and preserved input", async () => {
    const e=await t.event("810000099");let lease=e.lease;for(let n=1;n<=5;n++){await t.db.retry(t.bot,e.event.id,lease,"timeout",true);if(n<5){fixtureSql(`update telegram_private.transport_events set available_at=clock_timestamp()-interval '1 second' where id='${e.event.id}';`);lease=secret();expect((await t.db.claim(t.bot,lease,"process"))?.id).toBe(e.event.id);}}
    expect(await t.db.claim(t.bot,secret(),"process")).toBeNull();expect(fixtureSql(`select state||':'||attempts::text||':'||(payload_ciphertext is not null)::text from telegram_private.transport_events where id='${e.event.id}';`)).toBe("dead:5:true");
  });
  it("keeps effective RLS/private function ACL and roles intact", () => {
    expect(fixtureSql("select count(*) from pg_class t join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('finance','telegram_private') and t.relkind='r' and t.oid<>'finance.currencies'::regclass and (not t.relrowsecurity or not t.relforcerowsecurity);")).toBe("0");
    expect(fixtureSql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='telegram_private' and a.grantee=0 and a.privilege_type='EXECUTE';")).toBe("0");
    expect(fixtureSql("select rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb or rolreplication from pg_roles where rolname='finzi_telegram_gateway';")).toBe("f");
  });
  it("recovery rejects an unknown synthetic subject before any write", () => {
    expect(()=>fixtureSql(recoverySql(true,crypto.randomUUID()))).toThrow();
  });
  it("recovery invalidates restored local capabilities without changing signed history or balances", async () => {
    await start();await query(ac,{action:"open",command:"saldo",currency:"PEN",updateId:"event"});
    const before=fixtureSql(`select md5(jsonb_build_array((select jsonb_agg(to_jsonb(t) order by id) from finance.transactions t where user_id='${a.uid}'),(select jsonb_agg(to_jsonb(e) order by transaction_id) from finance.transaction_entries e where user_id='${a.uid}'))::text);`);
    const balances=(await a.c.schema("api").rpc("read_accounts")).data;
    const result=JSON.parse(fixtureSql(recoverySql(true,a.uid)));expect(result).toMatchObject({links:0,drafts:0,queries:0});
    await expect(call(ac,"catalog")).rejects.toMatchObject({code:"42501"});
    expect((await a.c.schema("api").rpc("read_accounts")).data).toEqual(balances);
    expect(fixtureSql(`select md5(jsonb_build_array((select jsonb_agg(to_jsonb(t) order by id) from finance.transactions t where user_id='${a.uid}'),(select jsonb_agg(to_jsonb(e) order by transaction_id) from finance.transaction_entries e where user_id='${a.uid}'))::text);`)).toBe(before);
  });
});
