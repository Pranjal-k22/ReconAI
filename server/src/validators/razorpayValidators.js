import { z } from "zod";

export const syncPaymentsSchema = z
  .object({
    from: z.coerce.number().int().positive().optional(),
    to: z.coerce.number().int().positive().optional(),
    actorId: z.string().trim().optional().default("demo-finance-reviewer")
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to && data.from > data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "'from' timestamp cannot be greater than 'to' timestamp"
      });
    }
  });

export const syncSettlementsSchema = z.object({
  year: z.coerce.number().int().min(2000, "Year must be >= 2000").max(2100, "Year must be <= 2100"),
  month: z.coerce.number().int().min(1, "Month must be between 1 and 12").max(12, "Month must be between 1 and 12"),
  day: z.coerce.number().int().min(1, "Day must be between 1 and 31").max(31, "Day must be between 1 and 31").optional(),
  actorId: z.string().trim().optional().default("demo-finance-reviewer")
});
