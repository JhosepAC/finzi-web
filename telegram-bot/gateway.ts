import postgres from "postgres";
export function gateway(url: string) {
 const parsed=new URL(url);
 if(parsed.username!=="finzi_telegram_gateway" || !["127.0.0.1","localhost"].includes(parsed.hostname)) throw new Error("Phase 3 only supports the restricted local gateway");
 const sql=postgres(url,{max:1,idle_timeout:0,max_lifetime:0,connect_timeout:10,connection:{application_name:"finzi-telegram",statement_timeout:15000},onnotice:()=>{}});
 let pid: number|undefined;
 return {
  async checkConnection(){const [r]=await sql`select session_user username`;if(r.username!=="finzi_telegram_gateway")throw new Error("Invalid gateway role");},
  async checkRuntime(){
   const required=["claim_link(text,text,text,text,text)","link_context(text,text,text,text)","conversation_catalog(jsonb)","draft_command(jsonb,jsonb)","register_callbacks(jsonb,uuid,integer,jsonb)","confirm_draft(jsonb,text,text)","read_query(jsonb,jsonb)","lock_query(jsonb)","cleanup_queries(integer)"];
   const [r]=await sql`select
    exists(select 1 from pg_roles where rolname=session_user and not (rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb or rolreplication)) safe_role,
    not exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=session_user) no_memberships,
    not exists(select 1 from unnest(${required}::text[]) signature where to_regprocedure('telegram_private.'||signature) is null or not coalesce(has_function_privilege(session_user,to_regprocedure('telegram_private.'||signature),'EXECUTE'),false)) routines,
    not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and has_function_privilege(session_user,p.oid,'EXECUTE')) no_api,
    not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('finance','telegram_private') and c.relkind='r' and has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')) no_tables`;
   if(!r.safe_role||!r.no_memberships||!r.routines||!r.no_api||!r.no_tables)throw new Error("Runtime preflight failed");
  },
  async lock(bot: string) {
   const [r]=await sql`select pg_backend_pid() pid,pg_try_advisory_lock(hashtextextended(${"finzi-telegram:"+bot},0)) locked,session_user username`;
   if(!r.locked || r.username!=="finzi_telegram_gateway")throw new Error("Another poller or invalid role");pid=r.pid;
  },
  async assertLock() { const [r]=await sql`select pg_backend_pid() pid`;if(r.pid!==pid)throw new Error("Poller lease lost; restart explicitly"); },
  async claim(challenge: string,bot: string,user: string,chat: string,hash: string) { await sql`select telegram_private.claim_link(${challenge},${bot},${user},${chat},${hash})`; },
  async context(capability: string,bot: string,user: string,chat: string) { const [r]=await sql`select telegram_private.link_context(${capability},${bot},${user},${chat}) value`;return r.value as Record<string,string>|null; },
  async catalog(c:Record<string,string>){const [r]=await sql`select telegram_private.conversation_catalog(${sql.json({...c,scope:"catalog:read"})}::jsonb) value`;return r.value;},
  async command(c:Record<string,string>,command:Record<string,unknown>){const [r]=await sql`select telegram_private.draft_command(${sql.json({...c,scope:"draft:write"})}::jsonb,${sql.json(command)}::jsonb) value`;return r.value;},
  async callbacks(c:Record<string,string>,id:string,version:number,choices:{hash:string;field:string;value:string}[]){await sql`select telegram_private.register_callbacks(${sql.json({...c,scope:"draft:write"})}::jsonb,${id}::uuid,${version},${sql.json(choices)}::jsonb)`;},
  async confirm(c:Record<string,string>,tokenHash:string,updateId:string){const [r]=await sql`select telegram_private.confirm_draft(${sql.json({...c,scope:"movement:confirm"})}::jsonb,${tokenHash},${updateId}) value`;return r.value;},
  async query(c:Record<string,string>,op:Record<string,unknown>){return sql.begin(async tx=>{
   const context=sql.json({...c,scope:"report:read"});await tx`select telegram_private.lock_query(${context}::jsonb)`;
   const [r]=await tx`select telegram_private.read_query(${context}::jsonb,${sql.json(op)}::jsonb) value`;return r.value;
  });},
  async sweepQueries(){await sql`select telegram_private.cleanup_queries(500)`;},
  close:()=>sql.end({timeout:5})
 };
}
export type Gateway = Pick<ReturnType<typeof gateway>,"claim"|"context"|"catalog"|"command"|"callbacks"|"confirm"|"query">;
