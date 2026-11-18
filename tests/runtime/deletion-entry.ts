// Local workerd fixture only; no production config references this entrypoint.
import production, { type Env } from "../../deletion-worker/worker.ts";
import { manifestStore, type ManifestDatabase } from "../../deletion-worker/manifests.ts";
import { type Job } from "../../deletion-worker/protocol.ts";
const job: Job = { id: "69000000-0000-4000-8000-000000000001", user_id: "69000000-0000-4000-8000-000000000002", tracking_hash: "b".repeat(64), lease: "c".repeat(64), state: "PROCESSING", manifest_digest: null };
const fixture = {
  async fetch(request: Request, env: Env & { DELETION_MANIFESTS: ManifestDatabase & { exec(sql: string): Promise<unknown> } }) {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || env.DELETION_MANIFEST_KEY !== "e".repeat(64) || env.DELETION_ENABLED !== "false") return production.fetch();
    if (path === "/__scheduled_disabled") { await production.scheduled({}, env); return new Response(null, { status: 204 }); }
    if (path === "/__save" || path === "/__verify") {
      const store = await manifestStore(env.DELETION_MANIFESTS, env.DELETION_MANIFEST_KEY);
      const digest = path === "/__save" ? await store.save(job) : await store.verify(job);
      const row = await env.DELETION_MANIFESTS.withSession("first-primary").prepare("SELECT envelope FROM deletion_manifests WHERE request_id=?").bind(job.id).first<{ envelope: string }>();
      return Response.json({ digest, plaintextPresent: !!row?.envelope.includes(job.user_id) || !!row?.envelope.includes(job.tracking_hash) });
    }
    if (path === "/__mutate") {
      try { await env.DELETION_MANIFESTS.exec("UPDATE deletion_manifests SET envelope='{}'"); return new Response(null, { status: 500 }); }
      catch { return new Response(null, { status: 409 }); }
    }
    return production.fetch();
  },
};
export default fixture;
