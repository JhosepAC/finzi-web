export const upstream: string;
export const origin: string;
export type PilotState = { phase: string; stopped: boolean; deadline: number; authRequests: number; authRequestLimit?: number; emailsReserved: number; emailLimit?: number; registrationReserved?: boolean; recoveryReserved?: boolean; identityVerified: boolean; recoveryVerified?: boolean };
export function authorizeRequest(state: PilotState, recipient: string, method: string, path: string, search: string, body: Record<string, unknown>): void;
export function wrapPilotFetch(native: typeof fetch, bridge: string, token: string): typeof fetch;
