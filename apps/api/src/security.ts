import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { db } from "./db.js";
import { config } from "./config.js";
import type { SessionUser } from "@netrue/shared";

export const hashToken = (value:string) => createHash("sha256").update(`${config.SESSION_SECRET}:${value}`).digest("hex");
export const safeEqual = (a:string,b:string) => { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); };
export const newToken = (bytes=32) => randomBytes(bytes).toString("base64url");
const sessionMaxAgeSeconds=()=>config.SESSION_TTL_DAYS*24*60*60;
export async function createSession(userId:ObjectId, mfaVerified=false) { const token=newToken(); const csrf=newToken(24); const d=await db(); await d.collection("sessions").insertOne({userId,tokenHash:hashToken(token),csrfHash:hashToken(csrf),mfaVerified,createdAt:new Date(),lastSeenAt:new Date(),expiresAt:new Date(Date.now()+sessionMaxAgeSeconds()*1000)}); return {token,csrf}; }
export async function sessionUser(request:FastifyRequest): Promise<SessionUser | null> { const token=request.cookies.netrue_session; if(!token)return null; const d=await db(); const session=await d.collection("sessions").findOne({tokenHash:hashToken(token),expiresAt:{$gt:new Date()}}); if(!session)return null; const user=await d.collection("users").findOne({_id:session.userId,state:"active"}); if(!user)return null; await d.collection("sessions").updateOne({_id:session._id},{$set:{lastSeenAt:new Date(),expiresAt:new Date(Date.now()+sessionMaxAgeSeconds()*1000)}}); return {id:user._id.toString(),email:user.email,fullName:user.fullName,roles:user.roles,patientId:user.patientId?.toString(),practitionerStatus:user.practitionerStatus,mfaVerified:session.mfaVerified}; }
export async function requireUser(request:FastifyRequest, reply:FastifyReply) { const user=await sessionUser(request); if(!user){ return reply.code(401).send({code:"UNAUTHENTICATED",message:"Sign in is required.",requestId:request.id}); } (request as any).user=user; return user; }
export function assertCsrf(request:FastifyRequest, reply:FastifyReply) { if(["GET","HEAD","OPTIONS"].includes(request.method))return true; const cookie=request.cookies.netrue_csrf; const header=request.headers["x-csrf-token"]; if(!cookie||typeof header!=="string"||!safeEqual(hashToken(cookie),hashToken(header))){reply.code(403).send({code:"CSRF_REJECTED",message:"The security token is missing or invalid.",requestId:request.id});return false;} return true; }
export function setSessionCookies(reply:FastifyReply,token:string,csrf:string){ const common={secure:config.COOKIE_SECURE,httpOnly:true,sameSite:"strict" as const,path:"/",maxAge:sessionMaxAgeSeconds()}; reply.setCookie("netrue_session",token,common); reply.setCookie("netrue_csrf",csrf,{...common,httpOnly:false}); }
export function clearSessionCookies(reply:FastifyReply){reply.clearCookie("netrue_session",{path:"/"});reply.clearCookie("netrue_csrf",{path:"/"});}
