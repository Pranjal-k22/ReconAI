import { z } from "zod";

export const humanDecisionSchema = z.object({
  decision: z.enum(["APPROVE_MATCH", "KEEP_EXCEPTION", "MARK_RESOLVED"], {
    errorMap: () => ({ message: "Invalid decision. Allowed: APPROVE_MATCH, KEEP_EXCEPTION, MARK_RESOLVED" })
  }),
  resolutionNotes: z.string().trim().min(5, "resolutionNotes must be at least 5 characters long").max(2000, "resolutionNotes cannot exceed 2000 characters"),
  actorId: z.string().trim().optional().default("demo-finance-reviewer")
});
