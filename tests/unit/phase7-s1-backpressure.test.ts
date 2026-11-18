import { describe, expect, it } from "vitest";
import { advanceCpuGate, authorizeRecoveryOnly } from "../../scripts/phase7-s1-backpressure.mjs";
import { authorizeRequest } from "../../scripts/phase7-s1-policy.mjs";
const sample = { at: 0, total: 100, idle: 80, calls: 0, reset: "unchanged", unsafe: false };
const next = (percent: number) => ({ ...sample, at: 61000, total: 200, idle: 180 - percent });
describe("S1 recovery CPU backpressure", () => {
  it("requires two healthy windows before initial work and after every spike", () => {
    const gate = { paused: true, consecutive: 0 };
    advanceCpuGate(gate, sample, next(1), 0); expect(gate.paused).toBe(true);
    advanceCpuGate(gate, sample, next(2), 0); expect(gate.paused).toBe(false);
    const rejected = advanceCpuGate(gate, sample, next(15.39), 0);
    expect(rejected.accepted).toBe(false); expect(rejected.percent).toBeCloseTo(15.39); expect(gate.paused).toBe(true);
    advanceCpuGate(gate, sample, next(1), 0); expect(gate.paused).toBe(true);
    advanceCpuGate(gate, sample, next(1), 0); expect(gate.paused).toBe(false);
  });
  it("pauses at exactly ten percent and resets the healthy streak", () => {
    const gate = { paused: false, consecutive: 3 };
    expect(advanceCpuGate(gate, sample, next(10), 0).accepted).toBe(false);
    expect(gate).toEqual({ paused: true, consecutive: 0 });
  });
  it.each([
    { at: 59000 }, { total: 100 }, { idle: 79 }, { reset: "changed" }, { unsafe: true }, { calls: -1 }, { total: NaN },
  ])("keeps invalid observations terminal: %j", patch => {
    expect(() => advanceCpuGate({ paused: true, consecutive: 0 }, sample, { ...next(1), ...patch }, 0)).toThrow();
  });
  it("does not hide excess SQL behind a simultaneous CPU spike", () => {
    expect(() => advanceCpuGate({ paused: false, consecutive: 2 }, sample, { ...next(15), calls: 1 }, 0)).toThrow("RPC_CALL_EXCESS");
  });
  it("blocks all network work while paused without consuming the email", () => {
    const state = { phase: "ready_recovery", stopped: false, deadline: Date.now() + 10000, authRequests: 21, emailsReserved: 1, identityVerified: true, cpuGate: { paused: true, consecutive: 0 } };
    expect(() => authorizeRecoveryOnly(state, "synthetic@example.test", "POST", "/auth/v1/recover", "", { email: "synthetic@example.test" }, authorizeRequest)).toThrow("CPU_PAUSED");
    expect(state.emailsReserved).toBe(1); expect(state.authRequests).toBe(21);
    state.cpuGate.paused = false;
    authorizeRecoveryOnly(state, "synthetic@example.test", "POST", "/auth/v1/recover", "", { email: "synthetic@example.test" }, authorizeRequest);
    expect(state.emailsReserved).toBe(2);
    expect(() => authorizeRecoveryOnly(state, "synthetic@example.test", "POST", "/auth/v1/recover", "", { email: "synthetic@example.test" }, authorizeRequest)).toThrow();
  });
  it("never permits signup, resend or signup verification in the continuation", () => {
    const state = { phase: "ready_registration", stopped: false, deadline: Date.now() + 10000, authRequests: 21, emailsReserved: 1, identityVerified: true, cpuGate: { paused: false, consecutive: 2 } };
    for (const path of ["/auth/v1/signup", "/auth/v1/resend", "/auth/v1/verify"]) expect(() => authorizeRecoveryOnly(state, "synthetic@example.test", "POST", path, "", { type: "signup", email: "synthetic@example.test" }, authorizeRequest)).toThrow();
  });
});
