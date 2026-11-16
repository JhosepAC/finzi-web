import type { Update } from "grammy/types";
import type { State } from "./store.ts";
export async function drain(store:{state:State;save:()=>void},handle:(update:Update)=>Promise<void>) {
 while(store.state.inbox.length) { await handle(store.state.inbox[0]);const done=store.state.inbox.shift()!;try{store.save();}catch(error){store.state.inbox.unshift(done);throw error;} }
}
export function receive(store:{state:State;save:()=>void},updates:Update[]) {
 if(!updates.length)return;
 if(updates.some(u=>!Number.isSafeInteger(u.update_id)||u.update_id<0))throw new Error("Unsafe update identity");
 if(store.state.inbox.length)throw new Error("Drain durable inbox before polling");
 const offset=store.state.offset;store.state.inbox=updates;store.state.offset=updates.at(-1)!.update_id+1;
 try{store.save();}catch(error){store.state.inbox=[];store.state.offset=offset;throw error;} // Persist encrypted input before the next getUpdates acknowledges this offset.
}
