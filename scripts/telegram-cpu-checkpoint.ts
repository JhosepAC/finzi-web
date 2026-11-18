import { cpuCounters,checkWindow,type Sample } from "./telegram-cpu-guard.ts";
import { atStage,ControlFault,safeFailure,type Stage } from "./telegram-control-observability.ts";
export type Observation={status:"progress"|"accepted"|"rejected"|"suspended";stage:Stage;at:number;code?:string;safeCause?:string;previous?:Record<string,number|boolean>;next?:Record<string,number|boolean>;resetChanged?:boolean;expectedCalls?:number;percent?:number;metrics?:{total:number;idle:number};recovery?:boolean};
function view(s:Sample|undefined){if(!s)return undefined;const out:Record<string,number|boolean>={unsafe:s.unsafe===true};for(const k of ["at","total","idle","calls"] as const)if(typeof s[k]==="number"&&Number.isFinite(s[k]))out[k]=s[k];return out;}
export async function collectSample(io:{fetchMetrics:()=>Promise<Response>;diagnostics:()=>unknown;now:()=>number;progress:(stage:Stage,metrics?:{total:number;idle:number})=>void}):Promise<Sample>{
 io.progress("metrics.fetch");const response=await atStage("metrics.fetch","METRICS_UNAVAILABLE",io.fetchMetrics);
 io.progress("metrics.status");if(!response.ok)throw new ControlFault("metrics.status","METRICS_UNAVAILABLE",{httpStatus:response.status});
 io.progress("metrics.body");const text=await atStage("metrics.body","METRICS_UNAVAILABLE",()=>response.text());
 io.progress("metrics.parse");const counters=cpuCounters(text);
 io.progress("diagnostics.spawn",counters);const row=await atStage("diagnostics.spawn","DIAGNOSTIC_EXIT",io.diagnostics) as Record<string,unknown>|undefined;
 io.progress("sample.validate");if(!row||!Number.isFinite(Number(row.calls))||row.calls===null||typeof row.reset!=="string"||typeof row.unsafe!=="boolean")throw new ControlFault("sample.validate","SAMPLE_INVALID");
 return {at:io.now(),...counters,calls:Number(row.calls),reset:row.reset,unsafe:row.unsafe};
}
export function createCheckpoint(io:{sample:()=>Promise<Sample>;rpc:()=>number;now:()=>number;wait:(ms:number)=>Promise<void>;budget:()=>void;emit:(o:Observation)=>void;maxCpuPauses?:number}){
 let previous:Sample|undefined,previousRpc=0,pauses=0;
 return async()=>{
 let stage:Stage="sample.validate",next:Sample|undefined,expected:number|undefined,recovery=0,reported=false;
 const progress=(s:Stage)=>{stage=s;io.emit({status:"progress",stage:s,at:io.now()});};
 try{
  if(!previous){progress("sample.validate");previous=await io.sample();previousRpc=io.rpc();}
  for(;;){
   reported=false;
   progress("checkpoint.wait");await atStage(stage,"UNKNOWN",()=>io.wait(Math.max(0,61000-(io.now()-previous!.at))));
   await atStage(stage,"BUDGET_STOP",io.budget);
   progress("sample.validate");next=await io.sample();expected=io.rpc()-previousRpc;
   progress("window.validate");let percent:number;
   try{percent=checkWindow(previous,next,expected);}catch(error){
    const failure=safeFailure(error,stage);
    io.emit({status:"rejected",...failure,at:io.now(),previous:view(previous),next:view(next),resetChanged:previous.reset!==next.reset,expectedCalls:expected});reported=true;
    // Never mask simultaneous RPC growth, resets, permissions or invalid metrics.
    if(failure.code!=="CPU_LIMIT"||next.calls-previous.calls>expected||pauses>=(io.maxCpuPauses??0))throw error;
    pauses++;recovery=2;
    io.emit({status:"suspended",...failure,at:io.now(),previous:view(previous),next:view(next),expectedCalls:expected});
    previous=next;previousRpc=io.rpc();continue;
   }
   io.emit({status:"accepted",stage,at:io.now(),previous:view(previous),next:view(next),resetChanged:previous.reset!==next.reset,expectedCalls:expected,percent,recovery:recovery>0});
   previous=next;previousRpc=io.rpc();
   if(recovery>0){recovery--;if(recovery>0)continue;}
   return;
  }
 }catch(error){if(!reported){const failure=safeFailure(error,stage);io.emit({status:"rejected",...failure,at:io.now(),previous:view(previous),next:view(next),resetChanged:previous&&next?previous.reset!==next.reset:undefined,expectedCalls:expected});}throw error;}
 };
}
