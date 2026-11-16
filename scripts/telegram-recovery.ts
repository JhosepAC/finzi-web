import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

export function recoverySql(apply:boolean,userId?:string){
 if(userId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))throw new Error("Invalid synthetic user");
 const filter=userId?`user_id='${userId}'`:"true";
 const counts=`select json_build_object('links',(select count(*) from telegram_private.links where ${filter} and revoked_at is null),'drafts',(select count(*) from telegram_private.drafts where ${filter} and state in ('needs_input','pending')),'queries',(select count(*) from telegram_private.query_sessions where ${filter}));`;
 if(!apply)return counts;
 const guard=userId?`if not exists(select 1 from auth.users where id='${userId}' and email like 'telegram-%@example.test') then raise exception 'Synthetic user required';end if;`:
  `if exists(select 1 from pg_roles where rolname='finzi_telegram_gateway' and rolcanlogin) or exists(select 1 from pg_stat_activity where usename='finzi_telegram_gateway') then raise exception 'Disable login and stop the gateway first';end if;`;
 return `begin;
 set local lock_timeout='5s';
 set local statement_timeout='30s';
 select pg_advisory_xact_lock(hashtextextended('finzi-telegram-recovery',0));
 do $$begin ${guard} end $$;
 lock table telegram_private.links,telegram_private.link_attempts,telegram_private.drafts,telegram_private.callbacks,telegram_private.query_sessions in share row exclusive mode;
 update telegram_private.links set revoked_at=clock_timestamp(),version=version+1 where ${filter} and revoked_at is null;
 update telegram_private.drafts set state='cancelled',source_text=null,payload='{}',awaiting_field=null,terminal_at=clock_timestamp(),version=version+1 where ${filter} and state in ('needs_input','pending');
 delete from telegram_private.link_attempts where ${filter};
 delete from telegram_private.callbacks where ${filter};
 delete from telegram_private.query_sessions where ${filter};
 ${counts}
 commit;`;
}
export function recoveryOptions(args:string[]){
 const user=args.find(a=>a.startsWith('--synthetic-user='))?.slice('--synthetic-user='.length);
 if(args.some(a=>a!=='--apply'&&a!=='--confirm=INVALIDATE_TELEGRAM_LINKS'&&!a.startsWith('--synthetic-user='))||args.filter(a=>a.startsWith('--synthetic-user=')).length>1)throw new Error("Unknown recovery option");
 const apply=args.includes('--apply');if(apply!==args.includes('--confirm=INVALIDATE_TELEGRAM_LINKS'))throw new Error("Explicit recovery confirmation required");
 recoverySql(false,user);return {apply,user};
}
function main(){try{
 const options=recoveryOptions(process.argv.slice(2));
 const result=execFileSync('docker',['exec','-i','supabase_db_finzi-auth','psql','-U','supabase_admin','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],{input:recoverySql(options.apply,options.user),encoding:'utf8',stdio:['pipe','pipe','pipe']});
 // Emit counts only; subprocess errors and SQL never reach the console.
 const summary=JSON.parse(result.trim().split('\n').filter(Boolean).at(-1)!);
 console.log(JSON.stringify({mode:options.apply?'applied':'preview',...summary}));
}catch{console.error('Recovery was not completed. Check confirmation, offline gateway and local database. No credentials were logged.');process.exitCode=1;}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
