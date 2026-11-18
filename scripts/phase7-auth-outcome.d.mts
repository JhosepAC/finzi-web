export function authOutcome(method: string, path: string, search: string, status: number, data: unknown): { code: string; terminal: boolean };
export function safeAuthHeaders(headers: Headers): Record<string,string>;
