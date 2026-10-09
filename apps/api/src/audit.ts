import { db } from "./db.js";
export async function audit(event:{actorId:string;patientId?:string;action:string;resourceType:string;resourceId?:string;outcome:"success"|"denied";requestId:string;organisationId?:string;grantId?:string}) { const d=await db(); await d.collection("audit_events").insertOne({...event,createdAt:new Date()}); }
