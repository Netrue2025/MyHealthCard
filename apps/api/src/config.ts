import { z } from "zod";
const bool = z.enum(["true","false"]).transform(v => v === "true");
const schema = z.object({
  NODE_ENV: z.enum(["development","test","production"]).default("development"), PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"), API_ORIGIN: z.string().url().default("http://localhost:3001"),
  MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017/netrue_health"), SESSION_SECRET: z.string().min(32).default("development-only-secret-change-me-000000"),
  UPLOAD_DIR: z.string().default("./uploads"), COOKIE_SECURE: bool.default("false"), SCANNER_MODE: z.enum(["fail-closed","clamav","development-clean"]).default("fail-closed"),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  FEATURE_RESULT_COMPARISON: bool.default("false"), FEATURE_OCR: bool.default("false"), FEATURE_EMERGENCY_PROFILE: bool.default("false")
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.message}`);
export const config = parsed.data;
