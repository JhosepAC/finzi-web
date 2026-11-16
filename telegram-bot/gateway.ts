import postgres from "postgres";
export function gateway(url: string) {
 const parsed=new URL(url);
 if(parsed.username!=="finzi_telegram_gateway" || !["127.0.0.1","localhost"].includes(parsed.hostname)) throw new Error("Phase 3 only supports the restricted local gateway");
 const sql=postgres(url,{max:1,idle_timeout:0,max_lifetime:0,connect_timeout:10,connection:{application_name:"finzi-telegram",statement_timeout:15000},onnotice:()=>{}});
 let pid: number|undefined;
 return {
  async lock(bot: string) {
   const [r]=await sql`select pg_backend_pid() pid,pg_try_advisory_lock(hashtextextended(${"finzi-telegram:"+bot},0)) locked,session_user username`;
   if(!r.locked || r.username!=="finzi_telegram_gateway")throw new Error("Another poller or invalid role");pid=r.pid;
  },
  async assertLock() { const [r]=await sql`select pg_backend_pid() pid`;if(r.pid!==pid)throw new Error("Poller lease lost; restart explicitly"); },
  async claim(challenge: string,bot: string,user: string,chat: string,hash: string) { await sql`select telegram_private.claim_link(${challenge},${bot},${user},${chat},${hash})`; },
  async context(capability: string,bot: string,user: string,chat: string) { const [r]=await sql`select telegram_private.link_context(${capability},${bot},${user},${chat}) value`;return r.value as Record<string,string>|null; },
  close:()=>sql.end({timeout:5})
 };
}
export type Gateway = Pick<ReturnType<typeof gateway>,"claim"|"context">;
