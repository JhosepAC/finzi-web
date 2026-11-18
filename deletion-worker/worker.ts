import { connectDatabase } from "./database.ts";
import { manifestStore, type ManifestDatabase } from "./manifests.ts";
import { provider } from "./provider.ts";
import { runCheckpoint } from "./protocol.ts";

export interface Env {
  DELETION_ENABLED: string;
  DELETION_DATABASE_URL: string;
  DELETION_MANIFEST_KEY: string;
  DELETION_MANIFESTS: ManifestDatabase;
  SUPABASE_URL: string;
  DELETION_OPERATIONS_KEY: string;
}
export async function scheduledCheckpoint(env: Env): Promise<void> {
  if (env.DELETION_ENABLED !== "true") return;
  // Validate non-SQL adapters before claiming or connecting.
  const custody = await manifestStore(env.DELETION_MANIFESTS, env.DELETION_MANIFEST_KEY);
  const operations = provider(env.SUPABASE_URL, env.DELETION_OPERATIONS_KEY);
  const db = await connectDatabase(env.DELETION_DATABASE_URL);
  try { await runCheckpoint(db, custody, operations); } finally { await db.close(); }
}
const worker = {
  fetch() { return new Response(null, { status: 404 }); },
  async scheduled(_event: unknown, env: Env) {
    try { await scheduledCheckpoint(env); }
    catch { throw new Error("deletion_checkpoint_unavailable"); }
  },
};
export default worker;
