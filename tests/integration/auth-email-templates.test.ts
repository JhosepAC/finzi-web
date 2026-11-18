import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
const inbox = process.env.FINZI_TEST_MAILPIT_URL ?? "http://127.0.0.1:17324";
for (const value of [url, inbox]) {
  const parsed = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.protocol !== "http:") throw new Error("local_auth_mail_only");
}
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const password = "synthetic auth email phrase 2026";
type Message = { HTML: string; Subject: string };
async function mail(email: string, subject: string): Promise<Message> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const response = await fetch(`${inbox}/api/v1/messages?limit=50`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("local_mail_unavailable");
    const list = await response.json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    const found = list.messages.find(m => m.Subject === subject && m.To.some(t => t.Address === email));
    if (found) {
      const detail = await fetch(`${inbox}/api/v1/message/${encodeURIComponent(found.ID)}`, { signal: AbortSignal.timeout(3000) });
      if (!detail.ok) throw new Error("local_mail_unavailable");
      const body = await detail.json() as Message;
      expect(body.HTML.includes("Tu espacio personal en Finzi.")).toBe(true);
      expect(body.HTML.includes("{{")).toBe(false);
      expect(/<script|<iframe|<form|<img\b/i.test(body.HTML)).toBe(false);
      return body;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("local_mail_missing");
}
function actionLink(message: Message): URL {
  const link = message.HTML.match(/<a class="action" href="([^"]+)"/i)?.[1];
  if (!link) throw new Error("auth_mail_action_missing");
  return new URL(link.replaceAll("&amp;", "&"));
}
function ageToken(uid: string, kind: "confirmation" | "recovery") {
  if (!/^[a-f0-9-]{36}$/.test(uid)) throw new Error("fixture_subject_invalid");
  execFileSync("docker", ["exec", "supabase_db_finzi-auth", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
    `update auth.users set ${kind}_sent_at=clock_timestamp()-interval '2 hours' where id='${uid}' and email like 'smtp-phase6-%@example.test'`], { stdio: "pipe" });
}
describe("Phase 6 local Auth SMTP templates, with no external delivery", () => {
  const email = `smtp-phase6-${crypto.randomUUID()}@example.test`, nextEmail = `smtp-phase6-next-${crypto.randomUUID()}@example.test`;
  let c: SupabaseClient, uid: string, signup: URL, recovery: URL;
  beforeAll(() => {
    c = client();
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config.includes("enable_confirmations = true")).toBe(true);
    expect(config.includes("double_confirm_changes = true")).toBe(true);
  });
  it("renders confirmation through Auth into Mailpit and denies unconfirmed login", async () => {
    const result = await c.auth.signUp({ email, password });
    expect(result.error?.code ?? null).toBeNull(); expect(result.data.session).toBeNull(); uid = result.data.user!.id;
    signup = actionLink(await mail(email, "Confirma tu cuenta en Finzi"));
    expect(signup.origin).toBe("http://127.0.0.1:3000"); expect(signup.pathname).toBe("/auth/confirm"); expect(signup.search).toBe("");
    expect(new URLSearchParams(signup.hash.slice(1)).get("type")).toBe("signup");
    expect((await client().auth.signInWithPassword({ email, password })).error?.code).toBe("email_not_confirmed");
  });
  it("confirmation succeeds once and rejects replay", async () => {
    const token = new URLSearchParams(signup.hash.slice(1)).get("token_hash")!;
    expect((await c.auth.verifyOtp({ token_hash: token, type: "signup" })).error?.code ?? null).toBeNull();
    expect((await client().auth.verifyOtp({ token_hash: token, type: "signup" })).error?.code).toBe("otp_expired");
  });
  it("renders recovery with a fragment, without exposing credentials in query strings", async () => {
    expect((await client().auth.resetPasswordForEmail(email, { redirectTo: "http://127.0.0.1:3000/auth/confirm" })).error?.code ?? null).toBeNull();
    recovery = actionLink(await mail(email, "Recupera tu acceso a Finzi"));
    expect(recovery.origin).toBe("http://127.0.0.1:3000"); expect(recovery.pathname).toBe("/auth/confirm"); expect(recovery.search).toBe("");
    expect(new URLSearchParams(recovery.hash.slice(1)).get("type")).toBe("recovery");
  });
  it("recovery authenticates once, updates the password and cannot be replayed", async () => {
    const token = new URLSearchParams(recovery.hash.slice(1)).get("token_hash")!, recovered = client();
    expect((await recovered.auth.verifyOtp({ token_hash: token, type: "recovery" })).error?.code ?? null).toBeNull();
    expect((await recovered.auth.updateUser({ password: password + " updated" })).error?.code ?? null).toBeNull();
    expect((await recovered.auth.signOut({ scope: "global" })).error?.code ?? null).toBeNull();
    expect((await client().auth.verifyOtp({ token_hash: token, type: "recovery" })).error?.code).toBe("otp_expired");
    expect((await c.auth.signInWithPassword({ email, password: password + " updated" })).error?.code ?? null).toBeNull();
  });
  it("renders both email-change messages; only the second confirmation changes the email", async () => {
    expect((await c.auth.updateUser({ email: nextEmail })).error?.code ?? null).toBeNull();
    const oldMessage = await mail(email, "Confirma el cambio de correo en Finzi"), newMessage = await mail(nextEmail, "Confirma el cambio de correo en Finzi");
    const first = actionLink(oldMessage), second = actionLink(newMessage);
    expect(oldMessage.HTML.includes(nextEmail)).toBe(true); expect(newMessage.HTML.includes(nextEmail)).toBe(true);
    for (const link of [first, second]) {
      expect(link.origin).toBe(url); expect(link.pathname).toBe("/auth/v1/verify"); expect(link.searchParams.get("type")).toBe("email_change");
    }
    expect(first.searchParams.get("token") !== second.searchParams.get("token")).toBe(true);
    // Test the native provider URLs, with redirect disabled: no request to another host.
    const one = await fetch(first, { redirect: "manual" }); expect(one.status).toBe(303);
    expect((await c.auth.getUser()).data.user?.email).toBe(email);
    const two = await fetch(second, { redirect: "manual" }); expect(two.status).toBe(303);
    expect((await c.auth.getUser()).data.user?.email).toBe(nextEmail);
    const replay = await fetch(second, { redirect: "manual" });
    expect((replay.headers.get("location") ?? "").includes("error_code=otp_expired")).toBe(true);
  });
  it("expired signup links are rejected without disabling email confirmation", async () => {
    const expiredEmail = `smtp-phase6-expired-${crypto.randomUUID()}@example.test`, temp = client();
    const registered = await temp.auth.signUp({ email: expiredEmail, password }); expect(registered.error?.code ?? null).toBeNull();
    const link = actionLink(await mail(expiredEmail, "Confirma tu cuenta en Finzi"));
    ageToken(registered.data.user!.id, "confirmation");
    expect((await temp.auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "signup" })).error?.code).toBe("otp_expired");
    expect((await client().auth.signInWithPassword({ email: expiredEmail, password })).error?.code).toBe("email_not_confirmed");
  });
  it("expired recovery links are rejected and do not change the password", async () => {
    // Independent address after the successful dual-confirmation flow above.
    expect((await client().auth.resetPasswordForEmail(nextEmail)).error?.code ?? null).toBeNull();
    const link = actionLink(await mail(nextEmail, "Recupera tu acceso a Finzi")); ageToken(uid, "recovery");
    expect((await client().auth.verifyOtp({ token_hash: new URLSearchParams(link.hash.slice(1)).get("token_hash")!, type: "recovery" })).error?.code).toBe("otp_expired");
    expect((await client().auth.signInWithPassword({ email: nextEmail, password: password + " updated" })).error?.code ?? null).toBeNull();
  });
});
