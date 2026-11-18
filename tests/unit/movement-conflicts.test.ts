import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/modules/identity/server", () => ({ createUserScopedClient: async () => ({ auth: { getUser: mocks.getUser }, schema: () => ({ rpc: mocks.rpc }) }) }));
vi.mock("@/modules/identity/infrastructure/environment", () => ({ getAuthEnvironment: () => ({ origin: "http://localhost:3000" }) }));
import { POST, PUT } from "../../src/app/api/v1/movements/route";

const input = { requestId: crypto.randomUUID(), kind: "income", accountId: crypto.randomUUID(), categoryId: crypto.randomUUID(), amount: "1.00", description: "Synthetic", note: "", occurredAt: null };
function request(replace = false) {
  return new NextRequest("http://localhost:3000/api/v1/movements", { method: replace ? "PUT" : "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(replace ? { ...input, id: crypto.randomUUID(), expectedVersion: 1, reason: "Synthetic correction" } : input) });
}
beforeEach(() => { mocks.getUser.mockResolvedValue({ data: { user: { email_confirmed_at: "2026-01-01" } }, error: null }); });

describe("movement conflict transport", () => {
  it.each([false, true])("permanent conflict returns 409 without retry (replace=%s)", async (replace) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
    const response = await (replace ? PUT : POST)(request(replace));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("engine serialization remains retryable without automatic replay (replace=%s)", async (replace) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await (replace ? PUT : POST)(request(replace));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "RETRYABLE_TRANSACTION" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("infrastructure uncertainty returns 503 and does not replay", async () => {
    mocks.rpc.mockRejectedValue(new Error("synthetic transport failure"));
    expect((await POST(request())).status).toBe(503); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("requires verified identity before reaching the financial RPC", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("migration preserves all financial SQL except the two reviewed business error sites", () => {
    const original = readFileSync("supabase/migrations/20261114000800_transfers_replacements.sql", "utf8").replaceAll("\r\n", "\n");
    const start = original.indexOf("create function finance.write_movement(");
    const writer = original.slice(start, original.indexOf("end $$;", start) + 7);
    const migration = readFileSync("supabase/migrations/20261116001000_movement_business_conflicts.sql", "utf8").replaceAll("\r\n", "\n");
    const expected = writer.replace("create function", "create or replace function")
      .replace("raise serialization_failure;", "raise sqlstate 'PT409' using message = 'idempotency_conflict';")
      .replace("raise serialization_failure;", "raise sqlstate 'PT409' using message = 'movement_version_conflict';");
    expect(migration.slice(migration.indexOf("create or replace function"), migration.indexOf("end $$;") + 7)).toBe(expected);
    expect(migration).not.toMatch(/exception\s+when|alter\s+(role|table)|grant\s|revoke\s/i);
  });
});
