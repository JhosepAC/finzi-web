import { describe, it, expect, vi } from "vitest";
import { runBatch, eventAad, type Environment } from "../../telegram-webhook/processor.ts";
import { seal, unseal } from "../../telegram-webhook/crypto.ts";
import { hash } from "../../telegram-bot/bot.ts";
import type { Database, Event } from "../../telegram-webhook/database.ts";
const env: Environment = { TELEGRAM_WEBHOOK_BOT_ID: "970000003", TELEGRAM_WEBHOOK_BOT_USERNAME: "FinziSyntheticBot", TELEGRAM_WEBHOOK_BOT_TOKEN: "970000003:synthetic_only", TELEGRAM_WEBHOOK_SECRET: "a".repeat(64), TELEGRAM_WEBHOOK_CUSTODY_KEY: "b".repeat(64), TELEGRAM_WEBHOOK_CALLBACK_KEY: "c".repeat(64), TELEGRAM_WEBHOOK_URL: "" };

describe("unchanged bot enrollment through the durable adapter", () => {
  it.each([false, true])("preserves the claim contract and queues a safe reply (rejected=%s)", async rejected => {
    const challenge = "e".repeat(64), user = "70001";
    const update = { update_id: 71, message: { message_id: 71, date: Math.floor(Date.now() / 1000), from: { id: 70001, is_bot: false, first_name: "Synthetic" }, chat: { id: 70001, type: "private" }, text: "/start " + challenge, entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
    const event: Event = { id: crypto.randomUUID(), bot_id: env.TELEGRAM_WEBHOOK_BOT_ID, update_id: 71, telegram_user_id: user, chat_id: user, event_type: "message", payload_ciphertext: null, result_ciphertext: null, attempts: 1, delivery_attempts: 0 };
    event.payload_ciphertext = await seal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "inbox", eventAad(event), update);
    let stored: { challengeHash: string; ciphertext: string }[] = [];
    const claim = vi.fn(async (_bot: string, _id: string, _lease: string, operation: string, args: Record<string, unknown>) => {
      expect(operation).toBe("claim"); expect(args.challenge).toBe(challenge);
      // Custody must be committed before /start can claim this exact capability.
      expect(stored).toHaveLength(1);
      const credential = await unseal<{ capability: string }>(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "credentials", JSON.stringify(["credential-v1", event.bot_id, user, hash(challenge)]), stored[0].ciphertext);
      expect(args.hash).toBe(hash(credential.capability));
      if (rejected) throw Object.assign(new Error("synthetic expected denial"), { code: "42501" });
      return null;
    });
    const db = {
      claim: async () => event,
      credentials: async (_bot: string, _id: string, _lease: string, digest: string | null = null, cipher: string | null = null) => {
        if (digest && cipher) stored = [{ challengeHash: digest, ciphertext: cipher }]; return stored;
      },
      call: claim,
      finish: async (_bot: string, _id: string, _lease: string, cipher: string | null = null) => { event.result_ciphertext = cipher; event.payload_ciphertext = null; },
      retry: vi.fn(),
    } as unknown as Database;
    const sender = vi.fn(async () => {});
    expect(await runBatch(db, env, "process", sender)).toBe(true);
    expect(claim).toHaveBeenCalledTimes(1); expect(sender).not.toHaveBeenCalled(); expect(db.retry).not.toHaveBeenCalled();
    const output = await unseal<{ calls: { method: string; payload: { text: string } }[] }>(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "outbox", "outbox:" + event.id, event.result_ciphertext!);
    expect(output.calls).toHaveLength(1); expect(output.calls[0].method).toBe("sendMessage");
    expect(output.calls[0].payload.text).toContain(rejected ? "El enlace venció" : "Solicitud recibida");
    expect(await runBatch(db, env, "deliver", sender)).toBe(true); expect(sender).toHaveBeenCalledTimes(1);
  });
});
