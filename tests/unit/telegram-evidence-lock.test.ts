import {it,expect,vi} from "vitest";
import {writeEvidence} from "../../scripts/telegram-control-observability";
it("recovers a transient Windows rename lock without repeating work",()=>{
 let n=0;const write=vi.fn(),wait=vi.fn();const rename=vi.fn(()=>{if(n++===0)throw Object.assign(new Error("private path"),{code:"EPERM"});});
 writeEvidence("unique-lock.json",{safe:true},{write,rename,wait});expect(rename).toHaveBeenCalledTimes(2);expect(wait).toHaveBeenCalledTimes(1);expect(JSON.parse(write.mock.calls.at(-1)![1]).evidenceIO.busyRetries).toBe(1);
});
it("stops at three filesystem attempts and never retries unrelated IO failures",()=>{
 for(const code of ["EBUSY","ENOSPC"]){const rename=vi.fn(()=>{throw Object.assign(new Error("private"),{code});});expect(()=>writeEvidence("failure-"+code,{}, {write:()=>{},rename,wait:()=>{}})).toThrow("EVIDENCE_WRITE_FAILED");expect(rename).toHaveBeenCalledTimes(code==="EBUSY"?3:1);}
});
