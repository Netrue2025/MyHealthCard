import webpush from "web-push";
import { db } from "./db.js";
import { config } from "./config.js";

let timer: NodeJS.Timeout | undefined;
function localParts(now:Date,timeZone:string){const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);const get=(type:string)=>parts.find(p=>p.type===type)?.value??"";return {date:`${get("year")}-${get("month")}-${get("day")}`,time:`${get("hour")}:${get("minute")}`};}
async function tick(){const d=await db();const now=new Date();const schedules=await d.collection("medication_schedules").find({reminderEnabled:true,active:true}).toArray();for(const schedule of schedules){let local;try{local=localParts(now,schedule.timezone)}catch{continue}if(!schedule.times.includes(local.time)||local.date<(schedule.startDate??"0000-00-00")||(schedule.endDate&&local.date>schedule.endDate))continue;try{await d.collection("reminder_deliveries").insertOne({scheduleId:schedule._id,localDate:local.date,time:local.time,createdAt:now});}catch(error:any){if(error?.code===11000)continue;throw error}const subscriptions=await d.collection("push_subscriptions").find({userId:schedule.userId}).toArray();for(const subscription of subscriptions){try{await webpush.sendNotification(subscription.subscription,JSON.stringify({title:"Medication reminder",body:"A scheduled medication is due. Open Netrue Health for the details.",url:"/daily-care"}));}catch(error:any){if(error?.statusCode===404||error?.statusCode===410)await d.collection("push_subscriptions").deleteOne({_id:subscription._id});}}
}}
export function startReminderWorker(){if(!config.VAPID_PUBLIC_KEY||!config.VAPID_PRIVATE_KEY)return;webpush.setVapidDetails(config.VAPID_SUBJECT,config.VAPID_PUBLIC_KEY,config.VAPID_PRIVATE_KEY);timer=setInterval(()=>void tick().catch(()=>undefined),30000);void tick().catch(()=>undefined);}
export function stopReminderWorker(){if(timer)clearInterval(timer);}
