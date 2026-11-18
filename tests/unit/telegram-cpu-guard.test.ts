import { describe, expect, it } from "vitest";
import { checkWindow, cpuCounters } from "../../scripts/telegram-cpu-guard";
const a={at:0,total:100,idle:90,calls:10,reset:"same",unsafe:false};
describe("mandatory CPU admission",()=>{
 it("admits low CPU with only expected calls",()=>expect(checkWindow(a,{...a,at:61000,total:200,idle:189,calls:12},2)).toBeCloseTo(1));
 it.each([{total:200,idle:180},{calls:99},{reset:"reset"},{unsafe:true},{at:100},{total:100}])("stops on anomaly %j",change=>expect(()=>checkWindow(a,{...a,at:61000,total:200,idle:189,...change},0)).toThrow());
 it("rejects absent or malformed telemetry",()=>{expect(()=>cpuCounters("unavailable")).toThrow();expect(()=>cpuCounters('node_cpu_seconds_total{mode="idle"} NaN')).toThrow();});
 it("excludes guest counters",()=>expect(cpuCounters('node_cpu_seconds_total{mode="idle"} 90\nnode_cpu_seconds_total{mode="user"} 10\nnode_cpu_seconds_total{mode="guest"} 200')).toEqual({total:100,idle:90}));
});
