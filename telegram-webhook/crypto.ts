import { createHmac, timingSafeEqual } from "node:crypto";

export function equalSecret(actual: string | null, expected: string): boolean {
  if (!actual || !/^[A-Za-z0-9_-]{32,256}$/.test(expected)) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function digest(value: string): string {
  return createHmac("sha256", "finzi-transport-content-v1").update(value).digest("hex");
}
export function signCallback(key: string, bot: string, value: string): string {
  return createHmac("sha256", Buffer.from(key, "hex")).update("callback:" + bot + ":" + value).digest("hex").slice(0, 48);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
async function encryptionKey(key: string, purpose: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("invalid_key");
  const material = await crypto.subtle.importKey("raw", Buffer.from(key, "hex"), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("finzi-webhook-v1:" + purpose) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function seal(key: string, purpose: string, aad: string, value: unknown): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(aad) }, await encryptionKey(key, purpose), new TextEncoder().encode(JSON.stringify(value)));
  return "v1." + Buffer.from(nonce).toString("base64url") + "." + Buffer.from(data).toString("base64url");
}
export async function unseal<T>(key: string, purpose: string, aad: string, value: string): Promise<T> {
  try {
    const [version, nonce, bytes, extra] = value.split(".");
    if (version !== "v1" || extra || !nonce || !bytes) throw new Error();
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(nonce, "base64url"), additionalData: new TextEncoder().encode(aad) }, await encryptionKey(key, purpose), Buffer.from(bytes, "base64url"));
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch { throw new Error("invalid_cipher"); }
}
