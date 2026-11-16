import {createBot,hash} from "../../telegram-bot/bot";
import {gateway} from "../../telegram-bot/gateway";
import type {UserFromGetMe} from "grammy/types";
export function syntheticTelegram(capability:string,identity:string){
 if(!process.env.TELEGRAM_DATABASE_URL)process.loadEnvFile(".env.telegram.local");
 const port=gateway(process.env.TELEGRAM_DATABASE_URL!);
 const info:UserFromGetMe={id:9001,is_bot:true,first_name:"Synthetic Finzi",username:"finzi_fixture_bot",can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false,has_topics_enabled:false,allows_users_to_create_topics:false,can_manage_bots:false,supports_join_request_queries:false};
 const user={id:Number(identity),is_bot:false,first_name:"Synthetic"},chat={id:user.id,type:"private" as const,first_name:"Synthetic"};
 const replies:{text:string;reply_markup?:{inline_keyboard:{text:string;callback_data:string}[][]}}[]=[];let id=8000;
 const bot=createBot("9001:synthetic_token",port,{state:{botId:"9001",offset:0,inbox:[],credentials:[{user:identity,capability,challengeHash:"synthetic",createdAt:Date.now()}]},save:()=>{},sign:v=>hash("synthetic-test-key:"+v).slice(0,48)},info);
 // Strict interception: no test operation can send to a real Telegram server.
 bot.api.config.use(async(previous,method,payload)=>{
  if(method!=="sendMessage"&&method!=="answerCallbackQuery")throw new Error("External Telegram call forbidden in test");
  if(method==="sendMessage")replies.push(payload as typeof replies[number]);
  return {ok:true,result:method==="answerCallbackQuery"?true:{message_id:id,date:Math.floor(Date.now()/1000),chat,text:"ok"}} as Awaited<ReturnType<typeof previous>>;
 });
 return {replies,close:()=>port.close(),send:(text:string)=>bot.handleUpdate({update_id:++id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat,from:user,text}}),click:(data:string)=>bot.handleUpdate({update_id:++id,callback_query:{id:"synthetic-"+id,from:user,chat_instance:"synthetic",data,message:{message_id:1,date:Math.floor(Date.now()/1000),chat,from:info}}})};
}
