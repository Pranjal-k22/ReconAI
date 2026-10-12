import { z } from "zod";

/**
 * ReconAI 2.0 - Agent Contracts & Structured Output Schemas
 *
 * Implements strict Zod schema contracts for the four bounded AI roles:
 * - CUSTOMER_AI
 * - SHOP_AI
 * - INVESTIGATOR_AI
 * - RESOLUTION_PLANNER_AI
 *
 * INVARIANT: Every agent response must validate against its contract schema.
 */

export const EVIDENCE_CARD_TYPES = [
  "PROVIDER_PAYMENT_STATUS",
  "MERCHANT_ORDER_STATE",
  "CUSTOMER_CLAIM_RECORD",
  "SHOP_CLAIM_RECORD",
  "DETERMINISTIC_CLASSIFICATION",
  "LIFECYCLE_EVENT_RECORD"
];

export const EVIDENCE_SOURCES = [
  "GATEWAY_PROVIDER",
  "MERCHANT_ORDER",
  "CUSTOMER_CLAIM",
  "SHOP_CLAIM",
  "DETERMINISTIC_CLASSIFIER",
  "LEDGER_EVENT"
];

export const AUTHORITIES = [
  "PROVIDER_VERIFIED",
  "SYSTEM_RECORD",
  "CUSTOMER_CLAIM",
  "SHOP_CLAIM",
  "ADVISORY_INFERENCE"
];

export const ALLOWED_ADVISORY_STEPS = [
  "ADVISORY_RECONCILE_LOCAL_LEDGER",
  "ADVISORY_WAIT_AND_MONITOR",
  "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW",
  "ADVISORY_HOLD_PARTIALLY_PAID",
  "ADVISORY_WAIT_FOR_SETTLEMENT_WINDOW",
  "ADVISORY_TRACK_AUTO_REVERSAL",
  "ADVISORY_NO_ACTION",
  "ADVISORY_ESCALATE_TO_GATEWAY"
];

export const FORBIDDEN_EXECUTION_KEYWORDS = [
  "REFUND_NOW",
  "CAPTURE_PAYMENT",
  "TRANSFER_FUNDS",
  "EXECUTE_PAYOUT",
  "OVERRIDE_SAFE_HOLD",
  "MARK_RESOLVED",
  "CONFIRM_PAYMENT_DIRECT"
];

/**
 * Evidence Card Contract Schema
 */
export const EvidenceCardSchema = z.object({
  cardId: z.string().trim().min(1),
  cardType: z.enum(EVIDENCE_CARD_TYPES),
  evidenceSource: z.enum(EVIDENCE_SOURCES),
  authority: z.enum(AUTHORITIES),
  verified: z.boolean(),
  tenantId: z.string().trim().min(1),
  caseId: z.string().trim().min(1),
  data: z.record(z.any()),
  evidenceRef: z.string().nullable().optional()
});

/**
 * Customer AI Output Schema
 */
export const CustomerAiOutputSchema = z.object({
  role: z.literal("CUSTOMER_AI"),
  caseId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  perspective: z.string().trim().min(1).max(1200),
  disputedAmountPaise: z.number().int().nonnegative().nullable().optional(),
  citedEvidenceIds: z.array(z.string().trim()).default([]),
  unverifiedClaims: z.array(z.string().trim()).default([]),
  status: z.enum(["COMPLETED", "INSUFFICIENT_EVIDENCE", "FALLBACK"])
});

/**
 * Shop AI Output Schema
 */
export const ShopAiOutputSchema = z.object({
  role: z.literal("SHOP_AI"),
  caseId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  perspective: z.string().trim().min(1).max(1200),
  orderStatusObserved: z.string().trim().min(1),
  citedEvidenceIds: z.array(z.string().trim()).default([]),
  unverifiedClaims: z.array(z.string().trim()).default([]),
  status: z.enum(["COMPLETED", "INSUFFICIENT_EVIDENCE", "FALLBACK"])
});

/**
 * Investigator AI Output Schema
 */
export const InvestigatorAiOutputSchema = z.object({
  role: z.literal("INVESTIGATOR_AI"),
  caseId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  verifiedFacts: z
    .array(
      z.object({
        dimension: z.string().trim(),
        value: z.string().trim(),
        evidenceRef: z.string().trim().min(1)
      })
    )
    .default([]),
  unverifiedClaims: z
    .array(
      z.object({
        claimType: z.string().trim(),
        text: z.string().trim(),
        source: z.string().trim(),
        evidenceRef: z.string().nullable().optional()
      })
    )
    .default([]),
  conflictsAndContradictions: z.array(z.string().trim()).default([]),
  missingEvidence: z.array(z.string().trim()).default([]),
  deterministicScenarioRef: z.string().trim().default("UNKNOWN"),
  safeHoldRecommended: z.boolean().default(false),
  safeHoldCode: z.string().trim().default("NONE"),
  citedEvidenceIds: z.array(z.string().trim()).default([]),
  reasoningSummary: z.string().trim().min(1).max(2000),
  investigativeNextSteps: z.array(z.string().trim()).default([]),
  status: z.enum(["COMPLETED", "INSUFFICIENT_EVIDENCE", "CONTRADICTION_UNRESOLVED", "FALLBACK"])
});

/**
 * Resolution Planner AI Output Schema
 *
 * CRITICAL INVARIANT: isExecutable MUST be false.
 * Action authorization fields like actionEligibility are strictly absent.
 */
export const ResolutionPlannerAiOutputSchema = z.object({
  role: z.literal("RESOLUTION_PLANNER_AI"),
  caseId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  suggestedNextStep: z.enum(ALLOWED_ADVISORY_STEPS),
  proposalSummary: z.string().trim().min(1).max(1200),
  proposalReasoning: z.string().trim().min(1).max(2000),
  citedEvidenceIds: z.array(z.string().trim()).default([]),
  isExecutable: z.literal(false).default(false),
  authoritative: z.literal(false).default(false),
  requiresPolicyEngine: z.literal(true).default(true),
  requiresHumanReview: z.boolean().default(false),
  status: z.enum(["PROPOSAL_GENERATED", "INSUFFICIENT_EVIDENCE", "SAFE_HOLD_REQUIRED", "FALLBACK"])
});
