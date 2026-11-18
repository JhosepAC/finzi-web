import { describe, it, expect, vi } from "vitest";
import { receiver } from "../../telegram-webhook/worker.ts";
import { parseUpdate } from "../../telegram-webhook/update.ts";
import { seal, unseal, signCallback } from "../../telegram-webhook/crypto.ts";
import type { Database } from "../../telegram-webhook/database.ts";
import type { Environment } from "../../telegram-webhook/processor.ts";
const env: Environment = { TELEGRAM_WEBHOOK_BOT_ID: "970000003", TELEGRAM_WEBHOOK_BOT_USERNAME: "FinziSyntheticBot", TELEGRAM_WEBHOOK_BOT_TOKEN: "970000003:synthetic_only", TELEGRAM_WEBHOOK_SECRET: "a".repeat(64), TELEGRAM_WEBHOOK_CUSTODY_KEY: "b".repeat(64), TELEGRAM_WEBHOOK_CALLBACK_KEY: "c".repeat(64), TELEGRAM_WEBHOOK_DATABASE_URL: "unused", TELEGRAM_WEBHOOK_URL: "" };
const event = { update_id: 11, message: { message_id: 11, date: Math.floor(Date.now()/1000), from: { id: 70001, is_bot: false, first_name: "Synthetic" }, chat: { id: 70001, type: "private" }, text: "/saldo", entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
const request = (body: unknown = event, secret = env.TELEGRAM_WEBHOOK_SECRET) => new Request("https://finzi.invalid/telegram/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(body) });
describe("dedicated Telegram receiver", () => {
 it("rejects methods, secrets and malformed events before database access", async () => {
  const connect = vi.fn(); const fetch = receiver(connect);
  expect((await fetch(new Request("https://finzi.invalid/telegram/webhook"), env)).status).toBe(405);
  expect((await fetch(request(event, "wrong"), env)).status).toBe(403);
  expect((await fetch(request({ update_id: 1 }), env)).status).toBe(400);
  expect((await fetch(request({ ...event, message: { ...event.message, chat: { id: 70002, type: "private" } } }), env)).status).toBe(400);
  expect(connect).not.toHaveBeenCalled();
 });
 it("limits bodies even without Content-Length and does not persist invalid input", async () => {
  const connect = vi.fn();
  const big = request({ data: "x".repeat(17000) });
  expect((await receiver(connect)(big, env)).status).toBe(413);
  expect(connect).not.toHaveBeenCalled();
 });
 it("does not acknowledge before the durable commit resolves", async () => {
  let commit!: () => void; let entered!: () => void;
  const arrived = new Promise<void>(resolve => { entered = resolve; });
  const enqueue = vi.fn(async () => { entered(); await new Promise<void>(resolve => { commit = resolve; }); return "event"; });
  const db = { check: vi.fn(async () => {}), enqueue, close: vi.fn(async () => {}) } as unknown as Database;
  let replied = false; const response = receiver(() => db)(request(), env).then(r => { replied = true; return r; });
  await arrived; expect(replied).toBe(false); commit();
  expect((await response).status).toBe(200);
  expect(enqueue.mock.calls).toHaveLength(1);
 });
 it("returns a retryable failure if persistence fails", async () => {
  const db = { check: async () => {}, enqueue: async () => { throw new Error("synthetic failure"); }, close: async () => {} } as unknown as Database;
  expect((await receiver(() => db)(request(), env)).status).toBe(503);
 });
 it("uses authenticated purpose-separated encryption and stable callbacks", async () => {
  const cipher = await seal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "inbox", "bot:1:update:2", { text: "synthetic" });
  expect(cipher).not.toContain("synthetic");
  expect(await unseal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "inbox", "bot:1:update:2", cipher)).toEqual({ text: "synthetic" });
  await expect(unseal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "outbox", "bot:1:update:2", cipher)).rejects.toThrow("invalid_cipher");
  await expect(unseal(env.TELEGRAM_WEBHOOK_CUSTODY_KEY, "inbox", "bot:1:update:3", cipher)).rejects.toThrow("invalid_cipher");
  expect(signCallback(env.TELEGRAM_WEBHOOK_CALLBACK_KEY, "1", "choice")).toBe(signCallback(env.TELEGRAM_WEBHOOK_CALLBACK_KEY, "1", "choice"));
  expect(signCallback(env.TELEGRAM_WEBHOOK_CALLBACK_KEY, "1", "choice")).not.toBe(signCallback(env.TELEGRAM_WEBHOOK_CALLBACK_KEY, "2", "choice"));
 });
 it("strips unneeded media fields and retains only command entities", () => {
  const parsed = parseUpdate({ ...event, message: { ...event.message, photo: [{ file_id: "private" }], entities: [{ type: "bold", offset: 0, length: 6 }] } });
  expect(parsed.update.message).not.toHaveProperty("photo");
  expect(parsed.update.message?.entities).toEqual([]);
 });
});
