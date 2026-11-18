import { diagnostic } from "./diagnostics.ts";
import { randomBytes } from "node:crypto";
import { Api } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { createBot, hash } from "../telegram-bot/bot.ts";
import type { Gateway } from "../telegram-bot/gateway.ts";
import type { State } from "../telegram-bot/store.ts";
import { signCallback, seal, unseal } from "./crypto.ts";
import type { Database, Event } from "./database.ts";
import { parseUpdate } from "./update.ts";

export type Environment = {
  TELEGRAM_WEBHOOK_BOT_ID: string; TELEGRAM_WEBHOOK_BOT_USERNAME: string;
  TELEGRAM_WEBHOOK_SECRET: string; TELEGRAM_WEBHOOK_DATABASE_URL?: string;
  TELEGRAM_DB?: { connectionString: string };
  TELEGRAM_WEBHOOK_CUSTODY_KEY: string; TELEGRAM_WEBHOOK_CALLBACK_KEY: string;
  TELEGRAM_WEBHOOK_BOT_TOKEN: string; TELEGRAM_WEBHOOK_URL: string;
};
type Call = { method: "sendMessage" | "answerCallbackQuery"; payload: Record<string, unknown> };
type Outbox = { calls: Call[]; authorization: Record<string, string> | null; scope: string };
export const eventAad = (e: Pick<Event, "bot_id" | "update_id" | "telegram_user_id" | "chat_id" | "event_type">) =>
  JSON.stringify(["event-v1", e.bot_id, String(e.update_id), e.telegram_user_id, e.chat_id, e.event_type]);
const credentialAad = (bot: string, user: string, challenge: string) => JSON.stringify(["credential-v1", bot, user, challenge]);
export function checkEnvironment(env: Environment) {
  if (!/^[1-9][0-9]{0,15}$/.test(env.TELEGRAM_WEBHOOK_BOT_ID) || !Number.isSafeInteger(Number(env.TELEGRAM_WEBHOOK_BOT_ID)) ||
    !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(env.TELEGRAM_WEBHOOK_BOT_USERNAME) ||
    !env.TELEGRAM_WEBHOOK_BOT_TOKEN?.startsWith(env.TELEGRAM_WEBHOOK_BOT_ID + ":") ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET) ||
    ![env.TELEGRAM_WEBHOOK_CUSTODY_KEY, env.TELEGRAM_WEBHOOK_CALLBACK_KEY].every(k => /^[a-f0-9]{64}$/.test(k)) ||
    env.TELEGRAM_WEBHOOK_CALLBACK_KEY === env.TELEGRAM_WEBHOOK_CUSTODY_KEY) throw new Error("invalid_configuration");
}
async function processEvent(db: Database, env: Environment, event: Event, lease: string) {
  const update = await unseal<Update>(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "inbox", eventAad(event), event.payload_ciphertext!);
  const verified = parseUpdate(update);
  if (String(update.update_id) !== String(event.update_id) || verified.user !== event.telegram_user_id || verified.chat !== event.chat_id || verified.kind !== event.event_type) throw new Error("invalid_cipher");
  const load = async () => Promise.all((await db.credentials(event.bot_id, event.id, lease)).map(row =>
    unseal<State["credentials"][number]>(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "credentials", credentialAad(event.bot_id, event.telegram_user_id, row.challengeHash), row.ciphertext)));
  let credentials = await load();
  // Persist the same random capability BEFORE the unchanged /start handler claims the link.
  // No asynchronous durable save is disguised as the synchronous filesystem Store port.
  const start = update.message?.text?.match(/^\/start(?:@([A-Za-z0-9_]+))?\s+([a-f0-9]{64})\s*$/);
  if (start && (!start[1] || start[1].toLowerCase() === env.TELEGRAM_WEBHOOK_BOT_USERNAME.toLowerCase()) &&
      !credentials.some(c => c.challengeHash === hash(start[2]))) {
    const record = { user: event.telegram_user_id, challengeHash: hash(start[2]), capability: randomBytes(32).toString("hex"), createdAt: Date.now() };
    const cipher = await seal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "credentials", credentialAad(event.bot_id, record.user, record.challengeHash), record);
    await db.credentials(event.bot_id, event.id, lease, record.challengeHash, cipher); credentials = await load();
  }
  const outbox: Outbox = { calls: [], authorization: null, scope: "catalog:read" };
  const call = (operation: string, args: Record<string, unknown>) => db.call(event.bot_id, event.id, lease, operation, args);
  const delegated = (operation: string, context: Record<string, string>, args: Record<string, unknown> = {}) => {
    outbox.authorization = context;
    outbox.scope = operation === "query" ? "report:read" : operation === "confirm" ? "movement:confirm" : "catalog:read";
    return call(operation, { context, ...args });
  };
  const port: Gateway = {
    claim: async (challenge, bot, user, chat, capabilityHash) => {
      if (bot !== event.bot_id || user !== event.telegram_user_id || chat !== event.chat_id) throw new Error("invalid_identity");
      await call("claim", { challenge, hash: capabilityHash });
    },
    context: async (capability, bot, user, chat) => {
      if (bot !== event.bot_id || user !== event.telegram_user_id || chat !== event.chat_id) throw new Error("invalid_identity");
      return call("context", { capability }) as Promise<Record<string, string> | null>;
    },
    catalog: c => delegated("catalog", c), command: (c, command) => delegated("command", c, { command }),
    callbacks: async (c, id, version, choices) => { await delegated("callbacks", c, { id, version, choices }); },
    confirm: (c, tokenHash, updateId) => {
      if (updateId !== String(event.update_id)) throw new Error("invalid_identity");
      return delegated("confirm", c, { tokenHash });
    },
    query: (c, operation) => delegated("query", c, { operation })
  };
  const state: State = { botId: event.bot_id, offset: 0, inbox: [], credentials };
  const info: UserFromGetMe = { id: Number(event.bot_id), is_bot: true, first_name: "Finzi", username: env.TELEGRAM_WEBHOOK_BOT_USERNAME,
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };
  const bot = createBot(env.TELEGRAM_WEBHOOK_BOT_TOKEN, port, { state, save: () => { throw new Error("unexpected_custody_write"); }, sign: value => signCallback(env.TELEGRAM_WEBHOOK_CALLBACK_KEY, event.bot_id, value) }, info);
  bot.api.config.use(async (_previous, method, payload) => {
    if (method !== "sendMessage" && method !== "answerCallbackQuery") throw new Error("unexpected_telegram_method");
    const data = payload as unknown as Record<string, unknown>;
    if (method === "sendMessage" && String(data.chat_id) !== event.chat_id) throw new Error("invalid_identity");
    if (method === "answerCallbackQuery" && data.callback_query_id !== update.callback_query?.id) throw new Error("invalid_identity");
    if (outbox.calls.length >= 8) throw new Error("outbox_limit");
    outbox.calls.push({ method, payload: data });
    return { ok: true, result: undefined as never }; // Queued output; handlers do not consume a Telegram Message result.
  });
  await bot.handleUpdate(update);
  const cipher = await seal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "outbox", "outbox:" + event.id, outbox);
  await db.finish(event.bot_id, event.id, lease, cipher);
}
export type Sender = (calls: Call[], env: Environment) => Promise<void>;
export const telegramSender: Sender = async (calls, env) => {
  const target = new URL(env.TELEGRAM_WEBHOOK_URL);
  if (target.protocol !== "https:" || target.pathname !== "/telegram/webhook" || target.username || target.password || target.search) throw new Error("unconfigured_delivery");
  const api = new Api(env.TELEGRAM_WEBHOOK_BOT_TOKEN, { timeoutSeconds: 8 });
  const me = await api.getMe();
  if (String(me.id) !== env.TELEGRAM_WEBHOOK_BOT_ID || me.username?.toLowerCase() !== env.TELEGRAM_WEBHOOK_BOT_USERNAME.toLowerCase()) throw new Error("invalid_bot");
  const hook = await api.getWebhookInfo();
  if (hook.url !== env.TELEGRAM_WEBHOOK_URL) throw new Error("another_consumer");
  for (const call of calls) {
    try {
      if (call.method === "sendMessage") await api.raw.sendMessage(call.payload as unknown as Parameters<typeof api.raw.sendMessage>[0]);
      else await api.raw.answerCallbackQuery(call.payload as unknown as Parameters<typeof api.raw.answerCallbackQuery>[0]);
    } catch (error) {
      // Callback acknowledgement expires; it is not a financial failure.
      if (call.method === "answerCallbackQuery" && (error as { error_code?: number }).error_code === 400) continue;
      throw error;
    }
  }
};
async function deliverEvent(db: Database, env: Environment, event: Event, lease: string, sender: Sender) {
  const outbox = await unseal<Outbox>(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "outbox", "outbox:" + event.id, event.result_ciphertext!);
  if (outbox.authorization) {
    const old = outbox.authorization;
    const current = await db.call(event.bot_id, event.id, lease, "context", { capability: old.capability }) as Record<string, string> | null;
    if (!current || current.linkId !== old.linkId || current.generation !== old.generation ||
       (outbox.scope === "report:read" && current.canReport !== "true") || (outbox.scope === "movement:confirm" && current.canConfirm !== "true")) {
      await db.finish(event.bot_id, event.id, lease); return; // Revoked private output is suppressed, never delivered from stale authorization.
    }
  }
  await sender(outbox.calls, env);
  await db.finish(event.bot_id, event.id, lease);
}
export async function runBatch(db: Database, env: Environment, stage: "process" | "deliver", sender: Sender = telegramSender) {
  const lease = randomBytes(32).toString("hex");
  let event: Event | null;
  try { event = await db.claim(env.TELEGRAM_WEBHOOK_BOT_ID, lease, stage); }
  catch (error) { if ((error as { code?: string }).code === "55P03") return false; throw error; }
  if (!event) return false;
  try {
    if (stage === "process") await processEvent(db, env, event, lease);
    else await deliverEvent(db, env, event, lease, sender);
    return true;
  } catch (error) {
    const original = (error as { error?: unknown }).error ?? error;
    diagnostic(original, "batch", stage);
    const invalid = original instanceof Error && original.message === "invalid_cipher";
    const code = invalid ? "invalid_cipher" : stage === "deliver" ? "delivery" : ((original as { name?: string }).name === "TimeoutError" || (original as { code?: string }).code === "57014") ? "timeout" : "retry";
    // A lost/expired lease cannot be revived by this worker. The next Cron reclaims it.
    try { await db.retry(event.bot_id, event.id, lease, code, !invalid); } catch { /* Fenced; no raw logs or payload. */ }
    return false;
  }
}
