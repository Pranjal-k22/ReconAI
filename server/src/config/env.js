import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  MONGODB_URI: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
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
});

let validatedEnv = null;

export const validateEnv = () => {
  if (validatedEnv) return validatedEnv;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:", result.error.format());
    throw new Error("Invalid environment variables setup");
  }

  validatedEnv = result.data;
  return validatedEnv;
};

export const getEnv = () => {
  if (!validatedEnv) {
    return validateEnv();
  }
  return validatedEnv;
};
