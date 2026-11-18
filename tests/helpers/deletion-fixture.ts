import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { runSupabase } from "../../scripts/supabase-cli.mjs";
import { processDeletion, localQuery, type Store } from "../../scripts/deletion-worker.mjs";
import { fixtureSql } from "./telegram-transport";

// Scoped adapter for the actual local protocol. Never run a global queue in an E2E fixture.
export async function completeSyntheticDeletion(id: string, store: Pick<Store,"save">) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("invalid_fixture_receipt");
  const local = JSON.parse(runSupabase(["status","-o","json"]));
  if (!["127.0.0.1","localhost"].includes(new URL(local.API_URL).hostname)) throw new Error("local_only");
  const lease = randomBytes(32).toString("hex"), digest = createHash("sha256").update(lease).digest("hex");
  const job = JSON.parse(fixtureSql(`update ops.deletion_receipts r set lease_hash=decode('${digest}','hex'),lease_until=clock_timestamp()+interval '2 minutes' from ops.deletion_subjects s join auth.users u on u.id=s.user_id where r.id='${id}' and s.receipt_id=r.id and u.email like '%@example.test' and r.completed_at is null and not exists(select 1 from ops.cloud_deletion_jobs c where c.receipt_id=r.id) returning json_build_object('id',r.id,'user_id',s.user_id,'tracking_hash',encode(r.tracking_hash,'hex'),'lease','${lease}');`));
  const client=createClient(local.API_URL,local.SECRET_KEY??local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  let stage="manifest";
  const completed=await processDeletion(job,{
    manifest:()=>store.save(job),
    step:(_job:object,action:string,value:unknown=null)=>{if(value!==null&&(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value)))throw new Error("invalid_digest");return localQuery(`select to_jsonb(ops.deletion_step('${id}','${lease}','${action}',${value?`'${value}'`:"null"}))`);},
    async purgeFiles(owner:string){stage="storage";if(owner!==job.user_id)throw new Error("fixture_owner_mismatch");const bucket=client.storage.from("category-images"),listed=await bucket.list(owner,{limit:1000});if(listed.error)throw new Error("storage_error");const paths=(listed.data??[]).filter(v=>v.id).map(v=>`${owner}/${v.name}`);if(paths.length&&(await bucket.remove(paths)).error)throw new Error("storage_error");stage="database_purge";},
    async deleteIdentity(owner:string){stage="auth";if(owner!==job.user_id)throw new Error("fixture_owner_mismatch");if((await client.auth.admin.deleteUser(owner)).error)throw new Error("auth_error");stage="complete";}
  });
  if(!completed)throw new Error("synthetic_deletion_failed_at_"+stage);
  return {completed:1,retries:0};
}
