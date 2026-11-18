import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { receiver } from "../../telegram-webhook/worker";
import { runBatch, type Environment } from "../../telegram-webhook/processor";
import { unseal } from "../../telegram-webhook/crypto";
import { localTransport, fixtureSql } from "./telegram-transport";

export function syntheticTelegram(identity: string) {
  const t=localTransport(), uri=new URL(parseEnv(readFileSync(".env.telegram.local","utf8")).TELEGRAM_DATABASE_URL ?? "");
  if(!["127.0.0.1","localhost"].includes(uri.hostname))throw new Error("local_only");uri.search="";
  const env:Environment={TELEGRAM_WEBHOOK_BOT_ID:t.bot,TELEGRAM_WEBHOOK_BOT_USERNAME:"finzi_fixture_bot",TELEGRAM_WEBHOOK_BOT_TOKEN:t.bot+":synthetic_test_only",TELEGRAM_DB:{connectionString:uri.toString()},TELEGRAM_WEBHOOK_SECRET:"a".repeat(40),TELEGRAM_WEBHOOK_CUSTODY_KEY:"b".repeat(64),TELEGRAM_WEBHOOK_CALLBACK_KEY:"c".repeat(64),TELEGRAM_WEBHOOK_URL:"https://synthetic.invalid/telegram/webhook"};
  const user={id:Number(identity),is_bot:false,first_name:"Synthetic"},chat={id:user.id,type:"private",first_name:"Synthetic"};
  const replies:{text:string;reply_markup?:{inline_keyboard:{text:string;callback_data:string}[][]}}[]=[];
  let id=Date.now();
  const sender:Parameters<typeof runBatch>[3]=async calls=>{for(const call of calls){if(call.method!=="sendMessage"&&call.method!=="answerCallbackQuery")throw new Error("external_call_forbidden");if(call.method==="sendMessage"){if(String(call.payload.chat_id)!==identity)throw new Error("foreign_chat");replies.push(call.payload as typeof replies[number]);}}};
  async function receive(update:object){
    const response=await receiver()(new Request("http://localhost/telegram/webhook",{method:"POST",headers:{"content-type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(update)}),env);
    if(response.status!==200)throw new Error("local_receive_failed");
    if(!await runBatch(t.db,env,"process",sender))throw new Error("local_process_failed");
    if(!await runBatch(t.db,env,"deliver",sender))throw new Error("local_delivery_failed");
  }
  return {
    replies,
    async close(){await t.close();fixtureSql(`update telegram_private.transport_bots set enabled=false where bot_id='${t.bot}';`);},
    send:(text:string)=>{id=t.nextUpdate();return receive({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat,from:user,text,...(text.startsWith("/")?{entities:[{type:"bot_command",offset:0,length:text.split(/\s/)[0].length}]}:{})}});},
    click:(data:string)=>{id=t.nextUpdate();return receive({update_id:id,callback_query:{id:"synthetic-"+id,from:user,chat_instance:"synthetic",data,message:{message_id:1,date:Math.floor(Date.now()/1000),chat,from:{id:Number(t.bot),is_bot:true,first_name:"Synthetic"}}}});},
    async context(){
      const e=await t.event(identity);
      try{const rows=await t.db.credentials(t.bot,e.event.id,e.lease);if(!rows.length)return null;const row=rows[0];const value=await unseal<{capability:string}>(env.TELEGRAM_WEBHOOK_CUSTODY_KEY,"credentials",JSON.stringify(["credential-v1",t.bot,identity,row.challengeHash]),row.ciphertext);return await t.db.call(t.bot,e.event.id,e.lease,"context",{capability:value.capability}) as Record<string,string>|null;}
      finally{await t.complete(e.event,e.lease);}
    }
  };
}
