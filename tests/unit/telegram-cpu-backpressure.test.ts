import {it,expect,vi} from "vitest";
import {createCheckpoint,type Observation} from "../../scripts/telegram-cpu-checkpoint";
import type {Sample} from "../../scripts/telegram-cpu-guard";
const base:Sample={at:0,total:100,idle:90,calls:10,reset:"same",unsafe:false};
it("suspends work and requires two low windows, preserving the rejected window",async()=>{
 const observations:Observation[]=[];let n=0;const sample=vi.fn(async()=>{const i=n++;return {...base,at:i*61000,total:100+i*100,idle:i===0?90:i===1?175:175+(i-1)*99};});
 const continuation=vi.fn();await createCheckpoint({sample,rpc:()=>0,now:()=>0,wait:async()=>{},budget:()=>{},emit:o=>observations.push(o),maxCpuPauses:3})().then(continuation);
 expect(sample).toHaveBeenCalledTimes(4);expect(continuation).toHaveBeenCalledTimes(1);
 expect(observations.filter(o=>o.status==="rejected")).toHaveLength(1);expect(observations.filter(o=>o.status==="suspended")).toHaveLength(1);expect(observations.filter(o=>o.status==="accepted"&&o.recovery)).toHaveLength(2);
});
it("never resumes on CPU plus excess RPCs",async()=>{
 let n=0;const sample=vi.fn(async()=>n++===0?base:{...base,at:61000,total:200,idle:175,calls:11});
 await expect(createCheckpoint({sample,rpc:()=>0,now:()=>0,wait:async()=>{},budget:()=>{},emit:()=>{},maxCpuPauses:3})()).rejects.toMatchObject({code:"CPU_LIMIT"});expect(sample).toHaveBeenCalledTimes(2);
});
it("limits pauses across repeated hot windows",async()=>{
 let n=0;const sample=vi.fn(async()=>{const i=n++;return {...base,at:i*61000,total:100+i*100,idle:90+i*85};});
 await expect(createCheckpoint({sample,rpc:()=>0,now:()=>0,wait:async()=>{},budget:()=>{},emit:()=>{},maxCpuPauses:3})()).rejects.toMatchObject({code:"CPU_LIMIT"});expect(sample).toHaveBeenCalledTimes(5);
});
