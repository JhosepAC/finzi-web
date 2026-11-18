import { writeFileSync, renameSync } from "node:fs";
export const causes = {
 UNKNOWN:"unclassified_failure", METRICS_TIMEOUT:"metrics_request_timeout", METRICS_UNAVAILABLE:"metrics_request_unavailable", METRICS_INVALID:"metrics_body_invalid", METRICS_MISSING:"metrics_counters_missing",
 DIAGNOSTIC_TIMEOUT:"diagnostic_process_timeout", DIAGNOSTIC_EXIT:"diagnostic_process_failed", DIAGNOSTIC_JSON_INVALID:"diagnostic_response_invalid", SAMPLE_INVALID:"diagnostic_sample_invalid",
 SAMPLE_TOO_SHORT:"observation_interval_too_short", CPU_COUNTER_STALLED:"cpu_counter_not_advanced", CPU_IDLE_REGRESSED:"idle_counter_regressed", STATS_RESET:"statistics_reset_changed", RPC_COUNTER_REGRESSED:"rpc_counter_regressed", AUTHENTICATOR_ACTIVITY:"authenticator_not_idle", CPU_INVALID:"cpu_ratio_invalid", CPU_LIMIT:"cpu_at_or_above_limit", RPC_CALL_EXCESS:"observed_calls_exceed_expected", EVIDENCE_WRITE_FAILED:"local_evidence_write_failed", BUDGET_STOP:"execution_budget_reached"
} as const;
export type Code=keyof typeof causes;
const stages=["checkpoint.wait","metrics.fetch","metrics.status","metrics.body","metrics.parse","diagnostics.spawn","diagnostics.status","diagnostics.parse","sample.validate","window.validate","evidence.write","scenario.work","scenario.validate"] as const;
export type Stage=typeof stages[number];
export class ControlFault extends Error {
 readonly stage:Stage;readonly code:Code;readonly details:Record<string,number>;
 constructor(stage:Stage,code:Code,details:Record<string,number>={}) {super(code);this.name="ControlFault";this.stage=stage;this.code=code;this.details=details;}
}
export function safeFailure(error:unknown,stage:Stage){
 const fault=error instanceof ControlFault?error:undefined;
 const code=fault&&Object.hasOwn(causes,fault.code)?fault.code:"UNKNOWN";
 const safeStage=fault&&stages.includes(fault.stage)?fault.stage:stage;
 const details:Record<string,number>={};
 for(const key of ["httpStatus","exitCode"]) {const v=fault?.details[key];if(typeof v==="number"&&Number.isFinite(v))details[key]=v;}
 return {stage:safeStage,code,safeCause:causes[code],...details};
}
export async function atStage<T>(stage:Stage,code:Code,work:()=>Promise<T>|T):Promise<T>{
 try{return await work();}catch(error){if(error instanceof ControlFault)throw error;
 const timeout=(error as {name?:unknown})?.name==="TimeoutError";
 throw new ControlFault(stage,timeout&&stage==="metrics.fetch"?"METRICS_TIMEOUT":code);
 }
}
type EvidenceIO={write:(path:string,text:string)=>void;rename:(from:string,to:string)=>void;wait?:()=>void};
const busyRetries=new Map<string,number>();
export function writeEvidence(path:string,data:unknown,io:EvidenceIO={write:(p,s)=>writeFileSync(p,s,{mode:0o600}),rename:(a,b)=>renameSync(a,b),wait:()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}}){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const snapshot=data&&typeof data==="object"&&!Array.isArray(data)?{...data,evidenceIO:{busyRetries:busyRetries.get(path)??0}}:data;
   io.write(path+".tmp",JSON.stringify(snapshot,null,2));io.rename(path+".tmp",path);return;
  }catch(error){
   const code=(error as {code?:unknown})?.code;
   const busy=code==="EPERM"||code==="EBUSY"||code==="EACCES";
   if(!busy||attempt===2)throw new ControlFault("evidence.write","EVIDENCE_WRITE_FAILED");
   busyRetries.set(path,(busyRetries.get(path)??0)+1);io.wait?.();
  }
 }
}

export function providerOutput(result:{status:number|null;stdout:string;error?:{code?:unknown}}){
 if(result.error?.code==="ETIMEDOUT")throw new ControlFault("diagnostics.spawn","DIAGNOSTIC_TIMEOUT");
 if(result.status!==0)throw new ControlFault("diagnostics.status","DIAGNOSTIC_EXIT",typeof result.status==="number"?{exitCode:result.status}:{});
 return result.stdout;
}
export function diagnosticRows(raw:string):Record<string,unknown>[]{
 try{const parsed=JSON.parse(raw);if(!Array.isArray(parsed.rows))throw new Error();return parsed.rows;}
 catch{throw new ControlFault("diagnostics.parse","DIAGNOSTIC_JSON_INVALID");}
}
