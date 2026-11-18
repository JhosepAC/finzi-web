import { ControlFault } from "./telegram-control-observability.ts";
export type Sample = { at: number; total: number; idle: number; calls: number; reset: string; unsafe: boolean };
export function checkWindow(a: Sample,b: Sample,expectedCalls: number) {
 if(b.at-a.at<60000)throw new ControlFault("window.validate","SAMPLE_TOO_SHORT");
 if(b.total<=a.total)throw new ControlFault("window.validate","CPU_COUNTER_STALLED");
 if(b.idle<a.idle)throw new ControlFault("window.validate","CPU_IDLE_REGRESSED");
 if(b.reset!==a.reset)throw new ControlFault("window.validate","STATS_RESET");
 if(b.calls<a.calls)throw new ControlFault("window.validate","RPC_COUNTER_REGRESSED");
 if(b.unsafe)throw new ControlFault("window.validate","AUTHENTICATOR_ACTIVITY");
 const percent=100*(1-(b.idle-a.idle)/(b.total-a.total));
 if(!Number.isFinite(percent)||percent<0)throw new ControlFault("window.validate","CPU_INVALID");
 if((b.idle-a.idle)<=(b.total-a.total)*0.9)throw new ControlFault("window.validate","CPU_LIMIT");
 if(b.calls-a.calls>expectedCalls)throw new ControlFault("window.validate","RPC_CALL_EXCESS");
 return percent;
}
export function cpuCounters(text:string){
 const sums={total:0,idle:0};let count=0;
 for(const line of text.split("\n")){
  if(!line.startsWith("node_cpu_seconds_total{"))continue;
  const mode=/mode="([^"]+)"/.exec(line)?.[1], value=Number(line.split(/\s+/)[1]);
  if(!mode||!Number.isFinite(value))throw new ControlFault("metrics.parse","METRICS_INVALID");
  if(mode==="guest"||mode==="guest_nice")continue;
  count++;sums.total+=value;if(mode==="idle")sums.idle+=value;
 }
 if(!count||!sums.idle)throw new ControlFault("metrics.parse","METRICS_MISSING");return sums;
}
