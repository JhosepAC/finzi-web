import { z } from "zod";
import type { Update } from "grammy/types";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const user = z.object({ id, is_bot: z.boolean(), first_name: z.string().max(256), username: z.string().max(64).optional() });
const chat = z.object({ id, type: z.literal("private") });
const message = z.object({ message_id: id, date: z.number().int().nonnegative(), chat, from: user,
  text: z.string().max(2000).optional(), entities: z.array(z.object({ type: z.string().max(40), offset: z.number().int().nonnegative(), length: z.number().int().positive() })).max(100).transform(entities => entities.filter(e => e.type === "bot_command")).optional()
});
const schema = z.object({ update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  message: message.optional(), callback_query: z.object({ id: z.string().min(1).max(128), from: user, chat_instance: z.string().max(128), data: z.string().regex(/^f[456]:[a-f0-9]{48}$/),
    message: z.object({ message_id: id, date: z.number().int().nonnegative(), chat }) }).optional()
}).refine(v => Boolean(v.message) !== Boolean(v.callback_query));
export function parseUpdate(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_update");
  const update = parsed.data;
  const sender = update.message?.from ?? update.callback_query!.from;
  const target = update.message?.chat ?? update.callback_query!.message.chat;
  if (sender.is_bot || sender.id !== target.id) throw new Error("invalid_identity");
  return { update: update as Update, user: String(sender.id), chat: String(target.id), kind: update.message ? "message" : "callback_query" };
}
export async function readUpdate(request: Request): Promise<unknown> {
  const max = 16 * 1024;
  if (Number(request.headers.get("content-length")) > max) throw new Error("too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_update");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > max) { await reader.cancel(); throw new Error("too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
