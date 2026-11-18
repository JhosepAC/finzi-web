import { hex, uuid, type Job, type Manifests } from "./protocol.ts";

// Minimal D1 interface keeps this runtime independent of Node and Wrangler types.
export interface Statement {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
}
export interface ManifestDatabase { withSession(mode: "first-primary"): { prepare(sql: string): Statement } }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const text = new TextEncoder();
async function digest(raw: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", text.encode(raw))), n => n.toString(16).padStart(2, "0")).join("");
}
export async function manifestStore(db: ManifestDatabase, keyHex: string): Promise<Manifests> {
  if (!db || typeof db.withSession !== "function") throw new Error("manifest_binding_invalid");
  if (!hex.test(keyHex)) throw new Error("manifest_key_invalid");
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(keyHex.match(/../g)!, s => parseInt(s, 16)), "AES-GCM", false, ["encrypt", "decrypt"]);
  async function access(job: Job, create: boolean) {
    if (!uuid.test(job.id) || !uuid.test(job.user_id) || !hex.test(job.tracking_hash)) throw new Error("manifest_target_invalid");
    const session = db.withSession("first-primary"), aad = text.encode(`finzi-deletion:1:${job.id}`);
    let row = await session.prepare("SELECT envelope FROM deletion_manifests WHERE request_id = ?").bind(job.id).first<{ envelope: string }>();
    if (!row && create) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key,
        text.encode(JSON.stringify({ version: 1, requestId: job.id, subjectId: job.user_id, trackingHash: job.tracking_hash })));
      const envelope = JSON.stringify({ version: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) });
      await session.prepare("INSERT INTO deletion_manifests(request_id,envelope) VALUES (?,?) ON CONFLICT(request_id) DO NOTHING").bind(job.id, envelope).run();
      row = await session.prepare("SELECT envelope FROM deletion_manifests WHERE request_id = ?").bind(job.id).first<{ envelope: string }>();
    }
    if (!row || row.envelope.length > 4096) throw new Error("manifest_missing");
    const envelope = JSON.parse(row.envelope);
    if (envelope.version !== 1) throw new Error("manifest_version_invalid");
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv), additionalData: aad }, key, decode(envelope.ciphertext));
    const value = JSON.parse(new TextDecoder().decode(raw));
    if (value.version !== 1 || value.requestId !== job.id || value.subjectId !== job.user_id || value.trackingHash !== job.tracking_hash) throw new Error("manifest_incompatible");
    return digest(row.envelope);
  }
  return { save: job => access(job, true), verify: job => access(job, false) };
}
