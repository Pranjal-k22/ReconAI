import { z } from "zod";

export const createControllerRunSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name cannot exceed 100 characters")
    .optional(),
  sourceMode: z
    .enum(["SYNTHETIC", "CSV", "RAZORPAY", "MIXED"], {
      errorMap: () => ({
        message: "Invalid sourceMode. Supported modes: SYNTHETIC, CSV, RAZORPAY, MIXED"
      })
    })
    .optional()
    .default("SYNTHETIC"),
  importBatchId: z.string().trim().optional().default("BATCH-DEMO-V1"),
  datasetVersion: z.string().trim().optional().default("RECONAI_DEMO_V1"),
  autoInvestigate: z.boolean().optional().default(true)
});
