import { diagnostic } from "./diagnostics.ts";
import { canonical, digest, equalSecret, seal } from "./crypto.ts";
import { openDatabase, type Database } from "./database.ts";
import { checkEnvironment, eventAad, runBatch, type Environment } from "./processor.ts";
import { parseUpdate, readUpdate } from "./update.ts";

const reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export function receiver(connect: (url: string, hyperdrive?: boolean) => Database = openDatabase) {
  return async (request: Request, env: Environment) => {
    if (new URL(request.url).pathname !== "/telegram/webhook") return reply(404);
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    try { checkEnvironment(env); } catch { return reply(503); }
    if (!equalSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) return reply(403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415);
    let parsed: ReturnType<typeof parseUpdate>;
    try { parsed = parseUpdate(await readUpdate(request)); } catch (error) { return reply((error as Error).message === "too_large" ? 413 : 400); }
    const { update, user, chat, kind } = parsed;
    const metadata = { bot_id: env.TELEGRAM_WEBHOOK_BOT_ID, update_id: update.update_id, telegram_user_id: user, chat_id: chat, event_type: kind };
    let db: Database | undefined;
    let phase = "encrypt";
    try {
      const cipher = await seal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "inbox", eventAad(metadata), update);
      phase = "connect"; db = connect(env.TELEGRAM_DB?.connectionString ?? env.TELEGRAM_WEBHOOK_DATABASE_URL ?? "", Boolean(env.TELEGRAM_DB)); phase = "preflight"; await db.check();
      phase = "enqueue";
      await db.enqueue(metadata.bot_id, update.update_id, user, chat, kind, digest(canonical(update)), cipher);
      return reply(200); // Durable commit, never waitUntil or an in-memory queue.
    } catch (error) { diagnostic(error, "receive", phase); return reply(503); }
    finally { try { await db?.close(); } catch { /* No secrets in logs. */ } }
  };
}
const worker = {
  fetch: receiver(),
  async scheduled(_event: unknown, env: Environment) {
    checkEnvironment(env);
    const db = openDatabase(env.TELEGRAM_DB?.connectionString ?? env.TELEGRAM_WEBHOOK_DATABASE_URL ?? "", Boolean(env.TELEGRAM_DB));
    try {
      await db.check();
      await runBatch(db, env, "deliver");
      await runBatch(db, env, "process");
    } catch (error) { diagnostic(error, "batch"); throw new Error("telegram_batch_failed"); }
    finally { try { await db.close(); } catch { /* Safe failure; never log connection strings. */ } }
  }
};

export default worker;
