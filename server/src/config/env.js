import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(5000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CLIENT_URL: z.string().default("http://localhost:5173"),
    MONGODB_URI: z.string().default(""),
    GEMINI_API_KEY: z.string().optional().default(""),
    GEMINI_MODEL: z.string().optional().default("gemini-2.5-flash"),
    RAZORPAY_KEY_ID: z.string().optional().default(""),
    RAZORPAY_KEY_SECRET: z.string().optional().default(""),
    RAZORPAY_MODE: z.enum(["test", "live"]).default("test"),
    RAZORPAY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    DEMO_MODE: z
      .union([z.boolean(), z.string()])
      .transform((val) => {
        if (typeof val === "boolean") return val;
        if (typeof val === "string") {
          return val.toLowerCase() === "true" || val === "1";
        }
        return true;
      })
      .default(true)
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "test" && (!data.MONGODB_URI || data.MONGODB_URI.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MONGODB_URI"],
        message: "MONGODB_URI is required in development and production modes"
      });
    }
  });

let validatedEnv = null;

export const validateEnv = (customEnv = process.env) => {
  const result = envSchema.safeParse(customEnv);

  if (!result.success) {
    const formattedErrors = result.error.format();
    const errorMsg = "Invalid environment variables setup: MONGODB_URI is required in development and production modes";
    const error = new Error(errorMsg);
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
