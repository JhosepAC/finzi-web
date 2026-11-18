import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { runSupabase } from "./supabase-cli.mjs";
const ref="mkzclztzyqdmftesnwcw";
assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"deployment/staging");
const query=readFileSync("infrastructure/supabase/catalog.sql","utf8");
let remote,local;
try {
 remote=JSON.parse(runSupabase(["db","query",`--remote=${ref}`,"--read-only","--file","infrastructure/supabase/catalog.sql","--output-format","json"])).rows.find(r=>r.catalog).catalog;
 const output=execFileSync("docker",["exec","supabase_db_finzi-auth","psql","-U","supabase_admin","-d","postgres","-At","-c",query],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 local=JSON.parse(output.slice(output.indexOf("{")));
} catch { throw new Error("Metadata comparison failed; raw connection output suppressed"); }
const directory="docs/deployment/evidence";
writeFileSync(`${directory}/phase2-remote-catalog.json`,JSON.stringify(remote,null,2));
writeFileSync(`${directory}/phase2-local-catalog.json`,JSON.stringify(local,null,2));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
const normalize=x=>{
 const result=JSON.parse(JSON.stringify(x).replaceAll("supabase_admin","postgres"));
 for(const table of result.tables) if(table.acl) {
  const grouped=new Map();
  for(const entry of table.acl.slice(1,-1).split(",")) {
   const [grantee,rights]=entry.split("="),[privileges,grantor]=rights.split("/");
   assert(!privileges.includes("*"),"Unreviewed grant option in table ACL");
   const key=grantee+"/"+grantor;
   grouped.set(key,[...new Set([...(grouped.get(key)??""),...privileges])].sort().join(""));
  }
  table.acl=[...grouped].map(([k,v])=>k+"="+v).sort().join(",");
 }
 return canonical(result);
};
const a=normalize(remote),b=normalize(local),differences={};
for(const key of Object.keys(a)) {
 if(JSON.stringify(a[key])===JSON.stringify(b[key]))continue;
 if(Array.isArray(a[key])&&Array.isArray(b[key])) {
  const aa=new Set(a[key].map(v=>JSON.stringify(v))),bb=new Set(b[key].map(v=>JSON.stringify(v)));
  const x={remoteOnly:[...aa].filter(v=>!bb.has(v)).map(v=>JSON.parse(v)),localOnly:[...bb].filter(v=>!aa.has(v)).map(v=>JSON.parse(v))};
  if(x.remoteOnly.length||x.localOnly.length)differences[key]=x;
 } else differences[key]={remote:a[key],local:b[key]};
}
writeFileSync(`${directory}/phase2-catalog-differences.json`,JSON.stringify(differences,null,2));
for(const role of remote.roles)assert(!role.super&&!role.bypass&&!role.inherit&&!role.create_role&&!role.create_db,"Excess runtime role privilege");
for(const table of remote.tables.filter(t=>["r","p"].includes(t.kind)&&t.name!=="currencies")) {
 assert(table.rls&&table.force,"Tenant table without forced RLS");
 assert(!remote.roles.some(r=>r.name===table.owner),"Runtime owns a table");
}
for(const fn of remote.functions) {
 assert(fn.acl!==null,"Implicit PUBLIC EXECUTE default requires review");
 assert(!fn.definer||fn.config?.includes('search_path=""'),"Definer lacks empty search_path");
 assert(!/(?:\{|,)=X\//.test(fn.acl??""),"PUBLIC EXECUTE present");
}
assert.deepEqual(Object.keys(differences),["memberships"],"Unexpected schema/runtime difference: stop for review");
assert.equal(remote.memberships.length,3);
for(const membership of remote.memberships)assert(membership.member==="postgres"&&membership.admin&&!membership.inherit&&!membership.set,"Unexpected managed role membership");
console.log(JSON.stringify({counts:Object.fromEntries(Object.entries(remote).map(([k,v])=>[k,v?.length??0])),differenceCategories:Object.keys(differences)}));
