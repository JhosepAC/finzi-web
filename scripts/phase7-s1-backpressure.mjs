import { checkWindow } from "./telegram-cpu-guard.ts";

// Only CPU_LIMIT is recoverable. Security/telemetry faults remain terminal.
export function advanceCpuGate(gate, before, after, expectedCalls) {
  if (after.calls - before.calls > expectedCalls) throw new Error("RPC_CALL_EXCESS");
  let percent;
  try { percent = checkWindow(before, after, expectedCalls); }
  catch (error) {
    if (error.code !== "CPU_LIMIT") throw error;
    gate.paused = true; gate.consecutive = 0;
    return { percent: 100 * (1 - (after.idle - before.idle) / (after.total - before.total)), accepted: false };
  }
  gate.consecutive++;
  if (gate.consecutive >= 2) gate.paused = false;
  return { percent, accepted: true };
}

export function authorizeRecoveryOnly(state, recipient, method, path, search, body, authorize) {
  if (path === "/auth/v1/signup" || path === "/auth/v1/resend") throw new Error("REGISTRATION_NOT_AUTHORIZED");
  if (state.cpuGate.paused) throw new Error("CPU_PAUSED");
  if (method === "POST" && path === "/auth/v1/verify" && body.type !== "recovery") throw new Error("ONLY_RECOVERY_AUTHORIZED");
  authorize(state, recipient, method, path, search, body);
}
