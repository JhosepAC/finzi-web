import { describe, expect, it, vi } from "vitest";
import { verifyConfirmationRace } from "../../scripts/telegram-concurrency-evidence";

const receipt = { movementId: "synthetic-canonical", status: "posted" };
const success = (value: unknown = receipt): PromiseFulfilledResult<unknown> => ({ status: "fulfilled", value });
const rejection = (code: string): PromiseRejectedResult => ({ status: "rejected", reason: { code } });

describe("financial concurrency evidence outside the worker crash handler", () => {
  it("proves two successful identical receipts and explicit replay", async () => {
    expect(await verifyConfirmationRace([success(), success({ ...receipt })], async () => receipt))
      .toMatchObject({ successfulRequests: 2, busyRequests: 0, explicitReplayReceiptEqual: true });
  });
  it("accepts a bounded lock rejection only when a canonical winner and replay exist", async () => {
    expect(await verifyConfirmationRace([success(), rejection("55P03")], async () => receipt))
      .toMatchObject({ successfulRequests: 1, busyRequests: 1, busyCodes: ["55P03"] });
  });
  it("fails on a missing second request", async () => {
    await expect(verifyConfirmationRace([success()], async () => receipt)).rejects.toThrow();
  });
  it("fails on two rejected requests without replaying", async () => {
    const replay = vi.fn();
    await expect(verifyConfirmationRace([rejection("55P03"), rejection("55P03")], replay)).rejects.toThrow();
    expect(replay).not.toHaveBeenCalled();
  });
  it("does not hide an unexpected SQL failure behind a simulated worker crash", async () => {
    const replay = vi.fn();
    const outcomes = [success(), rejection("42501")];
    // The worker returned false after its expected injected finish failure.
    // Financial assertions run here, outside that error-catching boundary.
    await expect(verifyConfirmationRace(outcomes, replay)).rejects.toThrow("Unexpected financial race failure");
    expect(replay).not.toHaveBeenCalled();
  });
  it("rejects differing concurrent receipts", async () => {
    await expect(verifyConfirmationRace([success(), success({ movementId: "different" })], async () => receipt)).rejects.toThrow("Financial receipts differ");
  });
  it("rejects a replay that returns a different receipt", async () => {
    await expect(verifyConfirmationRace([success(), success()], async () => ({ movementId: "different" }))).rejects.toThrow("Replay receipt differs");
  });
});
