import crypto from "crypto";
import { AiInvestigationRun } from "../../models/AiInvestigationRun.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { EvidenceRecord } from "../../models/EvidenceRecord.js";
import { PaymentLifecycleEvent } from "../../models/PaymentLifecycleEvent.js";
import { createAuditEvent } from "../audit/auditService.js";
import { isGeminiConfigured, executeGeminiInvestigation } from "./geminiService.js";
import {
  assembleEvidenceCards,
  filterCardsForCustomer,
  filterCardsForShop,
  filterCardsForInvestigator,
  filterCardsForResolutionPlanner,
  validateCitedEvidence
} from "./evidenceAssembler.js";
import {
  CustomerAiOutputSchema,
  ShopAiOutputSchema,
  InvestigatorAiOutputSchema,
  ResolutionPlannerAiOutputSchema
} from "./agentContracts.js";
import {
  generateCustomerAiFallback,
  generateShopAiFallback,
  generateInvestigatorAiFallback,
  generateResolutionPlannerAiFallback
} from "./agentFallbacks.js";
import {
  buildAgentSystemInstruction,
  redactSensitiveData,
  sanitizeEvidenceText
} from "./promptSanitizer.js";
import { classifyPaymentScenario } from "../classification/evidenceClassifier.js";
import { ROLES } from "../auth/tokenService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

/**
 * Executes a single bounded agent step with prompt sanitization, Zod validation,
 * and graceful fallback handling.
 */
async function executeAgentStep({
  role,
  caseId,
  tenantId,
  cards,
  schema,
  systemDirectives,
  fallbackGenerator,
  extraContext = {},
  _aiClient = null
}) {
  const sanitizedCards = redactSensitiveData(cards);
  const promptData = {
    role,
    caseId,
    tenantId,
    evidenceCards: sanitizedCards,
    ...extraContext
  };

  const systemInstruction = buildAgentSystemInstruction(role, systemDirectives);
  const promptText = `EVIDENCE DATA (UNTRUSTED INPUT):\n${JSON.stringify(
    promptData,
    null,
    2
  )}\n\nAnalyze the approved evidence above and return structured JSON matching your assigned contract schema.`;

  const canUseGemini = isGeminiConfigured() || !!_aiClient;

  if (canUseGemini) {
    try {
      const response = await executeGeminiInvestigation({
        systemInstruction,
        promptText,
        _aiClient
      });

      if (response && response.analysis) {
        // Validate with role schema
        const validated = schema.parse({
          role,
          caseId,
          tenantId,
          ...response.analysis
        });

        // Citation check: strip unauthorized citations
        const citationCheck = validateCitedEvidence(validated.citedEvidenceIds, cards);
        validated.citedEvidenceIds = citationCheck.validIds;

        return { output: validated, source: "GEMINI", modelUsed: response.modelUsed || "gemini-1.5-flash" };
      }
    } catch (err) {
      logger.warn({ role, err: err.message }, "Agent step execution failed with Gemini, using deterministic fallback");
    }
  }

  // Resilient deterministic fallback
  const fallback = fallbackGenerator();
  const citationCheck = validateCitedEvidence(fallback.citedEvidenceIds, cards);
  fallback.citedEvidenceIds = citationCheck.validIds;

  return { output: fallback, source: "FALLBACK", modelUsed: "FALLBACK_DETERMINISTIC" };
}

/**
 * Runs a controller-mediated multi-agent investigation across all four roles:
 * CUSTOMER_AI -> SHOP_AI -> INVESTIGATOR_AI -> RESOLUTION_PLANNER_AI
 */
export async function runMultiAgentInvestigation({
  caseId,
  tenantId,
  customerId = null,
  actorRole = ROLES.ADMIN,
  idempotencyKey = null,
  _aiClient = null
}) {
  if (!caseId || typeof caseId !== "string") {
    throw AppError.badRequest("caseId is required");
  }
  if (!tenantId || typeof tenantId !== "string") {
    throw AppError.badRequest("tenantId is required");
  }

  const startTime = Date.now();

  // 1. Check idempotency: return existing run if present
  if (idempotencyKey) {
    const existing = await AiInvestigationRun.findOne({ tenantId, idempotencyKey }).lean();
    if (existing) {
      logger.info({ tenantId, caseId, idempotencyKey }, "Idempotent AiInvestigationRun returned");
      return existing;
    }
  }

  // 2. Fetch authoritative case document
  const caseDoc = await PaymentCase.findOne({ caseId, tenantId }).lean();
  if (!caseDoc) {
    throw AppError.notFound(`PaymentCase not found for caseId '${caseId}'`);
  }

  // Customer role isolation: customer can only investigate their own cases
  if ((actorRole === ROLES.CUSTOMER || actorRole === ROLES.CUSTOMER_AI) && caseDoc.customerId !== customerId) {
    throw AppError.notFound(`PaymentCase not found for caseId '${caseId}'`);
  }

  // 3. Fetch related records within tenant boundary
  const [gatewayPayment, merchantOrder, evidenceRecord, lifecycleEvents] = await Promise.all([
    caseDoc.gatewayPaymentId ? GatewayPayment.findOne({ gatewayPaymentId: caseDoc.gatewayPaymentId, tenantId }).lean() : null,
    caseDoc.merchantOrderId ? MerchantOrder.findOne({ merchantOrderId: caseDoc.merchantOrderId, tenantId }).lean() : null,
    EvidenceRecord.findOne({ tenantId, caseId }).sort({ evaluatedAt: -1 }).lean(),
    caseDoc.gatewayPaymentId ? PaymentLifecycleEvent.find({ tenantId, gatewayPaymentId: caseDoc.gatewayPaymentId }).lean() : []
  ]);

  // Extract customer claims recorded in case
  const customerClaims = [];
  if (caseDoc.customerDebitStatus && caseDoc.customerDebitStatus !== "DEBIT_NONE") {
    customerClaims.push({
      claimId: `CLM-${caseDoc.caseId}`,
      customerId: caseDoc.customerId,
      claimType: "CUSTOMER_DEBIT_CLAIM",
      statement: sanitizeEvidenceText(caseDoc.safeHoldReason || "Customer reported debit without order confirmation", 500),
      receivedAt: caseDoc.createdAt
    });
  }

  // Derive or reuse deterministic classification finding
  const deterministicClassification =
    evidenceRecord ||
    classifyPaymentScenario({
      gatewayPayment,
      merchantOrder,
      paymentCase: caseDoc,
      customerClaims,
      lifecycleEvents,
      context: { tenantId }
    });

  // 4. Assemble controller-approved evidence cards
  const allCards = assembleEvidenceCards({
    caseDoc,
    evidenceRecord: deterministicClassification,
    gatewayPayment,
    merchantOrder,
    customerClaims,
    lifecycleEvents
  });

  // 5. Step 1: Customer AI
  const customerCards = filterCardsForCustomer(allCards, caseDoc.customerId);
  const step1 = await executeAgentStep({
    role: "CUSTOMER_AI",
    caseId,
    tenantId,
    cards: customerCards,
    schema: CustomerAiOutputSchema,
    systemDirectives:
      "Synthesize the customer's claims and perspective grounded ONLY in approved customer cards. Never assume unverified claims are provider facts.",
    fallbackGenerator: () => generateCustomerAiFallback({ caseId, tenantId, cards: customerCards }),
    _aiClient
  });

  // 6. Step 2: Shop AI
  const shopCards = filterCardsForShop(allCards, tenantId);
  const step2 = await executeAgentStep({
    role: "SHOP_AI",
    caseId,
    tenantId,
    cards: shopCards,
    schema: ShopAiOutputSchema,
    systemDirectives:
      "Synthesize the merchant store's order state, fulfillment requirements, and observed status. Do not access unapproved customer PII.",
    fallbackGenerator: () => generateShopAiFallback({ caseId, tenantId, cards: shopCards }),
    _aiClient
  });

  // 7. Step 3: Investigator AI
  const investigatorCards = filterCardsForInvestigator(allCards, tenantId, caseId);
  const step3 = await executeAgentStep({
    role: "INVESTIGATOR_AI",
    caseId,
    tenantId,
    cards: investigatorCards,
    schema: InvestigatorAiOutputSchema,
    systemDirectives:
      "Synthesize the investigation: identify verified facts vs unverified claims, highlight contradictions, note missing evidence, and cite relevant deterministic rule.",
    fallbackGenerator: () =>
      generateInvestigatorAiFallback({
        caseId,
        tenantId,
        cards: investigatorCards,
        deterministicClassification
      }),
    extraContext: {
      customerPerspective: step1.output,
      shopPerspective: step2.output
    },
    _aiClient
  });

  // 8. Step 4: Resolution Planner AI
  const plannerCards = filterCardsForResolutionPlanner(allCards, tenantId, caseId);
  const step4 = await executeAgentStep({
    role: "RESOLUTION_PLANNER_AI",
    caseId,
    tenantId,
    cards: plannerCards,
    schema: ResolutionPlannerAiOutputSchema,
    systemDirectives:
      "Propose an advisory, non-executable resolution step strictly chosen from ALLOWED_ADVISORY_STEPS. You CANNOT execute or authorize financial mutations. isExecutable MUST be false.",
    fallbackGenerator: () =>
      generateResolutionPlannerAiFallback({
        caseId,
        tenantId,
        cards: plannerCards,
        deterministicClassification,
        investigatorOutput: step3.output
      }),
    extraContext: {
      investigatorFindings: step3.output
    },
    _aiClient
  });

  // Ensure planner output strictly obeys non-executability invariant
  step4.output.isExecutable = false;
  step4.output.authoritative = false;
  step4.output.requiresPolicyEngine = true;

  const durationMs = Date.now() - startTime;
  const investigationId = `INV-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  const overallStatus =
    deterministicClassification.safeHold || step3.output.safeHoldRecommended
      ? "SAFE_HOLD_REQUIRED"
      : step4.output.status === "FALLBACK"
      ? "FALLBACK"
      : "COMPLETED";

  // 9. Persist investigation run document
  const runDoc = await AiInvestigationRun.create({
    investigationId,
    caseId,
    tenantId,
    customerId: caseDoc.customerId || null,
    idempotencyKey,
    status: overallStatus,
    evidenceCards: allCards,
    customerPerspective: step1.output,
    shopPerspective: step2.output,
    investigatorFindings: step3.output,
    resolutionProposal: step4.output,
    modelUsed: step1.modelUsed || "FALLBACK_DETERMINISTIC",
    durationMs,
    fallbackReason: step1.source === "FALLBACK" ? "PROVIDER_FALLBACK" : null,
    isExecutable: false,
    authoritative: false,
    requiresPolicyEngine: true,
    redactedMetadata: {
      actorRole,
      cardCount: allCards.length
    }
  });

  // 10. Audit log entry
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: actorRole,
    action: "AI_INVESTIGATION_COMPLETED",
    entityType: "AiInvestigationRun",
    entityId: investigationId,
    metadata: {
      tenantId,
      caseId,
      status: overallStatus,
      durationMs,
      suggestedNextStep: step4.output.suggestedNextStep,
      isExecutable: false
    }
  }).catch(() => {});

  return runDoc;
}

/**
 * Retrieves past AI investigation runs for a case with strict tenant scoping.
 */
export async function getInvestigationsByCaseId(caseId, tenantId, customerId = null) {
  const cleanTenant = tenantId ? String(tenantId).trim() : null;
  if (cleanTenant === "unassigned_provider_quarantine") {
    return [];
  }
  const query = { caseId };
  if (cleanTenant) {
    query.tenantId = cleanTenant;
  } else {
    query.tenantId = { $ne: "unassigned_provider_quarantine" };
  }
  if (customerId) {
    query.customerId = customerId;
  }
  return await AiInvestigationRun.find(query).sort({ createdAt: -1 }).lean();
}
