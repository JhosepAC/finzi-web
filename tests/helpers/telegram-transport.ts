import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { openDatabase, type Event } from "../../telegram-webhook/database";
import { seal } from "../../telegram-webhook/crypto";
export const secret = () => randomBytes(32).toString("hex");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function fixtureSql(statement: string) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { input: statement, encoding: "utf8", stdio: "pipe" }).trim();
}
export function localTransport() {
  const env = parseEnv(readFileSync(".env.telegram.local", "utf8"));
  const uri = new URL(env.TELEGRAM_DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(uri.hostname) || uri.username !== "finzi_telegram_gateway") throw new Error("local_restricted_transport_required");
  uri.search = "";
  const db = openDatabase(uri.toString(), true), other = openDatabase(uri.toString(), true);
  const bot = String(Date.now()) + String(Math.floor(Math.random() * 100)).padStart(2, "0");
  fixtureSql(`insert into telegram_private.transport_bots(bot_id,mode,enabled) values('${bot}','webhook',true);`);
  let update = Date.now();
  async function event(user: string, callback = false) {
    const id = ++update, lease = secret();
    await db.enqueue(bot, id, user, user, callback ? "callback_query" : "message", hash(String(id)), "d".repeat(64));
    const claimed = await db.claim(bot, lease, "process");
    if (!claimed || String(claimed.update_id) !== String(id)) throw new Error("unexpected_local_event");
    return { event: claimed, lease, update: String(id) };
  }
  async function complete(e: Event, lease: string) {
    const cipher = await seal("a".repeat(64), "outbox", "outbox:" + e.id, { calls: [], authorization: null, scope: "catalog:read" });
    await db.finish(bot, e.id, lease, cipher);
    const delivered = await db.claim(bot, lease, "deliver");
    if (!delivered || delivered.id !== e.id) throw new Error("unexpected_local_delivery");
    await db.finish(bot, e.id, lease);
  }
  async function invoke(user: string, operation: string, args: Record<string, unknown> = {}) {
    const e = await event(user, operation === "confirm");
    const key = operation === "command" ? "command" : operation === "query" ? "operation" : null;
    if (key && args[key] && typeof args[key] === "object" && "updateId" in args[key]) args = { ...args, [key]: { ...args[key], updateId: e.update } };
    try { return await db.call(bot, e.event.id, e.lease, operation, args); }
    finally { await complete(e.event, e.lease); }
  }
  return { db, other, bot, nextUpdate:()=>++update, event, complete, invoke, close: async () => { await db.close(); await other.close(); } };
}
