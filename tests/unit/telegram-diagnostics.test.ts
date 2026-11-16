import {BotError,GrammyError,type Context} from "grammy";
import {describe,it,expect} from "vitest";
import {safeDiagnostic} from "../../telegram-bot/diagnostics";
describe("Telegram safe diagnostics",()=>{
 it("reports SQLSTATE and stage without financial payloads, credentials, query or stack",()=>{
  const secret="synthetic-private-message-and-capability";const error=Object.assign(new Error(secret),{code:"42501",query:secret,parameters:[secret],detail:secret,cause:new Error(secret)});
  const result=safeDiagnostic(error,"maintenance");expect(result).toEqual({stage:"maintenance",category:"database",code:"42501"});expect(JSON.stringify(result)).not.toContain(secret);
 });
 it("does not log unknown codes, raw objects or arbitrary error messages",()=>{
  for(const error of [{code:"private-token",message:"private-text"},new Error("private-text"),null,"private-text"]){expect(safeDiagnostic(error,"dispatch")).toEqual({stage:"dispatch",category:"runtime"});}
 });
 it("classifies explicit custody and lease errors without including their stack",()=>{
  expect(safeDiagnostic(new Error("Custody failure"),"custody")).toEqual({stage:"custody",category:"custody"});expect(safeDiagnostic(new Error("Poller lease lost; restart explicitly"),"lease")).toEqual({stage:"lease",category:"lease"});
 });
 it("keeps Telegram status and retry_after but excludes API description, token and outbound message",()=>{
  const secret="synthetic-sensitive-message-token";const error=new GrammyError(secret,{ok:false,error_code:429,description:secret,parameters:{retry_after:5}},"sendMessage",{text:secret,chat_id:123});
  expect(safeDiagnostic(error,"dispatch")).toEqual({stage:"dispatch",category:"telegram",status:429,retryAfter:5});expect(JSON.stringify(safeDiagnostic(error,"dispatch"))).not.toContain(secret);
 });

 it("unwraps BotError without logging the update or context attached by grammY",()=>{
  const error=Object.assign(new Error("synthetic-private-error"),{code:"42501"});const wrapped=new BotError(error,{update:{update_id:123,message:{text:"synthetic-private-update"}}} as unknown as Context);
  expect(safeDiagnostic(wrapped,"dispatch")).toEqual({stage:"dispatch",category:"database",code:"42501"});expect(JSON.stringify(safeDiagnostic(wrapped,"dispatch"))).not.toContain("synthetic-private");
 });

});
