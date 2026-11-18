import postgres from "postgres";
import { supabaseCa } from "./supabase-ca.ts";
import { type Action, type Database, type Failure, type Inspection, type Job } from "./protocol.ts";

export function databaseOptions(connection: string) {
  const url = new URL(connection);
  const expectedUser = "finzi_deletion_gateway.mkzclztzyqdmftesnwcw";
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !/^aws-[0-9]+-sa-east-1\.pooler\.supabase\.com$/.test(url.hostname)
    || url.port !== "6543" || decodeURIComponent(url.username) !== expectedUser || !url.password || url.pathname !== "/postgres" || url.search || url.hash) throw new Error("database_configuration_invalid");
  return {
    host: url.hostname, port: 6543, database: "postgres", username: expectedUser, password: decodeURIComponent(url.password),
    ssl: { ca: supabaseCa, rejectUnauthorized: true as const, servername: url.hostname },
    max: 1, prepare: false, connect_timeout: 5, idle_timeout: 2, max_lifetime: 30,
    connection: { statement_timeout: 10000, lock_timeout: 1000, application_name: "finzi-deletion-cloud" },
  };
}

export async function connectDatabase(connection: string): Promise<Database & { close(): Promise<void> }> {
  const sql = postgres(databaseOptions(connection));
  try {
    const [identity] = await sql`select current_user as role, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolinherit, r.rolreplication,
      exists(select 1 from pg_auth_members where member=r.oid) as member,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls
      from pg_roles r where r.rolname=current_user`;
    if (identity?.role !== "finzi_deletion_gateway" || !identity.tls || identity.rolsuper || identity.rolbypassrls
      || identity.rolcreaterole || identity.rolcreatedb || identity.rolinherit || identity.rolreplication || identity.member) throw new Error("database_identity_invalid");
    return {
      async claim(lease) { const [r] = await sql`select ops.cloud_deletion_claim(${lease}) as result`; return r.result as Job | null; },
      async inspect(job) { const [r] = await sql`select ops.cloud_deletion_inspect(${job.id}::uuid,${job.lease}) as result`; return r.result as Inspection; },
      async step(job: Job, action: Action, digest?: string) { await sql`select ops.cloud_deletion_step(${job.id}::uuid,${job.lease},${action},${digest ?? null})`; },
      async fail(job: Job, code: Failure) { await sql`select ops.cloud_deletion_fail(${job.id}::uuid,${job.lease},${code})`; },
      close() { return sql.end({ timeout: 2 }); },
    };
  } catch {
    await sql.end({ timeout: 2 });
    throw new Error("database_unavailable");
  }
}
