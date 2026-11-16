import { z } from "zod";
const id=z.uuid();
export const telegramAction=z.discriminatedUnion("action",[
 z.object({action:z.literal("create")}).strict(),
 z.object({action:z.literal("activate"),attemptId:id}).strict(),
 z.object({action:z.literal("query-permission"),linkId:id,expectedVersion:z.number().int().positive(),allow:z.boolean()}).strict(),
 z.object({action:z.literal("movement-permission"),linkId:id,expectedVersion:z.number().int().positive(),allow:z.boolean()}).strict(),
 z.object({action:z.literal("revoke"),linkId:id,expectedVersion:z.number().int().positive()}).strict()
]);
export const telegramStatus=z.object({
 username:z.string().nullable(),
 links:z.array(z.object({id,bot_id:z.string(),telegram_user_id:z.string(),chat_id:z.string(),generation:z.number(),version:z.number(),can_confirm:z.boolean().default(false),can_report:z.boolean().default(false),created_at:z.string(),expires_at:z.string(),revoked_at:z.string().nullable()})),
 attempts:z.array(z.object({id,created_at:z.string(),expires_at:z.string(),claimed_at:z.string().nullable(),bot_id:z.string().nullable(),telegram_user_id:z.string().nullable(),chat_id:z.string().nullable()}))
});
export type TelegramStatus=z.infer<typeof telegramStatus>;
