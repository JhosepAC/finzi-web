export const states = ["PENDING", "PROCESSING", "STORAGE_PURGED", "DATABASE_PURGED", "AUTH_PURGED", "VERIFIED", "COMPLETED"] as const;
export type State = typeof states[number];
export type Job = { id: string; user_id: string; tracking_hash: string; lease: string; state: State; manifest_digest: string | null };
export type Inspection = { database: number; auth: number; storage: number; transport: number; files: { bucket: string; path: string }[] };
export type Failure = "manifest" | "storage" | "database" | "auth" | "verification" | "timeout";
export type Action = "manifest" | "yield" | "storage" | "database" | "auth" | "verify" | "complete";
export interface Database {
  claim(lease: string): Promise<Job | null>;
  inspect(job: Job): Promise<Inspection>;
  step(job: Job, action: Action, digest?: string): Promise<void>;
  fail(job: Job, code: Failure): Promise<void>;
}
export interface Manifests { save(job: Job): Promise<string>; verify(job: Job): Promise<string> }
export interface Provider { removeFiles(files: Inspection["files"]): Promise<void>; removeIdentity(id: string): Promise<void>; identityAbsent(id: string): Promise<boolean> }
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const hex = /^[a-f0-9]{64}$/;
export function validJob(job: Job): boolean {
  return uuid.test(job.id) && uuid.test(job.user_id) && hex.test(job.tracking_hash) && hex.test(job.lease)
    && states.includes(job.state) && job.state !== "PENDING" && job.state !== "COMPLETED"
    && (job.manifest_digest === null || hex.test(job.manifest_digest));
}
function empty(i: Inspection): boolean { return i.database === 0 && i.auth === 0 && i.storage === 0 && i.transport === 0; }

// One fenced checkpoint per invocation. No local polling and no implicit retries.
export async function runCheckpoint(db: Database, manifests: Manifests, provider: Provider): Promise<"idle" | "advanced" | "deferred"> {
  const lease = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const job = await db.claim(lease);
  if (!job) return "idle";
  if (!validJob(job)) throw new Error("invalid_job");
  let stage: Failure = "manifest";
  try {
    if (!job.manifest_digest) {
      const digest = await manifests.save(job);
      if (!hex.test(digest)) throw new Error("manifest_invalid");
      stage = "database";
      await db.step(job, "manifest", digest);
      return "advanced";
    }
    const digest = await manifests.verify(job);
    if (digest !== job.manifest_digest) throw new Error("manifest_mismatch");
    switch (job.state) {
      case "PROCESSING": {
        stage = "storage";
        const before = await db.inspect(job);
        if (before.storage > 0) {
          if (!before.files.length || before.files.length > 50 || before.files.some(f => f.bucket !== before.files[0].bucket)) throw new Error("inventory_invalid");
          await provider.removeFiles(before.files);
          const after = await db.inspect(job);
          if (after.storage >= before.storage) throw new Error("storage_no_progress");
          stage = "database";
          await db.step(job, after.storage === 0 ? "storage" : "yield");
        } else {
          stage = "database";
          await db.step(job, "storage");
        }
        break;
      }
      case "STORAGE_PURGED": stage = "database"; await db.step(job, "database"); break;
      case "DATABASE_PURGED": {
        stage = "database";
        const before = await db.inspect(job);
        if (before.database || before.storage || before.transport) throw new Error("purge_not_verified");
        stage = "auth";
        await provider.removeIdentity(job.user_id);
        if (!await provider.identityAbsent(job.user_id)) throw new Error("auth_remaining");
        stage = "database"; await db.step(job, "auth"); break;
      }
      case "AUTH_PURGED":
      case "VERIFIED":
        stage = "verification";
        if (!empty(await db.inspect(job)) || !await provider.identityAbsent(job.user_id)) throw new Error("data_remaining");
        await db.step(job, job.state === "VERIFIED" ? "complete" : "verify", digest);
        break;
      default: throw new Error("invalid_state");
    }
    return "advanced";
  } catch {
    // A lost lease cannot overwrite the current owner's checkpoint or failure.
    try { await db.fail(job, stage); } catch { /* Lease expiry/recovery is handled by SQL. */ }
    return "deferred";
  }
}
