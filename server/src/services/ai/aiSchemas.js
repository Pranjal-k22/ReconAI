import { z } from "zod";

/**
 * Allowed advisory recommended next steps for Gemini / Fallback analysis.
 * Gemini MUST NOT recommend financial execution actions (e.g. REFUND_CUSTOMER, CAPTURE_PAYMENT).
 */
export const ALLOWED_RECOMMENDED_NEXT_STEPS = [
  "VERIFY_SOURCE_RECORD",
  "CHECK_SETTLEMENT",
  "CHECK_PAYMENT",
  "CHECK_REFUND",
  "CHECK_FEE",
  "CONTACT_FINANCE_TEAM",
  "MANUAL_REVIEW",
  "NO_ACTION"
];

/**
 * Forbidden actions that must be rejected by Zod schema if returned by AI.
 */
export const FORBIDDEN_ACTIONS = [
  "REFUND_CUSTOMER",
  "CAPTURE_PAYMENT",
  "RETRY_PAYMENT",
  "TRANSFER_FUNDS",
  "DELETE_TRANSACTION",
  "MARK_AS_MATCHED",
  "APPROVE_TRANSACTION",
  "APPROVE_MATCH"
];

/**
 * Zod schema defining the required structured output contract for AI investigation.
 */
export const aiAnalysisOutputSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1, "summary is required")
    .max(1000, "summary cannot exceed 1000 characters"),
  likelyCause: z
    .string()
    .trim()
    .min(1, "likelyCause is required")
    .max(1000, "likelyCause cannot exceed 1000 characters"),
  evidence: z
    .array(z.string().trim())
    .max(10, "evidence array cannot exceed 10 items")
    .default([]),
  recommendedNextStep: z.enum(ALLOWED_RECOMMENDED_NEXT_STEPS, {
    errorMap: () => ({
      message: `recommendedNextStep must be one of: ${ALLOWED_RECOMMENDED_NEXT_STEPS.join(", ")}`
    })
  }),
  riskNotes: z
    .array(z.string().trim())
    .max(10, "riskNotes array cannot exceed 10 items")
    .default([]),
  aiConfidence: z
    .number()
    .min(0, "aiConfidence must be >= 0")
    .max(1, "aiConfidence must be <= 1")
    .nullable()
    .optional()
    .default(null)
});

/**
 * Schema for investigation API request payload.
 */
export const investigateRequestSchema = z.object({
  actorId: z.string().trim().optional().default("demo-finance-reviewer")
});
