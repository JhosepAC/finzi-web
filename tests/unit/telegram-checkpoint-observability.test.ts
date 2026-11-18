import { describe,it,expect,vi } from "vitest";
import { collectSample,createCheckpoint,type Observation } from "../../scripts/telegram-cpu-checkpoint";
import { checkWindow,cpuCounters,type Sample } from "../../scripts/telegram-cpu-guard";
import { ControlFault,safeFailure,writeEvidence,atStage,providerOutput,diagnosticRows } from "../../scripts/telegram-control-observability";
const a:Sample={at:0,total:100,idle:90,calls:10,reset:"same",unsafe:false};
const b:Sample={...a,at:61000,total:200,idle:189};
const secret="SECRET_TOKEN_JWT_PASSWORD_SQL_PAYLOAD";
const metrics='node_cpu_seconds_total{mode="idle"} 189\nnode_cpu_seconds_total{mode="user"} 11';
describe("safe checkpoint observability without network",()=>{
 it.each([{status:null,error:{code:"ETIMEDOUT"},code:"DIAGNOSTIC_TIMEOUT"},{status:2,code:"DIAGNOSTIC_EXIT"}])("classifies actual provider result fields",input=>{
  try{providerOutput({...input,stdout:secret});throw new Error("Expected failure");}catch(error){const safe=safeFailure(error,"diagnostics.spawn");expect(safe.code).toBe(input.code);expect(JSON.stringify(safe)).not.toContain(secret);}
 });
 it.each([secret,'{}','{"rows":null}'])("classifies malformed provider JSON safely",raw=>{
  try{diagnosticRows(raw);throw new Error("Expected failure");}catch(error){expect(safeFailure(error,"diagnostics.parse").code).toBe("DIAGNOSTIC_JSON_INVALID");}
 });
 it("accepts valid provider output without extra requests",()=>expect(diagnosticRows(providerOutput({status:0,stdout:'{"rows":[{"calls":10}]}'}))).toEqual([{calls:10}]));
 it.each([
  [{at:1},"SAMPLE_TOO_SHORT"],[{total:100},"CPU_COUNTER_STALLED"],[{idle:89},"CPU_IDLE_REGRESSED"],
  [{reset:"different"},"STATS_RESET"],[{calls:9},"RPC_COUNTER_REGRESSED"],[{unsafe:true},"AUTHENTICATOR_ACTIVITY"],
  [{total:NaN},"CPU_INVALID"],[{idle:201},"CPU_INVALID"],[{idle:180},"CPU_LIMIT"],[{idle:179},"CPU_LIMIT"],[{calls:11},"RPC_CALL_EXCESS"]
 ] as const)("retains exact guard reason %j",(change,code)=>{
  try{checkWindow(a,{...b,...change},0);throw new Error("Expected rejection");}catch(error){expect(safeFailure(error,"window.validate")).toMatchObject({code,stage:"window.validate"});}
 });
 it("preserves success threshold and expected RPC delta",()=>expect(checkWindow(a,{...b,calls:12},2)).toBeCloseTo(1));
 it.each([["","METRICS_MISSING"],['node_cpu_seconds_total{mode="idle"} NaN',"METRICS_INVALID"],['node_cpu_seconds_total{x="a"} 1',"METRICS_INVALID"]])("distinguishes parsing failure",(text,code)=>{
  try{cpuCounters(text);}catch(error){expect(safeFailure(error,"metrics.parse").code).toBe(code);return;}throw new Error("Expected failure");
 });
 function collector(overrides:Partial<Parameters<typeof collectSample>[0]>={}){
  return collectSample({fetchMetrics:async()=>new Response(metrics),diagnostics:()=>({calls:"10",reset:"same",unsafe:false}),now:()=>61000,progress:()=>{},...overrides});
 }
 it("collects a valid sample",async()=>expect(await collector()).toEqual(b));
 it.each([{calls:null,reset:"same",unsafe:false},{calls:"bad",reset:"same",unsafe:false},{calls:1,reset:123,unsafe:false},{calls:1,reset:"same",unsafe:"secret"}])("rejects malformed diagnostic row",async row=>{
  await expect(collector({diagnostics:()=>row})).rejects.toMatchObject({code:"SAMPLE_INVALID"});
 });
 it("preserves partial numeric telemetry when diagnostics fail",async()=>{
  const progress=vi.fn();await expect(collector({progress,diagnostics:()=>{throw new Error(secret);}})).rejects.toMatchObject({code:"DIAGNOSTIC_EXIT"});
  expect(progress).toHaveBeenCalledWith("diagnostics.spawn",{total:200,idle:189});expect(JSON.stringify(progress.mock.calls)).not.toContain(secret);
 });
 it.each([
  ["network",{fetchMetrics:async()=>{throw new Error(secret);}},"metrics.fetch","METRICS_UNAVAILABLE"],
  ["timeout",{fetchMetrics:async()=>{throw Object.assign(new Error(secret),{name:"TimeoutError"});}},"metrics.fetch","METRICS_TIMEOUT"],
  ["http",{fetchMetrics:async()=>new Response(secret,{status:503})},"metrics.status","METRICS_UNAVAILABLE"],
  ["body",{fetchMetrics:async()=>({ok:true,text:async()=>{throw new Error(secret);}} as unknown as Response)},"metrics.body","METRICS_UNAVAILABLE"],
  ["parse",{fetchMetrics:async()=>new Response(secret)},"metrics.parse","METRICS_MISSING"],
  ["cli",{diagnostics:():unknown=>{throw new Error(secret);}},"diagnostics.spawn","DIAGNOSTIC_EXIT"],
  ["json",{diagnostics:():unknown=>{throw new ControlFault("diagnostics.parse","DIAGNOSTIC_JSON_INVALID");}},"diagnostics.parse","DIAGNOSTIC_JSON_INVALID"],
  ["shape",{diagnostics:():unknown=>undefined},"sample.validate","SAMPLE_INVALID"]
 ] as const)("sanitizes collector %s",async(_label,overrides,stage,code)=>{
  try{await collector(overrides);throw new Error("Expected failure");}catch(error){const safe=safeFailure(error,"sample.validate");expect(safe).toMatchObject({stage,code});expect(JSON.stringify(safe)).not.toContain(secret);}
 });
 it.each(["DIAGNOSTIC_TIMEOUT","DIAGNOSTIC_EXIT","DIAGNOSTIC_JSON_INVALID"] as const)("preserves nested classified error %s",async code=>{
  await expect(atStage("diagnostics.spawn","UNKNOWN",()=>{throw new ControlFault("diagnostics.parse",code);})).rejects.toMatchObject({code});
 });
 it("records rejected sample before stopping; no retry or continuation",async()=>{
  const emitted:Observation[]=[];let now=0;
  const sample=vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce({...b,idle:180,reset:secret});
  const checkpoint=createCheckpoint({sample,now:()=>now,rpc:()=>0,wait:async ms=>{now+=ms;},budget:()=>{},emit:o=>emitted.push(o)});
  const continuation=vi.fn();await expect(checkpoint().then(continuation)).rejects.toBeInstanceOf(ControlFault);
  expect(continuation).not.toHaveBeenCalled();expect(sample).toHaveBeenCalledTimes(2);
  expect(emitted.at(-1)).toMatchObject({status:"rejected",code:"STATS_RESET",previous:{total:100},next:{total:200},resetChanged:true});
  expect(JSON.stringify(emitted)).not.toContain(secret);expect(emitted.some(o=>o.status==="accepted")).toBe(false);
 });
 it("records accepted window and required wait",async()=>{
  const emitted:Observation[]=[];const wait=vi.fn(async()=>{});const sample=vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
  await createCheckpoint({sample,now:()=>0,rpc:()=>0,wait,budget:()=>{},emit:o=>emitted.push(o)})();
  expect(wait).toHaveBeenCalledWith(61000);expect(emitted.at(-1)).toMatchObject({status:"accepted",percent:expect.any(Number)});
 });
 it("reuses the last accepted baseline without resampling or retry",async()=>{
  let now=0;const sample=vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce({...b,at:122000,total:300,idle:288});
  const emit=vi.fn();const checkpoint=createCheckpoint({sample,now:()=>now,rpc:()=>0,wait:async ms=>{now+=ms;},budget:()=>{},emit});
  await checkpoint();await checkpoint();expect(sample).toHaveBeenCalledTimes(3);expect(emit.mock.calls.filter(([o])=>o.status==="accepted")).toHaveLength(2);
 });
 it.each(["initial","next","wait","budget","persistence"])("stops on checkpoint %s error",async phase=>{
  let calls=0;const emitted:Observation[]=[];
  const checkpoint=createCheckpoint({sample:async()=>{calls++;if((phase==="initial"&&calls===1)||(phase==="next"&&calls===2))throw new ControlFault("metrics.fetch","METRICS_TIMEOUT");return calls===1?a:b;},
   now:()=>0,rpc:()=>0,wait:async()=>{if(phase==="wait")throw new Error(secret);},budget:()=>{if(phase==="budget")throw new Error(secret);},
   emit:o=>{if(phase==="persistence")throw new ControlFault("evidence.write","EVIDENCE_WRITE_FAILED");emitted.push(o);}});
  await expect(checkpoint()).rejects.toBeInstanceOf(Error);expect(calls).toBeLessThanOrEqual(2);expect(emitted.some(o=>o.status==="accepted")).toBe(false);expect(JSON.stringify(emitted)).not.toContain(secret);
 });
 it("projects errors instead of serializing arbitrary code/cause/message/stack",()=>{
  const safe=safeFailure(Object.assign(new Error(secret),{code:secret,cause:{password:secret},stdout:secret}),"scenario.work");
  expect(safe).toEqual({stage:"scenario.work",code:"UNKNOWN",safeCause:"unclassified_failure"});expect(JSON.stringify(safe)).not.toContain(secret);
  expect(safeFailure(new ControlFault("metrics.status","METRICS_UNAVAILABLE",{httpStatus:503,exitCode:NaN,password:123}),"scenario.work")).toEqual({stage:"metrics.status",code:"METRICS_UNAVAILABLE",safeCause:"metrics_request_unavailable",httpStatus:503});
 });
 it("writes through temp/rename and stops safely on IO failures",()=>{
  const write=vi.fn(),rename=vi.fn();writeEvidence("local-run.json",{safe:true},{write,rename});expect(rename).toHaveBeenCalledWith("local-run.json.tmp","local-run.json");
  for(const phase of ["write","rename"]){expect(()=>writeEvidence("local-run.json",{}, {write:()=>{if(phase==="write")throw new Error(secret);},rename:()=>{if(phase==="rename")throw new Error(secret);}})).toThrow("EVIDENCE_WRITE_FAILED");}
 });
});
