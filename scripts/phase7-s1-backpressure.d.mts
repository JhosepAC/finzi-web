import type { PilotState, authorizeRequest } from "./phase7-s1-policy.mjs";
type Sample = { at: number; total: number; idle: number; calls: number; reset: string; unsafe: boolean };
export type CpuGate = { paused: boolean; consecutive: number };
export function advanceCpuGate(gate: CpuGate, before: Sample, after: Sample, expectedCalls: number): { percent: number; accepted: boolean };
export function authorizeRecoveryOnly(state: PilotState & {cpuGate: CpuGate}, recipient: string, method: string, path: string, search: string, body: Record<string, unknown>, authorize: typeof authorizeRequest): void;
