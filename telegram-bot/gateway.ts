import postgres from "postgres";
export function gateway(url: string) {
 const parsed=new URL(url);
 if(parsed.username!=="finzi_telegram_gateway" || !["127.0.0.1","localhost"].includes(parsed.hostname)) throw new Error("Phase 3 only supports the restricted local gateway");
 const sql=postgres(url,{max:1,idle_timeout:0,max_lifetime:0,connect_timeout:10,connection:{application_name:"finzi-telegram",statement_timeout:15000},onnotice:()=>{}});
 let pid: number|undefined;
 return {
  async checkConnection(){const [r]=await sql`select session_user username`;if(r.username!=="finzi_telegram_gateway")throw new Error("Invalid gateway role");},
  async lock(bot: string) {
   const [r]=await sql`select pg_backend_pid() pid,pg_try_advisory_lock(hashtextextended(${"finzi-telegram:"+bot},0)) locked,session_user username`;
   if(!r.locked || r.username!=="finzi_telegram_gateway")throw new Error("Another poller or invalid role");pid=r.pid;
  },
  async assertLock() { const [r]=await sql`select pg_backend_pid() pid`;if(r.pid!==pid)throw new Error("Poller lease lost; restart explicitly"); },
  async claim(challenge: string,bot: string,user: string,chat: string,hash: string) { await sql`select telegram_private.claim_link(${challenge},${bot},${user},${chat},${hash})`; },
  async context(capability: string,bot: string,user: string,chat: string) { const [r]=await sql`select telegram_private.link_context(${capability},${bot},${user},${chat}) value`;return r.value as Record<string,string>|null; },
  async catalog(c:Record<string,string>){const [r]=await sql`select telegram_private.conversation_catalog(${JSON.stringify({...c,scope:"catalog:read"})}::jsonb) value`;return r.value;},
  async command(c:Record<string,string>,command:Record<string,unknown>){const [r]=await sql`select telegram_private.draft_command(${JSON.stringify({...c,scope:"draft:write"})}::jsonb,${JSON.stringify(command)}::jsonb) value`;return r.value;},
  async callbacks(c:Record<string,string>,id:string,version:number,choices:{hash:string;field:string;value:string}[]){await sql`select telegram_private.register_callbacks(${JSON.stringify({...c,scope:"draft:write"})}::jsonb,${id}::uuid,${version},${JSON.stringify(choices)}::jsonb)`;},
  async confirm(c:Record<string,string>,tokenHash:string,updateId:string){const [r]=await sql`select telegram_private.confirm_draft(${JSON.stringify({...c,scope:"movement:confirm"})}::jsonb,${tokenHash},${updateId}) value`;return r.value;},
  close:()=>sql.end({timeout:5})
 };
}
export type Gateway = Pick<ReturnType<typeof gateway>,"claim"|"context"|"catalog"|"command"|"callbacks"|"confirm">;
