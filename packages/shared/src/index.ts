import { z } from "zod";

export const roles = ["patient", "practitioner", "facility_contributor", "facility_manager", "verifier", "support", "security_admin"] as const;
export type Role = (typeof roles)[number];
export const recordCategories = ["laboratory", "imaging", "prescription", "visit", "procedure", "immunization", "other"] as const;
export const historyTypes = ["medications", "allergies", "conditions", "encounters", "procedures", "immunizations", "vitals", "family_history"] as const;

export const registerSchema = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(128), fullName: z.string().trim().min(2).max(100) });
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1), mfaCode: z.string().regex(/^\d{6}$/).optional() });
export const recordSchema = z.object({ title: z.string().trim().min(2).max(160), category: z.enum(recordCategories), reportDate: z.string().date().optional(), sourceType: z.enum(["patient_upload", "facility_submitted", "manual_entry"]).default("manual_entry") });
export const historySchema = z.object({ label: z.string().trim().min(1).max(160), details: z.string().trim().max(1000).optional(), date: z.string().date().optional(), state: z.enum(["reported", "confirmed", "none_reported", "unknown"]).default("reported") });
export const grantSchema = z.object({ recipientEmail: z.string().email(), resourceIds: z.array(z.string().min(1)).min(1).max(100), actions: z.array(z.enum(["view", "download", "review"])).min(1), purpose: z.string().trim().min(2).max(240), durationHours: z.union([z.literal(1), z.literal(24), z.literal(168)]).default(24) });
export const observationSchema = z.object({ label: z.string().trim().min(1).max(160), rawValue: z.string().max(100), numericValue: z.number().finite().optional(), comparator: z.enum(["<", "<=", "=", ">=", ">"]).optional(), unit: z.string().max(40).optional(), lower: z.number().finite().optional(), upper: z.number().finite().optional(), lowerInclusive: z.boolean().default(true), upperInclusive: z.boolean().default(true), rawInterval: z.string().max(120).optional(), applicability: z.string().max(160).optional(), laboratoryFlag: z.enum(["normal", "abnormal", "critical", "unknown"]).default("unknown"), confirmed: z.boolean().default(false) });

export type ApiError = { code: string; message: string; requestId: string; fieldErrors?: Record<string, string[]> };
export type SessionUser = { id: string; email: string; fullName: string; roles: Role[]; patientId?: string; practitionerStatus?: "pending" | "verified" | "suspended"; mfaVerified: boolean };
