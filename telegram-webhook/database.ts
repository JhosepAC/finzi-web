import { supabaseCa } from "./supabase-ca.ts";
import postgres from "postgres";

export type Event = { id: string; bot_id: string; update_id: string | number; telegram_user_id: string; chat_id: string; event_type: string;
  payload_ciphertext: string | null; result_ciphertext: string | null; attempts: number; delivery_attempts: number };
export type Database = ReturnType<typeof openDatabase>;
export function openDatabase(connection: string, hyperdrive = false) {
  const uri = new URL(connection);
  if (!hyperdrive && (!/^(finzi_telegram_gateway|finzi_telegram_gateway\.mkzclztzyqdmftesnwcw)$/.test(decodeURIComponent(uri.username)) ||
      !["db.mkzclztzyqdmftesnwcw.supabase.co", "aws-0-sa-east-1.pooler.supabase.com"].includes(uri.hostname) || !["", "5432", "6543"].includes(uri.port))) throw new Error("invalid_database");
  // Hyperdrive owns the upstream pool. Its protocol requires prepared statements;
  // direct transaction-pooler connections retain their existing settings.
  const sql = postgres(connection, { ssl: hyperdrive ? false : { ca: supabaseCa, rejectUnauthorized: true }, max: 1, prepare: hyperdrive, connect_timeout: 5, idle_timeout: hyperdrive ? 0 : 1, max_lifetime: 30,
    connection: { application_name: "finzi-telegram-webhook-staging", statement_timeout: 10000 }, onnotice: () => {} });
  async function check() {
    const [r] = await sql`select session_user as role, current_database() as database,
      exists(select 1 from pg_roles where rolname=session_user and not (rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb or rolreplication)) safe,
      not exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=session_user) isolated,
      not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('finance','telegram_private') and c.relkind='r' and has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')) no_tables,
      not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and has_function_privilege(session_user,p.oid,'EXECUTE')) no_api,
      not has_function_privilege(session_user,'telegram_private.confirm_draft(jsonb,text,text)','EXECUTE') fenced`;
    if (r.role !== "finzi_telegram_gateway" || !r.safe || !r.isolated || !r.no_tables || !r.no_api || !r.fenced) throw new Error("invalid_role");
  }
  return {
    check,
    async enqueue(bot: string, update: number, user: string, chat: string, kind: string, hash: string, cipher: string) {
      const [r] = await sql`select telegram_private.enqueue_update(${bot},${update}::bigint,${user},${chat},${kind},${hash},${cipher}) value`; return r.value as string;
    },
    async claim(bot: string, lease: string, stage: string) {
      const [r] = await sql`select telegram_private.claim_update(${bot},${lease},${stage}) value`; return r.value as Event | null;
    },
    async credentials(bot: string, event: string, lease: string, challenge: string | null = null, cipher: string | null = null) {
      const [r] = await sql`select telegram_private.update_credentials(${bot},${event}::uuid,${lease},${challenge},${cipher}) value`;
      return r.value as { challengeHash: string; ciphertext: string }[];
    },
    async call(bot: string, event: string, lease: string, operation: string, args: Record<string, unknown>) {
      const [r] = await sql`select telegram_private.dispatch_update(${bot},${event}::uuid,${lease},${operation},${sql.json(args)}) value`; return r.value;
    },
    async finish(bot: string, event: string, lease: string, cipher: string | null = null) {
      await sql`select telegram_private.finish_update(${bot},${event}::uuid,${lease},${cipher})`;
    },
    async retry(bot: string, event: string, lease: string, code: string, retryable: boolean) {
      await sql`select telegram_private.retry_update(${bot},${event}::uuid,${lease},${code},${retryable})`;
    },
    close: () => sql.end({ timeout: 2 })
  };
}
