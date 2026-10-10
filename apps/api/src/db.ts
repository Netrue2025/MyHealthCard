import { MongoClient, type Db } from "mongodb";
import { config } from "./config.js";
let client: MongoClient | undefined; let database: Db | undefined;
export async function db() { if (!client) { client = new MongoClient(config.MONGODB_URI); await client.connect(); database = client.db(); } return database!; }
export async function closeDb() { await client?.close(); client = undefined; database = undefined; }
export async function ensureIndexes() { const d = await db(); await Promise.all([
  d.collection("users").createIndex({email:1},{unique:true}), d.collection("patients").createIndex({healthId:1},{unique:true}), d.collection("sessions").createIndex({expiresAt:1},{expireAfterSeconds:0}),
  d.collection("records").createIndex({patientId:1,reportDate:-1}), d.collection("history").createIndex({patientId:1,type:1,date:-1}), d.collection("grants").createIndex({recipientId:1,expiresAt:1}),
  d.collection("audit_events").createIndex({patientId:1,createdAt:-1}), d.collection("idempotency").createIndex({expiresAt:1},{expireAfterSeconds:0}), d.collection("files").createIndex({patientId:1,recordId:1}),
  d.collection("medication_schedules").createIndex({patientId:1,createdAt:-1}), d.collection("medication_logs").createIndex({patientId:1,scheduleId:1,scheduledDate:1,time:1},{unique:true}), d.collection("daily_tests").createIndex({patientId:1,measuredAt:-1}),
  d.collection("push_subscriptions").createIndex({endpoint:1},{unique:true}), d.collection("reminder_deliveries").createIndex({scheduleId:1,localDate:1,time:1},{unique:true}), d.collection("reminder_deliveries").createIndex({createdAt:1},{expireAfterSeconds:2592000})
]); }
