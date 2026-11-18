// Local workerd test entry ONLY. Production wrangler main remains worker.ts.
import { Api } from "grammy";
import production from "../../telegram-webhook/worker.ts";
import type { Environment } from "../../telegram-webhook/processor.ts";

let active: (Environment & { PHASE3_SYNTHETIC_CHAT: string }) | undefined;
const methods: string[] = [];
const originalGetMe = Api.prototype.getMe;
Api.prototype.getMe = function (signal) {
  const env = active;
  if (!env || !env.TELEGRAM_WEBHOOK_BOT_TOKEN.endsWith(":synthetic_test_only")) throw new Error("synthetic_only");
  this.config.use(async (_previous, method, payload) => {
    methods.push(method);
    if (method === "getMe") return { ok: true, result: { id: Number(env.TELEGRAM_WEBHOOK_BOT_ID), is_bot: true, first_name: "Synthetic", username: env.TELEGRAM_WEBHOOK_BOT_USERNAME } as never };
    if (method === "getWebhookInfo") return { ok: true, result: { url: env.TELEGRAM_WEBHOOK_URL, has_custom_certificate: false, pending_update_count: 0 } as never };
    if (method !== "sendMessage" || String((payload as { chat_id?: unknown }).chat_id) !== env.PHASE3_SYNTHETIC_CHAT) throw new Error("forbidden_test_delivery");
    return { ok: true, result: { message_id: 1 } as never };
  });
  return originalGetMe.call(this, signal);
};

const cronTestWorker = {
  async fetch(request: Request, env: Environment & { PHASE3_SYNTHETIC_CHAT: string }) {
    if (new URL(request.url).pathname !== "/__phase3_cron_test") return production.fetch(request, env);
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!/^\d{15}$/.test(env.TELEGRAM_WEBHOOK_BOT_ID) || !/^\d+$/.test(env.PHASE3_SYNTHETIC_CHAT)) throw new Error("synthetic_only");
    active = env;
    const before = methods.length;
    try {
      await production.scheduled({}, env);
      return Response.json({ scheduledHandler: true, syntheticApiMethods: methods.slice(before), realTelegramRequests: 0 });
    } finally { active = undefined; }
  },
};
export default cronTestWorker;
