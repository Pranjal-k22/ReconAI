import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const PROHIBITED_DEV_SECRETS = Object.freeze([
  "reconai-dev-jwt-secret-key-32chars-min!",
  "reconai-service-token-secret-32chars-min!",
  "reconai-test-jwt-secret-key-32chars-min!",
  "reconai-test-service-token-secret-32chars-min!"
]);

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(5000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CLIENT_URL: z.string().default("http://localhost:5173"),
    MONGODB_URI: z.string().default(""),
    GEMINI_API_KEY: z.string().optional().default(""),
    GEMINI_MODEL: z.string().optional().default("gemini-1.5-flash"),
    RAZORPAY_KEY_ID: z.string().optional().default(""),
    RAZORPAY_KEY_SECRET: z.string().optional().default(""),
    RAZORPAY_MODE: z.enum(["test", "live"]).default("test"),
    RAZORPAY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),
    RAZORPAY_SANDBOX_WRITES_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((val) => {
        if (typeof val === "boolean") return val;
        if (typeof val === "string") {
          return val.toLowerCase() === "true" || val === "1";
        }
        return false;
      })
      .default(false),
    DEMO_MODE: z
      .union([z.boolean(), z.string()])
      .transform((val) => {
        if (typeof val === "boolean") return val;
        if (typeof val === "string") {
          return val.toLowerCase() === "true" || val === "1";
        }
        return true;
      })
      .default(true),
    JWT_SECRET: z.string().min(16).default("reconai-dev-jwt-secret-key-32chars-min!"),
    JWT_EXPIRES_IN: z.string().default("1h"),
    JWT_ISSUER: z.string().default("reconai-auth-service"),
    JWT_AUDIENCE: z.string().default("reconai-api"),
    SERVICE_TOKEN_SECRET: z.string().min(16).default("reconai-service-token-secret-32chars-min!"),
    SERVICE_TOKEN_AUDIENCE: z.string().default("reconai-service"),
    MONITORING_WORKER_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((val) => {
        if (typeof val === "boolean") return val;
        if (typeof val === "string") {
          return val.toLowerCase() === "true" || val === "1";
        }
        return true;
      })
      .default(true),
    MONITORING_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    MONITORING_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30000),
    MONITORING_MAX_CONCURRENT_READS: z.coerce.number().int().positive().default(5),
    MONITORING_MAX_ATTEMPTS: z.coerce.number().int().positive().default(4),
    MONITORING_DEADLINE_MINUTES: z.coerce.number().int().positive().default(60)
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "test" && (!data.MONGODB_URI || data.MONGODB_URI.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MONGODB_URI"],
        message: "MONGODB_URI is required in development and production modes"
      });
    }

    if (data.NODE_ENV === "production") {
      // Production signing secret validations: must be >= 32 chars and not match known dev fallbacks
      if (
        !data.JWT_SECRET ||
        data.JWT_SECRET.length < 32 ||
        PROHIBITED_DEV_SECRETS.includes(data.JWT_SECRET) ||
        data.JWT_SECRET.toLowerCase().includes("dev")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_SECRET"],
          message: "Production requires a distinct, cryptographically strong JWT_SECRET (min 32 chars) not matching development fallbacks"
        });
      }

      if (
        !data.SERVICE_TOKEN_SECRET ||
        data.SERVICE_TOKEN_SECRET.length < 32 ||
        PROHIBITED_DEV_SECRETS.includes(data.SERVICE_TOKEN_SECRET) ||
        data.SERVICE_TOKEN_SECRET.toLowerCase().includes("dev")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SERVICE_TOKEN_SECRET"],
          message: "Production requires a distinct, cryptographically strong SERVICE_TOKEN_SECRET (min 32 chars) not matching development fallbacks"
        });
      }

      if (data.JWT_SECRET && data.SERVICE_TOKEN_SECRET && data.JWT_SECRET === data.SERVICE_TOKEN_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SERVICE_TOKEN_SECRET"],
          message: "JWT_SECRET and SERVICE_TOKEN_SECRET must be distinct keys"
        });
      }
    }

    if (data.RAZORPAY_SANDBOX_WRITES_ENABLED === true) {
      if (data.RAZORPAY_MODE !== "test") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RAZORPAY_SANDBOX_WRITES_ENABLED"],
          message: "RAZORPAY_SANDBOX_WRITES_ENABLED can only be enabled when RAZORPAY_MODE is 'test'"
        });
      }
      const keyId = (data.RAZORPAY_KEY_ID || "").trim();
      if (!keyId.startsWith("rzp_test_")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RAZORPAY_KEY_ID"],
          message: "RAZORPAY_SANDBOX_WRITES_ENABLED requires test credentials starting with 'rzp_test_'"
        });
      }
    }
  });

let validatedEnv = null;

export const validateEnv = (customEnv = process.env) => {
  const result = envSchema.safeParse(customEnv);

  if (!result.success) {
    const formattedErrors = result.error.format();
    const messages = result.error.errors.map((e) => e.message).join("; ");
    const error = new Error(`Invalid environment variables setup: ${messages}`);
    error.format = formattedErrors;
    throw error;
  }

  if (customEnv === process.env) {
    validatedEnv = result.data;
  }
  return result.data;
};

export const getEnv = () => {
  if (!validatedEnv) {
    return validateEnv();
  }
  return validatedEnv;
};
