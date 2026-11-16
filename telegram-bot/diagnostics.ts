import { BotError,GrammyError } from "grammy";
export type RuntimeStage="configuration"|"identity"|"custody"|"lease"|"commands"|"dispatch"|"maintenance"|"polling";
const sqlCodes=new Set(["42501","40001","23514","23505","23503","P0002","22008","22P02","54000","22003","57014","40P01","08000","08003","08006","57P01","42883"]);
// Only allowlisted structural fields leave this boundary. Never stringify an Error,
// its SQL/parameters, Telegram payload, description, stack or underlying cause.
export function safeDiagnostic(error:unknown,stage:RuntimeStage){
 const cause=error instanceof BotError?error.error:error;
 if(cause instanceof GrammyError){return {stage,category:"telegram",status:cause.error_code,retryAfter:Number.isSafeInteger(cause.parameters.retry_after)?cause.parameters.retry_after:undefined};}
 const code=(cause as {code?:unknown}|null)?.code;
 if(typeof code==="string"&&sqlCodes.has(code))return {stage,category:"database",code};
 if(cause instanceof Error&&cause.message==="Custody failure")return {stage,category:"custody"};
 if(cause instanceof Error&&cause.message==="Poller lease lost; restart explicitly")return {stage,category:"lease"};
 return {stage,category:"runtime"};
}
